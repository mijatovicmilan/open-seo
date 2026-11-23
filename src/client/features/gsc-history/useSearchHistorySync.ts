import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import type { HistoryStatus } from "@/client/features/gsc-history/types";
import { syncSearchHistory } from "@/serverFunctions/gscHistory";

// Each server call is one bounded run; the page keeps calling while history
// is missing, up to this many runs per visit.
const MAX_ROUNDS_PER_VISIT = 40;

/** Runs the history catch-up: once on open when the status asks for it,
 *  and on "Sync now". Each round is one bounded server run; rounds repeat
 *  while days are missing, so a long backfill never blocks the page. */
export function useSearchHistorySync(
  projectId: string,
  status: HistoryStatus | undefined,
) {
  const queryClient = useQueryClient();
  const rounds = useRef(0);
  const autoStarted = useRef(false);
  const [progress, setProgress] = useState<HistoryStatus | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["searchInsights", projectId] });

  const mutation = useMutation({
    mutationFn: () => syncSearchHistory({ data: { projectId } }),
    onSuccess: ({ result, status: next }) => {
      rounds.current++;
      setProgress(next);
      const more =
        result.status === "synced" &&
        result.remainingDays > 0 &&
        rounds.current < MAX_ROUNDS_PER_VISIT;
      // Show the first round's days at once, then refresh when done.
      if (rounds.current === 1 || !more) void refresh();
      if (more) {
        mutation.mutate();
        return;
      }
      setProgress(null);
      if (result.status === "failed") toast.error(result.error);
    },
    onError: (error) => {
      setProgress(null);
      void refresh();
      toast.error(getStandardErrorMessage(error, "Search Console sync failed"));
    },
  });

  // Once per visit: later status changes come from this hook's own runs.
  const { mutate } = mutation;
  useEffect(() => {
    if (!status?.needsSync || autoStarted.current) return;
    autoStarted.current = true;
    mutate();
  }, [status?.needsSync, mutate]);

  return {
    isSyncing: mutation.isPending,
    progress,
    syncNow: () => {
      rounds.current = 0;
      mutation.mutate();
    },
  };
}

export type SearchHistorySync = ReturnType<typeof useSearchHistorySync>;
