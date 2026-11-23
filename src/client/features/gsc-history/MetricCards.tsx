import {
  METRICS,
  type MetricKey,
} from "@/client/features/gsc-history/searchSeries";
import type { Insights } from "@/client/features/gsc-history/types";

type Totals = Insights["totals"];

// On tiny numbers a percentage misleads (3 to 39 impressions is "+1200%"),
// so under 20 the change is shown as a plain difference.
function change(
  key: MetricKey,
  current: number,
  previous: number,
): { text: string; improved: boolean } | null {
  if (key === "position") {
    if (previous <= 0 || current <= 0) return null;
    const diff = previous - current;
    return Math.abs(diff) < 0.05
      ? null
      : {
          text: `${diff > 0 ? "+" : ""}${diff.toFixed(1)}`,
          improved: diff > 0,
        };
  }
  if (previous <= 0) return null;
  if (key !== "ctr" && previous < 20) {
    const diff = current - previous;
    return diff === 0
      ? null
      : {
          text: `${diff > 0 ? "+" : ""}${diff.toLocaleString("en-US")}`,
          improved: diff > 0,
        };
  }
  const pct = ((current - previous) / previous) * 100;
  return Math.abs(pct) < 0.05
    ? null
    : { text: `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`, improved: pct > 0 };
}

const KEYS: MetricKey[] = ["clicks", "impressions", "ctr", "position"];

/** Period totals that double as the chart's metric picker, as in Search
 *  Console: the selected card is the line on the chart. */
export function MetricCards({
  totals,
  prevTotals,
  selected,
  onSelect,
  compareLabel,
}: {
  totals: Totals;
  prevTotals: Totals | null;
  selected: MetricKey;
  onSelect: (metric: MetricKey) => void;
  compareLabel: string | null;
}) {
  return (
    <div
      className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4"
      role="radiogroup"
      aria-label="Chart metric"
    >
      {KEYS.map((key) => {
        const metric = METRICS[key];
        const value = totals[key];
        const delta = prevTotals ? change(key, value, prevTotals[key]) : null;
        const active = key === selected;
        const empty =
          (key === "position" || key === "ctr") && totals.impressions === 0;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(key)}
            className={`min-w-0 rounded-lg border bg-base-100 p-3 text-left transition-colors sm:p-4 ${
              active
                ? "border-primary ring-1 ring-primary/40"
                : "border-base-300 hover:border-base-content/30"
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-base-content/60">
              <span
                className={`size-2 rounded-full ${active ? "bg-primary" : "bg-base-content/20"}`}
                aria-hidden
              />
              {metric.name}
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className="text-xl font-semibold tabular-nums sm:text-2xl">
                {empty ? "—" : metric.format(value)}
              </span>
              {delta ? (
                <span
                  className={`text-xs tabular-nums ${delta.improved ? "text-success" : "text-error"}`}
                  title={compareLabel ? `vs ${compareLabel}` : undefined}
                >
                  {delta.text}
                </span>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
