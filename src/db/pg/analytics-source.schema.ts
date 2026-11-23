import { index, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projects } from "./app.schema";
import { organization } from "./better-auth-schema";

// Postgres mirror. Column notes: see ../analytics-source.schema.ts.

const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const posthogCredentials = pgTable(
  "posthog_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // API origin, e.g. https://eu.posthog.com.
    host: text("host").notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    // "abcd": the key's last four characters, for display.
    keyHint: text("key_hint").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [index("posthog_credentials_org_idx").on(table.organizationId)],
);

export const analyticsSources = pgTable("analytics_sources", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["ga4", "posthog"] }).notNull(),
  posthogCredentialId: text("posthog_credential_id").references(
    () => posthogCredentials.id,
    { onDelete: "set null" },
  ),
  posthogProjectId: text("posthog_project_id"),
  posthogTimeZone: text("posthog_time_zone"),
  createdAt: text("created_at").notNull().default(isoNow),
  updatedAt: text("updated_at").notNull().default(isoNow),
});

export const analyticsKeyEvents = pgTable(
  "analytics_key_events",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    eventName: text("event_name").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.eventName] })],
);
