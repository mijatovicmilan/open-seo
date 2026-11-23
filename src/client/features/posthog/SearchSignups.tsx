import * as React from "react";
import { sort } from "remeda";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  formatCount,
  formatCtr,
  formatPosition,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import {
  InsightSection,
  PageCell,
} from "@/client/features/gsc-history/SearchInsightsSections";
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
}: {
  data: SignupsData | null;
  error: string | null;
}) {
  const [order, setOrder] = React.useState<{ key: SortKey; desc: boolean }>({
    key: "clicks",
    desc: true,
  });
  if (error) {
    return (
      <div role="alert" className="alert alert-warning text-sm">
        Visits and signups from PostHog: {error}
      </div>
    );
  }
  if (!data) return null;
  if (data.unsupportedFilter) {
    return (
      <p className="text-xs text-base-content/50">
        Visits and signups from PostHog can't be split by{" "}
        {data.unsupportedFilter}; clear that filter to see them.
      </p>
    );
  }
  const rows = sort(data.pages, (a, b) => {
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
      <table className="table table-zebra table-sm">
        <thead>
          <tr>
            <th>Page</th>
            {COLUMNS.map((column) => (
              <th
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
                  className="inline-flex items-center gap-0.5 whitespace-nowrap hover:text-base-content"
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
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.page}>
              <td>
                <PageCell url={row.page} />
              </td>
              <td className="text-right tabular-nums">
                {formatCount(row.clicks)}
              </td>
              <td className="text-right tabular-nums">
                {row.position === null ? "—" : formatPosition(row.position)}
              </td>
              <td className="text-right tabular-nums">
                {formatCount(row.visits)}
              </td>
              <td className="text-right tabular-nums">
                {row.visitsPerClick === null
                  ? "—"
                  : row.visitsPerClick.toFixed(2)}
              </td>
              <td className="text-right tabular-nums">
                {formatCount(row.signups)}
              </td>
              <td className="text-right tabular-nums">
                {row.signupRate === null ? "—" : formatCtr(row.signupRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-base-300 px-4 py-2 text-xs text-base-content/50">
        Visits are PostHog sessions from Google organic search, by landing page,
        in days of {data.source.timeZone} (Search Console uses Pacific time). On
        cookieless sites visits are estimates.
      </p>
    </InsightSection>
  );
}
