import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { projects } from "./app.schema";

// ============================================================================
// Search Console history (fork feature, see FORK-CHANGES.md). The live Search
// Performance page asks GSC on every view; these tables keep one copy per day
// so changes over time, new pages and chart annotations can be read without
// GSC's 16-month window or its per-call row cap. Web search type, all
// countries and devices. Dates are YYYY-MM-DD in GSC's own (Pacific) days.
// ============================================================================

const isoNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

// Site totals per day. A row means the day was synced, even with zero
// clicks, so missing days are the ones still to fetch.
export const gscDailyTotals = sqliteTable(
  "gsc_daily_totals",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    // Impression-weighted average position.
    position: real("position").notNull(),
    syncedAt: text("synced_at").notNull().default(isoNow),
    // When the day's country and device rows were stored; null while they
    // are still to fetch (days stored before those tables existed).
    segmentsSyncedAt: text("segments_synced_at"),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.date] })],
);

// Per page per day (dimension page only), which keeps clicks that the
// query x page rows lose to anonymized queries.
export const gscDailyPages = sqliteTable(
  "gsc_daily_pages",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    page: text("page").notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    position: real("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.date, table.page] }),
    index("gsc_daily_pages_project_page_idx").on(
      table.projectId,
      table.page,
      table.date,
    ),
  ],
);

// Per query and page per day, capped per day at the sync's row limit
// (highest impressions first).
export const gscDailyQueryPages = sqliteTable(
  "gsc_daily_query_pages",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    query: text("query").notNull(),
    page: text("page").notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    position: real("position").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.date, table.query, table.page],
    }),
    index("gsc_daily_query_pages_project_query_idx").on(
      table.projectId,
      table.query,
      table.date,
    ),
  ],
);

// Per country and device per day (dimensions country, device): the
// totals behind the country and device filters. Country is GSC's ISO 3166
// alpha-3 code in lower case ("usa"), device is desktop, mobile or tablet.
export const gscDailySegments = sqliteTable(
  "gsc_daily_segments",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    country: text("country").notNull(),
    device: text("device").notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    position: real("position").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.date, table.country, table.device],
    }),
  ],
);

// Per query, page, country and device per day, capped per day like the
// query x page rows: the tables under a country or device filter.
export const gscDailyQueryPageSegments = sqliteTable(
  "gsc_daily_query_page_segments",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    query: text("query").notNull(),
    page: text("page").notNull(),
    country: text("country").notNull(),
    device: text("device").notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    position: real("position").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.projectId,
        table.date,
        table.query,
        table.page,
        table.country,
        table.device,
      ],
    }),
  ],
);

// Sync bookkeeping per project: the last attempt, its error, and how far
// back history has been filled.
export const gscSyncState = sqliteTable("gsc_sync_state", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  lastAttemptAt: text("last_attempt_at"),
  lastSuccessAt: text("last_success_at"),
  lastError: text("last_error"),
  // Set once the backfill reached the oldest day GSC keeps.
  backfillDoneAt: text("backfill_done_at"),
});

// Notes on the chart that the data cannot know: a deploy, a page published,
// a link earned elsewhere. Outreach links and first-seen pages are derived
// on read and never stored here.
export const gscAnnotations = sqliteTable(
  "gsc_annotations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    kind: text("kind", { enum: ["deploy", "page", "link", "note"] }).notNull(),
    label: text("label").notNull(),
    url: text("url"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("gsc_annotations_project_date_idx").on(table.projectId, table.date),
  ],
);
