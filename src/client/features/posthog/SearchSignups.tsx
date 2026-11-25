import * as React from "react";
import { sort } from "remeda";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Alert } from "@/client/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import {
  formatCount,
  formatCtr,
  formatPosition,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import {
  InsightSection,
  PageCell,
} from "@/client/features/gsc-history/SearchInsightsSections";
import { TypeCell } from "@/client/features/gsc-history/TypePill";
import { pageSection } from "@/shared/pageSection";
import type { Insights } from "@/client/features/gsc-history/types";
import { getSearchSignups } from "@/serverFunctions/analyticsSource";

// Fork addition (FORK-CHANGES.md): Search Console clicks → PostHog visits
// from Google → signups, on the Search Insights page. Nothing shows for
// projects whose analytics source is not PostHog.

type SignupsResult = Awaited<ReturnType<typeof getSearchSignups>>;
type SignupsData = Extract<
  Extract<SignupsResult, { ok: true }>["value"],
  { available: true }
>;

export function useSearchSignups(
  projectId: string,
  insights: Insights | null,
  filter: {
    page?: string;
    query?: string;
    country?: string;
    device?: "desktop" | "mobile" | "tablet";
  },
) {
  const period = insights?.period;
  const request = period
    ? {
        projectId,
        current: period.current,
        previous: period.previous,
        chart: { start: period.current.start, end: period.chartEnd },
        page: filter.page || undefined,
        query: filter.query || undefined,
        country: filter.country || undefined,
        device: filter.device,
      }
    : null;
  const query = useQuery({
    queryKey: ["searchSignups", request],
    queryFn: () =>
      getSearchSignups({
        data: request ?? { projectId, current: { start: "", end: "" } },
      }),
    enabled: Boolean(request),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
  const result = query.data;
  const data: SignupsData | null =
    result?.ok && result.value.available ? result.value : null;
  return {
    data,
    error: result && !result.ok ? result.message : null,
    loading: query.isFetching,
  };
}

/** The Search Console series with Google visits and signups on each day
 *  (and its comparison day), for the chart. */
export function withSignupSeries(
  insights: Insights,
  data: SignupsData | null,
): Insights {
  if (!data || data.unsupportedFilter) return insights;
  const byDate = new Map(data.days.map((day) => [day.date, day]));
  const joined = (date: string) => ({
    visits: byDate.get(date)?.visits ?? 0,
    signups: byDate.get(date)?.signups ?? 0,
  });
  return {
    ...insights,
    series: insights.series.map((day) => ({
      ...day,
      ...joined(day.date),
      compare: day.compare
        ? { ...day.compare, ...joined(day.compare.date) }
        : null,
    })),
  };
}

type Row = SignupsData["pages"][number];
type SortKey =
  | "clicks"
  | "position"
  | "visits"
  | "visitsPerClick"
  | "signups"
  | "signupRate";

const COLUMNS: Array<{ key: SortKey; label: string; title: string }> = [
  { key: "clicks", label: "Clicks", title: "Search Console clicks" },
  { key: "position", label: "Pos.", title: "Average position" },
  {
    key: "visits",
    label: "Google visits",
    title: "PostHog visits from Google organic search",
  },
  {
    key: "visitsPerClick",
    label: "Visits/click",
    title: "Google visits per Search Console click",
  },
  { key: "signups", label: "Signups", title: "Visits with a key event" },
  {
    key: "signupRate",
    label: "Signup rate",
    title: "Signups per Google visit",
  },
];

function sortValue(row: Row, key: SortKey): number | null {
  return row[key];
}

export function SearchSignupsSection({
  data,
  error,
  section,
}: {
  data: SignupsData | null;
  error: string | null;
  /** One page type: PostHog can't filter by it, so the rows are cut here. */
  section?: string;
}) {
  const [order, setOrder] = React.useState<{ key: SortKey; desc: boolean }>({
    key: "clicks",
    desc: true,
  });
  if (error) {
    return (
      <Alert variant="warning">Visits and signups from PostHog: {error}</Alert>
    );
  }
  if (!data) return null;
  if (data.unsupportedFilter) {
    return (
      <p className="text-xs text-muted-foreground">
        Visits and signups from PostHog can't be split by{" "}
        {data.unsupportedFilter}; clear that filter to see them.
      </p>
    );
  }
  const pages = section
    ? data.pages.filter((row) => pageSection(row.page) === section)
    : data.pages;
  const rows = sort(pages, (a, b) => {
    const left = sortValue(a, order.key);
    const right = sortValue(b, order.key);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    // Position: lower is better, so "descending" puts the best first.
    const diff = order.key === "position" ? right - left : left - right;
    return (order.desc ? -diff : diff) || b.clicks - a.clicks;
  });
  const keyEvents = data.source.keyEvents;

  return (
    <InsightSection
      title="From search to signups"
      why={`Search Console clicks per page, the visits PostHog counted from Google, and the signups they brought (a visit with ${keyEvents.length ? keyEvents.join(" or ") : "a key event; none is set in Settings → Integrations"}). Few visits per click means visitors leave before the page loads, or block analytics; a page with signups deserves more search traffic.`}
      count={rows.length}
      empty="No page had Search Console clicks or Google visits in this period."
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-full">Page</TableHead>
            <TableHead>Type</TableHead>
            {COLUMNS.map((column) => (
              <TableHead
                key={column.key}
                className="text-right"
                title={column.title}
                aria-sort={
                  order.key === column.key
                    ? order.desc
                      ? "descending"
                      : "ascending"
                    : "none"
                }
              >
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 rounded-sm whitespace-nowrap outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  onClick={() =>
                    setOrder((current) => ({
                      key: column.key,
                      desc: current.key === column.key ? !current.desc : true,
                    }))
                  }
                >
                  {column.label}
                  {order.key === column.key ? (
                    order.desc ? (
                      <ArrowDown className="size-3" />
                    ) : (
                      <ArrowUp className="size-3" />
                    )
                  ) : null}
                </button>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.page}>
              <TableCell className="w-full max-w-0">
                <PageCell url={row.page} />
              </TableCell>
              <TypeCell url={row.page} />
              <TableCell className="text-right tabular-nums">
                {formatCount(row.clicks)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.position === null ? "—" : formatPosition(row.position)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(row.visits)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.visitsPerClick === null
                  ? "—"
                  : row.visitsPerClick.toFixed(2)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(row.signups)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.signupRate === null ? "—" : formatCtr(row.signupRate)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        Visits are PostHog sessions from Google organic search, by landing page,
        on Pacific-time days like Search Console&apos;s. On cookieless sites
        visits are estimates.
      </p>
    </InsightSection>
  );
}
