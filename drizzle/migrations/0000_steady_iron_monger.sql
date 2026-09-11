CREATE TABLE `event_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`capacity` integer DEFAULT 1 NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`location` text,
	`organizer_name` text NOT NULL,
	`organizer_email` text NOT NULL,
	`admin_token` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`winning_slot_id` text,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `poll_vote_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`poll_vote_id` text NOT NULL,
	`slot_id` text NOT NULL,
	`response` text NOT NULL,
	FOREIGN KEY (`poll_vote_id`) REFERENCES `poll_votes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slot_id`) REFERENCES `event_slots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `poll_votes` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`participant_name` text NOT NULL,
	`participant_email` text,
	`edit_token` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `signups` (
	`id` text PRIMARY KEY NOT NULL,
	`slot_id` text NOT NULL,
	`event_id` text NOT NULL,
	`participant_name` text NOT NULL,
	`participant_email` text,
	`edit_token` text NOT NULL,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'CONFIRMED' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`slot_id`) REFERENCES `event_slots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
