// The three MCP tools. Schemas are built once per isolate; a fresh server
// is assembled per request (stateless transport).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  CAPACITY_MAX,
  CAPACITY_MIN,
  POLL_DURATION_MAX,
  POLL_DURATION_MIN,
  insertEvent,
  normalizePollInput,
  normalizeSignupInput,
  type Normalized,
} from "~/utils/event-create";
import { readPublicEvent } from "~/utils/event-read";
import { reserveMcpUnit, type McpAlertOpts, type McpLimits } from "~/utils/mcp-quota";
import { organizerLinks } from "~/utils/organizer-email";
import {
  DESCRIPTION_MAX,
  LOCATION_MAX,
  MAX_SLOTS_PER_EVENT,
  MAX_TASKS_PER_DATE,
  ORGANIZER_NAME_MAX,
  SLOT_TITLE_MAX,
  TIMEZONE_MAX,
  TITLE_MAX,
} from "~/utils/validation";
import type { WindowLimiter } from "./rate-limit";

export const CREATE_NOTE =
  "No email was sent. Keep the admin link private: it grants full control of this event. " +
  "Save it now, then open it to add an email for a backup. Without a saved email, we cannot recover a lost admin link.";

const ADMIN_LINK_RULES =
  "The result includes adminUrl, a secret link with full control of the event. Give it only to the organizer who asked; " +
  "never put it in invitations, messages to participants or public posts. Share publicUrl with participants. " +
  "No email is sent. Each call creates a new event: if a call fails or times out, don't retry automatically — ask the user first.";

const date = z.string().describe("Date as YYYY-MM-DD, in the event's timezone.");
const hhmm = z.string().describe("24-hour time as HH:MM, in the event's timezone.");
const tz = z.string().max(TIMEZONE_MAX).describe("IANA timezone name, e.g. America/New_York.");

const signupInput = z.strictObject({
  title: z.string().max(TITLE_MAX),
  description: z.string().max(DESCRIPTION_MAX).optional(),
  location: z.string().max(LOCATION_MAX).optional().describe("Address or meeting link."),
  date: date.optional().describe("The day of the event (YYYY-MM-DD). Omit for an undated list; tasks then take no times."),
  timezone: tz,
  organizerName: z.string().max(ORGANIZER_NAME_MAX),
  tasks: z
    .array(
      z.strictObject({
        title: z.string().max(SLOT_TITLE_MAX).describe("What people sign up for, e.g. 'Bring drinks' or 'Setup crew'."),
        capacity: z.number().int().min(CAPACITY_MIN).max(CAPACITY_MAX).describe("How many people this task needs."),
        startTime: hhmm.optional(),
        endTime: hhmm.optional().describe("Required with startTime; must be later the same day."),
      })
    )
    .min(1)
    .max(MAX_TASKS_PER_DATE),
});

const pollInput = z.strictObject({
  title: z.string().max(TITLE_MAX),
  description: z.string().max(DESCRIPTION_MAX).optional(),
  location: z.string().max(LOCATION_MAX).optional().describe("Address or meeting link."),
  timezone: tz,
  organizerName: z.string().max(ORGANIZER_NAME_MAX),
  allDay: z.boolean().optional().describe("true for whole-day options (then no durationMinutes and no startTime)."),
  durationMinutes: z
    .number()
    .int()
    .min(POLL_DURATION_MIN)
    .max(POLL_DURATION_MAX)
    .optional()
    .describe("Length of each timed option. Required unless allDay is true."),
  options: z
    .array(
      z.strictObject({
        date,
        startTime: hhmm.optional().describe("Required for timed polls; omit for all-day polls."),
      })
    )
    .min(1)
    .max(MAX_SLOTS_PER_EVENT),
});

const createOutput = z.object({
  eventId: z.string(),
  publicUrl: z.string(),
  adminUrl: z.string(),
  qrUrl: z.string(),
  note: z.string(),
});

const slotBase = {
  id: z.string(),
  title: z.string(),
  date: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
};

const eventOutput = z.object({
  eventId: z.string(),
  publicUrl: z.string(),
  type: z.enum(["signup_sheet", "poll"]),
  title: z.string(),
  location: z.string().nullable(),
  date: z.string().nullable(),
  timezone: z.string(),
  status: z.enum(["open", "closed", "finalized"]),
  durationMinutes: z.number().nullable().optional(),
  winningOptionId: z.string().nullable().optional(),
  slots: z
    .array(z.object({ ...slotBase, capacity: z.number().nullable(), filled: z.number() }))
    .optional()
    .describe("Sign-up sheets: capacity (null = unlimited) and confirmed sign-ups per task."),
  options: z
    .array(z.object({ ...slotBase, yes: z.number(), maybe: z.number(), no: z.number() }))
    .optional()
    .describe("Polls: votes per option. People who didn't answer an option aren't counted as no."),
});

