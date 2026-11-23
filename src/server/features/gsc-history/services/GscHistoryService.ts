import { GscService } from "@/server/features/gsc/services/GscService";
import {
  GscHistoryRepository,
  type Annotation,
} from "@/server/features/gsc-history/repositories/GscHistoryRepository";
import {
  buildCtrCurve,
  buildCtrGaps,
  buildNearPageOne,
  buildNewPages,
  buildPageChanges,
  countRankingFlips,
  findCannibalizationCandidates,
  insightPeriods,
  minImpressionsFor,
  rankCannibalization,
  topQueryDrivers,
} from "@/server/features/gsc-history/insights";
import {
  addDays,
  historyWindow,
  planSync,
} from "@/server/features/gsc-history/syncPlan";
import type { GscAnnotationKind } from "@/types/schemas/gsc-history";

// Read side of Search Console history: sync status, the insight sections,
// the chart and its annotations. Callers authorize the project.

const HOUR_MS = 60 * 60_000;
// The page starts a catch-up when the last success is older than this...
const STALE_AFTER_MS = 12 * HOUR_MS;
// ...but not again within this long after a failed attempt.
const RETRY_AFTER_ERROR_MS = HOUR_MS;
const RUNNING_LEASE_MS = 5 * 60_000;

// Rows read per period. Enough for every section; beyond it is long tail.
const PAGE_AGGREGATE_LIMIT = 5_000;
const QUERY_PAGE_AGGREGATE_LIMIT = 10_000;
const DRIVER_ROWS_LIMIT = 5_000;
const NEW_ITEMS_LIMIT = 15;
// "New" needs this much stored history before the period, or every query
// and page would look new.
const NEW_BASELINE_DAYS = 28;
// Pages first seen in the first week of stored history were most likely
// there before it, so they are not called new.
const NEW_PAGE_HISTORY_SKIP_DAYS = 7;
const NEW_PAGE_LOOKBACK_DAYS = 90;
const FIRST_SEEN_ANNOTATIONS = 10;

type SyncState = Awaited<ReturnType<typeof GscHistoryRepository.getSyncState>>;

function isRunning(state: SyncState, now: Date): boolean {
  if (!state?.lastAttemptAt || state.lastError) return false;
  if (state.lastSuccessAt && state.lastSuccessAt >= state.lastAttemptAt)
    return false;
  return Date.parse(state.lastAttemptAt) > now.getTime() - RUNNING_LEASE_MS;
}

async function getStatus(projectId: string, now: Date = new Date()) {
  const [connection, state, bounds, stored] = await Promise.all([
    GscService.getConnection(projectId),
    GscHistoryRepository.getSyncState(projectId),
    GscHistoryRepository.getHistoryBounds(projectId),
    GscHistoryRepository.listStoredDates(projectId, historyWindow(now).oldest),
  ]);
  const missingDays = planSync(now, stored).missingCount;
  const running = isRunning(state, now);
  const recentError =
    Boolean(state?.lastError) &&
    Boolean(state?.lastAttemptAt) &&
    Date.parse(state?.lastAttemptAt ?? "") >
      now.getTime() - RETRY_AFTER_ERROR_MS;
  const stale =
    !state?.lastSuccessAt ||
    Date.parse(state.lastSuccessAt) < now.getTime() - STALE_AFTER_MS;
  return {
    connected: connection !== null,
    siteUrl: connection?.siteUrl ?? null,
    daysStored: bounds.days,
    oldestDay: bounds.oldest,
    newestDay: bounds.newest,
    missingDays,
    lastAttemptAt: state?.lastAttemptAt ?? null,
    lastSuccessAt: state?.lastSuccessAt ?? null,
    lastError: state?.lastError ?? null,
    backfillDoneAt: state?.backfillDoneAt ?? null,
    running,
    needsSync:
      connection !== null &&
      !running &&
      !recentError &&
      (stale || missingDays > 0),
  };
}

export type SearchHistoryStatus = Awaited<ReturnType<typeof getStatus>>;

