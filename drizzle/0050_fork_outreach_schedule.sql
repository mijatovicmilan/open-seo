ALTER TABLE `outreach_messages` ADD `scheduled_for` text;--> statement-breakpoint
ALTER TABLE `outreach_messages` ADD `schedule_manual` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `outreach_messages` ADD `schedule_note` text;--> statement-breakpoint
ALTER TABLE `outreach_settings` ADD `schedule_paused` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `outreach_settings` ADD `schedule_time_zone` text DEFAULT 'America/New_York' NOT NULL;--> statement-breakpoint
ALTER TABLE `outreach_settings` ADD `schedule_days` text DEFAULT '1 2 3 4 5' NOT NULL;--> statement-breakpoint
ALTER TABLE `outreach_settings` ADD `schedule_time` text DEFAULT '09:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `outreach_settings` ADD `schedule_window_minutes` integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE `outreach_settings` ADD `scheduler_checked_at` text;--> statement-breakpoint
ALTER TABLE `outreach_settings` ADD `scheduler_lock_until` text;