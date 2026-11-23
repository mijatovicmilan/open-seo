import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import { useChartWidth } from "@/client/features/rank-tracking/RankTrackingTrendChart";

// One time-series chart for the fork's Outreach and Search Insights pages:
// one metric at a time on one honest axis (whole-number ticks for counts,
// reversed for position), straight segments between real values, an optional
// muted comparison line, days still being reported drawn dashed, and notes
// as small markers on the baseline that show a guide line on hover. Colours
// come from the theme, so light and dark both work.

export type ChartNote = {
  kind: string;
  label: string;
  color: string;
  /** Text for the tooltip ("Link from Example Blog"). */
  text: string;
};

export type ChartPoint = {
  key: string;
  /** Tooltip heading ("Mon, Nov 10", "Week of Nov 10", "November 2026"). */
  label: string;
  /** Axis label ("Nov 10"). */
  tick: string;
  value: number | null;
  compare?: number | null;
  compareLabel?: string;
  /** Drawn dashed: days Search Console is still reporting, or a bucket the
   *  range only partly covers. */
  partial?: boolean;
  /** Why it is dashed, for the tooltip ("still reporting", "3 of 7 days"). */
  partialNote?: string;
  notes?: ChartNote[];
};

export type ChartMetric = {
  name: string;
  format: (value: number) => string;
  /** Counts get whole-number ticks; rates and averages do not. */
  integer: boolean;
  /** Lower is better (average position): the axis runs top to bottom. */
  inverted?: boolean;
  /** Percentages: ticks are formatted with `format`. */
  percent?: boolean;
};

const PRIMARY = "var(--color-primary)";
const MUTED = "color-mix(in oklab, var(--color-base-content) 35%, transparent)";
const AXIS = "color-mix(in oklab, var(--color-base-content) 55%, transparent)";

/** Round numbers for an axis: about four steps of 1, 2 or 5 × 10^n (2.5 is
 *  allowed for rates), always starting at 0 and reaching at least `max`. */
export function niceTicks(max: number, integer: boolean): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const multipliers = integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const found =
    multipliers.map((m) => m * power).find((step) => step >= rough) ??
    10 * power;
  const step = integer ? Math.max(1, Math.ceil(found)) : found;
  const ticks = [0];
  while ((ticks.at(-1) ?? 0) < max) {
    ticks.push(Number(((ticks.at(-1) ?? 0) + step).toFixed(6)));
  }
  return ticks;
}

type Row = ChartPoint & {
  settled: number | null;
  reporting: number | null;
  noteY: number;
};

