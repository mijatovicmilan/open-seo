/* eslint-disable max-lines -- the shared chart, its axes, markers and tooltip (fork feature) */
import {
  type KeyboardEvent,
  type SyntheticEvent,
  useCallback,
  useMemo,
  useRef,
} from "react";
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
import { TooltipLayer } from "@/client/features/charts/ChartTooltip";
import {
  type ShownDay,
  useChartTooltip,
} from "@/client/features/charts/useChartTooltip";
import { useChartWidth } from "@/client/features/charts/useChartWidth";

// One time-series chart for the fork's Outreach and Search Insights pages,
// working like Search Console's: one or more metrics, each in its own theme
// colour and on its own scale. At most two scales show an axis (left and
// right, ticks in the series colour so it is clear which line they belong
// to); further metrics are drawn to their own hidden scale. Counts get
// whole-number round ticks and position runs top to bottom. Segments are
// straight between real values; days still being reported (or a bucket the
// range cuts short) are a faint dotted line that carries on from the
// complete day next to them; the comparison period is a faint solid line in
// the same colour. Notes are small neutral markers under the baseline,
// merged with a count when close. The tooltip always shows every selected
// metric's real value.

export type ChartNote = {
  kind: string;
  label: string;
  color: string;
  /** Text for the tooltip ("Link from Example Blog"). */
  text: string;
  /** The day it belongs to (YYYY-MM-DD). */
  date?: string;
  /** Opened in a new tab from the tooltip. */
  url?: string | null;
  id?: string | null;
  /** A note people wrote: the tooltip offers to edit it. */
  editable?: boolean;
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
/** Fresh days: lighter than the line, but clear in both themes. */
const fresh = (color: string) =>
  `color-mix(in oklab, ${color} 60%, transparent)`;

/** Round numbers for an axis: about four steps of 1, 2 or 5 × 10^n (2.5 is
 *  allowed for rates), always starting at 0 and reaching at least `max`. */
export function niceTicks(max: number, integer: boolean): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  // Aim for about five steps (Plausible keeps up to five whole ticks).
  const rough = max / 5;
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

export type ScreenPoint = { x: number; y: number };

type HandlerState = {
  activeLabel?: string | number;
  activeCoordinate?: { x: number; y: number };
};

const AXIS_WIDTH = 44;

/** A note marker under the baseline; merged markers show their count. A
 *  click pins a tooltip with every mark it holds. */
function NoteMarker({
  cx,
  cy,
  count,
  onOpen,
}: {
  cx: number;
  cy: number;
  count: number;
  onOpen: (cx: number, cy: number) => void;
}) {
  return (
    <g
      role="button"
      aria-label={`${count} ${count === 1 ? "mark" : "marks"}`}
      style={{ cursor: "pointer" }}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(cx, cy);
      }}
    >
      <circle cx={cx} cy={cy} r={11} fill="transparent" />
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
}

/** Markers closer than ~16px merge into one with a count; clicking one
 *  pins a tooltip listing all of them. */
/** Dots for the dotted segment: only on the incomplete days, so the
 *  complete day it starts from keeps its own dot. */
function partialDot(points: ChartPoint[], fill: string) {
  return function PartialDot(props: {
    cx?: number;
    cy?: number;
    index?: number;
  }) {
    const point = points[props.index ?? -1];
    if (!point?.partial || props.cy === undefined) {
      return <g key={`p-${props.index}`} />;
    }
    return (
      <circle
        key={`p-${props.index}`}
        cx={props.cx}
        cy={props.cy}
        r={2.5}
        fill={fill}
      />
    );
  };
}

/** Per series: the complete points (solid line), the incomplete ones (a
 *  separate faint line) and the comparison. */
function toRows(points: ChartPoint[], series: ChartSeries[]): Row[] {
  return points.map((p, index) => {
    const row: Row = { ...p };
    // As in Search Console, the faint dotted segment carries on from the
    // complete day next to it, so the line has no gap.
    const nextToPartial =
      Boolean(points[index - 1]?.partial) ||
      Boolean(points[index + 1]?.partial);
    for (const s of series) {
      const value = p.values[s.key] ?? null;
      row[`${s.key}__solid`] = p.partial ? null : value;
      row[`${s.key}__partial`] = p.partial || nextToPartial ? value : null;
      row[`${s.key}__compare`] = p.compare?.[s.key] ?? null;
    }
    return row;
  });
}

function mergeMarkers(rows: Row[], width: number) {
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
}

/** The day the arrow keys, Home and End move to; null for other keys. */
function keyMove(key: string, current: number, last: number): number | null {
  if (key === "Home") return 0;
  if (key === "End") return last;
  if (key === "ArrowRight")
    return current < 0 ? last : Math.min(last, current + 1);
  if (key === "ArrowLeft") return current < 0 ? last : Math.max(0, current - 1);
  return null;
}

