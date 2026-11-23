import { Link } from "@tanstack/react-router";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { formatDay } from "@/client/features/gsc-history/annotationStyles";
import type { HistoryStatus } from "@/client/features/gsc-history/types";
import type { SearchHistorySync } from "@/client/features/gsc-history/useSearchHistorySync";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";

function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Days stored, oldest day, last sync, any error, and the Sync now button.
 *  While a catch-up runs it shows how much history is filled. */
export function SyncStatusLine({
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

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-base-300 bg-base-100 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <div className="text-base-content/70">
          {status.daysStored > 0 ? (
            <>
              <span className="font-medium text-base-content">
                {formatCount(status.daysStored)} days stored
              </span>
              {status.oldestDay ? ` since ${formatDay(status.oldestDay)}` : ""}
              {" · "}last sync {formatWhen(status.lastSuccessAt)}
            </>
          ) : (
            "No days stored yet"
          )}
        </div>
        {status.siteUrl ? (
          <div className="truncate text-xs text-base-content/50">
            {status.siteUrl}
          </div>
        ) : null}
        {busy && status.missingDays === 0 && status.segmentDaysMissing > 0 ? (
          <div className="flex items-center gap-2 text-base-content/60">
            <Loader2 className="size-3.5 animate-spin" />
            Adding country and device data:{" "}
            {formatCount(status.segmentDaysMissing)} days left.
          </div>
        ) : busy ? (
          <div className="flex items-center gap-2 text-base-content/60">
            <Loader2 className="size-3.5 animate-spin" />
            Filling history: {formatCount(status.daysStored)} of{" "}
            {formatCount(total)} days. You can keep using the page.
          </div>
        ) : status.segmentDaysMissing > 0 ? (
          <div className="text-base-content/60">
            Country and device data still to add for{" "}
            {formatCount(status.segmentDaysMissing)} days.
          </div>
        ) : status.missingDays > 0 ? (
          <div className="text-base-content/60">
            {formatCount(status.missingDays)} older days still to fetch.
          </div>
        ) : null}
        {status.lastError && !busy ? (
          <div className="flex items-start gap-1.5 text-error">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Last sync failed: {status.lastError}{" "}
              <Link
                to="/p/$projectId/settings/integrations"
                params={{ projectId }}
                className="link"
              >
                Integrations
              </Link>
            </span>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="btn btn-sm btn-ghost gap-1.5 self-start sm:self-center"
        onClick={sync.syncNow}
        disabled={busy}
      >
        <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
        Sync now
      </button>
    </div>
  );
}
