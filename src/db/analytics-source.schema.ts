import { index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { projects } from "./app.schema";
import { organization } from "./better-auth-schema";

// ============================================================================
// Analytics source per project (fork feature, see FORK-CHANGES.md). Without a
// row, or with provider "ga4", the Google Analytics connection feeds the
// analytics screens and MCP tools; with "posthog" the PostHog project does,
// read over HogQL with the server's POSTHOG_PERSONAL_API_KEY (never stored).
// ============================================================================

const isoNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

// A PostHog personal API key, shared by the organization's projects. The
// key is encrypted with BETTER_AUTH_SECRET (as OAuth tokens are) and only
// its last four characters are ever shown.
export const posthogCredentials = sqliteTable(
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

export const analyticsSources = sqliteTable("analytics_sources", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["ga4", "posthog"] }).notNull(),
  // PostHog project (environment) ID, e.g. "352215". Kept when the project
  // switches back to GA4, so switching again needs no re-entry.
  // The key that reads the PostHog project; null falls back to the
  // server's POSTHOG_PERSONAL_API_KEY when set.
  posthogCredentialId: text("posthog_credential_id").references(
    () => posthogCredentials.id,
    { onDelete: "set null" },
  ),
  posthogProjectId: text("posthog_project_id"),
  // The PostHog project's time zone, read when the ID is saved; report days
  // are days in this zone.
  posthogTimeZone: text("posthog_time_zone"),
  createdAt: text("created_at").notNull().default(isoNow),
  updatedAt: text("updated_at").notNull().default(isoNow),
});

// PostHog events that count as key events (signups, e.g. waitlist_joined).
export const analyticsKeyEvents = sqliteTable(
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
