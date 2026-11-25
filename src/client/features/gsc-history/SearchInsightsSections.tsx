import { createContext, useContext, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "cn";
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
import { formatDay } from "@/client/features/gsc-history/annotationStyles";
import type { InsightsTarget } from "@/client/features/gsc-history/InsightsDetailSheet";
import type { Insights } from "@/client/features/gsc-history/types";
import { pageSection, sectionLabel } from "@/shared/pageSection";

/** Clicking a page or query in any table opens its details panel. */
export const InsightsOpenContext = createContext<
  ((target: InsightsTarget) => void) | null
>(null);

export function pathOf(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

/** A URL shown as its path, cut to the cell's width; the full URL on hover.
 *  The cell around it sets the width (`w-full max-w-0` takes what is left). */
export function PageCell({ url }: { url: string | null }) {
  const onOpen = useContext(InsightsOpenContext);
  if (!url) return <span className="text-muted-foreground">—</span>;
  const label = pathOf(url);
  if (!onOpen) {
    return (
      <span title={url} className="block truncate">
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={url}
      onClick={() => onOpen({ page: url })}
      className="block max-w-full truncate rounded-sm text-left underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {label}
    </button>
  );
}

/** Fork addition (FORK-CHANGES.md): the page's type, its first folder. */
export function TypeCell({ url }: { url: string | null }) {
  return (
    <TableCell className="whitespace-nowrap text-muted-foreground">
      {url ? sectionLabel(pageSection(url)) : "—"}
    </TableCell>
  );
}

export function QueryCell({
  query,
  className = "w-full max-w-0",
}: {
  query: string;
  className?: string;
}) {
  const onOpen = useContext(InsightsOpenContext);
  return (
    <TableCell className={className}>
      {onOpen ? (
        <button
          type="button"
          title={query}
          onClick={() => onOpen({ query })}
          className="block max-w-full truncate rounded-sm text-left underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {query}
        </button>
      ) : (
        <span className="block truncate">{query}</span>
      )}
    </TableCell>
  );
}

// Query and page side by side share the free width.
const QUERY_HALF = "w-1/2 max-w-0";
const PAGE_HALF = "w-1/2 max-w-0";

function Delta({ current, previous }: { current: number; previous: number }) {
  const diff = current - previous;
  if (diff === 0) return <span className="text-muted-foreground">0</span>;
  return (
    <span className={diff > 0 ? "text-success" : "text-destructive"}>
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
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-semibold">
          {title}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {count}
          </span>
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{why}</p>
      </div>
      {count === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">{empty}</p>
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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-full">Page</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="text-right">Clicks</TableHead>
          <TableHead className="text-right">Change</TableHead>
          <TableHead className="text-right">Impr. change</TableHead>
          <TableHead className="hidden 2xl:table-cell">Driven by</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.page}>
            <TableCell className="w-full max-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <Icon
                  className={cn(
                    "size-3.5 shrink-0",
                    direction === "up" ? "text-success" : "text-destructive",
                  )}
                />
                <PageCell url={row.page} />
              </div>
            </TableCell>
            <TypeCell url={row.page} />
            <TableCell className="text-right tabular-nums">
              {formatCount(row.clicks)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <Delta current={row.clicks} previous={row.prevClicks} />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <Delta current={row.impressions} previous={row.prevImpressions} />
            </TableCell>
            <TableCell className="hidden max-w-xs text-xs text-muted-foreground 2xl:table-cell">
              {row.drivers.length === 0
                ? "—"
                : row.drivers.map((driver) => (
                    <div key={driver.query} className="truncate">
                      {driver.query}{" "}
                      <span className="text-muted-foreground/80">
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
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function NewQueriesTable({ rows }: { rows: Insights["newQueries"] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Query</TableHead>
          <TableHead>Best page</TableHead>
          <TableHead>First seen</TableHead>
          <TableHead className="text-right">Impr.</TableHead>
          <TableHead className="text-right">Clicks</TableHead>
          <TableHead className="text-right">Pos.</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.query}>
            <QueryCell query={row.query} className={QUERY_HALF} />
            <TableCell className={PAGE_HALF}>
              <PageCell url={row.page} />
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {formatDay(row.firstDate)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCount(row.impressions)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCount(row.clicks)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatPosition(row.position)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function NearPageOneTable({ rows }: { rows: Insights["nearPageOne"] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Query</TableHead>
          <TableHead>Best page</TableHead>
          <TableHead className="text-right">Pos.</TableHead>
          <TableHead className="text-right">Impr.</TableHead>
          <TableHead className="text-right">Clicks</TableHead>
          <TableHead className="text-right">At #3</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.query}>
            <QueryCell query={row.query} className={QUERY_HALF} />
            <TableCell className={PAGE_HALF}>
              <PageCell url={row.page} />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatPosition(row.position)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCount(row.impressions)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCount(row.clicks)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-success">
              +{formatCount(row.potentialClicks)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function CtrGapTable({ rows }: { rows: Insights["ctrGaps"] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Query</TableHead>
          <TableHead>Page</TableHead>
          <TableHead className="text-right">Pos.</TableHead>
          <TableHead className="text-right">CTR</TableHead>
          <TableHead className="text-right">Expected</TableHead>
          <TableHead className="text-right">Click gap</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.query}::${row.page}`}>
            <QueryCell query={row.query} className={QUERY_HALF} />
            <TableCell className={PAGE_HALF}>
              <PageCell url={row.page} />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatPosition(row.position)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCtr(row.ctr)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCtr(row.expectedCtr)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-destructive">
              {formatCount(row.clickGap)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function CannibalizationTable({
  rows,
}: {
  rows: Insights["cannibalization"];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Query</TableHead>
          <TableHead className="text-right">Impr.</TableHead>
          <TableHead>Competing pages (share, position)</TableHead>
          <TableHead className="text-right">Flips</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.query}>
            <QueryCell query={row.query} className="w-1/3 max-w-0" />
            <TableCell className="text-right tabular-nums">
              {formatCount(row.impressions)}
            </TableCell>
            <TableCell className="w-2/3 max-w-0">
              {row.pages.map((page) => (
                <div
                  key={page.page}
                  className="flex min-w-0 items-center gap-2"
                >
                  <PageCell url={page.page} />
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {Math.round(page.share * 100)}%, #
                    {formatPosition(page.position)}
                  </span>
                </div>
              ))}
            </TableCell>
            <TableCell
              className={cn(
                "text-right tabular-nums",
                row.flips > 0 &&
                  "font-medium text-warning-foreground dark:text-warning",
              )}
            >
              {row.flips}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
