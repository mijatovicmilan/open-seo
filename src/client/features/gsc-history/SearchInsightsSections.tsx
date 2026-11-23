import { createContext, useContext, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import {
  formatCount,
  formatCtr,
  formatPosition,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import { formatDay } from "@/client/features/gsc-history/annotationStyles";
import type { Insights } from "@/client/features/gsc-history/types";

type InsightsFilter = { page?: string; query?: string };

/** Clicking a page or query in any table filters the whole page to it. */
export const InsightsFilterContext = createContext<
  ((filter: InsightsFilter) => void) | null
>(null);

function pathOf(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

/** A URL shown as its path; click filters to the page, full URL on hover. */
function PageCell({ url }: { url: string | null }) {
  const onFilter = useContext(InsightsFilterContext);
  if (!url) return <span className="text-base-content/40">—</span>;
  const label = pathOf(url);
  if (!onFilter) {
    return (
      <span
        title={url}
        className="block max-w-[12rem] truncate 2xl:max-w-[22rem]"
      >
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={`Filter to ${url}`}
      onClick={() => onFilter({ page: url })}
      className="link link-hover block max-w-[12rem] truncate text-left 2xl:max-w-[22rem]"
    >
      {label}
    </button>
  );
}

function QueryCell({ query }: { query: string }) {
  const onFilter = useContext(InsightsFilterContext);
  return (
    <td className="max-w-[10rem] truncate 2xl:max-w-[18rem]">
      {onFilter ? (
        <button
          type="button"
          title={`Filter to "${query}"`}
          onClick={() => onFilter({ query })}
          className="link link-hover max-w-full truncate text-left"
        >
          {query}
        </button>
      ) : (
        query
      )}
    </td>
  );
}

function Delta({ current, previous }: { current: number; previous: number }) {
  const diff = current - previous;
  if (diff === 0) return <span className="text-base-content/40">0</span>;
  return (
    <span className={diff > 0 ? "text-success" : "text-error"}>
      {diff > 0 ? "+" : ""}
      {formatCount(diff)}
    </span>
  );
}

export function InsightSection({
  title,
  why,
  count,
  empty,
  children,
}: {
  title: string;
  why: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-base-300 bg-base-100">
      <div className="border-b border-base-300 px-4 py-3">
        <h2 className="font-semibold">
          {title}
          <span className="ml-2 text-sm font-normal text-base-content/50">
            {count}
          </span>
        </h2>
        <p className="mt-0.5 text-sm text-base-content/60">{why}</p>
      </div>
      {count === 0 ? (
        <p className="px-4 py-5 text-sm text-base-content/50">{empty}</p>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </section>
  );
}

export function ChangesTable({
  rows,
  direction,
}: {
  rows: Insights["changes"]["rising"];
  direction: "up" | "down";
}) {
  const Icon = direction === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <table className="table table-zebra table-sm">
      <thead>
        <tr>
          <th>Page</th>
          <th className="text-right">Clicks</th>
          <th className="text-right">Change</th>
          <th className="text-right">Impr. change</th>
          <th className="hidden xl:table-cell">Driven by</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.page}>
            <td>
              <div className="flex items-center gap-1.5">
                <Icon
                  className={`size-3.5 shrink-0 ${direction === "up" ? "text-success" : "text-error"}`}
                />
                <PageCell url={row.page} />
              </div>
            </td>
            <td className="text-right tabular-nums">
              {formatCount(row.clicks)}
            </td>
            <td className="text-right tabular-nums">
              <Delta current={row.clicks} previous={row.prevClicks} />
            </td>
            <td className="text-right tabular-nums">
              <Delta current={row.impressions} previous={row.prevImpressions} />
            </td>
            <td className="hidden max-w-xs text-xs text-base-content/70 xl:table-cell">
              {row.drivers.length === 0
                ? "—"
                : row.drivers.map((driver) => (
                    <div key={driver.query} className="truncate">
                      {driver.query}{" "}
                      <span className="text-base-content/50">
                        (
                        {driver.clicks !== driver.prevClicks ? (
                          <>
                            {driver.clicks - driver.prevClicks > 0 ? "+" : ""}
                            {formatCount(
                              driver.clicks - driver.prevClicks,
                            )}{" "}
                            clicks
                          </>
                        ) : (
                          <>
                            {driver.impressions - driver.prevImpressions > 0
                              ? "+"
                              : ""}
                            {formatCount(
                              driver.impressions - driver.prevImpressions,
                            )}{" "}
                            impr.
                          </>
                        )}
                        )
                      </span>
                    </div>
                  ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function NewQueriesTable({ rows }: { rows: Insights["newQueries"] }) {
  return (
    <table className="table table-zebra table-sm">
      <thead>
        <tr>
          <th>Query</th>
          <th>Best page</th>
          <th>First seen</th>
          <th className="text-right">Impr.</th>
          <th className="text-right">Clicks</th>
          <th className="text-right">Pos.</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.query}>
            <QueryCell query={row.query} />
            <td>
              <PageCell url={row.page} />
            </td>
            <td className="whitespace-nowrap">{formatDay(row.firstDate)}</td>
            <td className="text-right tabular-nums">
              {formatCount(row.impressions)}
            </td>
            <td className="text-right tabular-nums">
              {formatCount(row.clicks)}
            </td>
            <td className="text-right tabular-nums">
              {formatPosition(row.position)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function NearPageOneTable({ rows }: { rows: Insights["nearPageOne"] }) {
  return (
    <table className="table table-zebra table-sm">
      <thead>
        <tr>
          <th>Query</th>
          <th>Best page</th>
          <th className="text-right">Pos.</th>
          <th className="text-right">Impr.</th>
          <th className="text-right">Clicks</th>
          <th className="text-right">At #3</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.query}>
            <QueryCell query={row.query} />
            <td>
              <PageCell url={row.page} />
            </td>
            <td className="text-right tabular-nums">
              {formatPosition(row.position)}
            </td>
            <td className="text-right tabular-nums">
              {formatCount(row.impressions)}
            </td>
            <td className="text-right tabular-nums">
              {formatCount(row.clicks)}
            </td>
            <td className="text-right tabular-nums text-success">
              +{formatCount(row.potentialClicks)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CtrGapTable({ rows }: { rows: Insights["ctrGaps"] }) {
  return (
    <table className="table table-zebra table-sm">
      <thead>
        <tr>
          <th>Query</th>
          <th>Page</th>
          <th className="text-right">Pos.</th>
          <th className="text-right">CTR</th>
          <th className="text-right">Expected</th>
          <th className="text-right">Click gap</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.query}::${row.page}`}>
            <QueryCell query={row.query} />
            <td>
              <PageCell url={row.page} />
            </td>
            <td className="text-right tabular-nums">
              {formatPosition(row.position)}
            </td>
            <td className="text-right tabular-nums">{formatCtr(row.ctr)}</td>
            <td className="text-right tabular-nums">
              {formatCtr(row.expectedCtr)}
            </td>
            <td className="text-right tabular-nums text-error">
              {formatCount(row.clickGap)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CannibalizationTable({
  rows,
}: {
  rows: Insights["cannibalization"];
}) {
  return (
    <table className="table table-zebra table-sm">
      <thead>
        <tr>
          <th>Query</th>
          <th className="text-right">Impr.</th>
          <th>Competing pages (share, position)</th>
          <th className="text-right">Flips</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.query}>
            <QueryCell query={row.query} />
            <td className="text-right tabular-nums">
              {formatCount(row.impressions)}
            </td>
            <td>
              {row.pages.map((page) => (
                <div key={page.page} className="flex items-center gap-2">
                  <PageCell url={page.page} />
                  <span className="shrink-0 text-xs text-base-content/60">
                    {Math.round(page.share * 100)}%, #
                    {formatPosition(page.position)}
                  </span>
                </div>
              ))}
            </td>
            <td
              className={`text-right tabular-nums ${row.flips > 0 ? "font-medium text-warning" : ""}`}
            >
              {row.flips}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const maxValue = Math.max(...values, 1);
  const width = 80;
  const height = 20;
  const step = width / (values.length - 1);
  const points = values
    .map(
      (v, i) =>
        `${(i * step).toFixed(1)},${(height - (v / maxValue) * height).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg width={width} height={height} aria-hidden className="text-info">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      />
    </svg>
  );
}

export function NewPagesTable({ rows }: { rows: Insights["newPages"] }) {
  return (
    <table className="table table-zebra table-sm">
      <thead>
        <tr>
          <th>Page</th>
          <th>First impressions</th>
          <th className="text-right">Impr.</th>
          <th className="text-right">Clicks</th>
          <th>Weekly impressions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.page}>
            <td>
              <PageCell url={row.page} />
            </td>
            <td className="whitespace-nowrap">{formatDay(row.firstDate)}</td>
            <td className="text-right tabular-nums">
              {formatCount(row.impressions)}
            </td>
            <td className="text-right tabular-nums">
              {formatCount(row.clicks)}
            </td>
            <td>
              <div className="flex items-center gap-2">
                <Sparkline values={row.weeklyImpressions} />
                <span className="text-xs text-base-content/50">
                  {row.weeklyImpressions.length} wk
                </span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
