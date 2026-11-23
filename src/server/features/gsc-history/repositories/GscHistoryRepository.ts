/* eslint-disable max-lines -- one store for the history tables, reads and writes side by side */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  max,
  min,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  gscAnnotations,
  gscConnections,
  gscDailyPages,
  gscDailyQueryPages,
  gscDailyTotals,
  gscSyncState,
  outreachEvents,
  outreachProspects,
} from "@/db/schema";

// Backing store for Search Console history. Every query filters on
// project_id; callers authorize the project, never a child row id.

type Tx = Parameters<Parameters<typeof runBatch>[0]>[0];

export type DayMetrics = {
  clicks: number;
  impressions: number;
  position: number;
};
export type PageDayRow = DayMetrics & { page: string };
export type QueryPageDayRow = DayMetrics & { query: string; page: string };

// D1 allows 100 bound parameters per statement: 6 columns x 16 rows = 96,
// 7 columns x 14 rows = 98.
const ROWS_PER_INSERT_6 = 16;
const ROWS_PER_INSERT_7 = 14;
// Lists bound into IN (...) stay well below the same limit.
const MAX_IN_LIST = 50;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

// Postgres returns sum()/count() of integers as strings; map every aggregate.
const num = (value: unknown) => Number(value ?? 0);

function upsertTotals(
  tx: Tx,
  projectId: string,
  rows: Array<DayMetrics & { date: string }>,
  syncedAt: string,
) {
  return chunk(rows, ROWS_PER_INSERT_6).map((rowChunk) =>
    tx
      .insert(gscDailyTotals)
      .values(rowChunk.map((row) => ({ projectId, ...row, syncedAt })))
      .onConflictDoUpdate({
        target: [gscDailyTotals.projectId, gscDailyTotals.date],
        set: {
          clicks: sql`excluded.clicks`,
          impressions: sql`excluded.impressions`,
          position: sql`excluded.position`,
          syncedAt: sql`excluded.synced_at`,
        },
      }),
  );
}

/** Replace one day: pages and query x page rows are deleted and re-inserted,
 *  and the totals row (the "day is synced" marker) is written last, all in
 *  one atomic batch. */
async function writeDay(input: {
  projectId: string;
  date: string;
  totals: DayMetrics;
  pages: PageDayRow[];
  queryPages: QueryPageDayRow[];
}): Promise<void> {
  const { projectId, date } = input;
  const syncedAt = new Date().toISOString();
  await runBatch((tx) => [
    tx
      .delete(gscDailyPages)
      .where(
        and(
          eq(gscDailyPages.projectId, projectId),
          eq(gscDailyPages.date, date),
        ),
      ),
    tx
      .delete(gscDailyQueryPages)
      .where(
        and(
          eq(gscDailyQueryPages.projectId, projectId),
          eq(gscDailyQueryPages.date, date),
        ),
      ),
    ...chunk(input.pages, ROWS_PER_INSERT_6).map((rows) =>
      tx
        .insert(gscDailyPages)
        .values(rows.map((row) => ({ projectId, date, ...row }))),
    ),
    ...chunk(input.queryPages, ROWS_PER_INSERT_7).map((rows) =>
      tx
        .insert(gscDailyQueryPages)
        .values(rows.map((row) => ({ projectId, date, ...row }))),
    ),
    ...upsertTotals(tx, projectId, [{ date, ...input.totals }], syncedAt),
  ]);
}

/** Days GSC has no impressions for: a zero totals row and no detail rows. */
async function writeEmptyDays(
  projectId: string,
  dates: string[],
): Promise<void> {
  if (dates.length === 0) return;
  const syncedAt = new Date().toISOString();
  const rows = dates.map((date) => ({
    date,
    clicks: 0,
    impressions: 0,
    position: 0,
  }));
  await runBatch((tx) => [
    ...chunk(dates, MAX_IN_LIST).flatMap((dateChunk) => [
      tx
        .delete(gscDailyPages)
        .where(
          and(
            eq(gscDailyPages.projectId, projectId),
            inArray(gscDailyPages.date, dateChunk),
          ),
        ),
      tx
        .delete(gscDailyQueryPages)
        .where(
          and(
            eq(gscDailyQueryPages.projectId, projectId),
            inArray(gscDailyQueryPages.date, dateChunk),
          ),
        ),
    ]),
    ...upsertTotals(tx, projectId, rows, syncedAt),
  ]);
}

