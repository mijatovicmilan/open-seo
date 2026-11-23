CREATE TABLE "outreach_angles" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"color" text NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"prospect_id" text NOT NULL,
	"type" text NOT NULL,
	"detail" text,
	"actor" text NOT NULL,
	"at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_link_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"prospect_id" text NOT NULL,
	"checked_at" text NOT NULL,
	"found" integer NOT NULL,
	"url" text NOT NULL,
	"href" text,
	"rel" text,
	"actor" text NOT NULL,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "outreach_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"prospect_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"approved_hash" text,
	"approved_at" text,
	"sent_at" text,
	"message_id" text,
	"received_at" text,
	"in_reply_to_id" integer,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_prospects" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"number" integer NOT NULL,
	"site" text NOT NULL,
	"person" text,
	"contact" text DEFAULT '' NOT NULL,
	"contact_kind" text NOT NULL,
	"contact_note" text,
	"their_page" text NOT NULL,
	"their_page_title" text,
	"our_page" text NOT NULL,
	"gain" text,
	"status" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"dropped_reason" text,
	"link_url" text,
	"link_rel" text,
	"angle_id" text,
	"angle_note" text,
	"score_gain" integer,
	"score_gain_reason" text,
	"score_activity" integer,
	"score_activity_reason" text,
	"score_reach" integer,
	"score_reach_reason" text,
	"score_link" integer,
	"score_link_reason" text,
	"scored_at" text,
	"favicon" text,
	"favicon_fetched_at" text,
	"metric_authority" integer,
	"metric_traffic" integer,
	"metric_traffic_location" text,
	"metric_referring_domains" integer,
	"metrics_measured_at" text,
	"metrics_source" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_settings" (
	"project_id" text PRIMARY KEY NOT NULL,
	"site_url" text NOT NULL,
	"link_domains" text NOT NULL,
	"sender_name" text DEFAULT '' NOT NULL,
	"sender_email" text DEFAULT '' NOT NULL,
	"signature" text DEFAULT '' NOT NULL,
	"smtp_host" text DEFAULT '' NOT NULL,
	"smtp_port" integer DEFAULT 465 NOT NULL,
	"mail_env_key" text DEFAULT '' NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"daily_min" integer DEFAULT 2 NOT NULL,
	"daily_max" integer DEFAULT 3 NOT NULL,
	"weekly_min" integer DEFAULT 10 NOT NULL,
	"weekly_max" integer DEFAULT 20 NOT NULL,
	"follow_up_days" integer DEFAULT 7 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_annotations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"date" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"url" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_daily_pages" (
	"project_id" text NOT NULL,
	"date" text NOT NULL,
	"page" text NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"position" real NOT NULL,
	CONSTRAINT "gsc_daily_pages_project_id_date_page_pk" PRIMARY KEY("project_id","date","page")
);
--> statement-breakpoint
CREATE TABLE "gsc_daily_query_pages" (
	"project_id" text NOT NULL,
	"date" text NOT NULL,
	"query" text NOT NULL,
	"page" text NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"position" real NOT NULL,
	CONSTRAINT "gsc_daily_query_pages_project_id_date_query_page_pk" PRIMARY KEY("project_id","date","query","page")
);
--> statement-breakpoint
CREATE TABLE "gsc_daily_totals" (
	"project_id" text NOT NULL,
	"date" text NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"position" real NOT NULL,
	"synced_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "gsc_daily_totals_project_id_date_pk" PRIMARY KEY("project_id","date")
);
--> statement-breakpoint
CREATE TABLE "gsc_sync_state" (
	"project_id" text PRIMARY KEY NOT NULL,
	"last_attempt_at" text,
	"last_success_at" text,
	"last_error" text,
	"backfill_done_at" text
);
--> statement-breakpoint
ALTER TABLE "outreach_angles" ADD CONSTRAINT "outreach_angles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_prospect_id_outreach_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."outreach_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_link_checks" ADD CONSTRAINT "outreach_link_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_link_checks" ADD CONSTRAINT "outreach_link_checks_prospect_id_outreach_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."outreach_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_prospect_id_outreach_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."outreach_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD CONSTRAINT "outreach_prospects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD CONSTRAINT "outreach_prospects_angle_id_outreach_angles_id_fk" FOREIGN KEY ("angle_id") REFERENCES "public"."outreach_angles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_settings" ADD CONSTRAINT "outreach_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_annotations" ADD CONSTRAINT "gsc_annotations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_daily_pages" ADD CONSTRAINT "gsc_daily_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_daily_query_pages" ADD CONSTRAINT "gsc_daily_query_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_daily_totals" ADD CONSTRAINT "gsc_daily_totals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_sync_state" ADD CONSTRAINT "gsc_sync_state_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_angles_project_key_idx" ON "outreach_angles" USING btree ("project_id","key");--> statement-breakpoint
CREATE INDEX "outreach_events_prospect_idx" ON "outreach_events" USING btree ("prospect_id","at");--> statement-breakpoint
CREATE INDEX "outreach_events_project_type_idx" ON "outreach_events" USING btree ("project_id","type","at");--> statement-breakpoint
CREATE INDEX "outreach_link_checks_prospect_idx" ON "outreach_link_checks" USING btree ("prospect_id","checked_at");--> statement-breakpoint
CREATE INDEX "outreach_messages_prospect_idx" ON "outreach_messages" USING btree ("prospect_id","id");--> statement-breakpoint
CREATE INDEX "outreach_messages_project_sent_idx" ON "outreach_messages" USING btree ("project_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_prospects_project_number_idx" ON "outreach_prospects" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "outreach_prospects_angle_idx" ON "outreach_prospects" USING btree ("angle_id");--> statement-breakpoint
CREATE INDEX "gsc_annotations_project_date_idx" ON "gsc_annotations" USING btree ("project_id","date");--> statement-breakpoint
CREATE INDEX "gsc_daily_pages_project_page_idx" ON "gsc_daily_pages" USING btree ("project_id","page","date");--> statement-breakpoint
CREATE INDEX "gsc_daily_query_pages_project_query_idx" ON "gsc_daily_query_pages" USING btree ("project_id","query","date");