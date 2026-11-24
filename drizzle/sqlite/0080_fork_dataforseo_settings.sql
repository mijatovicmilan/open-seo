CREATE TABLE `dataforseo_settings` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`automatic_calls` integer NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
