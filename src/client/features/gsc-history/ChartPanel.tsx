import { useMemo, useState } from "react";
import { Button } from "@/client/components/ui/button";
import { TimeSeriesChart } from "@/client/features/charts/TimeSeriesChart";
import {
  type NoteAnchor,
  type NoteDraft,
  isManual,
  NoteEditor,
} from "@/client/features/gsc-history/AnnotationsPanel";
import { NotesMenu } from "@/client/features/gsc-history/NotesMenu";
import { formatDay } from "@/client/features/gsc-history/annotationStyles";
import {
  buildChartPoints,
  chartStart,
  METRIC_KEYS,
  METRICS,
  type MetricKey,
} from "@/client/features/gsc-history/searchSeries";
import type { Insights } from "@/client/features/gsc-history/types";

// The Search Insights chart card: legend, notes (add from the chart or the
// Notes menu, which also lists them) and the chart itself.

function addDay(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string) {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
      86_400_000,
  );
}

function fmt(day: string, options: Intl.DateTimeFormatOptions) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    ...options,
    timeZone: "UTC",
  });
}

// Fork addition (FORK-CHANGES.md): how far Google's data for the last
// partial day goes, from the newest hour it had ("…T15:00:00-08:00"). The
// hour is Pacific time, like Google's days.
function hourNote(newestHour: string | null, day: string) {
  if (!newestHour?.startsWith(day)) return "";
  const hour = Number(newestHour.slice(11, 13));
  const label = `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
  return `to ${label} PT`;
}

/** "Nov 21–22" or "Nov 30 – Dec 1". */
function shortRange(start: string, end: string) {
  if (start === end) return fmt(start, { month: "short", day: "numeric" });
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${fmt(start, { month: "short", day: "numeric" })}–${fmt(end, { day: "numeric" })}`;
  }
  return `${fmt(start, { month: "short", day: "numeric" })} – ${fmt(end, { month: "short", day: "numeric" })}`;
}

// Fork addition (FORK-CHANGES.md): short in the legend, with the years only
// when the range crosses one.
function legendRange(start: string, end: string) {
  return start.slice(0, 4) === end.slice(0, 4)
    ? shortRange(start, end)
    : periodText({ start, end });
}

export function periodText(range: { start: string; end: string }) {
  return `${formatDay(range.start)} – ${formatDay(range.end)}`;
}