async function listStoredDates(
  projectId: string,
  fromDate: string,
): Promise<string[]> {
  const rows = await db
    .select({ date: gscDailyTotals.date })
    .from(gscDailyTotals)
    .where(
      and(
        eq(gscDailyTotals.projectId, projectId),
        gte(gscDailyTotals.date, fromDate),
      ),
    );
  return rows.map((row) => row.date);
}

async function listConnectedProjectIds(): Promise<string[]> {
  const rows = await db
    .select({ projectId: gscConnections.projectId })
    .from(gscConnections);
  return rows.map((row) => row.projectId);
}

type SyncState = typeof gscSyncState.$inferSelect;

async function getSyncState(projectId: string): Promise<SyncState | null> {
  const [row] = await db
    .select()
    .from(gscSyncState)
    .where(eq(gscSyncState.projectId, projectId))
    .limit(1);
  return row ?? null;
}

/** Claim the project's sync. Fails (returns false) while another run is in
 *  flight: an attempt newer than its success, with no error, started after
 *  `staleBefore`. A crashed run stops blocking once it is stale. */
async function claimSync(
  projectId: string,
  nowIso: string,
  staleBeforeIso: string,
): Promise<boolean> {
  const rows = await db
    .insert(gscSyncState)
    .values({ projectId, lastAttemptAt: nowIso })
    .onConflictDoUpdate({
      target: gscSyncState.projectId,
      set: { lastAttemptAt: nowIso, lastError: null },
      setWhere: or(
        sql`${gscSyncState.lastAttemptAt} is null`,
        isNotNull(gscSyncState.lastError),
        sql`${gscSyncState.lastAttemptAt} < ${staleBeforeIso}`,
        sql`${gscSyncState.lastSuccessAt} >= ${gscSyncState.lastAttemptAt}`,
      ),
    })
    .returning({ projectId: gscSyncState.projectId });
  return rows.length > 0;
}

async function finishSync(
  projectId: string,
  result:
    | { ok: true; backfillDone: boolean; atIso: string }
    | { ok: false; error: string },
): Promise<void> {
  const set = result.ok
    ? {
        lastSuccessAt: result.atIso,
        lastError: null,
        // Keep the first time the backfill completed.
        ...(result.backfillDone
          ? {
              backfillDoneAt: sql`coalesce(${gscSyncState.backfillDoneAt}, ${result.atIso})`,
            }
          : {}),
      }
    : { lastError: result.error };
  await db
    .update(gscSyncState)
    .set(set)
    .where(eq(gscSyncState.projectId, projectId));
}

async function getHistoryBounds(projectId: string) {
  const [row] = await db
    .select({
      days: count(),
      oldest: min(gscDailyTotals.date),
      newest: max(gscDailyTotals.date),
    })
    .from(gscDailyTotals)
    .where(eq(gscDailyTotals.projectId, projectId));
  return {
    days: num(row?.days),
    oldest: row?.oldest ?? null,
    newest: row?.newest ?? null,
  };
}

async function listDailyTotals(projectId: string) {
  const rows = await db
    .select({
      date: gscDailyTotals.date,
      clicks: gscDailyTotals.clicks,
      impressions: gscDailyTotals.impressions,
      position: gscDailyTotals.position,
    })
    .from(gscDailyTotals)
    .where(eq(gscDailyTotals.projectId, projectId))
    .orderBy(asc(gscDailyTotals.date));
  return rows;
}

type AggregateRow = {
  clicks: number;
  impressions: number;
  /** Impression-weighted average position. */
  position: number;
};

function toAggregate(row: {
  clicks: unknown;
  impressions: unknown;
  weighted: unknown;
}): AggregateRow {
  const impressions = num(row.impressions);
  return {
    clicks: num(row.clicks),
    impressions,
    position: impressions > 0 ? num(row.weighted) / impressions : 0,
  };
}

type Range = { start: string; end: string };

/** Daily sums for one page and/or one query over a date range: from the
 *  page table for a page alone (it keeps anonymized-query clicks), from the
 *  query x page table when a query is involved. */
