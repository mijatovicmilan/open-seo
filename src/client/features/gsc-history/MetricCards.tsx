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

/** Period totals that double as the chart's metric toggles, as in Search
 *  Console: each selected card is a line on the chart, in the card's colour.
 *  At least one stays selected. */
export function MetricCards({
  totals,
  prevTotals,
  selected,
  onChange,
  compareLabel,
}: {
  totals: Totals;
  prevTotals: Totals | null;
  selected: MetricKey[];
  onChange: (metrics: MetricKey[]) => void;
  compareLabel: string | null;
}) {
  return (
    <div
      className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4"
      role="group"
      aria-label="Chart metrics"
    >
      {KEYS.map((key) => {
        const metric = METRICS[key];
        const value = totals[key];
        const delta = prevTotals ? change(key, value, prevTotals[key]) : null;
        const active = selected.includes(key);
        const last = active && selected.length === 1;
        const empty =
          (key === "position" || key === "ctr") && totals.impressions === 0;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            title={last ? "At least one metric stays on" : undefined}
            onClick={() => {
              if (last) return;
              onChange(
                active
                  ? selected.filter((item) => item !== key)
                  : [...selected, key],
              );
            }}
            style={
              active
                ? {
                    borderColor: metric.color,
                    backgroundColor: `color-mix(in oklab, ${metric.color} 8%, var(--color-base-100))`,
                  }
                : undefined
            }
            className={`min-w-0 rounded-lg border bg-base-100 p-3 text-left transition-colors sm:p-4 ${
              active ? "" : "border-base-300 hover:border-base-content/30"
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-base-content/60">
              <span
                className={`flex size-3 items-center justify-center rounded-sm border ${active ? "" : "border-base-content/30"}`}
                style={
                  active
                    ? {
                        backgroundColor: metric.color,
                        borderColor: metric.color,
                      }
                    : undefined
                }
                aria-hidden
              >
                {active ? (
                  <svg viewBox="0 0 12 12" className="size-2.5 text-base-100">
                    <path
                      d="M2.5 6.2 5 8.5l4.5-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
              </span>
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
