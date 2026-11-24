CREATE TABLE "dataforseo_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"endpoint" text NOT NULL,
	"feature" text NOT NULL,
	"cost_usd" double precision NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dataforseo_calls" ADD CONSTRAINT "dataforseo_calls_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataforseo_calls" ADD CONSTRAINT "dataforseo_calls_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dataforseo_calls_org_created_idx" ON "dataforseo_calls" USING btree ("organization_id","created_at");