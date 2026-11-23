/* eslint-disable max-lines -- the insight rules live together so their thresholds stay comparable */
import { sort } from "remeda";
import { addDays, daysBetween } from "@/server/features/gsc-history/syncPlan";

/**
 * Pure rules behind Search Insights. They take rows already summed by the
 * repository and decide what is worth acting on. Thresholds are relative to
 * the site's size with a floor, so a small site still sees something and a
 * big one is not flooded by its long tail.
 */

type Metrics = { clicks: number; impressions: number; position: number };
type QueryPageRow = Metrics & { query: string; page: string };
type PageRow = Metrics & { page: string };

const SECTION_LIMIT = 15;

// ---------------------------------------------------------------------------
// Period and thresholds
// ---------------------------------------------------------------------------

/** The current and previous periods. The current one ends at the newest
 *  stored day that is past GSC's ~3-day settling window (or the newest
 *  stored day when nothing is that old yet). */
export function insightPeriods(
  newestStored: string,
  today: Date,
  days: number,
): {
  current: { start: string; end: string };
  previous: { start: string; end: string };
} {
  const settled = addDays(today.toISOString().slice(0, 10), -3);
  const end = newestStored < settled ? newestStored : settled;
  const start = addDays(end, -(days - 1));
  return {
    current: { start, end },
    previous: { start: addDays(start, -days), end: addDays(start, -1) },
  };
}

/** Minimum impressions for a query x page row to count. 20 per 28 days as a
 *  floor (scaled to the period), or 0.05% of the site's impressions in the
 *  period when that is higher. */
export function minImpressionsFor(
  totalImpressions: number,
  days: number,
): number {
  const floor = Math.max(3, Math.round((20 * days) / 28));
  return Math.max(floor, Math.round(totalImpressions * 0.0005));
}

// ---------------------------------------------------------------------------
// Expected CTR by position
// ---------------------------------------------------------------------------

// Default organic CTR by rounded position (1-10), a blend of public CTR
// studies (Advanced Web Ranking, Sistrix, 2023-2025) for mixed desktop and
// mobile results. Used when the site has too little data of its own.
const DEFAULT_CTR_CURVE = [
  0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018,
];
// The site's own median replaces a default bucket once that many qualifying
// query x page rows sit in it.
const SITE_CURVE_MIN_ROWS = 20;
const CTR_MAX_POSITION = 10;

type CtrCurve = {
  source: "site" | "default" | "mixed";
  /** Expected CTR (0..1) for positions 1..10, index 0 = position 1. */
  byPosition: number[];
};

function positionBucket(position: number): number {
  return Math.min(Math.max(Math.round(position), 1), CTR_MAX_POSITION);
}