function sumTotals(
  rows: Array<{ clicks: number; impressions: number; position: number }>,
) {
  let clicks = 0;
  let impressions = 0;
  let weighted = 0;
  for (const row of rows) {
    clicks += row.clicks;
    impressions += row.impressions;
    weighted += row.position * row.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? weighted / impressions : 0,
  };
}

type Range = { start: string; end: string };

/** The chart starts a week before the first day with impressions (or at the
 *  previous period), so a young site is not a flat line of empty months. */
function trimLeadingEmptyDays<T extends { date: string; impressions: number }>(
  daily: T[],
  previousStart: string,
): T[] {
  const first = daily.find((row) => row.impressions > 0);
  if (!first) return daily;
  const fromFirst = addDays(first.date, -7);
  const from = fromFirst < previousStart ? fromFirst : previousStart;
  return daily.filter((row) => row.date >= from);
}

async function loadCannibalization(
  projectId: string,
  current: Range,
  rows: Parameters<typeof findCannibalizationCandidates>[0],
  minImpressions: number,
) {
  const candidates = findCannibalizationCandidates(rows, minImpressions);
  const days = await GscHistoryRepository.listQueryPageDays(
    projectId,
    candidates.map((row) => row.query),
    current,
  );
  const flips = new Map(
    candidates.map((row) => [
      row.query,
      countRankingFlips(days.filter((day) => day.query === row.query)),
    ]),
  );
  return rankCannibalization(candidates, flips);
}

async function loadChanges(projectId: string, current: Range, previous: Range) {
  const [curPages, prevPages] = await Promise.all([
    GscHistoryRepository.aggregatePages(
      projectId,
      current,
      PAGE_AGGREGATE_LIMIT,
    ),
    GscHistoryRepository.aggregatePages(
      projectId,
      previous,
      PAGE_AGGREGATE_LIMIT,
    ),
  ]);
  const { rising, falling } = buildPageChanges(curPages, prevPages);
  const movingPages = [...rising, ...falling].map((row) => row.page);
  const [curRows, prevRows] = await Promise.all([
    GscHistoryRepository.aggregateQueryPages(
      projectId,
      current,
      DRIVER_ROWS_LIMIT,
      movingPages,
    ),
    GscHistoryRepository.aggregateQueryPages(
      projectId,
      previous,
      DRIVER_ROWS_LIMIT,
      movingPages,
    ),
  ]);
  const withDrivers = (rows: typeof rising, direction: "up" | "down") =>
    rows.map((row) => ({
      ...row,
      drivers: topQueryDrivers(row.page, direction, curRows, prevRows),
    }));
  return {
    rising: withDrivers(rising, "up"),
    falling: withDrivers(falling, "down"),
  };
}

async function loadNewPages(projectId: string, oldest: string, newest: string) {
  const skipBefore = addDays(oldest, NEW_PAGE_HISTORY_SKIP_DAYS);
  const lookback = addDays(newest, -NEW_PAGE_LOOKBACK_DAYS);
  const since = skipBefore > lookback ? skipBefore : lookback;
  if (since > newest) return [];
  const pages = await GscHistoryRepository.listNewPages(
    projectId,
    since,
    NEW_ITEMS_LIMIT,
  );
  const days = await GscHistoryRepository.listPageDays(
    projectId,
    pages.map((page) => page.page),
    since,
  );
  return buildNewPages(pages, days, newest);
}

type ChartAnnotation = {
  id: string | null;
  date: string;
  kind: GscAnnotationKind | "outreach" | "first_seen";
  label: string;
  url: string | null;
};

