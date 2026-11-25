import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { niceTicks } from "@/client/features/charts/TimeSeriesChart";
import { useChartWidth } from "@/client/features/charts/useChartWidth";
import type { OutreachActivity } from "@/shared/outreach";

// Fork feature (FORK-CHANGES.md): first emails and follow-ups stacked, with
// replies beside them, per day or week. The bucket holding today is faded.

const FIRST = "var(--chart-1)";
const FOLLOW_UP = "color-mix(in oklab, var(--chart-1) 45%, transparent)";
const REPLY = "var(--chart-3)";

function tick(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const LEGEND = [
  { key: "first", label: "First emails", color: FIRST },
  { key: "followUps", label: "Follow-ups", color: FOLLOW_UP },
  { key: "replies", label: "Replies", color: REPLY },
] as const;

export function ActivityChart({
  buckets,
  view,
}: {
  buckets: OutreachActivity[];
  view: "day" | "week";
}) {
  const { containerRef, width } = useChartWidth();
  const top = Math.max(
    4,
    ...buckets.map((b) => Math.max(b.first + b.followUps, b.replies)),
  );
  const ticks = niceTicks(top, true);
  const height = 170;
  return (
    <div className="space-y-2">
      <div ref={containerRef} className="w-full min-w-0" style={{ height }}>
        {width > 0 ? (
          <BarChart
            width={width}
            height={height}
            data={buckets}
            margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
            barGap={2}
            accessibilityLayer={false}
          >
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tickFormatter={tick}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
              height={24}
            />
            <YAxis
              domain={[0, ticks.at(-1) ?? top]}
              ticks={ticks}
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              width={`${ticks.at(-1) ?? top}`.length * 7 + 10}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              content={({ active, payload }) => {
                const bucket = payload?.[0]?.payload as
                  | OutreachActivity
                  | undefined;
                if (!active || !bucket) return null;
                return (
                  <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
                    <div className="mb-1 font-medium">
                      {view === "day"
                        ? tick(bucket.date)
                        : `Week of ${tick(bucket.date)}`}
                      {bucket.partial ? " (so far)" : ""}
                    </div>
                    {LEGEND.map((item) => (
                      <div
                        key={item.key}
                        className="flex justify-between gap-4"
                      >
                        <span className="text-muted-foreground">
                          {item.label}
                        </span>
                        <span className="tabular-nums">{bucket[item.key]}</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {LEGEND.map((item) => (
              <Bar
                key={item.key}
                dataKey={item.key}
                stackId={item.key === "replies" ? "replies" : "sent"}
                fill={item.color}
                maxBarSize={16}
                isAnimationActive={false}
              >
                {buckets.map((bucket) => (
                  <Cell
                    key={bucket.date}
                    fillOpacity={bucket.partial ? 0.45 : 1}
                  />
                ))}
              </Bar>
            ))}
          </BarChart>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {LEGEND.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-sm"
              style={{ background: item.color }}
            />
            {item.label}
          </span>
        ))}
        <span>Faded: {view === "day" ? "today" : "this week"}, so far</span>
      </div>
    </div>
  );
}
