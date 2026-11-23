CREATE TABLE "gsc_daily_query_page_segments" (
	"project_id" text NOT NULL,
	"date" text NOT NULL,
	"query" text NOT NULL,
	"page" text NOT NULL,
	"country" text NOT NULL,
	"device" text NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"position" real NOT NULL,
	CONSTRAINT "gsc_daily_query_page_segments_project_id_date_query_page_country_device_pk" PRIMARY KEY("project_id","date","query","page","country","device")
);
--> statement-breakpoint
CREATE TABLE "gsc_daily_segments" (
	"project_id" text NOT NULL,
	"date" text NOT NULL,
	"country" text NOT NULL,
	"device" text NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"position" real NOT NULL,
	CONSTRAINT "gsc_daily_segments_project_id_date_country_device_pk" PRIMARY KEY("project_id","date","country","device")
);
--> statement-breakpoint
ALTER TABLE "gsc_daily_totals" ADD COLUMN "segments_synced_at" text;--> statement-breakpoint
ALTER TABLE "gsc_daily_query_page_segments" ADD CONSTRAINT "gsc_daily_query_page_segments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_daily_segments" ADD CONSTRAINT "gsc_daily_segments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;