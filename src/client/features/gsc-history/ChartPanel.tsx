import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { TimeSeriesChart } from "@/client/features/charts/TimeSeriesChart";
import {
  type NoteAnchor,
  type NoteDraft,
  isManual,
  NoteEditor,
  NotesList,
} from "@/client/features/gsc-history/AnnotationsPanel";
import { formatDay } from "@/client/features/gsc-history/annotationStyles";
import {
  buildChartPoints,
  chartStart,
  METRIC_KEYS,
  METRICS,
  type MetricKey,
} from "@/client/features/gsc-history/searchSeries";
import type { Insights } from "@/client/features/gsc-history/types";

// The Search Insights chart card: legend, notes (add from the chart or
// "+ Note", list behind "Notes (N)") and the chart itself.

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

/** "Nov 21–22" or "Nov 30 – Dec 1". */
function shortRange(start: string, end: string) {
  if (start === end) return fmt(start, { month: "short", day: "numeric" });
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${fmt(start, { month: "short", day: "numeric" })}–${fmt(end, { day: "numeric" })}`;
  }
  return `${fmt(start, { month: "short", day: "numeric" })} – ${fmt(end, { month: "short", day: "numeric" })}`;
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
  const [showNotes, setShowNotes] = useState(false);
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
  // Fork addition (FORK-CHANGES.md): "Include partial days" draws them solid.
  const includesPartial = period.current.end > period.settledEnd;
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 text-xs leading-6 text-muted-foreground [&>span]:whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-foreground/70" />
            {periodText({
              start: shownStart,
              end: includesPartial ? period.current.end : completeEnd,
            })}
          </span>
          {comparable && period.previous && !noData ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded bg-foreground/25" />
              {periodText({
                start: addDay(period.previous.start, shift),
                end: period.previous.end,
              })}
            </span>
          ) : null}
          {includesPartial && fresh && !noData ? (
            <span title="Search Console is still adding data for these days (fresh data), so they are lower than they will end up.">
              {shortRange(fresh.start, fresh.end)} still partial
            </span>
          ) : null}
          {hasPartial && !includesPartial && !noData ? (
            <span
              className="inline-flex items-center gap-1.5"
              title="Search Console is still adding data for these days (fresh data), so they are lower than they will end up."
            >
              <span className="w-4 border-t-2 border-dotted border-foreground/30" />
              {fresh
                ? `Partial data, ${shortRange(fresh.start, fresh.end)}`
                : "Partial data"}
            </span>
          ) : null}
          {!noData &&
          (period.compareMissing || (period.previous && !comparable)) ? (
            <span>No data in the comparison period</span>
          ) : null}
          {trimmed && insights.firstDataDay ? (
            <span>First data: {formatDay(insights.firstDataDay)}</span>
          ) : null}
        </div>
        <div className="-ml-2 flex shrink-0 items-center gap-1 sm:ml-0">
          {noteCount > 0 ? (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              aria-expanded={showNotes}
              onClick={() => setShowNotes((current) => !current)}
            >
              Notes ({noteCount})
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            title="Add a note"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              openEditor(
                {
                  date: insights.period.settledEnd,
                  kind: "deploy",
                  label: "",
                  url: "",
                },
                { x: rect.left, y: rect.bottom },
              );
            }}
          >
            <Plus data-icon="inline-start" /> Note
          </Button>
        </div>
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
      {showNotes ? (
        <div className="mt-3 border-t border-border pt-2">
          <NotesList
            projectId={projectId}
            annotations={insights.annotations}
            onEdit={openEditor}
          />
        </div>
      ) : null}
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
