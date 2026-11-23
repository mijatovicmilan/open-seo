ALTER TABLE "outreach_messages" ADD COLUMN "scheduled_for" text;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD COLUMN "schedule_manual" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD COLUMN "schedule_note" text;--> statement-breakpoint
ALTER TABLE "outreach_settings" ADD COLUMN "schedule_paused" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_settings" ADD COLUMN "schedule_time_zone" text DEFAULT 'America/New_York' NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_settings" ADD COLUMN "schedule_days" text DEFAULT '1 2 3 4 5' NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_settings" ADD COLUMN "schedule_time" text DEFAULT '09:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_settings" ADD COLUMN "schedule_window_minutes" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_settings" ADD COLUMN "scheduler_checked_at" text;--> statement-breakpoint
ALTER TABLE "outreach_settings" ADD COLUMN "scheduler_lock_until" text;