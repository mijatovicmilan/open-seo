import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight, Info, Loader2 } from "lucide-react";
import { SearchConsoleConnectionCard } from "@/client/features/gsc/SearchConsoleConnectionCard";
import {
  ChartPanel,
  periodText,
} from "@/client/features/gsc-history/ChartPanel";
import {
  FilterChips,
  InsightsControls,
} from "@/client/features/gsc-history/InsightsControls";
import { MetricCards } from "@/client/features/gsc-history/MetricCards";
import {
  type Granularity,
  type MetricKey,
  resolveGranularity,
} from "@/client/features/gsc-history/searchSeries";
import {
  CannibalizationTable,
  ChangesTable,
  CtrGapTable,
  InsightSection,
  InsightsFilterContext,
  NearPageOneTable,
  NewPagesTable,
  NewQueriesTable,
} from "@/client/features/gsc-history/SearchInsightsSections";
import { SyncStatusLine } from "@/client/features/gsc-history/SyncStatusLine";
import type { Insights } from "@/client/features/gsc-history/types";
import { useSearchHistorySync } from "@/client/features/gsc-history/useSearchHistorySync";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { getSearchInsights } from "@/serverFunctions/gscHistory";
import type {
  SearchInsightsCompare,
  SearchInsightsRange,
} from "@/types/schemas/gsc-history";

export type SearchInsightsState = {
  range: SearchInsightsRange;
  start?: string;
  end?: string;
  compare: SearchInsightsCompare;
  gran: Granularity;
  metrics: MetricKey[];
  page?: string;
  query?: string;
  country?: string;
  device?: "desktop" | "mobile" | "tablet";
};

export type SearchInsightsPatch = Partial<{
  [K in keyof SearchInsightsState]: SearchInsightsState[K] | undefined;
}>;