async function loadAnnotations(
  projectId: string,
  newPages: Array<{ page: string; firstDate: string }>,
): Promise<ChartAnnotation[]> {
  const [manual, links] = await Promise.all([
    GscHistoryRepository.listAnnotations(projectId),
    GscHistoryRepository.listOutreachLinks(projectId),
  ]);
  return [
    ...manual.map((row) => ({
      id: row.id,
      date: row.date,
      kind: row.kind,
      label: row.label,
      url: row.url,
    })),
    ...links.map((row) => ({
      id: null,
      date: row.at.slice(0, 10),
      kind: "outreach" as const,
      label: `Link from ${row.site}`,
      url: row.linkUrl ?? row.theirPage,
    })),
    ...newPages.slice(0, FIRST_SEEN_ANNOTATIONS).map((row) => ({
      id: null,
      date: row.firstDate,
      kind: "first_seen" as const,
      label: `First impressions: ${row.page}`,
      url: row.page,
    })),
  ];
}

async function getInsights(
  projectId: string,
  days: number,
  now: Date = new Date(),
) {
  const status = await getStatus(projectId, now);
  if (!status.oldestDay || !status.newestDay) {
    return { status, data: null };
  }
  const oldest = status.oldestDay;
  const newest = status.newestDay;
  const { current, previous } = insightPeriods(newest, now, days);

  const daily = await GscHistoryRepository.listDailyTotals(projectId);
  const inRange = (range: Range) =>
    daily.filter((row) => row.date >= range.start && row.date <= range.end);
  const totals = sumTotals(inRange(current));
  const prevTotals = sumTotals(inRange(previous));

  const queryPages = await GscHistoryRepository.aggregateQueryPages(
    projectId,
    current,
    QUERY_PAGE_AGGREGATE_LIMIT,
  );
  const minImpressions = minImpressionsFor(totals.impressions, days);
  const curve = buildCtrCurve(queryPages, minImpressions);
  const hasBaseline = oldest <= addDays(current.start, -NEW_BASELINE_DAYS);

  const [changes, cannibalization, newQueries, newPages] = await Promise.all([
    loadChanges(projectId, current, previous),
    loadCannibalization(projectId, current, queryPages, minImpressions),
    hasBaseline
      ? GscHistoryRepository.listNewQueries(projectId, current, NEW_ITEMS_LIMIT)
      : Promise.resolve([]),
    loadNewPages(projectId, oldest, newest),
  ]);

  // The best page for each new query, from the period's query x page rows.
  const bestPage = new Map<string, { page: string; position: number }>();
  for (const row of queryPages) {
    const best = bestPage.get(row.query);
    if (!best || row.position < best.position) {
      bestPage.set(row.query, { page: row.page, position: row.position });
    }
  }

  return {
    status,
    data: {
      period: { days, current, previous },
      totals,
      prevTotals,
      minImpressions,
      ctrCurve: curve,
      hasNewBaseline: hasBaseline,
      changes,
      newQueries: newQueries.map((row) => ({
        ...row,
        page: bestPage.get(row.query)?.page ?? null,
      })),
      nearPageOne: buildNearPageOne(queryPages, minImpressions, curve),
      ctrGaps: buildCtrGaps(queryPages, minImpressions, curve),
      cannibalization,
      newPages,
      daily: trimLeadingEmptyDays(daily, previous.start),
      annotations: await loadAnnotations(projectId, newPages),
    },
  };
}

export type SearchInsights = NonNullable<
  Awaited<ReturnType<typeof getInsights>>["data"]
>;

async function listAnnotations(projectId: string): Promise<Annotation[]> {
  return GscHistoryRepository.listAnnotations(projectId);
}

async function addAnnotation(input: {
  projectId: string;
  date: string;
  kind: GscAnnotationKind;
  label: string;
  url?: string;
}): Promise<Annotation> {
  return GscHistoryRepository.insertAnnotation({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    date: input.date,
    kind: input.kind,
    label: input.label,
    url: input.url ?? null,
  });
}

async function deleteAnnotation(
  projectId: string,
  annotationId: string,
): Promise<boolean> {
  return GscHistoryRepository.deleteAnnotation(projectId, annotationId);
}

export const GscHistoryService = {
  getStatus,
  getInsights,
  listAnnotations,
  addAnnotation,
  deleteAnnotation,
};
