CREATE TABLE "dataforseo_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"automatic_calls" boolean NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dataforseo_settings" ADD CONSTRAINT "dataforseo_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;