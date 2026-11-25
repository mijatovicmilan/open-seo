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
  type QueryPageSegmentDayRow,
  type SegmentDayRow,
} from "@/server/features/gsc-history/repositories/GscHistoryRepository";
import {
  addDays,
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
// Countries x devices for one day: about 250 x 3 at most.
const SEGMENT_ROWS_PER_DAY = 2_000;
// A run that has not finished after this long is treated as crashed.
const RUN_LEASE_MS = 5 * 60_000;
// The cron stops starting new projects after this long (daily crons get
// 15 minutes).
const CRON_DEADLINE_MS = 10 * 60_000;

type SyncRunResult =
  | {
      status: "synced";
      detailDays: number;
      segmentDays: number;
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
): Promise<{
  byDay: Map<string, DayMetrics>;
  newest: string | null;
  settledThrough: string | null;
}> {
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
  // Fork addition (FORK-CHANGES.md): the newest day Google calls final. With
  // no incomplete day in the window, every day it returned is final.
  const newest = [...byDay.keys()].reduce<string | null>(
    (found, day) => (found && found > day ? found : day),
    null,
  );
  const settledThrough = result.firstIncompleteDate
    ? addDays(result.firstIncompleteDate, -1)
    : newest;
  return { byDay, newest, settledThrough };
}

/** Fork addition (FORK-CHANGES.md): the newest hour Google has data for
 *  from `start` to `end`, so the chart can say how far a partial day goes. */
async function fetchNewestHour(projectId: string, start: string, end: string) {
  const result = await GscService.getPerformance({
    projectId,
    startDate: start,
    endDate: end,
    dimensions: ["hour"],
    type: "web",
    dataState: "hourly_all",
    rowLimit: GSC_MAX_ROW_LIMIT,
  });
  // Keys are ISO times in Pacific time with one offset, so they sort as text.
  return result.rows.reduce<string | null>((newest, row) => {
    const hour = row.keys?.[0];
    return hour && (!newest || hour > newest) ? hour : newest;
  }, null);
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

/** One day's rows per country and device, site-wide and per query x page.
 *  GSC sends devices in upper case; they are stored in lower case. */
async function fetchSegments(projectId: string, day: string) {
  const segmentRows = await fetchRows(
    projectId,
    day,
    ["country", "device"],
    SEGMENT_ROWS_PER_DAY,
  );
  const querySegmentRows = await fetchRows(
    projectId,
    day,
    ["query", "page", "country", "device"],
    QUERY_PAGE_ROWS_PER_DAY,
  );
  const segments: SegmentDayRow[] = [];
  for (const row of segmentRows) {
    const [country, device] = row.keys ?? [];
    if (!country || !device) continue;
    segments.push({
      country: country.toLowerCase(),
      device: device.toLowerCase(),
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.position,
    });
  }
  const querySegments: QueryPageSegmentDayRow[] = [];
  for (const row of querySegmentRows) {
    const [query, page, country, device] = row.keys ?? [];
    if (!query || !page || !country || !device) continue;
    querySegments.push({
      query,
      page,
      country: country.toLowerCase(),
      device: device.toLowerCase(),
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.position,
    });
  }
  return { segments, querySegments };
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
  options: {
    maxDetailDays?: number;
    now?: Date;
    /** Fork addition (FORK-CHANGES.md): only the days after the newest final
     *  one, for the 15-minute refresh. */
    partialOnly?: boolean;
  } = {},
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
    const {
      byDay: totals,
      newest,
      settledThrough,
    } = await fetchDailyTotals(projectId, plan.oldest, plan.latest);
    const newestHour =
      newest && settledThrough && newest > settledThrough
        ? await fetchNewestHour(projectId, newest, newest)
        : null;
    const impressionsByDay = new Map(
      [...totals].map(([day, metrics]) => [day, metrics.impressions]),
    );
    const selection = selectDays(
      options.partialOnly
        ? plan.candidates.filter(
            (day) => settledThrough !== null && day > settledThrough,
          )
        : plan.candidates,
      impressionsByDay,
      options.maxDetailDays ?? MAX_DETAIL_DAYS_PER_RUN,
    );
    await GscHistoryRepository.writeEmptyDays(projectId, selection.emptyDays);

    let rowsWritten = 0;
    let detailDays = 0;
    for (const day of selection.detailDays) {
      if (rowsWritten >= MAX_ROWS_PER_RUN) break;
      const { pages, queryPages } = await fetchDay(projectId, day);
      const { segments, querySegments } = await fetchSegments(projectId, day);
      const dayTotals = totals.get(day);
      if (!dayTotals) continue;
      await GscHistoryRepository.writeDay({
        projectId,
        date: day,
        totals: dayTotals,
        pages,
        queryPages,
        segments,
        querySegments,
      });
      rowsWritten +=
        pages.length +
        queryPages.length +
        segments.length +
        querySegments.length;
      detailDays++;
    }

    // Days stored before the country and device tables existed get those
    // rows from the same budget, newest first.
    const budget = options.partialOnly
      ? 0
      : (options.maxDetailDays ?? MAX_DETAIL_DAYS_PER_RUN) - detailDays;
    let segmentDays = 0;
    if (budget > 0 && rowsWritten < MAX_ROWS_PER_RUN) {
      const missing = await GscHistoryRepository.listDaysMissingSegments(
        projectId,
        budget,
      );
      for (const day of missing) {
        if (rowsWritten >= MAX_ROWS_PER_RUN) break;
        const { segments, querySegments } = await fetchSegments(projectId, day);
        await GscHistoryRepository.writeSegments({
          projectId,
          date: day,
          segments,
          querySegments,
        });
        rowsWritten += segments.length + querySegments.length;
        segmentDays++;
      }
    }

    // Count what is still missing from storage, now that this run wrote.
    const remainingDays =
      planSync(
        now,
        await GscHistoryRepository.listStoredDates(projectId, plan.oldest),
      ).missingCount +
      (await GscHistoryRepository.countDaysMissingSegments(projectId));
    await GscHistoryRepository.finishSync(projectId, {
      ok: true,
      backfillDone: remainingDays === 0,
      atIso: new Date().toISOString(),
      settledThrough,
      newestHour,
    });
    return {
      status: "synced",
      detailDays,
      segmentDays,
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

// Google keeps hourly data for 10 days.
const HOURLY_DAYS = 10;

/** Fork addition (FORK-CHANGES.md): run every 15 minutes. A project whose
 *  fresh data moved on since its last sync (Google has a newer hour) gets
 *  its partial days fetched again; otherwise it costs one GSC call. */
async function refreshPartialDays(now = new Date()): Promise<void> {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(now);
  for (const projectId of await GscHistoryRepository.listConnectedProjectIds()) {
    try {
      const state = await GscHistoryRepository.getSyncState(projectId);
      // Before the backfill, or after a failed sync, the daily job and the
      // page do the work.
      if (!state?.settledThrough || !state.backfillDoneAt || state.lastError)
        continue;
      const from = addDays(state.settledThrough, 1);
      const floor = addDays(today, -(HOURLY_DAYS - 1));
      const latest = await fetchNewestHour(
        projectId,
        from > floor ? from : floor,
        today,
      );
      if (!latest || latest === state.newestHour) continue;
      await syncProject(projectId, { now, partialOnly: true });
    } catch (error) {
      console.error(
        "[gsc-history] partial refresh failed for",
        projectId,
        error,
      );
    }
  }
}

export const GscHistorySyncService = {
  syncProject,
  syncAllConnectedProjects,
  refreshPartialDays,
};
