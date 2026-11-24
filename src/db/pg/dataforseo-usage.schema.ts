import { doublePrecision, index, pgTable, text } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projects } from "./app.schema";
import { organization } from "./better-auth-schema";

// Postgres mirror. Column notes: see ../dataforseo-usage.schema.ts.

const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const dataforseoCalls = pgTable(
  "dataforseo_calls",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    endpoint: text("endpoint").notNull(),
    feature: text("feature").notNull(),
    costUsd: doublePrecision("cost_usd").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("dataforseo_calls_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);
