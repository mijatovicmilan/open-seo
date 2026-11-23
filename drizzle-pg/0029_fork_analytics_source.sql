CREATE TABLE "analytics_key_events" (
	"project_id" text NOT NULL,
	"event_name" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "analytics_key_events_project_id_event_name_pk" PRIMARY KEY("project_id","event_name")
);
--> statement-breakpoint
CREATE TABLE "analytics_sources" (
	"project_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"posthog_credential_id" text,
	"posthog_project_id" text,
	"posthog_time_zone" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posthog_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"host" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_hint" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_key_events" ADD CONSTRAINT "analytics_key_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_sources" ADD CONSTRAINT "analytics_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_sources" ADD CONSTRAINT "analytics_sources_posthog_credential_id_posthog_credentials_id_fk" FOREIGN KEY ("posthog_credential_id") REFERENCES "public"."posthog_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posthog_credentials" ADD CONSTRAINT "posthog_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posthog_credentials_org_idx" ON "posthog_credentials" USING btree ("organization_id");