export interface McpToolContext {
  d1: D1Database;
  siteUrl: string;
  siteName: string;
  retentionDays: number;
  limits: McpLimits;
  clientIp: string;
  createLimiter: WindowLimiter;
  alerts: McpAlertOpts;
  now: () => Date;
}

function toolError(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function toolResult(value: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

async function createFromNormalized(ctx: McpToolContext, normalized: Normalized): Promise<CallToolResult> {
  if (!normalized.ok) return toolError(normalized.error);
  if (!ctx.createLimiter.hit(ctx.clientIp)) {
    return toolError("Too many events created from this network recently. Try again later or use the website.");
  }
  const now = ctx.now();
  let admitted: boolean;
  try {
    admitted = await reserveMcpUnit(ctx.d1, "writes", ctx.limits, now, ctx.alerts);
  } catch {
    return toolError("Can't create events right now. Try again later.");
  }
  if (!admitted) return toolError("Daily create limit reached. Try tomorrow or use the website.");

  let created: { eventId: string; adminToken: string };
  try {
    created = await insertEvent(ctx.d1, normalized.event, now);
  } catch {
    return toolError("Couldn't create the event; nothing was saved. Don't retry automatically.");
  }
  const links = organizerLinks(ctx.siteUrl, created.eventId, created.adminToken);
  return toolResult({ eventId: created.eventId, ...links, note: CREATE_NOTE });
}

// Elicitation is never used, so the SDK's default Ajv validator (which
// generates code, blocked on Workers) is swapped for one that refuses.
const noJsonSchemaValidation = {
  getValidator: () => () => ({
    valid: false as const,
    data: undefined,
    errorMessage: "JSON Schema validation is not available on this server.",
  }),
};

export const TOOL_NAMES = ["create_signup_sheet", "create_poll", "get_event"] as const;

export function buildMcpServer(ctx: McpToolContext): McpServer {
  const server = new McpServer(
    { name: ctx.siteName, version: "1.0.0" },
    {
      capabilities: { tools: {} },
      jsonSchemaValidator: noJsonSchemaValidation,
      instructions:
        `Create ${ctx.siteName} sign-up sheets and meeting polls and read their public results. ` +
        "No accounts. Joining, voting and managing happen on the website through the returned links.",
    }
  );

  server.registerTool(
    "create_signup_sheet",
    {
      title: "Create sign-up sheet",
      description:
        "Create a sign-up sheet where people claim tasks or shifts, each with a capacity (e.g. potluck dishes, volunteer shifts). " +
        "One date at most. " +
        ADMIN_LINK_RULES,
      inputSchema: signupInput,
      outputSchema: createOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => createFromNormalized(ctx, normalizeSignupInput(args, ctx.now()))
  );

  server.registerTool(
    "create_poll",
    {
      title: "Create meeting poll",
      description:
        "Create a meeting poll where people vote Yes / Maybe / No on proposed times or days. " +
        "Use allDay: true for whole days, or durationMinutes with a startTime on every option. " +
        ADMIN_LINK_RULES,
      inputSchema: pollInput,
      outputSchema: createOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => createFromNormalized(ctx, normalizePollInput(args, ctx.now()))
  );

  server.registerTool(
    "get_event",
    {
      title: "Get event results",
      description:
        "Read the public summary of a sign-up sheet or poll: tasks with filled counts, or options with vote counts. " +
        "No names or emails are returned.",
      inputSchema: z.strictObject({
        eventId: z.string().min(1).max(64).describe("The eventId returned at creation, or the last part of the public link."),
      }),
      outputSchema: eventOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ eventId }) => {
      try {
        const res = await readPublicEvent(ctx.d1, eventId, {
          siteUrl: ctx.siteUrl,
          retentionDays: ctx.retentionDays,
          now: ctx.now(),
        });
        return res.ok ? toolResult({ ...res.summary }) : toolError(res.error);
      } catch {
        return toolError("Can't read events right now. Try again later.");
      }
    }
  );

  return server;
}
