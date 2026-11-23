/* eslint-disable max-lines -- the shared chart, its axes, markers and tooltip (fork feature) */
import { type SyntheticEvent, useMemo, useState } from "react";
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

// One time-series chart for the fork's Outreach and Search Insights pages,
// working like Search Console's: one or more metrics, each in its own theme
// colour and on its own scale. At most two scales show an axis (left and
// right, ticks in the series colour so it is clear which line they belong
// to); further metrics are drawn to their own hidden scale. Counts get
// whole-number round ticks and position runs top to bottom. Segments are
// straight between real values; days still being reported (or a bucket the
// range cuts short) stand apart, faint; the comparison period is a faint
// solid line in the same colour. Notes are small neutral markers under the baseline,
// merged with a count when close, with a guide line on hover. The tooltip
// always shows every selected metric's real value. Days still being
// reported are a faint dotted line that never joins the last complete day.

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
  /** Value per series key; null where there is nothing to show. */
  values: Record<string, number | null>;
  /** Comparison value per series key, when a comparison is shown. */
  compare?: Record<string, number | null>;
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
  /** The axis reaches at least this far (counts: 5 clicks, 50 impressions;
   *  position: 10), so a handful of events never fills the chart's height. */
  minTop?: number;
};

export type ChartSeries = {
  key: string;
  metric: ChartMetric;
  /** A theme colour, e.g. "var(--color-primary)". */
  color: string;
};

const NOTE = "color-mix(in oklab, var(--color-base-content) 55%, transparent)";
const AXIS = "color-mix(in oklab, var(--color-base-content) 55%, transparent)";
const faint = (color: string) =>
  `color-mix(in oklab, ${color} 35%, transparent)`;

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

/** An axis for one series: domain and ticks from its own values (and its
 *  comparison), position reversed and starting at 1. */
function axisFor(points: ChartPoint[], series: ChartSeries) {
  const values = points.flatMap((p) => [
    p.values[series.key] ?? null,
    p.compare?.[series.key] ?? null,
  ]);
  const max = Math.max(
    series.metric.minTop ?? 0,
    ...values.filter((v): v is number => v !== null),
  );
  if (series.metric.inverted) {
    const ticks = niceTicks(Math.max(max, 2), true).filter((t) => t > 0);
    const top = ticks.at(-1) ?? 2;
    return {
      domain: [1, top] as [number, number],
      ticks: [1, ...ticks.filter((t) => t > 1)],
    };
  }
  const ticks = niceTicks(max, series.metric.integer);
  return { domain: [0, ticks.at(-1) ?? 1] as [number, number], ticks };
}

type Row = ChartPoint & Record<string, unknown>;