async function listFilteredDays(
  projectId: string,
  filter: { page?: string; query?: string },
  range: Range,
): Promise<Array<AggregateRow & { date: string }>> {
  if (filter.query) {
    const t = gscDailyQueryPages;
    const rows = await db
      .select({
        date: t.date,
        clicks: sql`sum(${t.clicks})`,
        impressions: sql`sum(${t.impressions})`,
        weighted: sql`sum(${t.position} * ${t.impressions})`,
      })
      .from(t)
      .where(
        and(
          eq(t.projectId, projectId),
          eq(t.query, filter.query),
          ...(filter.page ? [eq(t.page, filter.page)] : []),
          gte(t.date, range.start),
          lte(t.date, range.end),
        ),
      )
      .groupBy(t.date)
      .orderBy(asc(t.date));
    return rows.map((row) => ({ date: row.date, ...toAggregate(row) }));
  }
  const t = gscDailyPages;
  const rows = await db
    .select({
      date: t.date,
      clicks: sql`sum(${t.clicks})`,
      impressions: sql`sum(${t.impressions})`,
      weighted: sql`sum(${t.position} * ${t.impressions})`,
    })
    .from(t)
    .where(
      and(
        eq(t.projectId, projectId),
        eq(t.page, filter.page ?? ""),
        gte(t.date, range.start),
        lte(t.date, range.end),
      ),
    )
    .groupBy(t.date)
    .orderBy(asc(t.date));
  return rows.map((row) => ({ date: row.date, ...toAggregate(row) }));
}

/** Per-page sums over a date range, highest impressions first. */
async function aggregatePages(
  projectId: string,
  range: Range,
  limit: number,
): Promise<Array<AggregateRow & { page: string }>> {
  const t = gscDailyPages;
  const impressions = sql`sum(${t.impressions})`;
  const rows = await db
    .select({
      page: t.page,
      clicks: sql`sum(${t.clicks})`,
      impressions,
      weighted: sql`sum(${t.position} * ${t.impressions})`,
    })
    .from(t)
    .where(
      and(
        eq(t.projectId, projectId),
        gte(t.date, range.start),
        lte(t.date, range.end),
      ),
    )
    .groupBy(t.page)
    .orderBy(desc(impressions))
    .limit(limit);
  return rows.map((row) => ({ page: row.page, ...toAggregate(row) }));
}

/** Per query x page sums over a date range, highest impressions first,
 *  optionally limited to some pages. */
async function aggregateQueryPages(
  projectId: string,
  range: Range,
  limit: number,
  pages?: string[],
): Promise<Array<AggregateRow & { query: string; page: string }>> {
  const t = gscDailyQueryPages;
  if (pages && pages.length === 0) return [];
  const impressions = sql`sum(${t.impressions})`;
  const rows = await db
    .select({
      query: t.query,
      page: t.page,
      clicks: sql`sum(${t.clicks})`,
      impressions,
      weighted: sql`sum(${t.position} * ${t.impressions})`,
    })
    .from(t)
    .where(
      and(
        eq(t.projectId, projectId),
        gte(t.date, range.start),
        lte(t.date, range.end),
        pages ? inArray(t.page, pages.slice(0, MAX_IN_LIST)) : undefined,
      ),
    )
    .groupBy(t.query, t.page)
    .orderBy(desc(impressions))
    .limit(limit);
  return rows.map((row) => ({
    query: row.query,
    page: row.page,
    ...toAggregate(row),
  }));
}

/** Queries whose first stored impression falls in the range, with their
 *  sums over it (all their stored rows up to `end` are inside the range). */
async function listNewQueries(projectId: string, range: Range, limit: number) {
  const t = gscDailyQueryPages;
  const impressions = sql`sum(${t.impressions})`;
  const rows = await db
    .select({
      query: t.query,
      firstDate: min(t.date),
      clicks: sql`sum(${t.clicks})`,
      impressions,
      weighted: sql`sum(${t.position} * ${t.impressions})`,
    })
    .from(t)
    .where(and(eq(t.projectId, projectId), lte(t.date, range.end)))
    .groupBy(t.query)
    .having(gte(min(t.date), range.start))
    .orderBy(desc(impressions))
    .limit(limit);
  return rows.map((row) => ({
    query: row.query,
    firstDate: row.firstDate ?? range.start,
    ...toAggregate(row),
  }));
}

