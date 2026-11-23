/**
 * Which Search Console days a history sync should fetch. Pure date logic,
 * kept apart from the service so the catch-up rules are unit testable.
 *
 * Days are YYYY-MM-DD strings. GSC reports in Pacific days and keeps about
 * 16 months; its newest days keep changing for ~2-3 days, so the newest
 * PROVISIONAL_DAYS are fetched again on every sync.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// The newest days are still filling in; re-fetch them every sync.
const PROVISIONAL_DAYS = 3;
// GSC keeps 16 months. Stay two days inside that edge so the oldest requested
// day is never one Google has already dropped (it would be stored as zero).
const HISTORY_MONTHS = 16;
const OLDEST_DAY_MARGIN = 2;

export function addDays(day: string, delta: number): string {
  const ms = Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

export function daysBetween(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
      DAY_MS,
  );
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The days GSC can still return: from ~16 months back to yesterday (UTC).
 *  Yesterday may not have started in Pacific time yet; it is provisional and
 *  fetched again on the next sync, so an early empty answer is harmless. */
export function historyWindow(today: Date): { oldest: string; latest: string } {
  const latest = addDays(utcDay(today), -1);
  const floor = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - HISTORY_MONTHS, 1),
  );
  const daysInMonth = new Date(
    Date.UTC(floor.getUTCFullYear(), floor.getUTCMonth() + 1, 0),
  ).getUTCDate();
  floor.setUTCDate(Math.min(today.getUTCDate(), daysInMonth));
  return { oldest: addDays(utcDay(floor), OLDEST_DAY_MARGIN), latest };
}

type SyncPlan = {
  oldest: string;
  latest: string;
  /** Days to fetch, newest first: provisional days, then missing ones. */
  candidates: string[];
  /** Missing days outside the provisional window (the backfill still to do). */
  missingCount: number;
};

/** Every day in the window that is missing from storage, plus the
 *  provisional days, newest first. */
export function planSync(today: Date, storedDates: Iterable<string>): SyncPlan {
  const { oldest, latest } = historyWindow(today);
  const stored = new Set(storedDates);
  const provisionalStart = addDays(latest, -(PROVISIONAL_DAYS - 1));
  const candidates: string[] = [];
  let missingCount = 0;
  for (let day = latest; day >= oldest; day = addDays(day, -1)) {
    const provisional = day >= provisionalStart;
    if (provisional || !stored.has(day)) candidates.push(day);
    if (!provisional && !stored.has(day)) missingCount++;
  }
  return { oldest, latest, candidates, missingCount };
}

type DaySelection = {
  /** Days with impressions whose pages and queries are fetched this run. */
  detailDays: string[];
  /** Days GSC has no impressions for: stored as zero rows, no detail calls. */
  emptyDays: string[];
  /** Days with impressions left for a later run (over the day budget). */
  deferredCount: number;
};

/** Split the candidates by the window's daily totals. Empty days cost no
 *  detail calls, so only days with impressions count against the budget. */
export function selectDays(
  candidates: string[],
  impressionsByDay: ReadonlyMap<string, number>,
  maxDetailDays: number,
): DaySelection {
  const detailDays: string[] = [];
  const emptyDays: string[] = [];
  let deferredCount = 0;
  for (const day of candidates) {
    if ((impressionsByDay.get(day) ?? 0) <= 0) {
      emptyDays.push(day);
    } else if (detailDays.length < maxDetailDays) {
      detailDays.push(day);
    } else {
      deferredCount++;
    }
  }
  return { detailDays, emptyDays, deferredCount };
}
