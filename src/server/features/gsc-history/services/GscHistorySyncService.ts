import {
  GscNotConnectedError,
  GscService,
  isExpectedGrantFailure,
} from "@/server/features/gsc/services/GscService";
import { GSC_MAX_ROW_LIMIT } from "@/server/features/gsc/searchAnalytics";
import {
  GscHistoryRepository,
  type DayMetrics,
  type PageDayRow,
  type QueryPageDayRow,
} from "@/server/features/gsc-history/repositories/GscHistoryRepository";
import {
  historyWindow,
  planSync,
  selectDays,
} from "@/server/features/gsc-history/syncPlan";
import { GscApiError, GscTokenError } from "@/server/lib/gscErrors";
import type { GscDimension } from "@/server/features/gsc/searchAnalytics";

/**
 * Keeps a daily copy of a project's Search Console data (web search, all
 * countries and devices). Each run is bounded so it fits one Worker
 * invocation; callers that want the whole backfill call again while
 * `remainingDays` is above zero (the page does this while it is open).
 */

// Per run: at most this many days with impressions get their page and
// query x page detail (two to seven GSC calls each, ~1.5 s per day), and the
// run stops early once this many detail rows were written. The page passes a
// smaller budget so its progress line moves every few seconds.
const MAX_DETAIL_DAYS_PER_RUN = 30;
export const PAGE_DETAIL_DAYS_PER_RUN = 10;
const MAX_ROWS_PER_RUN = 60_000;
// Rows kept per day. GSC returns rows sorted by clicks, so the cap keeps a
// day's top pages and query x page pairs by clicks.
const PAGE_ROWS_PER_DAY = 2_000;
const QUERY_PAGE_ROWS_PER_DAY = 5_000;
// A run that has not finished after this long is treated as crashed.
const RUN_LEASE_MS = 5 * 60_000;
// The cron stops starting new projects after this long (daily crons get
// 15 minutes).
const CRON_DEADLINE_MS = 10 * 60_000;

type SyncRunResult =
  | {
      status: "synced";
      detailDays: number;
      emptyDays: number;
      rowsWritten: number;
      remainingDays: number;
    }
  | { status: "busy" }
  | { status: "not_connected" }
  | { status: "failed"; error: string; expected: boolean };

/** One paged GSC fetch, up to `cap` rows, 1,000 per call. */
async function fetchRows(
  projectId: string,
  day: string,
  dimensions: GscDimension[],
  cap: number,
) {
  const rows = [];
  for (let startRow = 0; startRow < cap; startRow += GSC_MAX_ROW_LIMIT) {
    const result = await GscService.getPerformance({
      projectId,
      startDate: day,
      endDate: day,
      dimensions,
      type: "web",
      dataState: "all",
      rowLimit: Math.min(GSC_MAX_ROW_LIMIT, cap - startRow),
      startRow,
    });
    rows.push(...result.rows);
    if (result.rows.length < GSC_MAX_ROW_LIMIT) break;
  }
  return rows;
}

async function fetchDailyTotals(
  projectId: string,
  oldest: string,
  latest: string,
): Promise<Map<string, DayMetrics>> {
  // ~490 days in the window, under one call's 1,000-row limit.
  const result = await GscService.getPerformance({
    projectId,
    startDate: oldest,
    endDate: latest,
    dimensions: ["date"],
    type: "web",
    dataState: "all",
    rowLimit: GSC_MAX_ROW_LIMIT,
  });
  const byDay = new Map<string, DayMetrics>();
  for (const row of result.rows) {
    const day = row.keys?.[0];
    if (!day) continue;
    byDay.set(day, {
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.position,
    });
  }
  return byDay;
}

async function fetchDay(projectId: string, day: string) {
  const pageRows = await fetchRows(projectId, day, ["page"], PAGE_ROWS_PER_DAY);
  const queryPageRows = await fetchRows(
    projectId,
    day,
    ["query", "page"],
    QUERY_PAGE_ROWS_PER_DAY,
  );
  const pages: PageDayRow[] = [];
  for (const row of pageRows) {
    const page = row.keys?.[0];
    if (!page) continue;
    pages.push({
      page,
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.position,
    });
  }
  const queryPages: QueryPageDayRow[] = [];
  for (const row of queryPageRows) {
    const query = row.keys?.[0];
    const page = row.keys?.[1];
    if (!query || !page) continue;
    queryPages.push({
      query,
      page,
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.position,
    });
  }
  return { pages, queryPages };
}

