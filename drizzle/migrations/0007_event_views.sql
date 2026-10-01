CREATE TABLE `event_views` (
	`event_id` text NOT NULL,
	`viewer_key` text NOT NULL,
	`first_seen` text NOT NULL,
	`last_seen` text NOT NULL,
	PRIMARY KEY(`event_id`, `viewer_key`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
