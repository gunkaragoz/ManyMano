import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // 'SIGNUP_SHEET' | 'TIME_POLL'
  title: text("title").notNull(),
  description: text("description"),
  eventDate: text("event_date"), // e.g. '2026-10-17' or human readable
  location: text("location"),
  organizerName: text("organizer_name").notNull(),
  organizerEmail: text("organizer_email").notNull(),
  adminToken: text("admin_token").notNull(),
  status: text("status").notNull().default("OPEN"), // 'OPEN' | 'CLOSED' | 'FINALIZED'
  settings: text("settings").notNull().default("{}"), // JSON string
  winningSlotId: text("winning_slot_id"),
  timezone: text("timezone").notNull().default("UTC"),
  durationMinutes: integer("duration_minutes"), // NULL = All day (TIME_POLL only)
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const eventSlots = sqliteTable("event_slots", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  shiftName: text("shift_name"),
  slotDate: text("slot_date"), // 'YYYY-MM-DD' per-option date for TIME_POLL multi-day
  startTime: text("start_time"),
  endTime: text("end_time"),
  capacity: integer("capacity").notNull().default(1), // -1 for unlimited
  displayOrder: integer("display_order").notNull().default(0),
});

export const signups = sqliteTable("signups", {
  id: text("id").primaryKey(),
  slotId: text("slot_id")
    .notNull()
    .references(() => eventSlots.id, { onDelete: "cascade" }),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  participantName: text("participant_name").notNull(),
  participantEmail: text("participant_email"),
  editToken: text("edit_token").notNull(),
  customFields: text("custom_fields").notNull().default("{}"), // JSON string
  status: text("status").notNull().default("CONFIRMED"), // 'CONFIRMED' | 'CANCELLED'
  createdAt: text("created_at").notNull(),
});

export const pollVotes = sqliteTable("poll_votes", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  participantName: text("participant_name").notNull(),
  participantEmail: text("participant_email"),
  editToken: text("edit_token").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const pollVoteEntries = sqliteTable("poll_vote_entries", {
  id: text("id").primaryKey(),
  pollVoteId: text("poll_vote_id")
    .notNull()
    .references(() => pollVotes.id, { onDelete: "cascade" }),
  slotId: text("slot_id")
    .notNull()
    .references(() => eventSlots.id, { onDelete: "cascade" }),
  response: text("response").notNull(), // 'YES' | 'MAYBE' | 'NO'
});

// Day-before reminder dedupe (see app/utils/reminders.ts + GET /api/reminders).
// One row per (event, date, kind) once the send was attempted successfully,
// so a retried cron run never double-emails. Kinds: 'organizer_12h' |
// 'organizer_48h' | 'participants' ('organizer' / 'organizer_24h' are legacy
// pre-12h kinds, still honored as already-sent).
// reminder_key is the event-local calendar day being reminded about (YYYY-MM-DD).
export const reminderSends = sqliteTable(
  "reminder_sends",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    reminderKey: text("reminder_key").notNull(),
    kind: text("kind").notNull(),
    sentAt: text("sent_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.reminderKey, t.kind] })]
);

// Free-tier quota tracking (Resend email counts + alert dedupe).
// Keys are period-scoped so rows never grow unboundedly in practice:
//   email:daily:YYYY-MM-DD, email:monthly:YYYY-MM,
//   email:alert:daily:80:YYYY-MM-DD, ... (one row per threshold hit)
// Old periods are harmless (tiny rows); retention pruning leaves them alone.
export const usageCounters = sqliteTable("usage_counters", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});
