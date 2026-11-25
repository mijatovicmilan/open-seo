import { cn } from "cn";
import {
  METRICS,
  type MetricKey,
} from "@/client/features/gsc-history/searchSeries";
import type { Insights } from "@/client/features/gsc-history/types";

// Fork addition (FORK-CHANGES.md): visits and signups from PostHog.
type Totals = Insights["totals"] & { visits?: number; signups?: number };

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
const JOINED_KEYS: MetricKey[] = ["visits", "signups"];

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
  const keys = totals.visits === undefined ? KEYS : [...KEYS, ...JOINED_KEYS];
  return (
    <div
      className={`grid gap-2 ${keys.length > 4 ? "grid-cols-3 lg:grid-cols-6" : "grid-cols-2 sm:grid-cols-4"}`}
      role="group"
      aria-label="Chart metrics"
    >
      {keys.map((key) => {
        const metric = METRICS[key];
        const value = totals[key] ?? 0;
        const previous = prevTotals?.[key];
        const delta =
          previous !== undefined ? change(key, value, previous) : null;
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
                    backgroundColor: `color-mix(in oklab, ${metric.color} 8%, var(--card))`,
                  }
                : undefined
            }
            className={cn(
              "min-w-0 rounded-lg border bg-card px-3 py-2 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active ? "" : "border-border hover:bg-foreground/[0.03]",
            )}
          >
            <div className="flex items-center gap-1.5 truncate text-[11px] uppercase tracking-wide text-muted-foreground">
              <span
                className={cn(
                  "flex size-3 shrink-0 items-center justify-center rounded-sm border",
                  active ? "" : "border-foreground/30",
                )}
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
                  <svg viewBox="0 0 12 12" className="size-2.5 text-card">
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
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-lg font-semibold tabular-nums text-foreground">
                {empty ? "—" : metric.format(value)}
              </span>
              {delta ? (
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    delta.improved ? "text-success" : "text-destructive",
                  )}
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
