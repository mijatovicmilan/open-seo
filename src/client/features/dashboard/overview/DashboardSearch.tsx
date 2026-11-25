import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  ChartPanel,
  periodText,
} from "@/client/features/gsc-history/ChartPanel";
import { MetricCards } from "@/client/features/gsc-history/MetricCards";
import type { MetricKey } from "@/client/features/gsc-history/searchSeries";
import type {
  HistoryStatus,
  Insights,
} from "@/client/features/gsc-history/types";
import {
  useSearchSignups,
  withSignupSeries,
} from "@/client/features/posthog/SearchSignups";

// Fork feature (FORK-CHANGES.md): the dashboard's search numbers and chart,
// the same stored history, cards and chart as Search Insights.

export function DashboardSearch({
  projectId,
  status,
  insights,
  loading,
}: {
  projectId: string;
  status: HistoryStatus | undefined;
  insights: Insights | null;
  loading: boolean;
}) {
  const [metrics, setMetrics] = useState<MetricKey[]>([
    "clicks",
    "impressions",
  ]);
  const signups = useSearchSignups(projectId, insights, {});
  if (loading) return <Skeleton className="h-96" />;
  if (!status?.connected || !insights) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-sm">
        <span className="text-muted-foreground">
          {status?.connected
            ? "Search Console history is still syncing; the chart fills in when the first days are stored."
            : "Connect Search Console to see clicks, impressions and signups here."}
        </span>
        <Link
          to="/p/$projectId/search-insights"
          params={{ projectId }}
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          Open Search Insights <ArrowRight className="size-3.5" />
        </Link>
      </section>
    );
  }
  const joined =
    signups.data && !signups.data.unsupportedFilter ? signups.data : null;
  const { period } = insights;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">
          Search
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {periodText(period.current)}
            {period.previous ? ` vs ${periodText(period.previous)}` : ""}
          </span>
        </h2>
        <Link
          to="/p/$projectId/search-insights"
          params={{ projectId }}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          Search Insights <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <MetricCards
        totals={{ ...insights.totals, ...joined?.totals }}
        prevTotals={
          insights.prevTotals
            ? { ...insights.prevTotals, ...joined?.prevTotals }
            : null
        }
        selected={metrics}
        onChange={setMetrics}
        compareLabel={period.previous ? periodText(period.previous) : null}
      />
      <ChartPanel
        projectId={projectId}
        insights={withSignupSeries(insights, joined)}
        metrics={metrics}
        // 28 days are always drawn by day.
        granularity="day"
        onShowDays={() => undefined}
      />
    </section>
  );
}
