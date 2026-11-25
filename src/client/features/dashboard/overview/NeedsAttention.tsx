import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { pathOf } from "@/client/features/gsc-history/SearchInsightsSections";
import type { Insights } from "@/client/features/gsc-history/types";
import {
  formatCount,
  formatCtr,
  formatPosition,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import {
  rankDrops,
  type DashboardRank,
} from "@/client/features/dashboard/overview/DashboardTrendCards";

// Fork feature (FORK-CHANGES.md): the few things worth doing next, from
// Search Insights and rank tracking, each linking to where it is handled.

const TONES = {
  accent: "bg-primary/10 text-primary",
  warning: "bg-warning/15 text-warning-foreground dark:text-warning",
  danger: "bg-destructive/10 text-destructive",
  success: "bg-success/10 text-success",
} as const;

type Item = {
  key: string;
  tag: string;
  tone: keyof typeof TONES;
  text: string;
  action: string;
  /** Search Insights filtered to it, or the rank tracker. */
  target: { search: { query?: string; page?: string } } | { configId: string };
};

const PER_KIND = 2;

export function NeedsAttention({
  projectId,
  insights,
  rank,
}: {
  projectId: string;
  insights: Insights | null;
  rank: DashboardRank;
}) {
  const items: Item[] = [
    ...(insights?.nearPageOne.slice(0, PER_KIND) ?? []).map((row) => ({
      key: `near:${row.query}`,
      tag: "Near page one",
      tone: "accent" as const,
      text: `"${row.query}" at #${formatPosition(row.position)}, ${formatCount(row.impressions)} impr.`,
      action: `+${formatCount(row.potentialClicks)} clicks at #3`,
      target: { search: { query: row.query } },
    })),
    ...(insights?.ctrGaps.slice(0, PER_KIND) ?? []).map((row) => ({
      key: `ctr:${row.query}:${row.page}`,
      tag: "Low CTR",
      tone: "warning" as const,
      text: `${pathOf(row.page)} for "${row.query}": ${formatCtr(row.ctr)} at #${formatPosition(row.position)}, ${formatCtr(row.expectedCtr)} expected`,
      action: "Improve the title",
      target: { search: { page: row.page } },
    })),
    ...(insights?.changes.falling.slice(0, PER_KIND) ?? []).map((row) => ({
      key: `fall:${row.page}`,
      tag: "Falling",
      tone: "danger" as const,
      text: `${pathOf(row.page)}: ${formatCount(row.prevClicks)} → ${formatCount(row.clicks)} clicks`,
      action: "See why",
      target: { search: { page: row.page } },
    })),
    ...(rank.config
      ? rankDrops(rank)
          .slice(0, PER_KIND)
          .map((drop) => ({
            key: `rank:${drop.keyword}`,
            tag: "Rank drop",
            tone: "danger" as const,
            text: `"${drop.keyword}" fell from #${drop.from} to ${drop.to === null ? "out of the top 100" : `#${drop.to}`}`,
            action: "Rank tracking",
            target: { configId: rank.config!.id },
          }))
      : []),
    ...(insights?.newPages.slice(0, PER_KIND) ?? []).map((row) => ({
      key: `new:${row.page}`,
      tag: "New page",
      tone: "success" as const,
      text: `${pathOf(row.page)}: ${formatCount(row.impressions)} impr., ${formatCount(row.clicks)} clicks since it appeared`,
      action: "Open",
      target: { search: { page: row.page } },
    })),
  ];
  const linkClass = "shrink-0 text-sm text-primary hover:underline";

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-semibold">
          Needs attention
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {items.length}
          </span>
        </h2>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          Nothing stands out right now. Queries near page one, low CTR, falling
          pages and rank drops show up here.
        </p>
      ) : (
        <ul>
          {items.map((item) => (
            <li
              key={item.key}
              className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0"
            >
              <span
                className={cn(
                  "w-28 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-medium",
                  TONES[item.tone],
                )}
              >
                {item.tag}
              </span>
              <span className="min-w-0 flex-1 truncate" title={item.text}>
                {item.text}
              </span>
              {"configId" in item.target ? (
                <Link
                  to="/p/$projectId/rank-tracking/$configId"
                  params={{ projectId, configId: item.target.configId }}
                  className={linkClass}
                >
                  {item.action}
                </Link>
              ) : (
                <Link
                  to="/p/$projectId/search-insights"
                  params={{ projectId }}
                  search={item.target.search}
                  className={linkClass}
                >
                  {item.action}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