export function TimeSeriesChart({
  points,
  series,
  kind = "line",
  height = 240,
  onAddNote,
  onEditNote,
}: {
  points: ChartPoint[];
  series: ChartSeries[];
  kind?: "line" | "bar";
  height?: number;
  /** "Note on this day" in the pinned tooltip, with where to open the editor
   *  (viewport pixels). */
  onAddNote?: (key: string, at: ScreenPoint) => void;
  /** The pencil next to a note people wrote. */
  onEditNote?: (note: ChartNote, at: ScreenPoint) => void;
}) {
  const { containerRef, width } = useChartWidth();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const setBox = useCallback(
    (el: HTMLDivElement | null) => {
      boxRef.current = el;
      containerRef(el);
    },
    [containerRef],
  );
  const hasCompare = points.some((p) => p.compare);
  const hasNotes = points.some((p) => p.notes?.length);
  const showDots = points.length <= 45;

  const axes = useMemo(
    () => series.map((s) => ({ series: s, ...axisFor(points, s) })),
    [points, series],
  );

  const rows = useMemo(() => toRows(points, series), [points, series]);

  const markers = useMemo(() => mergeMarkers(rows, width), [rows, width]);

  const notesOf = (day: ShownDay) =>
    day.group ?? rows.find((row) => row.key === day.key)?.notes ?? [];
  const tip = useChartTooltip(boxRef, (day) => notesOf(day).length > 0);
  const shownRow = tip.shown
    ? rows.find((row) => row.key === tip.shown?.key)
    : undefined;
  const shownNotes = tip.shown ? notesOf(tip.shown) : [];

  const margin = {
    top: 8,
    right: axes.length > 1 ? 0 : 8,
    bottom: 12,
    left: 0,
  };
  // Where a day sits, for the keyboard (the pointer reports its own).
  const plotLeft = margin.left + AXIS_WIDTH;
  const plotWidth =
    width - margin.right - (axes.length > 1 ? AXIS_WIDTH : 0) - plotLeft;
  const xAt = (index: number) => {
    const n = rows.length;
    if (kind === "bar") return plotLeft + ((index + 0.5) * plotWidth) / n;
    return n > 1 ? plotLeft + (index * plotWidth) / (n - 1) : plotLeft;
  };
  const dayFrom = (
    state: HandlerState,
    event: SyntheticEvent,
  ): ShownDay | null => {
    const key =
      typeof state.activeLabel === "string" ? state.activeLabel : null;
    if (!key) return null;
    const index = rows.findIndex((row) => row.key === key);
    const native = event.nativeEvent;
    const top = boxRef.current?.getBoundingClientRect().top ?? 0;
    return {
      key,
      x: state.activeCoordinate?.x ?? xAt(index),
      y: native instanceof MouseEvent ? native.clientY - top : height * 0.35,
    };
  };

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
      {/* Only for the hover dots; the card is drawn below, outside the SVG,
          so it can be reached and pinned. */}
      <Tooltip
        cursor={false}
        active={tip.pinned ? false : undefined}
        content={() => null}
      />
      {shownRow ? (
        <ReferenceLine
          x={shownRow.key}
          yAxisId={baseAxis?.series.key}
          stroke={shownNotes.length ? NOTE : "currentColor"}
          strokeOpacity={shownNotes.length ? 1 : 0.2}
          strokeDasharray={shownNotes.length ? "3 3" : undefined}
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
          shape={(shapeProps: { cx?: number; cy?: number }) => (
            <NoteMarker
              cx={shapeProps.cx ?? 0}
              // Just under the baseline, apart from the lines' own dots.
              cy={(shapeProps.cy ?? 0) + 10}
              count={marker.notes.length}
              onOpen={(cx, cy) =>
                tip.pin({
                  key: marker.key,
                  x: cx,
                  y: cy - 10,
                  group: marker.notes,
                })
              }
            />
          )}
        />
      ))}
    </>
  );

  const onMove = (state: HandlerState, event: SyntheticEvent) => {
    const day = dayFrom(state, event);
    if (day) tip.hover(day);
  };
  const onClick = (state: HandlerState, event: SyntheticEvent) => {
    const day = dayFrom(state, event);
    if (day) tip.click(day);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || rows.length === 0) return;
    const index = keyMove(
      event.key,
      rows.findIndex((row) => row.key === tip.shown?.key),
      rows.length - 1,
    );
    const row = index === null ? undefined : rows[index];
    if (index === null || !row) return;
    event.preventDefault();
    tip.pin({ key: row.key, x: xAt(index), y: height * 0.35 });
  };

  return (
    <div
      ref={setBox}
      tabIndex={0}
      role="group"
      aria-label="Chart. Arrow keys move between days; Escape closes the details."
      onKeyDown={onKeyDown}
      // recharts focuses its surface on click; the app shows no ring there.
      className="relative w-full min-w-0 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/50 [&_.recharts-wrapper_*:focus]:outline-none"
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
            onMouseLeave={tip.leave}
            onClick={onClick}
            accessibilityLayer={false}
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
            onMouseLeave={tip.leave}
            onClick={onClick}
            accessibilityLayer={false}
            style={{ cursor: "pointer" }}
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
                stroke={fresh(s.color)}
                strokeWidth={2}
                strokeDasharray="2 4"
                dot={partialDot(points, fresh(s.color))}
                activeDot={{ r: 4, strokeWidth: 0, fill: fresh(s.color) }}
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
      {tip.shown && shownRow ? (
        <TooltipLayer
          key={`${shownRow.key}-${tip.shown.group ? "group" : "day"}`}
          day={tip.shown}
          pinned={tip.pinned}
          point={shownRow}
          series={series}
          notes={shownNotes}
          chartWidth={width}
          chartHeight={height}
          onEnter={tip.enterCard}
          onLeave={tip.leaveCard}
          onClose={tip.close}
          onAddNote={
            onAddNote
              ? (at) => {
                  tip.close();
                  onAddNote(shownRow.key, at);
                }
              : undefined
          }
          onEditNote={
            onEditNote
              ? (note, at) => {
                  tip.close();
                  onEditNote(note, at);
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
