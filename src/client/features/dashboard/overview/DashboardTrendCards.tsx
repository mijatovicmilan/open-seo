import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { sort } from "remeda";
import { cn } from "cn";
import { Skeleton } from "@/client/components/ui/skeleton";
import { getAiVisibilityTrend } from "@/serverFunctions/ai-visibility";
import {
  getLatestRankResults,
  getRankConfigTrend,
  getRankTrackingConfigSummaries,
} from "@/serverFunctions/rank-tracking";
import type { RankTrackingRow } from "@/types/schemas/rank-tracking";

// Fork feature (FORK-CHANGES.md): small trend cards on the dashboard, read
// from what rank tracking and AI visibility already stored. Nothing here
// calls DataForSEO.

/** The project's rank tracker with the newest check and its keyword rows. */
export function useDashboardRank(projectId: string) {
  const summaries = useQuery({
    queryKey: ["rankConfigSummaries", projectId],
    queryFn: () => getRankTrackingConfigSummaries({ data: { projectId } }),
  });
  // The tracker checked most recently; most projects have one.
  const config = (summaries.data ?? [])
    .filter((item) => item.keywordCount > 0)
    .reduce<
      NonNullable<typeof summaries.data>[number] | null
    >((best, item) => (!best || (item.lastRunCompletedAt ?? "") > (best.lastRunCompletedAt ?? "") ? item : best), null);
  const results = useQuery({
    queryKey: ["dashboardRankResults", projectId, config?.id],
    queryFn: () =>
      getLatestRankResults({
        data: { projectId, configId: config!.id, comparePeriod: "7d" },
      }),
    enabled: Boolean(config),
  });
  const rows = results.data?.rows ?? [];
  const device: "desktop" | "mobile" = rows.some(
    (row) => row.desktop.checkedAt !== null,
  )
    ? "desktop"
    : "mobile";
  return {
    loading: summaries.isPending || (Boolean(config) && results.isPending),
    config,
    device,
    rows,
  };
}

export type DashboardRank = ReturnType<typeof useDashboardRank>;

/** Keywords that fell since the check a week ago, biggest fall first. */
export function rankDrops(rank: DashboardRank) {
  const drops = rank.rows
    .map((row) => ({ row, result: row[rank.device] }))
    .filter(
      ({ result }) =>
        result.previousPosition !== null &&
        (result.position === null || result.position > result.previousPosition),
    )
    .map(({ row, result }) => ({
      keyword: row.keyword,
      from: result.previousPosition!,
      to: result.position,
      fall: (result.position ?? 101) - result.previousPosition!,
    }));
  return sort(drops, (a, b) => b.fall - a.fall);
}

function rankSummary(rows: RankTrackingRow[], device: "desktop" | "mobile") {
  const checked = rows.filter((row) => row[device].checkedAt !== null);
  const ranked = checked
    .map((row) => row[device].position)
    .filter((position): position is number => position !== null);
  let up = 0;
  let down = 0;
  for (const row of checked) {
    const { position, previousPosition } = row[device];
    if (previousPosition === null || position === previousPosition) continue;
    if (position !== null && position < previousPosition) up++;
    else down++;
  }
  return {
    checked: checked.length,
    top10: ranked.filter((position) => position <= 10).length,
    average:
      ranked.length > 0
        ? ranked.reduce((sum, position) => sum + position, 0) / ranked.length
        : null,
    up,
    down,
  };
}

export function DashboardTrendCards({
  projectId,
  rank,
}: {
  projectId: string;
  rank: DashboardRank;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <RankCard projectId={projectId} rank={rank} />
      <AiCard projectId={projectId} />
    </div>
  );
}

function TrendCard({
  title,
  to,
  value,
  note,
  points,
  color,
}: {
  title: string;
  to: ReactNode;
  value: ReactNode;
  note: ReactNode;
  points: number[];
  color: string;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{title}</span>
        {to}
      </div>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
          <div className="text-xs text-muted-foreground">{note}</div>
        </div>
        <Sparkline points={points} color={color} />
      </div>
    </section>
  );
}