function median(values: number[]): number {
  const sorted = sort(values, (a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The site's median CTR per position bucket where it has enough rows, the
 *  default curve elsewhere. */
export function buildCtrCurve(
  rows: QueryPageRow[],
  minImpressions: number,
): CtrCurve {
  const buckets: number[][] = DEFAULT_CTR_CURVE.map(() => []);
  for (const row of rows) {
    if (row.impressions < minImpressions || row.position > CTR_MAX_POSITION)
      continue;
    buckets[positionBucket(row.position) - 1].push(
      row.clicks / row.impressions,
    );
  }
  let siteBuckets = 0;
  const byPosition = buckets.map((values, index) => {
    if (values.length < SITE_CURVE_MIN_ROWS) return DEFAULT_CTR_CURVE[index];
    siteBuckets++;
    return median(values);
  });
  const source =
    siteBuckets === 0
      ? "default"
      : siteBuckets === buckets.length
        ? "site"
        : "mixed";
  return { source, byPosition };
}

function expectedCtr(curve: CtrCurve, position: number): number {
  return curve.byPosition[positionBucket(position) - 1];
}

// ---------------------------------------------------------------------------
// Near page one
// ---------------------------------------------------------------------------

const NEAR_MIN_POSITION = 8;
const NEAR_MAX_POSITION = 20;
// Clicks are estimated as if the page reached this position.
const NEAR_TARGET_POSITION = 3;

type NearPageOneRow = {
  query: string;
  page: string;
  impressions: number;
  clicks: number;
  position: number;
  /** Extra clicks per period if the page ranked at position 3. */
  potentialClicks: number;
};

/** Queries whose best page averages position 8-20 with enough impressions,
 *  ordered by the clicks a move to position 3 would add. A query whose best
 *  page already ranks above 8 is left out. */
export function buildNearPageOne(
  rows: QueryPageRow[],
  minImpressions: number,
  curve: CtrCurve,
): NearPageOneRow[] {
  const best = new Map<string, QueryPageRow>();
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.query, (totals.get(row.query) ?? 0) + row.impressions);
    const current = best.get(row.query);
    if (
      !current ||
      row.position < current.position ||
      (row.position === current.position &&
        row.impressions > current.impressions)
    ) {
      best.set(row.query, row);
    }
  }
  const output: NearPageOneRow[] = [];
  for (const row of best.values()) {
    if (row.position < NEAR_MIN_POSITION || row.position > NEAR_MAX_POSITION)
      continue;
    const impressions = totals.get(row.query) ?? row.impressions;
    if (impressions < minImpressions) continue;
    const target = expectedCtr(curve, NEAR_TARGET_POSITION) * impressions;
    output.push({
      query: row.query,
      page: row.page,
      impressions,
      clicks: row.clicks,
      position: row.position,
      potentialClicks: Math.max(0, Math.round(target - row.clicks)),
    });
  }
  return sort(output, (a, b) => b.potentialClicks - a.potentialClicks).slice(
    0,
    SECTION_LIMIT,
  );
}

// ---------------------------------------------------------------------------
// CTR below expected
// ---------------------------------------------------------------------------

// Flag a row when its CTR is under this share of the expected CTR...
const CTR_GAP_RATIO = 0.6;
// ...and the gap is worth at least this many clicks in the period.
const CTR_GAP_MIN_CLICKS = 3;

type CtrGapRow = {
  query: string;
  page: string;
  impressions: number;
  clicks: number;
  position: number;
  ctr: number;
  expectedCtr: number;
  /** Clicks the row would get at the expected CTR, minus its clicks. */
  clickGap: number;
};

/** Page-one query x page rows whose CTR is well under the expected CTR for
 *  their position, ordered by the click gap. */
export function buildCtrGaps(
  rows: QueryPageRow[],
  minImpressions: number,
  curve: CtrCurve,
): CtrGapRow[] {
  const output: CtrGapRow[] = [];
  for (const row of rows) {
    if (row.impressions < minImpressions || row.position > CTR_MAX_POSITION)
      continue;
    const expected = expectedCtr(curve, row.position);
    const ctr = row.clicks / row.impressions;
    const clickGap = Math.round(expected * row.impressions - row.clicks);
    if (ctr >= expected * CTR_GAP_RATIO || clickGap < CTR_GAP_MIN_CLICKS)
      continue;
    output.push({
      query: row.query,
      page: row.page,
      impressions: row.impressions,
      clicks: row.clicks,
      position: row.position,
      ctr,
      expectedCtr: expected,
      clickGap,
    });
  }
  return sort(output, (a, b) => b.clickGap - a.clickGap).slice(
    0,
    SECTION_LIMIT,
  );
}

// ---------------------------------------------------------------------------
// Cannibalization
// ---------------------------------------------------------------------------

// A page counts as competing when it holds this share of a query's
// impressions; two or more such pages make a cannibalization candidate.
const CANNIBAL_MIN_SHARE = 0.2;
const CANNIBAL_CANDIDATES = 20;

type CannibalizationRow = {
  query: string;
  impressions: number;
  clicks: number;
  pages: Array<{ page: string; share: number; position: number }>;
  /** Days on which the best-ranking page differed from the day before. */
  flips: number;
};

/** Step 1: queries where 2+ pages each hold a meaningful impression share,
 *  biggest first. The caller then loads their daily rows for the flips. */
export function findCannibalizationCandidates(
  rows: QueryPageRow[],
  minImpressions: number,
): Array<Omit<CannibalizationRow, "flips">> {
  const byQuery = new Map<string, QueryPageRow[]>();
  for (const row of rows) {
    const list = byQuery.get(row.query) ?? [];
    list.push(row);
    byQuery.set(row.query, list);
  }
  const output: Array<Omit<CannibalizationRow, "flips">> = [];
  for (const [query, list] of byQuery) {
    if (list.length < 2) continue;
    const impressions = list.reduce((sum, row) => sum + row.impressions, 0);
    if (impressions < minImpressions * 2) continue;
    const pages = sort(
      list
        .map((row) => ({
          page: row.page,
          share: row.impressions / impressions,
          position: row.position,
        }))
        .filter((page) => page.share >= CANNIBAL_MIN_SHARE),
      (a, b) => b.share - a.share,
    );
    if (pages.length < 2) continue;
    output.push({
      query,
      impressions,
      clicks: list.reduce((sum, row) => sum + row.clicks, 0),
      pages,
    });
  }
  return sort(output, (a, b) => b.impressions - a.impressions).slice(
    0,
    CANNIBAL_CANDIDATES,
  );
}

/** Days on which a query's best page (lowest position, then most
 *  impressions) changed from the previous day it had data. */
export function countRankingFlips(
  days: Array<{
    date: string;
    page: string;
    position: number;
    impressions: number;
  }>,
): number {
  const bestByDay = new Map<string, { page: string; position: number }>();
  for (const day of days) {
    if (day.impressions <= 0) continue;
    const current = bestByDay.get(day.date);
    if (!current || day.position < current.position) {
      bestByDay.set(day.date, { page: day.page, position: day.position });
    }
  }
  const ordered = sort([...bestByDay.entries()], (a, b) =>
    a[0].localeCompare(b[0]),
  );
  let flips = 0;
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i][1].page !== ordered[i - 1][1].page) flips++;
  }
  return flips;
}