/** A short, secret-free message for the status line. */
function describeSyncError(error: unknown): string {
  if (error instanceof GscNotConnectedError) {
    return "Search Console is not connected for this project.";
  }
  if (error instanceof GscTokenError) {
    return "The Search Console connection expired or was revoked. Reconnect it in Settings > Integrations.";
  }
  if (error instanceof GscApiError) return error.message.slice(0, 300);
  return "Sync failed unexpectedly. Try again later.";
}

/** One bounded catch-up run for a project. Never throws for expected
 *  Search Console failures; they are recorded on the sync state. */
async function syncProject(
  projectId: string,
  options: { maxDetailDays?: number; now?: Date } = {},
): Promise<SyncRunResult> {
  const now = options.now ?? new Date();
  const connection = await GscService.getConnection(projectId);
  if (!connection) return { status: "not_connected" };

  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - RUN_LEASE_MS).toISOString();
  const claimed = await GscHistoryRepository.claimSync(
    projectId,
    nowIso,
    staleBefore,
  );
  if (!claimed) return { status: "busy" };

  try {
    const { oldest } = historyWindow(now);
    const plan = planSync(
      now,
      await GscHistoryRepository.listStoredDates(projectId, oldest),
    );
    const totals = await fetchDailyTotals(projectId, plan.oldest, plan.latest);
    const impressionsByDay = new Map(
      [...totals].map(([day, metrics]) => [day, metrics.impressions]),
    );
    const selection = selectDays(
      plan.candidates,
      impressionsByDay,
      options.maxDetailDays ?? MAX_DETAIL_DAYS_PER_RUN,
    );
    await GscHistoryRepository.writeEmptyDays(projectId, selection.emptyDays);

    let rowsWritten = 0;
    let detailDays = 0;
    for (const day of selection.detailDays) {
      if (rowsWritten >= MAX_ROWS_PER_RUN) break;
      const { pages, queryPages } = await fetchDay(projectId, day);
      const dayTotals = totals.get(day);
      if (!dayTotals) continue;
      await GscHistoryRepository.writeDay({
        projectId,
        date: day,
        totals: dayTotals,
        pages,
        queryPages,
      });
      rowsWritten += pages.length + queryPages.length;
      detailDays++;
    }

    // Count what is still missing from storage, now that this run wrote.
    const remainingDays = planSync(
      now,
      await GscHistoryRepository.listStoredDates(projectId, plan.oldest),
    ).missingCount;
    await GscHistoryRepository.finishSync(projectId, {
      ok: true,
      backfillDone: remainingDays === 0,
      atIso: new Date().toISOString(),
    });
    return {
      status: "synced",
      detailDays,
      emptyDays: selection.emptyDays.length,
      rowsWritten,
      remainingDays,
    };
  } catch (error) {
    const expected =
      error instanceof GscNotConnectedError || isExpectedGrantFailure(error);
    if (!expected) {
      console.error("[gsc-history] sync failed for project", projectId, error);
    }
    const message = describeSyncError(error);
    await GscHistoryRepository.finishSync(projectId, {
      ok: false,
      error: message,
    });
    return { status: "failed", error: message, expected };
  }
}

/** Daily cron body: one bounded run per connected project. Never throws for
 *  a single project's failure. */
async function syncAllConnectedProjects(): Promise<void> {
  const started = Date.now();
  const projectIds = await GscHistoryRepository.listConnectedProjectIds();
  for (const projectId of projectIds) {
    if (Date.now() - started > CRON_DEADLINE_MS) {
      console.warn("[gsc-history] cron deadline reached; rest waits a day");
      return;
    }
    try {
      await syncProject(projectId);
    } catch (error) {
      console.error("[gsc-history] cron sync crashed for", projectId, error);
    }
  }
}

export const GscHistorySyncService = {
  syncProject,
  syncAllConnectedProjects,
};