/** A line with no axes; nothing with fewer than two points. */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 96 + 2;
      const y = 30 - ((point - min) / span) * 26;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 32"
      className="h-8 w-24 shrink-0 overflow-visible"
      aria-hidden
    >
      <polyline
        points={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function CardLink({
  children,
  ...props
}: { children: ReactNode } & (
  | { to: "/p/$projectId/rank-tracking"; params: { projectId: string } }
  | {
      to: "/p/$projectId/rank-tracking/$configId";
      params: { projectId: string; configId: string };
    }
  | { to: "/p/$projectId/ai-visibility"; params: { projectId: string } }
)) {
  return (
    <Link
      {...props}
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      {children} <ArrowRight className="size-3.5" />
    </Link>
  );
}

function RankCard({
  projectId,
  rank,
}: {
  projectId: string;
  rank: DashboardRank;
}) {
  const { config, device, rows } = rank;
  const trend = useQuery({
    queryKey: ["rankConfigTrend", projectId, config?.id, device, 90],
    queryFn: () =>
      getRankConfigTrend({
        data: { projectId, configId: config!.id, device, sinceDays: 90 },
      }),
    enabled: Boolean(config),
  });
  if (rank.loading) return <Skeleton className="h-28" />;
  if (!config) {
    return (
      <EmptyLine
        title="Rank tracking"
        text="No keywords tracked yet."
        link={
          <CardLink to="/p/$projectId/rank-tracking" params={{ projectId }}>
            Track keywords
          </CardLink>
        }
      />
    );
  }
  const summary = rankSummary(rows, device);
  return (
    <TrendCard
      title={`Tracked keywords in the top 10 (${device})`}
      to={
        <CardLink
          to="/p/$projectId/rank-tracking/$configId"
          params={{ projectId, configId: config.id }}
        >
          Rank tracking
        </CardLink>
      }
      value={
        <>
          {summary.top10}
          <span className="text-base font-normal text-muted-foreground">
            {" "}
            of {summary.checked}
          </span>
        </>
      }
      note={
        <>
          {summary.average !== null
            ? `Average position ${summary.average.toFixed(1)}`
            : "None in the top 100"}
          {summary.up + summary.down > 0 ? (
            <>
              {" · "}
              <span className="text-success">{summary.up} up</span>
              {", "}
              <span className={cn(summary.down > 0 && "text-destructive")}>
                {summary.down} down
              </span>{" "}
              in 7 days
            </>
          ) : null}
        </>
      }
      points={(trend.data ?? []).map((run) => run.top3 + run.top4to10)}
      color="#378ADD"
    />
  );
}

function AiCard({ projectId }: { projectId: string }) {
  const trend = useQuery({
    queryKey: ["aiVisibilityTrend", projectId, 28],
    queryFn: () => getAiVisibilityTrend({ data: { projectId, days: 28 } }),
    retry: false,
  });
  if (trend.isPending) return <Skeleton className="h-28" />;
  const data = trend.data;
  const link = (
    <CardLink to="/p/$projectId/ai-visibility" params={{ projectId }}>
      AI visibility
    </CardLink>
  );
  if (!data || data.comparison === "no_data" || data.mentions.current === null)
    return (
      <EmptyLine
        title="AI answers that name you"
        text="No prompts tracked yet."
        link={link}
      />
    );
  const change = data.mentions.change;
  return (
    <TrendCard
      title="AI answers that name you"
      to={link}
      // Rates come as percents.
      value={`${Math.round(data.mentions.current)}%`}
      note={
        <>
          Tracked prompts, last 28 days
          {change !== null ? (
            <span
              className={cn(
                "ml-1",
                change > 0 && "text-success",
                change < 0 && "text-destructive",
              )}
            >
              {change > 0 ? "+" : ""}
              {change.toFixed(1)} pts
            </span>
          ) : null}
        </>
      }
      points={data.runs
        .map((run) => run.mentionRate)
        .filter((rate): rate is number => rate !== null)}
      color="#D4537E"
    />
  );
}

function EmptyLine({
  title,
  text,
  link,
}: {
  title: string;
  text: string;
  link: ReactNode;
}) {
  return (
    <section className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
      <span>
        <span className="text-muted-foreground">{title}: </span>
        {text}
      </span>
      {link}
    </section>
  );
}
