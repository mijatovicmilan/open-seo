import { Link } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { formatDay } from "@/client/features/gsc-history/annotationStyles";
import type { HistoryStatus } from "@/client/features/gsc-history/types";
import type { SearchHistorySync } from "@/client/features/gsc-history/useSearchHistorySync";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";

// In Pacific time, like Google's days and the chart's hours, so every time
// on the page is in one zone.
function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  return `${new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  })} PT`;
}

/** The header's sync control: days stored, last sync, and a small Sync
 *  button. The site and the oldest day are in the tooltip. */
export function SyncControl({
  status: loaded,
  sync,
}: {
  status: HistoryStatus;
  sync: SearchHistorySync;
}) {
  const status = sync.progress ?? loaded;
  const busy = sync.isSyncing || status.running;
  const details = [
    status.siteUrl,
    status.oldestDay ? `Stored since ${formatDay(status.oldestDay)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex items-center gap-2">
      <span
        className="text-xs text-muted-foreground"
        title={details || undefined}
      >
        {status.daysStored > 0
          ? `${formatCount(status.daysStored)} days · synced ${formatWhen(status.lastSuccessAt)}`
          : "No days stored yet"}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={sync.syncNow}
        disabled={busy}
      >
        <RefreshCw
          data-icon="inline-start"
          className={cn(busy && "animate-spin")}
        />
        Sync
      </Button>
    </div>
  );
}

/** What the sync is doing or what went wrong; nothing when all is well. */
export function SyncNotices({
  projectId,
  status: loaded,
  sync,
}: {
  projectId: string;
  status: HistoryStatus;
  sync: SearchHistorySync;
}) {
  const status = sync.progress ?? loaded;
  const busy = sync.isSyncing || status.running;
  const total = status.daysStored + status.missingDays;
  const notice =
    busy && status.missingDays === 0 && status.segmentDaysMissing > 0 ? (
      <span className="flex items-center gap-2">
        <Spinner className="size-3.5" />
        Adding country and device data: {formatCount(
          status.segmentDaysMissing,
        )}{" "}
        days left.
      </span>
    ) : busy ? (
      <span className="flex items-center gap-2">
        <Spinner className="size-3.5" />
        Filling history: {formatCount(status.daysStored)} of{" "}
        {formatCount(total)} days. You can keep using the page.
      </span>
    ) : status.segmentDaysMissing > 0 ? (
      `Country and device data still to add for ${formatCount(status.segmentDaysMissing)} days.`
    ) : status.missingDays > 0 ? (
      `${formatCount(status.missingDays)} older days still to fetch.`
    ) : null;
  const error = status.lastError && !busy;
  if (!notice && !error) return null;
  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      {notice ? <div>{notice}</div> : null}
      {error ? (
        <div className="flex items-start gap-1.5 text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Last sync failed: {status.lastError}{" "}
            <Link
              to="/p/$projectId/settings/integrations"
              params={{ projectId }}
              className="underline underline-offset-4"
            >
              Integrations
            </Link>
          </span>
        </div>
      ) : null}
    </div>
  );
}
