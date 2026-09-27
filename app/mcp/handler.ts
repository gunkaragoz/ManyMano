// POST /mcp: stateless MCP over Streamable HTTP (JSON responses, no
// sessions, no GET streams). workers/app.ts only imports this when
// MCP_ENABLED is "true".
//
// Checks run before any tool: method, Origin, per-IP limit, body size,
// one well-formed JSON-RPC message. Only `tools/call` reserves the daily
// call budget in D1; discovery stays off D1 so a WebMCP bridge listing
// tools on page views can't drain it.
//
// The endpoint is public and unauthenticated on purpose. It never reads
// cookies or admin tokens — a same-origin browser call (WebMCP) gets no
// more power than any other caller.

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { JSONRPCMessageSchema, isJSONRPCRequest } from "@modelcontextprotocol/sdk/types.js";
import type { CloudflareEnv } from "~/utils/cloudflare-context";
import { getMcpLimits, reserveMcpUnit, secondsUntilUtcMidnight, type McpLimits } from "~/utils/mcp-quota";
import { resolveRetentionDays } from "~/utils/retention";
import { getSiteConfig } from "~/utils/site";
import { createWindowLimiter } from "./rate-limit";
import { buildMcpServer } from "./tools";

export const MAX_BODY_BYTES = 64 * 1024;
const REQUEST_WINDOW_MS = 10 * 60 * 1000;

// Per isolate; see rate-limit.ts for what that does and doesn't cover.
const requestLimiter = createWindowLimiter({ limit: 60, windowMs: REQUEST_WINDOW_MS, maxKeys: 5000 });
const createLimiter = createWindowLimiter({ limit: 10, windowMs: REQUEST_WINDOW_MS, maxKeys: 5000 });

type Ctx = Pick<ExecutionContext, "waitUntil">;

function withNoStore(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function plain(status: number, text: string, headers: Record<string, string> = {}): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function rpcError(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

/** Read at most `max` bytes; null when the body is larger. */
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function handleMcp(request: Request, env: CloudflareEnv, ctx: Ctx): Promise<Response> {
  if (env.MCP_ENABLED !== "true") return plain(404, "Not found");
  if (request.method !== "POST") return plain(405, "Method not allowed. MCP here is POST-only.", { Allow: "POST" });

  const site = getSiteConfig(env);
  // Browser calls must be same-origin: the host serving this request (branch
  // previews run on changing hosts that SITE_URL doesn't name) or SITE_URL.
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin && origin !== new URL(site.siteUrl).origin) {
    return plain(403, "Origin not allowed.");
  }

  // Cloudflare sets cf-connecting-ip; forwarded-for headers are never trusted.
  const clientIp = request.headers.get("cf-connecting-ip") || "unknown";
  if (!requestLimiter.hit(clientIp)) {
    return rpcError(429, -32000, "Too many requests. Try again later.", {
      "Retry-After": String(REQUEST_WINDOW_MS / 1000),
    });
  }

  const encoding = (request.headers.get("content-encoding") || "identity").trim().toLowerCase();
  if (encoding !== "identity") return rpcError(415, -32000, "Compressed request bodies are not supported.");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return rpcError(413, -32000, "Request body too large.");
  }
  const bytes = await readCapped(request, MAX_BODY_BYTES);
  if (bytes === null) return rpcError(413, -32000, "Request body too large.");

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return rpcError(400, -32700, "Parse error: invalid JSON.");
  }
  if (Array.isArray(parsedBody)) return rpcError(400, -32600, "Batch requests are not supported. Send one message per POST.");
  const message = JSONRPCMessageSchema.safeParse(parsedBody);
  if (!message.success) return rpcError(400, -32600, "Invalid JSON-RPC message.");

  let limits: McpLimits;
  try {
    limits = getMcpLimits(env);
  } catch (err) {
    console.error(String((err as Error).message));
    return rpcError(503, -32000, "Service unavailable.", { "Retry-After": "300" });
  }

  const alerts = {
    webhookUrl: env.ALERT_WEBHOOK_URL,
    appName: site.siteName,
    defer: (p: Promise<unknown>) => ctx.waitUntil(p),
  };

  if (isJSONRPCRequest(message.data) && message.data.method === "tools/call") {
    const now = new Date();
    let admitted: boolean;
    try {
      admitted = await reserveMcpUnit(env.DB, "calls", limits, now, alerts);
    } catch {
      return rpcError(503, -32000, "Service unavailable. Try again later.", { "Retry-After": "60" });
    }
    if (!admitted) {
      return rpcError(429, -32000, "Daily limit reached. Try again after 00:00 UTC.", {
        "Retry-After": String(secondsUntilUtcMidnight(now)),
      });
    }
  }

  const server = buildMcpServer({
    d1: env.DB,
    siteUrl: site.siteUrl,
    siteName: site.siteName,
    retentionDays: resolveRetentionDays(env),
    limits,
    clientIp,
    createLimiter,
    alerts,
    now: () => new Date(),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    // JSON mode resolves once the full response body exists.
    const res = await transport.handleRequest(request, { parsedBody: message.data });
    return withNoStore(res);
  } finally {
    await server.close().catch(() => {});
  }
}
