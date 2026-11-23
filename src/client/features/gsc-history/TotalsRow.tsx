import {
  formatCount,
  formatCtr,
  formatPosition,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import type { Insights } from "@/client/features/gsc-history/types";

type Totals = Insights["totals"];

function TotalCell({
  label,
  value,
  change,
  improved,
}: {
  label: string;
  value: string;
  change: string | null;
  improved: boolean;
}) {
  return (
    <div className="rounded-lg border border-base-300 bg-base-100 p-4">
      <div className="text-xs uppercase tracking-wide text-base-content/60">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{value}</span>
        {change ? (
          <span
            className={`text-xs ${improved ? "text-success" : "text-error"}`}
          >
            {change}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// On tiny numbers a percentage misleads (3 to 39 impressions is "+1200%"),
// so under 20 the change is shown as a plain difference.
function percentChange(current: number, previous: number): string | null {
  if (previous <= 0) return null;
  if (previous < 20 && Number.isInteger(previous)) {
    const diff = current - previous;
    return diff === 0 ? null : `${diff > 0 ? "+" : ""}${diff}`;
  }
  const change = ((current - previous) / previous) * 100;
  return `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
}

/** Period totals against the previous period. Position improves downward. */
export function TotalsRow({
  totals,
  prevTotals,
}: {
  totals: Totals;
  prevTotals: Totals;
}) {
  const positionChange =
    totals.position > 0 && prevTotals.position > 0
      ? prevTotals.position - totals.position
      : null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <TotalCell
        label="Clicks"
        value={formatCount(totals.clicks)}
        change={percentChange(totals.clicks, prevTotals.clicks)}
        improved={totals.clicks >= prevTotals.clicks}
      />
      <TotalCell
        label="Impressions"
        value={formatCount(totals.impressions)}
        change={percentChange(totals.impressions, prevTotals.impressions)}
        improved={totals.impressions >= prevTotals.impressions}
      />
      <TotalCell
        label="CTR"
        value={formatCtr(totals.ctr)}
        change={percentChange(totals.ctr, prevTotals.ctr)}
        improved={totals.ctr >= prevTotals.ctr}
      />
      <TotalCell
        label="Avg position"
        value={formatPosition(totals.position)}
        change={
          positionChange === null
            ? null
            : `${positionChange >= 0 ? "+" : ""}${positionChange.toFixed(1)}`
        }
        improved={(positionChange ?? 0) >= 0}
      />
    </div>
  );
}
