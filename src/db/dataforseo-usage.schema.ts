import { index, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { projects } from "./app.schema";
import { organization } from "./better-auth-schema";

// ============================================================================
// DataForSEO spend log (fork feature, see FORK-CHANGES.md). Self-hosted
// installs pay DataForSEO directly and had no record of what each call cost;
// hosted installs meter through Autumn and write nothing here.
// ============================================================================

const isoNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

// One row per call DataForSEO charged for, with the cost it reported.
export const dataforseoCalls = sqliteTable(
  "dataforseo_calls",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Kept when the project is deleted, so past spend still adds up.
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    // The API path without the version, e.g. "backlinks/referring_domains/live".
    endpoint: text("endpoint").notNull(),
    // What the call was for, e.g. "backlinks" or "rank_tracking".
    feature: text("feature").notNull(),
    costUsd: real("cost_usd").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("dataforseo_calls_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);
