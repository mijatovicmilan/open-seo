import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { TimeSeriesChart } from "@/client/features/charts/TimeSeriesChart";
import {
  type NoteAnchor,
  type NoteDraft,
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

export function periodText(range: { start: string; end: string }) {
  return `${formatDay(range.start)} – ${formatDay(range.end)}`;
}

export function ChartPanel({
  projectId,
  insights,
  metrics,
  granularity,
}: {
  projectId: string;
  insights: Insights;
  metrics: MetricKey[];
  granularity: "day" | "week" | "month";
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
  const noData = !insights.firstDataDay;
  return (
    <section className="rounded-xl border border-base-300 bg-base-100 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-base-content/60">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-base-content/70" />
            {periodText(period.current)}
          </span>
          {comparable && period.previous ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded bg-base-content/25" />
              {periodText(period.previous)}
            </span>
          ) : null}
          {hasPartial ? (
            <span
              className="inline-flex items-center gap-1.5"
              title="Search Console is still adding data for these days (fresh data), so they are lower than they will end up."
            >
              <span className="w-4 border-t-2 border-dotted border-base-content/30" />
              Partial data
            </span>
          ) : null}
          {period.compareMissing || (period.previous && !comparable) ? (
            <span>No data in the comparison period</span>
          ) : null}
          {trimmed && insights.firstDataDay ? (
            <span>No data before {formatDay(insights.firstDataDay)}</span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {noteCount > 0 ? (
            <button
              type="button"
              className="btn btn-ghost btn-xs text-base-content/60"
              aria-expanded={showNotes}
              onClick={() => setShowNotes((current) => !current)}
            >
              Notes ({noteCount})
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-xs gap-1 text-base-content/60"
            title="Add a note, or click a day on the chart"
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
            <Plus className="size-3.5" /> Note
          </button>
        </div>
      </div>
      {noData ? (
        <div className="flex h-60 items-center justify-center text-sm text-base-content/50">
          No impressions in this period.
        </div>
      ) : (
        <TimeSeriesChart
          points={points}
          series={series}
          onPointClick={(key, at) =>
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
        />
      )}
      {showNotes ? (
        <div className="mt-3 border-t border-base-300 pt-2">
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