function TooltipCard({
  point,
  series,
}: {
  point: ChartPoint;
  series: ChartSeries[];
}) {
  const notes = point.notes ?? [];
  const hasCompare = Boolean(point.compare);
  return (
    <div className="w-64 rounded-lg border border-base-300 bg-base-100 p-3 text-xs shadow-lg">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-medium text-base-content">{point.label}</span>
        {point.partial ? (
          <span className="text-base-content/50">
            {point.partialNote ?? "still reporting"}
          </span>
        ) : null}
      </div>
      <table className="w-full">
        {hasCompare ? (
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-base-content/40">
              <th />
              <th className="pb-1 text-right font-normal">This</th>
              <th
                className="max-w-20 truncate pb-1 pl-2 text-right font-normal"
                title={point.compareLabel}
              >
                {point.compareLabel ?? "Before"}
              </th>
            </tr>
          </thead>
        ) : null}
        <tbody>
          {series.map((s) => {
            const value = point.values[s.key];
            const prior = point.compare?.[s.key];
            return (
              <tr key={s.key}>
                <td className="py-0.5">
                  <span className="flex items-center gap-2 text-base-content/70">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    {s.metric.name}
                  </span>
                </td>
                <td className="py-0.5 text-right font-medium tabular-nums text-base-content">
                  {value === null || value === undefined
                    ? "—"
                    : s.metric.format(value)}
                </td>
                {hasCompare ? (
                  <td className="py-0.5 pl-2 text-right tabular-nums text-base-content/50">
                    {prior === null || prior === undefined
                      ? "—"
                      : s.metric.format(prior)}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
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
  series,
  kind = "line",
  height = 240,
  onPointClick,
}: {
  points: ChartPoint[];
  series: ChartSeries[];
  kind?: "line" | "bar";
  height?: number;
  /** Clicking a day (e.g. to add a note there), with where it was clicked. */
  onPointClick?: (key: string, at: { x: number; y: number }) => void;
}) {
  const { containerRef, width } = useChartWidth();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const hasCompare = points.some((p) => p.compare);
  const hasNotes = points.some((p) => p.notes?.length);
  const showDots = points.length <= 45;

  const axes = useMemo(
    () => series.map((s) => ({ series: s, ...axisFor(points, s) })),
    [points, series],
  );

  // Per series: the complete points (solid line), the incomplete ones (a
  // separate faint line) and the comparison.
  const rows: Row[] = useMemo(
    () =>
      points.map((p) => {
        const row: Row = { ...p };
        for (const s of series) {
          const value = p.values[s.key] ?? null;
          row[`${s.key}__solid`] = p.partial ? null : value;
          // Incomplete days stand apart: faint, never joined to the last
          // complete day, so a half-reported day does not read as a drop.
          row[`${s.key}__partial`] = p.partial ? value : null;
          row[`${s.key}__compare`] = p.compare?.[s.key] ?? null;
        }
        return row;
      }),
    [points, series],
  );

  // Markers closer than ~16px merge into one with a count; the tooltip still
  // lists each day's own notes.
  const markers = useMemo(() => {
    const plotWidth = Math.max(1, width - 96);
    const window = Math.max(
      1,
      Math.ceil(16 / (plotWidth / Math.max(1, rows.length))),
    );
    const out: Array<{ key: string; notes: ChartNote[] }> = [];
    let lastIndex = -Infinity;
    rows.forEach((row, index) => {
      if (!row.notes?.length) return;
      const last = out.at(-1);
      if (last && index - lastIndex < window) {
        last.notes.push(...row.notes);
        return;
      }
      out.push({ key: row.key, notes: [...row.notes] });
      lastIndex = index;
    });
    return out;
  }, [rows, width]);

  const activeRow = rows.find((row) => row.key === activeKey);
  const baseAxis = axes[0];
  const baseline = baseAxis?.series.metric.inverted
    ? (baseAxis.domain[1] ?? 1)
    : 0;

  const chartParts = (
    <>
      <CartesianGrid
        vertical={false}
        stroke="currentColor"
        strokeOpacity={0.08}
        yAxisId={baseAxis?.series.key}
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
      {axes.map((axis, index) => (
        <YAxis
          key={axis.series.key}
          yAxisId={axis.series.key}
          orientation={index === 1 ? "right" : "left"}
          hide={index > 1}
          domain={axis.domain}
          ticks={axis.ticks}
          reversed={Boolean(axis.series.metric.inverted)}
          allowDecimals={!axis.series.metric.integer}
          tickFormatter={(value: number) =>
            axis.series.metric.percent
              ? axis.series.metric.format(value)
              : new Intl.NumberFormat("en-US", {
                  notation: "compact",
                }).format(value)
          }
          // With two scales the ticks take each line's colour, so it is
          // clear which axis belongs to which line.
          tick={{
            fontSize: 11,
            // Mixed toward the text colour so light tones stay readable.
            fill:
              axes.length > 1
                ? `color-mix(in oklab, ${axis.series.color} 70%, var(--color-base-content))`
                : AXIS,
          }}
          tickLine={false}
          axisLine={false}
          width={44}
        />
      ))}
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
          return <TooltipCard point={row} series={series} />;
        }}
      />
      {activeRow?.notes?.length ? (
        <ReferenceLine
          x={activeRow.key}
          yAxisId={baseAxis?.series.key}
          stroke={NOTE}
          strokeDasharray="3 3"
          ifOverflow="visible"
        />
      ) : null}
      {markers.map((marker) => (
        <ReferenceDot
          key={`note-${marker.key}`}
          x={marker.key}
          y={baseline}
          yAxisId={baseAxis?.series.key}
          ifOverflow="visible"
          shape={(shapeProps: { cx?: number; cy?: number }) => {
            const cx = shapeProps.cx ?? 0;
            // Just under the baseline, apart from the lines' own dots.
            const cy = (shapeProps.cy ?? 0) + 10;
            const count = marker.notes.length;
            return (
              <g>
                <circle
                  cx={cx}
                  cy={cy}
                  r={count > 1 ? 6 : 3.5}
                  fill={NOTE}
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
  const onClick = (
    state: { activeLabel?: string | number },
    event: SyntheticEvent,
  ) => {
    const label =
      typeof state.activeLabel === "string" ? state.activeLabel : null;
    if (!label || !onPointClick) return;
    const native = event.nativeEvent;
    onPointClick(
      label,
      native instanceof MouseEvent
        ? { x: native.clientX, y: native.clientY }
        : { x: window.innerWidth / 2, y: window.innerHeight / 3 },
    );
  };
  const margin = {
    top: 8,
    right: axes.length > 1 ? 0 : 8,
    bottom: 12,
    left: 0,
  };

  return (
    <div
      ref={containerRef}
      // recharts focuses its surface on click; the app shows no ring there.
      className="w-full min-w-0 [&_*:focus]:outline-none"
      style={{ height }}
    >
      {width > 0 ? (
        kind === "bar" ? (
          <BarChart
            width={width}
            height={height}
            data={rows}
            margin={margin}
            onMouseMove={onMove}
            onMouseLeave={() => setActiveKey(null)}
          >
            {chartParts}
            {series.map((s) => (
              <Bar
                key={s.key}
                yAxisId={s.key}
                dataKey={`${s.key}__solid`}
                fill={s.color}
                fillOpacity={0.85}
                radius={[3, 3, 0, 0]}
                maxBarSize={18}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        ) : (
          <LineChart
            width={width}
            height={height}
            data={rows}
            margin={margin}
            onMouseMove={onMove}
            onMouseLeave={() => setActiveKey(null)}
            onClick={onClick}
            style={onPointClick ? { cursor: "pointer" } : undefined}
          >
            {chartParts}
            {hasCompare
              ? series.map((s) => (
                  <Line
                    key={`${s.key}-compare`}
                    yAxisId={s.key}
                    type="linear"
                    dataKey={`${s.key}__compare`}
                    stroke={faint(s.color)}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))
              : null}
            {series.map((s) => (
              <Line
                key={`${s.key}-partial`}
                yAxisId={s.key}
                type="linear"
                dataKey={`${s.key}__partial`}
                stroke={faint(s.color)}
                strokeWidth={2}
                strokeDasharray="2 4"
                dot={{ r: 2.5, strokeWidth: 0, fill: faint(s.color) }}
                activeDot={{ r: 4, strokeWidth: 0, fill: faint(s.color) }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
            {series.map((s) => (
              <Line
                key={`${s.key}-solid`}
                yAxisId={s.key}
                type="linear"
                dataKey={`${s.key}__solid`}
                stroke={s.color}
                strokeWidth={2}
                dot={showDots ? { r: 2, strokeWidth: 0, fill: s.color } : false}
                activeDot={{ r: 4, strokeWidth: 0, fill: s.color }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        )
      ) : null}
    </div>
  );
}