export function ChartPanel({
  projectId,
  insights,
  metrics,
  granularity,
  onShowDays,
}: {
  projectId: string;
  insights: Insights;
  metrics: MetricKey[];
  granularity: "day" | "week" | "month";
  /** Switch to daily points when weeks or months are too few for a line. */
  onShowDays: () => void;
}) {
  const { period } = insights;
  // A comparison period without a single impression draws nothing useful.
  const comparable =
    Boolean(period.previous) && (insights.prevTotals?.impressions ?? 0) > 0;
  const from = chartStart(insights.series, insights.firstDataDay, granularity);
  const points = useMemo(
    () =>
      buildChartPoints({
        series: insights.series,
        // Filtered to one page, "new page" markers for other pages are noise.
        annotations: insights.annotations.filter(
          (note) =>
            note.kind !== "first_seen" ||
            (!insights.filter.page && !insights.filter.query) ||
            note.url === insights.filter.page,
        ),
        granularity,
        from,
        hasCompare: comparable,
        firstDataDay: insights.firstDataDay,
      }),
    [insights, granularity, from, comparable],
  );
  const series = useMemo(
    () =>
      METRIC_KEYS.filter((key) => metrics.includes(key)).map((key) => ({
        key,
        metric: METRICS[key],
        color: METRICS[key].color,
      })),
    [metrics],
  );
  const trimmed = from && insights.series[0] && from > insights.series[0].date;
  const [editor, setEditor] = useState<{
    draft: NoteDraft;
    anchor: NoteAnchor;
  } | null>(null);
  const openEditor = (draft: NoteDraft, anchor: NoteAnchor) =>
    setEditor({ draft, anchor });
  const noteCount = insights.annotations.filter(
    (note) => note.kind !== "first_seen",
  ).length;
  const hasPartial = points.some((point) => point.partial);
  // The legend names what the chart draws: from its first day (a young
  // site's chart starts on its first day with data) to the last complete
  // day; fresh days after it are listed as partial.
  const first = insights.firstDataDay;
  const shownStart =
    first && first > period.current.start ? first : period.current.start;
  const shift = daysBetween(period.current.start, shownStart);
  // Fork addition (FORK-CHANGES.md): with partial days counted, the period
  // runs past the last complete day.
  const completeEnd =
    period.settledEnd < period.current.end
      ? period.settledEnd
      : period.current.end;
  const fresh =
    period.chartEnd > completeEnd
      ? { start: addDay(completeEnd, 1), end: period.chartEnd }
      : null;
  const noData = !insights.firstDataDay;
  const lastHour = fresh ? hourNote(period.newestHour, fresh.end) : "";
  // Fork addition (FORK-CHANGES.md): "Include partial days" draws them solid.
  const includesPartial = period.current.end > period.settledEnd;
  const shownEnd = includesPartial ? period.current.end : completeEnd;
  const previousStart = period.previous
    ? addDay(period.previous.start, shift)
    : null;
  const rangeTitle = [
    periodText({ start: shownStart, end: shownEnd }),
    comparable && period.previous && previousStart
      ? `compared with ${periodText({ start: previousStart, end: period.previous.end })}`
      : null,
    trimmed && first ? `first data ${formatDay(first)}` : null,
    !noData && (period.compareMissing || (period.previous && !comparable))
      ? "no data in the comparison period"
      : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        {/* Fork change (FORK-CHANGES.md): one short legend row; the full
            dates and what is missing are in its tooltip. */}
        <div className="flex min-w-0 items-center gap-4 overflow-hidden text-xs whitespace-nowrap text-muted-foreground">
          <span className="inline-flex items-center gap-1.5" title={rangeTitle}>
            <span className="h-0.5 w-4 rounded bg-foreground/70" />
            {legendRange(shownStart, shownEnd)}
          </span>
          {comparable && period.previous && previousStart && !noData ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded bg-foreground/25" />
              vs {legendRange(previousStart, period.previous.end)}
            </span>
          ) : null}
          {fresh && !noData && (includesPartial || hasPartial) ? (
            <span
              className="inline-flex min-w-0 items-center gap-1.5"
              title="Search Console is still adding data for these days (fresh data), so they are lower than they will end up."
            >
              {includesPartial ? null : (
                <span className="w-4 border-t-2 border-dotted border-foreground/30" />
              )}
              {shortRange(fresh.start, fresh.end)} partial
              {lastHour ? (
                <span className="text-foreground/80">· {lastHour}</span>
              ) : null}
            </span>
          ) : null}
        </div>
        <NotesMenu
          projectId={projectId}
          insights={insights}
          count={noteCount}
          onEdit={openEditor}
        />
      </div>
      {noData ? (
        <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
          {Object.values(insights.filter).some(Boolean)
            ? "No impressions with these filters in this period."
            : "No impressions in this period."}
        </div>
      ) : granularity !== "day" && points.length < 3 ? (
        <div className="flex h-60 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <span>
            {points.length === 1 ? "One" : "Two"} {granularity}
            {points.length === 1 ? "" : "s"} of data so far, too few for a line.
          </span>
          <Button variant="outline" size="sm" onClick={onShowDays}>
            Show by day
          </Button>
        </div>
      ) : (
        <TimeSeriesChart
          points={points}
          series={series}
          onAddNote={(key, at) =>
            openEditor(
              {
                date:
                  key < insights.period.chartEnd
                    ? key
                    : insights.period.chartEnd,
                kind: "deploy",
                label: "",
                url: "",
              },
              at,
            )
          }
          onEditNote={(note, at) => {
            const kind = note.kind;
            if (!note.id || !note.date || !isManual(kind)) return;
            openEditor(
              {
                id: note.id,
                date: note.date,
                kind,
                label: note.text,
                url: note.url ?? "",
              },
              at,
            );
          }}
        />
      )}
      {editor ? (
        <NoteEditor
          key={`${editor.draft.id ?? "new"}-${editor.draft.date}`}
          projectId={projectId}
          draft={editor.draft}
          anchor={editor.anchor}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </section>
  );
}