function TooltipCard({
  point,
  metric,
  compareName,
}: {
  point: Row;
  metric: ChartMetric;
  compareName?: string;
}) {
  const notes = point.notes ?? [];
  return (
    <div className="w-60 rounded-lg border border-base-300 bg-base-100 p-3 text-xs shadow-lg">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-medium text-base-content">{point.label}</span>
        {point.partial ? (
          <span className="text-base-content/50">
            {point.partialNote ?? "still reporting"}
          </span>
        ) : null}
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: PRIMARY }}
          />
          <span className="flex-1 text-base-content/70">{metric.name}</span>
          <span className="tabular-nums font-medium text-base-content">
            {point.value === null ? "—" : metric.format(point.value)}
          </span>
        </div>
        {point.compare !== undefined ? (
          <div className="flex items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: MUTED }}
            />
            <span className="min-w-0 flex-1 truncate text-base-content/60">
              {point.compareLabel ?? compareName ?? "Before"}
            </span>
            <span className="tabular-nums text-base-content/70">
              {point.compare === null ? "—" : metric.format(point.compare)}
            </span>
          </div>
        ) : null}
      </div>
      {notes.length ? (
        <ul className="mt-2 space-y-1 border-t border-base-300 pt-2">
          {notes.slice(0, 4).map((note, index) => (
            <li
              key={`${note.kind}-${index}`}
              className="flex items-start gap-2"
            >
              <span
                className="mt-1 size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: note.color }}
              />
              <span className="min-w-0 flex-1">
                <span className="text-base-content/50">{note.label} · </span>
                <span className="break-words text-base-content/80">
                  {note.text}
                </span>
              </span>
            </li>
          ))}
          {notes.length > 4 ? (
            <li className="text-base-content/50">+{notes.length - 4} more</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

export function TimeSeriesChart({
  points,
  metric,
  kind = "line",
  height = 240,
  compareName,
}: {
  points: ChartPoint[];
  metric: ChartMetric;
  kind?: "line" | "bar";
  height?: number;
  compareName?: string;
}) {
  const { containerRef, width } = useChartWidth();
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const { rows, ticks, domain } = useMemo(() => {
    const values = points.flatMap((p) => [p.value, p.compare ?? null]);
    const max = Math.max(0, ...values.filter((v): v is number => v !== null));
    const tickList = metric.inverted
      ? niceTicks(Math.max(max, 1), true).filter((t) => t > 0)
      : niceTicks(max, metric.integer);
    const axisDomain: [number, number] = metric.inverted
      ? [1, Math.max(tickList.at(-1) ?? 1, 2)]
      : [0, tickList.at(-1) ?? 1];
    const finalTicks = metric.inverted
      ? [1, ...tickList.filter((t) => t > 1)]
      : tickList;
    // Solid between complete points; dashed on any segment that touches a
    // partial point (drawn underneath, so the two lines join).
    const built: Row[] = points.map((p, index) => {
      const near =
        p.partial ||
        Boolean(points[index - 1]?.partial) ||
        Boolean(points[index + 1]?.partial);
      return {
        ...p,
        settled: p.partial ? null : p.value,
        reporting: near ? p.value : null,
        noteY: metric.inverted ? axisDomain[1] : 0,
      };
    });
    return { rows: built, ticks: finalTicks, domain: axisDomain };
  }, [points, metric]);

  const hasCompare = points.some((p) => p.compare !== undefined);
  const hasNotes = points.some((p) => p.notes?.length);
  const showDots = points.length <= 45;
  const activeRow = rows.find((row) => row.key === activeKey);
  // Markers closer than ~16px merge into one with a count; the tooltip still
  // lists each day's own notes.
  const markers = useMemo(() => {
    const plotWidth = Math.max(1, width - 56);
    const window = Math.max(
      1,
      Math.ceil(16 / (plotWidth / Math.max(1, rows.length))),
    );
    const out: Array<{ key: string; noteY: number; notes: ChartNote[] }> = [];
    let lastIndex = -Infinity;
    rows.forEach((row, index) => {
      if (!row.notes?.length) return;
      const last = out.at(-1);
      if (last && index - lastIndex < window) {
        last.notes.push(...row.notes);
        return;
      }
      out.push({ key: row.key, noteY: row.noteY, notes: [...row.notes] });
      lastIndex = index;
    });
    return out;
  }, [rows, width]);

  const axes = (
    <>
      <CartesianGrid
        vertical={false}
        stroke="currentColor"
        strokeOpacity={0.08}
      />
      <XAxis
        dataKey="key"
        tickFormatter={(key: string) =>
          rows.find((row) => row.key === key)?.tick ?? key
        }
        tick={{ fontSize: 11, fill: AXIS }}
        tickMargin={hasNotes ? 16 : 6}
        tickLine={false}
        axisLine={false}
        minTickGap={28}
        interval="preserveStartEnd"
      />
      <YAxis
        domain={domain}
        ticks={ticks}
        reversed={Boolean(metric.inverted)}
        allowDecimals={!metric.integer}
        tickFormatter={(value: number) =>
          metric.percent
            ? metric.format(value)
            : new Intl.NumberFormat("en-US", { notation: "compact" }).format(
                value,
              )
        }
        tick={{ fontSize: 11, fill: AXIS }}
        tickLine={false}
        axisLine={false}
        width={40}
      />
      <Tooltip
        cursor={
          kind === "bar"
            ? { fill: "currentColor", fillOpacity: 0.05 }
            : { stroke: "currentColor", strokeOpacity: 0.2 }
        }
        wrapperStyle={{ outline: "none", zIndex: 20 }}
        content={(props: TooltipContentProps<number, string>) => {
          const key = typeof props.label === "string" ? props.label : null;
          const row = rows.find((item) => item.key === key);
          if (!props.active || !row) return null;
          return (
            <TooltipCard
              point={row}
              metric={metric}
              compareName={compareName}
            />
          );
        }}
      />
      {activeRow?.notes?.length ? (
        <ReferenceLine
          x={activeRow.key}
          stroke={activeRow.notes[0]?.color ?? MUTED}
          strokeDasharray="3 3"
          ifOverflow="visible"
        />
      ) : null}
      {markers.map((row) => (
        <ReferenceDot
          key={`note-${row.key}`}
          x={row.key}
          y={row.noteY}
          ifOverflow="visible"
          shape={(shapeProps: { cx?: number; cy?: number }) => {
            const cx = shapeProps.cx ?? 0;
            // Just under the baseline, apart from the line's own dots.
            const cy = (shapeProps.cy ?? 0) + 10;
            const count = row.notes.length;
            const color = row.notes[0]?.color ?? MUTED;
            return (
              <g>
                <circle
                  cx={cx}
                  cy={cy}
                  r={count > 1 ? 6 : 3.5}
                  fill={color}
                  stroke="var(--color-base-100)"
                  strokeWidth={1.5}
                />
                {count > 1 ? (
                  <text
                    x={cx}
                    y={cy + 3}
                    textAnchor="middle"
                    fontSize={8}
                    fontWeight={600}
                    fill="var(--color-base-100)"
                  >
                    {count}
                  </text>
                ) : null}
              </g>
            );
          }}
        />
      ))}
    </>
  );

  const onMove = (state: { activeLabel?: string | number }) => {
    const label =
      typeof state.activeLabel === "string" ? state.activeLabel : null;
    if (label !== activeKey) setActiveKey(label);
  };

  return (
    <div ref={containerRef} className="w-full min-w-0" style={{ height }}>
      {width > 0 ? (
        kind === "bar" ? (
          <BarChart
            width={width}
            height={height}
            data={rows}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            onMouseMove={onMove}
            onMouseLeave={() => setActiveKey(null)}
          >
            {axes}
            <Bar
              dataKey="value"
              fill={PRIMARY}
              fillOpacity={0.85}
              radius={[3, 3, 0, 0]}
              maxBarSize={18}
              isAnimationActive={false}
            />
          </BarChart>
        ) : (
          <LineChart
            width={width}
            height={height}
            data={rows}
            margin={{ top: 8, right: 8, bottom: 12, left: 0 }}
            onMouseMove={onMove}
            onMouseLeave={() => setActiveKey(null)}
          >
            {axes}
            {hasCompare ? (
              <Line
                type="linear"
                dataKey="compare"
                stroke={MUTED}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ) : null}
            <Line
              type="linear"
              dataKey="reporting"
              stroke={PRIMARY}
              strokeOpacity={0.55}
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: PRIMARY }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="settled"
              stroke={PRIMARY}
              strokeWidth={2}
              dot={showDots ? { r: 2, strokeWidth: 0, fill: PRIMARY } : false}
              activeDot={{ r: 4, strokeWidth: 0, fill: PRIMARY }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        )
      ) : null}
    </div>
  );
}
