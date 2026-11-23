import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CardShell } from "@/client/components/CardShell";
import { PermissionHint } from "@/client/components/PermissionHint";
import { Badge } from "@/client/components/ui/badge";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/client/components/ui/toggle-group";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { getAnalyticsSource } from "@/serverFunctions/analyticsSource";
import { ConnectPosthog } from "./PosthogConnect";
import { ConnectedPosthog } from "./PosthogConnected";
import type { SourceView } from "./posthogUi";

// Fork addition (FORK-CHANGES.md): choose the project's analytics source,
// Google Analytics or PostHog. The GA4 card (children) shows for GA4.

type Provider = "ga4" | "posthog";

const PROVIDERS: ReadonlyArray<readonly [Provider, string]> = [
  ["ga4", "Google Analytics"],
  ["posthog", "PostHog"],
];

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

  const labelId = React.useId();

  return (
    <div className="space-y-3">
      {/* The cards below name their integration, so this row only labels the
          source switch and carries no section heading. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span id={labelId} className="text-sm text-muted-foreground">
          Analytics source
        </span>
        <ToggleGroup
          aria-labelledby={labelId}
          size="sm"
          spacing={0.5}
          value={[shown]}
          onValueChange={(next) => {
            // A press on the active item empties the group. Keep one on.
            const picked = PROVIDERS.find(([value]) => value === next[0]);
            if (picked) setView(picked[0]);
          }}
          className="max-w-full flex-wrap rounded-lg border border-border bg-muted p-0.5 data-[size=sm]:rounded-lg"
        >
          {PROVIDERS.map(([value, label]) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className="text-muted-foreground aria-pressed:bg-primary/15 aria-pressed:text-primary"
            >
              {label}
              {source?.provider === value ? (
                <Badge variant="success" size="sm">
                  in use
                </Badge>
              ) : null}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {sourceQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {getStandardErrorMessage(sourceQuery.error)}
        </p>
      ) : null}
      {shown === "ga4" ? (
        <>
          {source?.provider === "posthog" ? (
            <p className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
              This project reads its analytics from PostHog. Disconnect PostHog
              to use Google Analytics again.
            </p>
          ) : null}
          {children}
        </>
      ) : source ? (
        <PosthogCard projectId={projectId} source={source} />
      ) : (
        <div
          role="status"
          aria-label="Loading analytics source"
          className="space-y-3 rounded-xl border border-border bg-card p-6"
        >
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-9 w-24" />
        </div>
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
        <PermissionHint
          action="change this project's analytics source"
          className="mb-4"
        />
      ) : null}
      {connected ? (
        <ConnectedPosthog projectId={projectId} source={source} />
      ) : (
        <ConnectPosthog projectId={projectId} source={source} />
      )}
      <p className="mt-5 text-xs text-muted-foreground">
        Read with a read-only personal API key (scope Query: read) over
        PostHog's query API; the key is stored encrypted and shown only as its
        first and last characters. Page views and events are exact; on sites
        that count visitors without cookies, users and sessions are estimates.
        PostHog has no ecommerce data.
      </p>
    </CardShell>
  );
}
