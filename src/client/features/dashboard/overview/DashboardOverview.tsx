import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { AuditHealthCard } from "@/client/features/dashboard/DashboardCards";
import { DashboardLinkActivity } from "@/client/features/dashboard/DashboardLinkActivity";
import { DashboardSearch } from "@/client/features/dashboard/overview/DashboardSearch";
import {
  DashboardTrendCards,
  useDashboardRank,
} from "@/client/features/dashboard/overview/DashboardTrendCards";
import { NeedsAttention } from "@/client/features/dashboard/overview/NeedsAttention";
import { OutreachAnalytics } from "@/client/features/outreach/OutreachAnalytics";
import type { DashboardAuditSummary } from "@/server/features/dashboard/services/DashboardService";
import { getSearchInsights } from "@/serverFunctions/gscHistory";

// Fork feature (FORK-CHANGES.md): the dashboard's Overview tab. Search
// numbers and chart first, then trends, what needs attention, links and site
// health. Everything is read from stored data.

export function DashboardOverview({
  projectId,
  domain,
  audit,
}: {
  projectId: string;
  domain: string | null;
  audit: DashboardAuditSummary | null;
}) {
  const request = { projectId, range: "28d", compare: "previous" } as const;
  const insightsQuery = useQuery({
    queryKey: ["searchInsights", projectId, request],
    queryFn: () => getSearchInsights({ data: request }),
    staleTime: 60_000,
  });
  const insights = insightsQuery.data?.data ?? null;
  const rank = useDashboardRank(projectId);
  return (
    <div className="flex flex-col gap-4">
      <DashboardSearch
        projectId={projectId}
        status={insightsQuery.data?.status}
        insights={insights}
        loading={insightsQuery.isPending}
      />
      <DashboardTrendCards projectId={projectId} rank={rank} />
      <NeedsAttention projectId={projectId} insights={insights} rank={rank} />
      <OutreachAnalytics projectId={projectId} compact />
      {domain ? (
        <DashboardLinkActivity projectId={projectId} domain={domain} />
      ) : null}
      {audit ? (
        <AuditHealthCard projectId={projectId} audit={audit} domain={domain} />
      ) : (
        <div className="flex items-center justify-between gap-3 px-1 text-sm text-muted-foreground">
          <span>Site health: not scanned yet.</span>
          <Link
            to="/p/$projectId/audit"
            params={{ projectId }}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Site audit <ArrowRight className="size-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
