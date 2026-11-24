ALTER TABLE "outreach_settings" ADD COLUMN "smtp_user" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_settings" ADD COLUMN "smtp_password_encrypted" text;--> statement-breakpoint
ALTER TABLE "outreach_settings" DROP COLUMN "mail_env_key";
