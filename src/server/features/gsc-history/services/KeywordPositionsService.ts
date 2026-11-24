import { GscHistoryRepository } from "../repositories/GscHistoryRepository";
import { addDays } from "../syncPlan";

// Search Console positions for saved and tracked keywords (fork feature, see
// FORK-CHANGES.md), read from the stored daily history: no DataForSEO call.
// A keyword matches the Search Console query with the same words, all
// countries and devices together.

const PERIOD_DAYS = 28;
// Search Console's last ~3 days are still filling in (as in Search Insights).
const SETTLE_DAYS = 3;

function normalize(keyword: string) {
  return keyword.trim().toLowerCase().replace(/\s+/g, " ");
}

async function getPositions(
  projectId: string,
  keywords: string[],
  today: Date = new Date(),
) {
  const { newest } = await GscHistoryRepository.getHistoryBounds(projectId);
  if (!newest) return { start: null, end: null, rows: [] };

  const settled = addDays(today.toISOString().slice(0, 10), -SETTLE_DAYS);
  const end = newest < settled ? newest : settled;
  const current = { start: addDays(end, -(PERIOD_DAYS - 1)), end };
  const previous = {
    start: addDays(current.start, -PERIOD_DAYS),
    end: addDays(current.start, -1),
  };
  const queries = [...new Set(keywords.map(normalize))];
  const [now, before] = await Promise.all([
    GscHistoryRepository.aggregateQueries(projectId, current, queries),
    GscHistoryRepository.aggregateQueries(projectId, previous, queries),
  ]);
  const nowByQuery = new Map(now.map((row) => [row.query, row]));
  const beforeByQuery = new Map(before.map((row) => [row.query, row]));

  const rows = keywords.flatMap((keyword) => {
    const row = nowByQuery.get(normalize(keyword));
    if (!row) return [];
    return [
      {
        keyword,
        clicks: row.clicks,
        impressions: row.impressions,
        position: row.position,
        previousPosition:
          beforeByQuery.get(normalize(keyword))?.position ?? null,
      },
    ];
  });
  return { start: current.start, end: current.end, rows };
}

export const KeywordPositionsService = { getPositions };
