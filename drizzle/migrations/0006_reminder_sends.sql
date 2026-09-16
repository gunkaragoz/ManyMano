CREATE TABLE `reminder_sends` (
	`event_id` text NOT NULL,
	`reminder_key` text NOT NULL,
	`kind` text NOT NULL,
	`sent_at` text NOT NULL,
	PRIMARY KEY(`event_id`, `reminder_key`, `kind`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