/** Step 2: attach flips and order by impressions, flipping queries first. */
export function rankCannibalization(
  candidates: Array<Omit<CannibalizationRow, "flips">>,
  flipsByQuery: ReadonlyMap<string, number>,
): CannibalizationRow[] {
  return sort(
    candidates.map((row) => ({
      ...row,
      flips: flipsByQuery.get(row.query) ?? 0,
    })),
    (a, b) =>
      Number(b.flips > 0) - Number(a.flips > 0) ||
      b.impressions - a.impressions,
  ).slice(0, SECTION_LIMIT);
}

// ---------------------------------------------------------------------------
// What changed
// ---------------------------------------------------------------------------

const MOVERS_PER_DIRECTION = 8;
const DRIVERS_PER_PAGE = 3;

type PageChange = {
  page: string;
  clicks: number;
  prevClicks: number;
  impressions: number;
  prevImpressions: number;
  position: number;
  prevPosition: number;
};

// Clicks lead; impressions break ties and catch pages moving before clicks.
const changeScore = (c: PageChange) =>
  (c.clicks - c.prevClicks) * 1000 + (c.impressions - c.prevImpressions);

/** Pages with the biggest click change between the periods (impressions
 *  break ties and catch pages that move before clicks follow). */
export function buildPageChanges(
  current: PageRow[],
  previous: PageRow[],
): { rising: PageChange[]; falling: PageChange[] } {
  const prev = new Map(previous.map((row) => [row.page, row]));
  const seen = new Set<string>();
  const changes: PageChange[] = [];
  const push = (page: string, cur?: PageRow, old?: PageRow) => {
    changes.push({
      page,
      clicks: cur?.clicks ?? 0,
      prevClicks: old?.clicks ?? 0,
      impressions: cur?.impressions ?? 0,
      prevImpressions: old?.impressions ?? 0,
      position: cur?.position ?? 0,
      prevPosition: old?.position ?? 0,
    });
  };
  for (const row of current) {
    seen.add(row.page);
    push(row.page, row, prev.get(row.page));
  }
  for (const row of previous) {
    if (!seen.has(row.page)) push(row.page, undefined, row);
  }
  const score = changeScore;
  const rising = sort(
    changes.filter((c) => score(c) > 0),
    (a, b) => score(b) - score(a),
  ).slice(0, MOVERS_PER_DIRECTION);
  const falling = sort(
    changes.filter((c) => score(c) < 0),
    (a, b) => score(a) - score(b),
  ).slice(0, MOVERS_PER_DIRECTION);
  return { rising, falling };
}

