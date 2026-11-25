import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertCircle, Info } from "lucide-react";
import { PageHeader } from "@/client/components/PageHeader";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Spinner } from "@/client/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { GoogleConnectionCard } from "@/client/features/integrations/GoogleConnectionCard";
import {
  ChartPanel,
  periodText,
} from "@/client/features/gsc-history/ChartPanel";
import {
  FilterChips,
  InsightsControls,
} from "@/client/features/gsc-history/InsightsControls";
import {
  InsightsDetailSheet,
  type InsightsTarget,
} from "@/client/features/gsc-history/InsightsDetailSheet";
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
  InsightsOpenContext,
  NearPageOneTable,
  NewQueriesTable,
} from "@/client/features/gsc-history/SearchInsightsSections";
import { NewPagesTable } from "@/client/features/gsc-history/NewPagesTable";
import {
  SyncControl,
  SyncNotices,
} from "@/client/features/gsc-history/SyncStatusLine";
import type { Insights } from "@/client/features/gsc-history/types";
import { useSearchHistorySync } from "@/client/features/gsc-history/useSearchHistorySync";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { getSearchInsights } from "@/serverFunctions/gscHistory";
// Fork addition (FORK-CHANGES.md): PostHog visits and signups.
import {
  SearchSignupsSection,
  useSearchSignups,
  withSignupSeries,
} from "@/client/features/posthog/SearchSignups";
import type {
  SearchInsightsCompare,
  SearchInsightsRange,
} from "@/types/schemas/gsc-history";

export type SearchInsightsState = {
  range: SearchInsightsRange;
  start?: string;
  end?: string;
  compare: SearchInsightsCompare;
  fresh: boolean;
  gran: Granularity;
  metrics: MetricKey[];
  page?: string;
  query?: string;
  section?: string;
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
    fresh: state.fresh || undefined,
    page: state.page || undefined,
    query: state.query || undefined,
    section: state.section || undefined,
    country: state.country || undefined,
    device: state.device,
  };
  const [detail, setDetail] = useState<InsightsTarget | null>(null);
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
  const signups = useSearchSignups(projectId, insights, state);
  const resolvedGranularity = resolveGranularity(
    state.gran,
    insights?.series.length ?? 28,
  );

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title={
            <span className="inline-flex items-center gap-2">
              Search Insights
              {insightsQuery.isFetching && !insightsQuery.isPending ? (
                <Spinner className="text-muted-foreground" />
              ) : null}
            </span>
          }
          description="What changed in Google Search and what to do about it, from your stored Search Console history."
          actions={
            status?.connected ? (
              <SyncControl status={status} sync={sync} />
            ) : null
          }
        />

        {insightsQuery.isPending ? (
          <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
            <Spinner /> Loading…
          </div>
        ) : insightsQuery.isError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>
              {getStandardErrorMessage(insightsQuery.error)}
            </AlertDescription>
          </Alert>
        ) : !status ? null : (
          <>
            {status.connected ? (
              <SyncNotices projectId={projectId} status={status} sync={sync} />
            ) : (
              <div className="max-w-2xl">
                <GoogleConnectionCard provider="gsc" projectId={projectId} />
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
                  fresh={state.fresh}
                  granularity={state.gran}
                  resolvedGranularity={resolvedGranularity}
                  bounds={{
                    oldest: status.oldestDay,
                    newest: status.newestDay,
                  }}
                  country={state.country}
                  device={state.device}
                  countries={insights.countries}
                  section={state.section}
                  sections={insights.sections}
                  segmentsPending={status.segmentDaysMissing > 0}
                  onChange={onChange}
                />
                <FilterChips
                  page={state.page}
                  query={state.query}
                  section={state.section}
                  country={state.country}
                  device={state.device}
                  onClear={(key) => onChange({ [key]: undefined })}
                />
                <InsightsDetailSheet
                  target={detail}
                  request={request}
                  metrics={state.metrics}
                  granularity={resolvedGranularity}
                  onOpen={setDetail}
                  onFilter={(target) => {
                    setDetail(null);
                    onChange(
                      "page" in target
                        ? { page: target.page, query: undefined }
                        : { query: target.query, page: undefined },
                    );
                  }}
                  onClose={() => setDetail(null)}
                />
                <InsightsOpenContext.Provider value={setDetail}>
                  <InsightsBody
                    projectId={projectId}
                    insights={insights}
                    signups={signups}
                    section={state.section}
                    metrics={state.metrics}
                    granularity={resolvedGranularity}
                    onMetrics={(metrics) => onChange({ metrics })}
                    onShowDays={() => onChange({ gran: "day" })}
                  />
                </InsightsOpenContext.Provider>
              </>
            ) : status.connected ? (
              <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
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
  signups,
  section,
  metrics,
  granularity,
  onMetrics,
  onShowDays,
}: {
  projectId: string;
  insights: Insights;
  signups: ReturnType<typeof useSearchSignups>;
  section?: string;
  metrics: MetricKey[];
  granularity: "day" | "week" | "month";
  onMetrics: (metrics: MetricKey[]) => void;
  onShowDays: () => void;
}) {
  const { period, changes } = insights;
  // PostHog can't split by page type: its totals and chart lines stay off.
  const joined =
    signups.data && !signups.data.unsupportedFilter && !section
      ? signups.data
      : null;
  const curveNote =
    insights.ctrCurve.source === "site"
      ? "your site's own median CTR per position"
      : insights.ctrCurve.source === "mixed"
        ? "your site's median CTR where it has enough data, an industry curve elsewhere"
        : "an industry CTR curve (not enough data of your own yet)";

  return (
    <>
      <MetricCards
        totals={{ ...insights.totals, ...joined?.totals }}
        prevTotals={
          insights.prevTotals
            ? { ...insights.prevTotals, ...joined?.prevTotals }
            : null
        }
        selected={metrics}
        onChange={onMetrics}
        compareLabel={period.previous ? periodText(period.previous) : null}
      />

      <ChartPanel
        projectId={projectId}
        insights={withSignupSeries(insights, joined)}
        metrics={metrics}
        granularity={granularity}
        onShowDays={onShowDays}
      />

      <p className="text-xs text-muted-foreground">
        Totals and the tables below cover {periodText(period.current)}
        {period.current.end > period.settledEnd
          ? ", partial days included"
          : ""}
        {period.previous && (insights.prevTotals?.impressions ?? 0) > 0
          ? `, compared with ${periodText(period.previous)}`
          : ""}
        . Table rows need {insights.minImpressions}+ impressions.
      </p>

      <SearchSignupsSection
        data={signups.data}
        error={signups.error}
        section={section}
      />

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

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          Stored daily from Search Console (web search).
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="About this data"
                  className="inline-flex rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              }
            >
              <Info className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>
              Up to 5,000 query and page pairs a day are kept, also per country
              and device (Google&apos;s top rows by clicks). Clicks on
              anonymized queries count in page totals only.
            </TooltipContent>
          </Tooltip>
        </span>
      </div>
    </>
  );
}
