import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import { useChartWidth } from "@/client/features/rank-tracking/RankTrackingTrendChart";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";
import type { Insights } from "@/client/features/gsc-history/types";

type Annotation = Insights["annotations"][number];

const CLICKS_COLOR = "#7c3aed";
const IMPRESSIONS_COLOR = "#3b82f6";

export const ANNOTATION_STYLES: Record<
  Annotation["kind"],
  { color: string; label: string }
> = {
  // Theme tokens, so notes follow the app's light and dark palettes.
  deploy: { color: "var(--color-warning)", label: "Deploy" },
  page: { color: "var(--color-success)", label: "Page" },
  link: { color: "var(--color-primary)", label: "Link" },
  note: {
    color: "color-mix(in oklab, var(--color-base-content) 45%, transparent)",
    label: "Note",
  },
  outreach: { color: "var(--color-primary)", label: "Outreach link" },
  first_seen: { color: "var(--color-info)", label: "New page" },
};

const CHART_HEIGHT = 260;

export function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatTick(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatAxis(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact" }).format(value);
}

export function SearchInsightsChart({ insights }: { insights: Insights }) {
  const { containerRef, width } = useChartWidth();
  const { daily, annotations, period } = insights;

  const annotationsByDay = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const annotation of annotations) {
      const list = map.get(annotation.date) ?? [];
      list.push(annotation);
      map.set(annotation.date, list);
    }
    return map;
  }, [annotations]);

  // Lines only for days the chart has, one per day (first kind wins color).
  const days = new Set(daily.map((row) => row.date));
  const markers = [...annotationsByDay.entries()].filter(([day]) =>
    days.has(day),
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-base-content/60">
        <LegendDot color={CLICKS_COLOR} label="Clicks" />
        <LegendDot color={IMPRESSIONS_COLOR} label="Impressions" />
        {Object.entries(ANNOTATION_STYLES).map(([kind, style]) =>
          annotations.some((a) => a.kind === kind) ? (
            <LegendDot
              key={kind}
              color={style.color}
              label={style.label}
              line
            />
          ) : null,
        )}
      </div>
      <div
        ref={containerRef}
        className="w-full min-w-0"
        style={{ height: CHART_HEIGHT }}
        aria-label="Daily clicks and impressions"
      >
        {width > 0 ? (
          <LineChart
            width={width}
            height={CHART_HEIGHT}
            data={daily}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="currentColor"
              opacity={0.1}
              vertical={false}
            />
            <ReferenceArea
              yAxisId="clicks"
              x1={period.current.start}
              x2={period.current.end}
              fill="currentColor"
              fillOpacity={0.04}
              ifOverflow="hidden"
            />
            <XAxis
              dataKey="date"
              tickFormatter={formatTick}
              tick={{ fontSize: 10, fill: "#888" }}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
            />
            <YAxis
              yAxisId="clicks"
              tickFormatter={formatAxis}
              tick={{ fontSize: 10, fill: "#888" }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <YAxis
              yAxisId="impressions"
              orientation="right"
              tickFormatter={formatAxis}
              tick={{ fontSize: 10, fill: "#888" }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            {markers.map(([day, list]) => (
              <ReferenceLine
                key={day}
                yAxisId="clicks"
                x={day}
                stroke={ANNOTATION_STYLES[list[0].kind].color}
                strokeDasharray="4 3"
                strokeOpacity={0.8}
              />
            ))}
            <Tooltip
              content={(props: TooltipContentProps<number, string>) => (
                <ChartTooltip
                  active={props.active}
                  label={props.label}
                  daily={daily}
                  annotationsByDay={annotationsByDay}
                />
              )}
              cursor={{ stroke: "rgba(150,150,150,0.3)" }}
            />
            <Line
              yAxisId="impressions"
              type="monotone"
              dataKey="impressions"
              name="Impressions"
              stroke={IMPRESSIONS_COLOR}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              yAxisId="clicks"
              type="monotone"
              dataKey="clicks"
              name="Clicks"
              stroke={CLICKS_COLOR}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        ) : null}
      </div>
      <p className="text-xs text-base-content/50">
        Shaded: the current {period.days}-day period. Dashed lines mark
        annotations; hover a day to read them.
      </p>
    </div>
  );
}

function LegendDot({
  color,
  label,
  line = false,
}: {
  color: string;
  label: string;
  line?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={
          line ? "h-3 w-0 border-l-2 border-dashed" : "size-2 rounded-full"
        }
        style={line ? { borderColor: color } : { backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function ChartTooltip({
  active,
  label,
  daily,
  annotationsByDay,
}: {
  active?: boolean;
  label?: string | number;
  daily: Insights["daily"];
  annotationsByDay: Map<string, Annotation[]>;
}) {
  if (!active || typeof label !== "string") return null;
  const row = daily.find((d) => d.date === label);
  const notes = annotationsByDay.get(label) ?? [];
  return (
    <div className="max-w-xs rounded-lg border border-base-300 bg-base-100 p-2 text-xs shadow-md">
      <div className="font-medium">{formatDay(label)}</div>
      {row ? (
        <div className="mt-1 space-y-0.5">
          <div style={{ color: CLICKS_COLOR }}>
            Clicks: {formatCount(row.clicks)}
          </div>
          <div style={{ color: IMPRESSIONS_COLOR }}>
            Impressions: {formatCount(row.impressions)}
          </div>
        </div>
      ) : null}
      {notes.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 border-t border-base-300 pt-1.5">
          {notes.map((note, index) => (
            <li key={`${note.kind}-${index}`} className="break-words">
              <span style={{ color: ANNOTATION_STYLES[note.kind].color }}>
                {ANNOTATION_STYLES[note.kind].label}:
              </span>{" "}
              {note.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