/** Pages whose first stored impression is on or after `since`. */
async function listNewPages(projectId: string, since: string, limit: number) {
  const t = gscDailyPages;
  const impressions = sql`sum(${t.impressions})`;
  const rows = await db
    .select({
      page: t.page,
      firstDate: min(t.date),
      clicks: sql`sum(${t.clicks})`,
      impressions,
    })
    .from(t)
    .where(eq(t.projectId, projectId))
    .groupBy(t.page)
    .having(gte(min(t.date), since))
    .orderBy(desc(impressions))
    .limit(limit);
  return rows.map((row) => ({
    page: row.page,
    firstDate: row.firstDate ?? since,
    clicks: num(row.clicks),
    impressions: num(row.impressions),
  }));
}

async function listPageDays(
  projectId: string,
  pages: string[],
  fromDate: string,
) {
  if (pages.length === 0) return [];
  const t = gscDailyPages;
  return db
    .select({
      page: t.page,
      date: t.date,
      clicks: t.clicks,
      impressions: t.impressions,
    })
    .from(t)
    .where(
      and(
        eq(t.projectId, projectId),
        inArray(t.page, pages.slice(0, MAX_IN_LIST)),
        gte(t.date, fromDate),
      ),
    );
}

async function listQueryPageDays(
  projectId: string,
  queries: string[],
  range: Range,
) {
  if (queries.length === 0) return [];
  const t = gscDailyQueryPages;
  return db
    .select({
      query: t.query,
      page: t.page,
      date: t.date,
      impressions: t.impressions,
      position: t.position,
    })
    .from(t)
    .where(
      and(
        eq(t.projectId, projectId),
        inArray(t.query, queries.slice(0, MAX_IN_LIST)),
        gte(t.date, range.start),
        lte(t.date, range.end),
      ),
    );
}

// The outreach module records an earned link as an event of this type.
const OUTREACH_LINK_FOUND_EVENT = "link found";

/** Earned outreach links, read-only from the outreach tables. */
async function listOutreachLinks(projectId: string) {
  return db
    .select({
      at: outreachEvents.at,
      site: outreachProspects.site,
      linkUrl: outreachProspects.linkUrl,
      theirPage: outreachProspects.theirPage,
    })
    .from(outreachEvents)
    .innerJoin(
      outreachProspects,
      eq(outreachProspects.id, outreachEvents.prospectId),
    )
    .where(
      and(
        eq(outreachEvents.projectId, projectId),
        eq(outreachProspects.projectId, projectId),
        eq(outreachEvents.type, OUTREACH_LINK_FOUND_EVENT),
      ),
    )
    .orderBy(asc(outreachEvents.at));
}

export type Annotation = typeof gscAnnotations.$inferSelect;

async function listAnnotations(projectId: string): Promise<Annotation[]> {
  return db
    .select()
    .from(gscAnnotations)
    .where(eq(gscAnnotations.projectId, projectId))
    .orderBy(asc(gscAnnotations.date), asc(gscAnnotations.createdAt));
}

async function insertAnnotation(
  input: Omit<Annotation, "createdAt">,
): Promise<Annotation> {
  const [row] = await db
    .insert(gscAnnotations)
    .values({ ...input, createdAt: new Date().toISOString() })
    .returning();
  if (!row) throw new Error("Failed to insert gsc_annotation");
  return row;
}

async function deleteAnnotation(
  projectId: string,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(gscAnnotations)
    .where(
      and(eq(gscAnnotations.projectId, projectId), eq(gscAnnotations.id, id)),
    )
    .returning({ id: gscAnnotations.id });
  return rows.length > 0;
}

export const GscHistoryRepository = {
  listFilteredDays,
  writeDay,
  writeEmptyDays,
  listStoredDates,
  listConnectedProjectIds,
  getSyncState,
  claimSync,
  finishSync,
  getHistoryBounds,
  listDailyTotals,
  aggregatePages,
  aggregateQueryPages,
  listNewQueries,
  listNewPages,
  listPageDays,
  listQueryPageDays,
  listOutreachLinks,
  listAnnotations,
  insertAnnotation,
  deleteAnnotation,
};
