import { useRef } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Filter } from "lucide-react";
import { cn } from "cn";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { Button } from "@/client/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { Spinner } from "@/client/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import type { ChartConfig } from "@/client/components/ui/chart";
import { TrendChart } from "@/client/features/dashboard/DashboardMetrics";
import { periodText } from "@/client/features/gsc-history/ChartPanel";
import {
  METRICS,
  type MetricKey,
} from "@/client/features/gsc-history/searchSeries";
import {
  InsightsOpenContext,
  PageCell,
  QueryCell,
  pathOf,
} from "@/client/features/gsc-history/SearchInsightsSections";
import { TypePill } from "@/client/features/gsc-history/TypePill";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  formatCount,
  formatPosition,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import { getSearchInsights } from "@/serverFunctions/gscHistory";

// Fork feature (FORK-CHANGES.md): what Search Insights knows about one page
// or one query, opened from any table.

export type InsightsTarget = { page: string } | { query: string };

type InsightsRequest = Parameters<typeof getSearchInsights>[0]["data"];

const chartConfig = {
  clicks: { label: "Clicks", color: METRICS.clicks.color },
  impressions: { label: "Impressions", color: METRICS.impressions.color },
} satisfies ChartConfig;

const STATS = ["clicks", "impressions", "ctr", "position"] as const;

export function InsightsDetailSheet({
  target,
  request,
  onOpen,
  onFilter,
  onClose,
}: {
  target: InsightsTarget | null;
  /** The page's own request; the target replaces its page, query and type. */
  request: InsightsRequest;
  onOpen: (target: InsightsTarget) => void;
  onFilter: (target: InsightsTarget) => void;
  onClose: () => void;
}) {
  const headerRef = useRef<HTMLDivElement>(null);
  return (
    <Sheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        initialFocus={headerRef}
        className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
      >
        {target ? (
          <InsightsOpenContext.Provider value={onOpen}>
            <SheetHeader
              ref={headerRef}
              tabIndex={-1}
              className="p-6 pb-4 outline-none"
            >
              <SheetDescription className="flex items-center gap-2">
                {"page" in target ? (
                  <>
                    Page
                    <TypePill url={target.page} />
                  </>
                ) : (
                  "Query"
                )}
              </SheetDescription>
              <SheetTitle className="pr-8 text-lg font-semibold break-words">
                {"page" in target ? (
                  <SafeExternalLink
                    url={target.page}
                    label={pathOf(target.page)}
                    className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
                  />
                ) : (
                  target.query
                )}
              </SheetTitle>
            </SheetHeader>
            <DetailBody target={target} request={request} />
            <SheetFooter className="border-t border-border px-6">
              <Button variant="outline" onClick={() => onFilter(target)}>
                <Filter data-icon="inline-start" />
                Show only this {"page" in target ? "page" : "query"} on Search
                Insights
              </Button>
            </SheetFooter>
          </InsightsOpenContext.Provider>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({
  target,
  request,
}: {
  target: InsightsTarget;
  request: InsightsRequest;
}) {
  const detailRequest = {
    ...request,
    page: "page" in target ? target.page : undefined,
    query: "query" in target ? target.query : undefined,
    section: undefined,
  };
  const query = useQuery({
    queryKey: ["searchInsights", request.projectId, detailRequest],
    queryFn: () => getSearchInsights({ data: detailRequest }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const insights = query.data?.data ?? null;
  if (query.isPending) {
    return (
      <div className="flex items-center gap-2 px-6 py-8 text-sm text-muted-foreground">
        <Spinner /> Loading…
      </div>
    );
  }
  if (query.isError || !insights) {
    return (
      <p className="px-6 py-8 text-sm text-destructive">
        {query.isError
          ? getStandardErrorMessage(query.error)
          : "No stored history yet."}
      </p>
    );
  }
  const { totals, prevTotals, period } = insights;
  const isPage = "page" in target;
  return (
    <div className="space-y-5 px-6 pb-6">
      <p className="text-xs text-muted-foreground">
        {periodText(period.current)}
        {period.current.end > period.settledEnd
          ? ", partial days included"
          : ""}
        {prevTotals && period.previous
          ? `, compared with ${periodText(period.previous)}`
          : ""}
      </p>
      <div className="grid grid-cols-4 gap-2">
        {STATS.map((key) => {
          const value = totals[key];
          const previous = prevTotals?.[key];
          const empty =
            (key === "ctr" || key === "position") && totals.impressions === 0;
          return (
            <div
              key={key}
              className="min-w-0 rounded-lg border border-border px-3 py-2"
            >
              <div className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                {METRICS[key].name}
              </div>
              <div className="text-lg font-semibold tabular-nums">
                {empty ? "—" : METRICS[key].format(value)}
              </div>
              {previous !== undefined && !empty ? (
                <Change metric={key} current={value} previous={previous} />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="flex h-36 flex-col">
        <TrendChart
          config={chartConfig}
          data={insights.series.map((day) => ({
            date: day.date,
            clicks: day.clicks,
            impressions: day.impressions,
          }))}
        />
      </div>
      <section className="space-y-2">
        <h3 className="text-sm font-medium">
          {isPage ? "Queries for this page" : "Pages for this query"}
          <span className="ml-2 font-normal text-muted-foreground">
            {insights.detailRows.length}
          </span>
        </h3>
        {insights.detailRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isPage
              ? "No query is stored for this page in the period. Google hides rare queries; their clicks count in the totals above."
              : "No page is stored for this query in the period."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-full">
                  {isPage ? "Query" : "Page"}
                </TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Impr.</TableHead>
                <TableHead className="text-right">Pos.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {insights.detailRows.map((row) => (
                <TableRow key={`${row.query}::${row.page}`}>
                  {isPage ? (
                    <QueryCell query={row.query} />
                  ) : (
                    <TableCell className="w-full max-w-0">
                      <PageCell url={row.page} />
                    </TableCell>
                  )}
                  <TableCell className="text-right tabular-nums">
                    {formatCount(row.clicks)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(row.impressions)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPosition(row.position)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

function Change({
  metric,
  current,
  previous,
}: {
  metric: MetricKey;
  current: number;
  previous: number;
}) {
  if (metric === "position" ? previous <= 0 : previous < 0) return null;
  const diff = current - previous;
  // A lower position is better.
  const improved = metric === "position" ? diff < 0 : diff > 0;
  if (Math.abs(diff) < (metric === "ctr" ? 0.0005 : 0.05)) {
    return <div className="text-xs text-muted-foreground">no change</div>;
  }
  const text =
    metric === "ctr"
      ? `${diff > 0 ? "+" : ""}${(diff * 100).toFixed(1)} pts`
      : metric === "position"
        ? `${diff > 0 ? "+" : ""}${diff.toFixed(1)}`
        : `${diff > 0 ? "+" : ""}${formatCount(diff)}`;
  return (
    <div
      className={cn(
        "text-xs tabular-nums",
        improved ? "text-success" : "text-destructive",
      )}
    >
      {text}
    </div>
  );
}
