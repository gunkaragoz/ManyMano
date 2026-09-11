import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // 'SIGNUP_SHEET' | 'TIME_POLL'
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  organizerName: text("organizer_name").notNull(),
  organizerEmail: text("organizer_email").notNull(),
  adminToken: text("admin_token").notNull(),
  status: text("status").notNull().default("OPEN"), // 'OPEN' | 'CLOSED' | 'FINALIZED'
  settings: text("settings").notNull().default("{}"), // JSON string
  winningSlotId: text("winning_slot_id"),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const eventSlots = sqliteTable("event_slots", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
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
