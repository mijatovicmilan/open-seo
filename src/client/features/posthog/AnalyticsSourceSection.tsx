import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CardShell } from "@/client/components/CardShell";
import { Badge } from "@/client/components/ui/badge";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { getAnalyticsSource } from "@/serverFunctions/analyticsSource";
import { ConnectPosthog } from "./PosthogConnect";
import { ConnectedPosthog } from "./PosthogConnected";
import type { SourceView } from "./posthogUi";

// Fork addition (FORK-CHANGES.md): choose the project's analytics source,
// Google Analytics or PostHog. The GA4 card (children) shows for GA4.

type Provider = "ga4" | "posthog";

const analyticsSourceQueryKey = (projectId: string) => [
  "analyticsSource",
  projectId,
];

function useAnalyticsSource(projectId: string) {
  return useQuery({
    queryKey: analyticsSourceQueryKey(projectId),
    queryFn: () => getAnalyticsSource({ data: { projectId } }),
    staleTime: 60_000,
  });
}

export function AnalyticsSourceSection({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const sourceQuery = useAnalyticsSource(projectId);
  const source = sourceQuery.data;
  const [view, setView] = React.useState<Provider | null>(null);
  const shown: Provider = view ?? source?.provider ?? "ga4";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-base-content/50">Analytics</h2>
        <div className="join" role="radiogroup" aria-label="Analytics source">
          {(
            [
              ["ga4", "Google Analytics"],
              ["posthog", "PostHog"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={shown === value}
              className={`btn btn-sm join-item ${shown === value ? "btn-active" : "btn-ghost border-base-300"}`}
              onClick={() => setView(value)}
            >
              {label}
              {source?.provider === value ? (
                <span className="badge badge-xs badge-success">in use</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
      {sourceQuery.isError ? (
        <p role="alert" className="text-sm text-error">
          {getStandardErrorMessage(sourceQuery.error)}
        </p>
      ) : null}
      {shown === "ga4" ? (
        <>
          {source?.provider === "posthog" ? (
            <p className="rounded-lg border border-base-300 bg-base-200/50 p-3 text-sm text-base-content/70">
              This project reads its analytics from PostHog. Disconnect PostHog
              to use Google Analytics again.
            </p>
          ) : null}
          {children}
        </>
      ) : source ? (
        <PosthogCard projectId={projectId} source={source} />
      ) : (
        <div className="skeleton h-40" />
      )}
    </div>
  );
}

function PosthogCard({
  projectId,
  source,
}: {
  projectId: string;
  source: SourceView;
}) {
  const connected =
    source.provider === "posthog" && Boolean(source.posthogProjectId);
  return (
    <CardShell
      title="PostHog"
      action={
        <Badge
          variant={connected ? (source.key ? "success" : "warning") : "outline"}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {connected
            ? source.key
              ? "Connected"
              : "Setup required"
            : "Not connected"}
        </Badge>
      }
    >
      {!source.canManage ? (
        <p className="mb-4 text-sm text-base-content/60">
          Ask an organization owner or admin to change this project's analytics
          source.
        </p>
      ) : null}
      {connected ? (
        <ConnectedPosthog projectId={projectId} source={source} />
      ) : (
        <ConnectPosthog projectId={projectId} source={source} />
      )}
      <p className="mt-5 text-xs text-base-content/60">
        Read with a read-only personal API key (scope Query: read) over
        PostHog's query API; the key is stored encrypted and shown only as its
        first and last characters. Page views and events are exact; on sites
        that count visitors without cookies, users and sessions are estimates.
        PostHog has no ecommerce data.
      </p>
    </CardShell>
  );
}