export function SearchInsightsPage({
  projectId,
  state,
  onChange,
}: {
  projectId: string;
  state: SearchInsightsState;
  onChange: (patch: SearchInsightsPatch) => void;
}) {
  const request = {
    projectId,
    range: state.range,
    start: state.range === "custom" ? state.start : undefined,
    end: state.range === "custom" ? state.end : undefined,
    compare: state.compare,
    page: state.page || undefined,
    query: state.query || undefined,
    country: state.country || undefined,
    device: state.device,
  };
  const insightsQuery = useQuery({
    queryKey: ["searchInsights", projectId, request],
    queryFn: () => getSearchInsights({ data: request }),
    placeholderData: keepPreviousData,
    // Stored data changes only when a sync writes; the sync invalidates.
    staleTime: 60_000,
    // A run started elsewhere (cron, MCP, another tab): poll until it ends.
    refetchInterval: (query) =>
      query.state.data?.status.running ? 15_000 : false,
  });
  const status = insightsQuery.data?.status;
  const insights = insightsQuery.data?.data ?? null;
  const sync = useSearchHistorySync(projectId, status);
  const resolvedGranularity = resolveGranularity(
    state.gran,
    insights?.series.length ?? 28,
  );

  return (
    <div className="px-4 py-4 pb-24 overflow-auto md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">Search Insights</h1>
            {insightsQuery.isFetching && !insightsQuery.isPending ? (
              <Loader2 className="size-4 animate-spin text-base-content/40" />
            ) : null}
          </div>
          <p className="text-sm text-base-content/70">
            What changed in Google Search and what to do about it, from your
            stored Search Console history.
          </p>
        </div>

        {insightsQuery.isPending ? (
          <div className="flex items-center gap-2 p-8 text-sm text-base-content/60">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : insightsQuery.isError ? (
          <div className="alert alert-error">
            <span className="text-sm">
              {getStandardErrorMessage(insightsQuery.error)}
            </span>
          </div>
        ) : !status ? null : (
          <>
            {status.connected ? (
              <SyncStatusLine
                projectId={projectId}
                status={status}
                sync={sync}
              />
            ) : (
              <div className="max-w-2xl">
                <SearchConsoleConnectionCard projectId={projectId} />
              </div>
            )}
            {insights ? (
              <>
                <InsightsControls
                  key={`${state.range}-${state.start}-${state.end}`}
                  range={state.range}
                  start={state.start}
                  end={state.end}
                  compare={state.compare}
                  granularity={state.gran}
                  resolvedGranularity={resolvedGranularity}
                  bounds={{
                    oldest: status.oldestDay,
                    newest: status.newestDay,
                  }}
                  country={state.country}
                  device={state.device}
                  countries={insights.countries}
                  segmentsPending={status.segmentDaysMissing > 0}
                  onChange={onChange}
                />
                <FilterChips
                  page={state.page}
                  query={state.query}
                  country={state.country}
                  device={state.device}
                  onClear={(key) => onChange({ [key]: undefined })}
                />
                <InsightsFilterContext.Provider
                  value={(filter) =>
                    onChange({ page: filter.page, query: filter.query })
                  }
                >
                  <InsightsBody
                    projectId={projectId}
                    insights={insights}
                    metrics={state.metrics}
                    granularity={resolvedGranularity}
                    onMetrics={(metrics) => onChange({ metrics })}
                    onShowDays={() => onChange({ gran: "day" })}
                  />
                </InsightsFilterContext.Provider>
              </>
            ) : status.connected ? (
              <div className="rounded-xl border border-base-300 bg-base-100 p-6 text-sm text-base-content/70">
                No history stored yet. The first sync fills the newest days
                first; insights appear as soon as it writes them.
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function InsightsBody({
  projectId,
  insights,
  metrics,
  granularity,
  onMetrics,
  onShowDays,
}: {
  projectId: string;
  insights: Insights;
  metrics: MetricKey[];
  granularity: "day" | "week" | "month";
  onMetrics: (metrics: MetricKey[]) => void;
  onShowDays: () => void;
}) {
  const { period, changes } = insights;
  const curveNote =
    insights.ctrCurve.source === "site"
      ? "your site's own median CTR per position"
      : insights.ctrCurve.source === "mixed"
        ? "your site's median CTR where it has enough data, an industry curve elsewhere"
        : "an industry CTR curve (not enough data of your own yet)";

  return (
    <>
      <MetricCards
        totals={insights.totals}
        prevTotals={insights.prevTotals}
        selected={metrics}
        onChange={onMetrics}
        compareLabel={period.previous ? periodText(period.previous) : null}
      />

      <ChartPanel
        projectId={projectId}
        insights={insights}
        metrics={metrics}
        granularity={granularity}
        onShowDays={onShowDays}
      />

      <p className="text-xs text-base-content/50">
        Totals and the tables below cover {periodText(period.current)}
        {period.previous && (insights.prevTotals?.impressions ?? 0) > 0
          ? `, compared with ${periodText(period.previous)}`
          : ""}
        . Table rows need {insights.minImpressions}+ impressions.
      </p>

      <div className="grid gap-4 xl:grid-cols-2">
        <InsightSection
          title="Rising pages"
          why="Pages gaining clicks. See which queries carry them and strengthen those pages: internal links, fresher content."
          count={changes.rising.length}
          empty="No page gained clicks or impressions against the previous period."
        >
          <ChangesTable rows={changes.rising} direction="up" />
        </InsightSection>
        <InsightSection
          title="Falling pages"
          why="Pages losing clicks. Check the queries that dropped, then the page: content, title, a competitor, or a technical change."
          count={changes.falling.length}
          empty="No page lost clicks or impressions against the previous period."
        >
          <ChangesTable rows={changes.falling} direction="down" />
        </InsightSection>
      </div>

      <InsightSection
        title="New queries"
        why="Queries that first brought impressions in this period. Make sure the page answers them, or give them a page of their own."
        count={insights.newQueries.length}
        empty={
          insights.hasNewBaseline
            ? "No new queries in this period."
            : "Needs at least 28 days of stored history before the period to tell new queries apart."
        }
      >
        <NewQueriesTable rows={insights.newQueries} />
      </InsightSection>

      <InsightSection
        title="Near page one"
        why="Queries whose best page averages position 8 to 20. A content or internal-link push here moves real traffic; 'At #3' estimates the extra clicks."
        count={insights.nearPageOne.length}
        empty="No query sits at positions 8 to 20 with enough impressions."
      >
        <NearPageOneTable rows={insights.nearPageOne} />
      </InsightSection>

      <InsightSection
        title="CTR below expected"
        why={`Page-one results clicked far less than ${curveNote} predicts. Rewrite the title and description to match the query.`}
        count={insights.ctrGaps.length}
        empty="No page-one result has a CTR well below the expected curve."
      >
        <CtrGapTable rows={insights.ctrGaps} />
      </InsightSection>

      <InsightSection
        title="Cannibalization"
        why="Queries where two or more of your pages split the impressions. Flips count days the ranking page changed. Merge, redirect or differentiate the pages."
        count={insights.cannibalization.length}
        empty="No query is split between pages."
      >
        <CannibalizationTable rows={insights.cannibalization} />
      </InsightSection>

      <InsightSection
        title="New pages"
        why="Pages that first got impressions in the last 90 days and how they grow week by week. A flat line after a month needs links or a better match to search intent."
        count={insights.newPages.length}
        empty="No page first appeared in the last 90 days of stored history."
      >
        <NewPagesTable rows={insights.newPages} />
      </InsightSection>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/50">
        <span className="inline-flex items-center gap-1">
          Stored daily from Search Console (web search).
          <span
            className="tooltip tooltip-top inline-flex"
            data-tip="Up to 5,000 query and page pairs a day are kept, also per country and device (Google's top rows by clicks). Clicks on anonymized queries count in page totals only."
          >
            <Info className="size-3.5" aria-label="About this data" />
          </span>
        </span>
        <Link
          to="/p/$projectId/search-performance"
          params={{ projectId }}
          className="btn btn-ghost btn-xs gap-1 text-base-content/60"
        >
          Live GSC view <ArrowRight className="size-3" />
        </Link>
      </div>
    </>
  );
}
