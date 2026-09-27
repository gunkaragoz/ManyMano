// Drive real route loaders/actions against the node:sqlite D1 stand-in,
// through a RouterContextProvider seeded the same way workers/app.ts does.

import { RouterContextProvider } from "react-router";
import { cloudflareContext, type CloudflareEnv } from "~/utils/cloudflare-context";
import { sha256Hex } from "~/utils/auth";
import type { SqliteD1 } from "./sqlite-d1";

export const SITE_URL = "https://example.com";

export function testEnv(db: SqliteD1, extra: Partial<CloudflareEnv> = {}): CloudflareEnv {
  return {
    DB: db.d1,
    SITE_URL,
    SITE_NAME: "ManyMano",
    SITE_TAGLINE: "tag",
    SITE_DESCRIPTION: "desc",
    FROM_EMAIL: "ManyMano <no-reply@mail.example.com>",
    ...extra,
  } as CloudflareEnv;
}

export function routeContext(env: CloudflareEnv): RouterContextProvider {
  const ctx = new RouterContextProvider();
  ctx.set(cloudflareContext, {
    env,
    cf: {} as CfProperties,
    ctx: { waitUntil: () => {}, passThroughOnException: () => {} },
    caches: {} as CacheStorage,
  });
  return ctx;
}

export function postForm(
  path: string,
  fields: Record<string, string>,
  headers: Record<string, string> = {}
): Request {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request(`${SITE_URL}${path}`, { method: "POST", body, headers });
}

/** Insert an event (and optional slot); returns its plaintext admin token. */
export async function seedEvent(
  db: SqliteD1,
  opts: {
    id?: string;
    type?: "SIGNUP_SHEET" | "TIME_POLL";
    organizerEmail?: string;
    eventDate?: string | null;
    slot?: { id: string; title?: string; capacity?: number; slotDate?: string | null; startTime?: string | null };
  } = {}
): Promise<{ id: string; adminToken: string }> {
  const id = opts.id ?? "evt123";
  const adminToken = `tok_${id}_secret`;
  const now = new Date().toISOString();
  db.sqlite
    .prepare(
      `INSERT INTO events (id, type, title, event_date, organizer_name, organizer_email, admin_token, status, settings, timezone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', '{}', 'UTC', ?, ?)`
    )
    .run(
      id,
      opts.type ?? "SIGNUP_SHEET",
      "Park <Cleanup>",
      opts.eventDate ?? null,
      "Sam",
      opts.organizerEmail ?? "",
      await sha256Hex(adminToken),
      now,
      now
    );
  if (opts.slot) {
    db.sqlite
      .prepare(
        `INSERT INTO event_slots (id, event_id, title, slot_date, start_time, capacity, display_order) VALUES (?, ?, ?, ?, ?, ?, 0)`
      )
      .run(
        opts.slot.id,
        id,
        opts.slot.title ?? "Task",
        opts.slot.slotDate ?? null,
        opts.slot.startTime ?? null,
        opts.slot.capacity ?? 3
      );
  }
  return { id, adminToken };
}

export function eventRow(db: SqliteD1, id: string) {
  return db.sqlite.prepare("SELECT * FROM events WHERE id = ?").get(id) as Record<string, unknown>;
}
