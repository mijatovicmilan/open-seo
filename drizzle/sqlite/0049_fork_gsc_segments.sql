CREATE TABLE `gsc_daily_query_page_segments` (
	`project_id` text NOT NULL,
	`date` text NOT NULL,
	`query` text NOT NULL,
	`page` text NOT NULL,
	`country` text NOT NULL,
	`device` text NOT NULL,
	`clicks` integer NOT NULL,
	`impressions` integer NOT NULL,
	`position` real NOT NULL,
	PRIMARY KEY(`project_id`, `date`, `query`, `page`, `country`, `device`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `gsc_daily_segments` (
	`project_id` text NOT NULL,
	`date` text NOT NULL,
	`country` text NOT NULL,
	`device` text NOT NULL,
	`clicks` integer NOT NULL,
	`impressions` integer NOT NULL,
	`position` real NOT NULL,
	PRIMARY KEY(`project_id`, `date`, `country`, `device`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `gsc_daily_totals` ADD `segments_synced_at` text;