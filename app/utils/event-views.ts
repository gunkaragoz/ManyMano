// Unique view counting for event pages.
//
// Design: one row per (event, viewer) in `event_views`. A viewer is
// identified by a long-lived random cookie (`mm_viewer`). The stored key is
// a SHA-256 hash of that cookie value, so the raw token never hits the DB.
// Cookie-less first loads fall back to a day-rotating salted IP+UA slot; the
// next load (now carrying the issued cookie) adopts that slot into a
// personal row, so one browser still counts exactly once.
//
// What does NOT count:
// - background live-sync polls (`?poll=1`, every few seconds per open tab)
// - bots (User-Agent via `isbot`, also honored in entry.server)
// - organizer admin views (so "viewed N times" measures guest interest;
//   organizers refreshing their own page don't inflate it)
// - repeated loads from the same viewer (INSERT OR IGNORE dedupes)
//
// Reads never throw: tracking failures degrade to "show the count we have".

import { isbot } from "isbot";
import { sha256Hex } from "./auth";
import { generateSecretToken } from "./ids";

export const VIEWER_COOKIE = "mm_viewer";
const VIEWER_ID_RE = /^[A-Za-z0-9]{20,64}$/;
const LAST_SEEN_REFRESH_MS = 24 * 60 * 60 * 1000;

export function getViewerIdFromCookies(request: Request): string | null {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== VIEWER_COOKIE) continue;
    const value = decodeURIComponent(part.slice(idx + 1).trim());
    if (VIEWER_ID_RE.test(value)) return value;
    return null;
  }
  return null;
}

export function buildViewerCookie(viewerId: string): string {
  // Global (not per-event) so one browser counts once across events, not
  // once per event-cookie. Secure is ignored on http://localhost but
  // harmless to send.
  return `${VIEWER_COOKIE}=${encodeURIComponent(viewerId)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
}

export interface TrackViewOptions {
  isAdmin: boolean;
  isPoll: boolean;
}

/** Record a unique view (best-effort) and return the current unique count. */
export async function trackEventView(
  d1: D1Database,
  eventId: string,
  request: Request,
  opts: TrackViewOptions
): Promise<{ viewCount: number; setViewerCookie: string | null }> {
  const countOnly = async () => ({ viewCount: await countEventViews(d1, eventId), setViewerCookie: null });
  try {
    // Live-sync polls, bots and organizer views never increment.
    if (opts.isPoll || opts.isAdmin) return await countOnly();
    if (isbot(request.headers.get("user-agent") || "")) return await countOnly();

    const now = new Date().toISOString();
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const ua = (request.headers.get("user-agent") || "").slice(0, 200);
    const cookieId = getViewerIdFromCookies(request);

    if (cookieId) {
      // Known browser identity: single-row invariant, refresh-safe.
      const viewerKey = await sha256Hex(`event-view:${cookieId}`);
      await d1
        .prepare(
          `INSERT OR IGNORE INTO event_views (event_id, viewer_key, first_seen, last_seen)
           VALUES (?1, ?2, ?3, ?3)`
        )
        .bind(eventId, viewerKey, now)
        .run();
      // Adopt today's shared IP slot into this personal row. Runs on every
      // load (idempotent): if a previous adoption-delete was lost to a
      // transient D1 failure, a later load heals it instead of double
      // counting this browser forever. Scoped to today's IP key, and if the
      // slot belongs to another cookie-less browser behind the same NAT,
      // their next refresh simply re-creates it (self-healing, ±1 at most).
      const ipKey = await ipDayKey(eventId, ip, ua);
      if (ipKey !== viewerKey) {
        await d1
          .prepare(`DELETE FROM event_views WHERE event_id = ?1 AND viewer_key = ?2`)
          .bind(eventId, ipKey)
          .run();
      }
      await refreshLastSeen(d1, eventId, viewerKey, now);
      return { viewCount: await countEventViews(d1, eventId), setViewerCookie: null };
    }

    // No usable cookie: count under today's shared IP+UA slot (one per day,
    // so refresh storms still count once) and issue the persistent cookie so
    // the next load upgrades to a personal row (see above).
    const viewerId = generateSecretToken();
    const ipKey = await ipDayKey(eventId, ip, ua);
    await d1
      .prepare(
        `INSERT OR IGNORE INTO event_views (event_id, viewer_key, first_seen, last_seen)
         VALUES (?1, ?2, ?3, ?3)`
      )
      .bind(eventId, ipKey, now)
      .run();
    await refreshLastSeen(d1, eventId, ipKey, now);
    return { viewCount: await countEventViews(d1, eventId), setViewerCookie: buildViewerCookie(viewerId) };
  } catch {
    // Tracking must never break page loads (e.g. table missing before the
    // migration lands on an old DB): fall back to 0 rather than 500.
    try {
      return await countOnly();
    } catch {
      return { viewCount: 0, setViewerCookie: null };
    }
  }
}

async function ipDayKey(eventId: string, ip: string, ua: string): Promise<string> {
  // UTC-day rotation bounds shared-NAT collapsing to a single day.
  const day = new Date().toISOString().slice(0, 10);
  return sha256Hex(`event-view-ip:${eventId}:${ip}:${ua}:${day}`);
}

async function refreshLastSeen(d1: D1Database, eventId: string, viewerKey: string, now: string): Promise<void> {
  // Refresh last_seen at most once a day (return-visit signal without a
  // write on every page load).
  const cutoff = new Date(Date.now() - LAST_SEEN_REFRESH_MS).toISOString();
  await d1
    .prepare(
      `UPDATE event_views SET last_seen = ?1
       WHERE event_id = ?2 AND viewer_key = ?3 AND last_seen < ?4`
    )
    .bind(now, eventId, viewerKey, cutoff)
    .run();
}

export async function countEventViews(d1: D1Database, eventId: string): Promise<number> {
  const row = await d1
    .prepare(`SELECT COUNT(*) AS n FROM event_views WHERE event_id = ?1`)
    .bind(eventId)
    .first<{ n: number }>();
  return typeof row?.n === "number" ? row.n : 0;
}