type QueryDriver = {
  query: string;
  clicks: number;
  prevClicks: number;
  impressions: number;
  prevImpressions: number;
};

/** The queries behind one page's change: biggest moves in the page's
 *  direction (clicks first, impressions second). */
export function topQueryDrivers(
  page: string,
  direction: "up" | "down",
  current: QueryPageRow[],
  previous: QueryPageRow[],
): QueryDriver[] {
  const byQuery = new Map<string, QueryDriver>();
  const entry = (query: string) => {
    const existing = byQuery.get(query);
    if (existing) return existing;
    const created = {
      query,
      clicks: 0,
      prevClicks: 0,
      impressions: 0,
      prevImpressions: 0,
    };
    byQuery.set(query, created);
    return created;
  };
  for (const row of current) {
    if (row.page !== page) continue;
    const e = entry(row.query);
    e.clicks += row.clicks;
    e.impressions += row.impressions;
  }
  for (const row of previous) {
    if (row.page !== page) continue;
    const e = entry(row.query);
    e.prevClicks += row.clicks;
    e.prevImpressions += row.impressions;
  }
  const sign = direction === "up" ? 1 : -1;
  const score = (d: QueryDriver) =>
    sign *
    ((d.clicks - d.prevClicks) * 1000 + (d.impressions - d.prevImpressions));
  return sort(
    [...byQuery.values()].filter((d) => score(d) > 0),
    (a, b) => score(b) - score(a),
  ).slice(0, DRIVERS_PER_PAGE);
}

// ---------------------------------------------------------------------------
// New pages
// ---------------------------------------------------------------------------

type NewPageRow = {
  page: string;
  firstDate: string;
  clicks: number;
  impressions: number;
  /** Impressions per 7-day week since the first day, oldest first. */
  weeklyImpressions: number[];
};

/** Weekly impressions since each page's first day. */
export function buildNewPages(
  pages: Array<{
    page: string;
    firstDate: string;
    clicks: number;
    impressions: number;
  }>,
  days: Array<{ page: string; date: string; impressions: number }>,
  lastDay: string,
): NewPageRow[] {
  const byPage = new Map<string, number[]>();
  for (const page of pages) {
    const weeks = Math.floor(daysBetween(page.firstDate, lastDay) / 7) + 1;
    byPage.set(
      page.page,
      Array.from({ length: Math.max(weeks, 1) }, () => 0),
    );
  }
  const firstByPage = new Map(pages.map((p) => [p.page, p.firstDate]));
  for (const day of days) {
    const weeks = byPage.get(day.page);
    const first = firstByPage.get(day.page);
    if (!weeks || !first || day.date < first || day.date > lastDay) continue;
    weeks[Math.floor(daysBetween(first, day.date) / 7)] += day.impressions;
  }
  return pages.map((page) => ({
    ...page,
    weeklyImpressions: byPage.get(page.page) ?? [],
  }));
}
