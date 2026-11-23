import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  type OutreachProspect,
  type OutreachSnapshot,
  outreachReplaceProspect,
  outreachScorePercent,
  outreachScoreTone,
  outreachStatusLabel,
  outreachStatusTone,
} from "@/shared/outreach";

// Shared pieces of the outreach screens (fork feature).

export const outreachQueryKey = (projectId: string) =>
  ["outreach", projectId] as const;
export const outreachFaviconsKey = (projectId: string) =>
  ["outreach-favicons", projectId] as const;

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

// Runs one prospect change: on success the returned prospect replaces the
// cached row at once and the snapshot is re-read for counts and limits; a
// refusal is shown as the server's reason.
export function useProspectMutation<Vars>(
  projectId: string,
  run: (vars: Vars) => Promise<Result<OutreachProspect>>,
  success?: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      queryClient.setQueryData<OutreachSnapshot>(
        outreachQueryKey(projectId),
        (data) => (data ? outreachReplaceProspect(data, result.value) : data),
      );
      if (success) toast.success(success);
      void queryClient.invalidateQueries({
        queryKey: outreachQueryKey(projectId),
      });
    },
    onError: () => toast.error("Something went wrong. Nothing was changed."),
  });
}

// Status reads as quiet text with a coloured dot; colour carries meaning only
// (green done, amber needs a decision, blue waiting, red closed against us).
const STATUS_DOTS = {
  healthy: "bg-success",
  degraded: "bg-warning",
  attention: "bg-info",
  down: "bg-error",
  unknown: "bg-base-content/30",
} as const;

export function StatusBadge({
  prospect,
}: {
  prospect: Pick<OutreachProspect, "status" | "approval">;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-base-content/70">
      <span
        className={`size-1.5 shrink-0 rounded-full ${STATUS_DOTS[outreachStatusTone(prospect)]}`}
        aria-hidden
      />
      {outreachStatusLabel(prospect.status)}
    </span>
  );
}

const SCORE_TEXT = {
  top: "text-success",
  good: "text-success",
  warn: "text-warning",
  low: "text-error",
  none: "text-base-content/50",
} as const;

export function ScorePill({ prospect }: { prospect: OutreachProspect }) {
  const percent = outreachScorePercent(prospect.score);
  return (
    <span
      className={`badge badge-sm border-0 bg-base-300 tabular-nums ${SCORE_TEXT[outreachScoreTone(percent)]}`}
      title={
        prospect.score
          ? `${prospect.score.total ?? "?"}/10, ${prospect.score.band ?? "incomplete"}`
          : "Not scored"
      }
    >
      {prospect.score?.total ?? "—"}
    </span>
  );
}

// The next step as text: the owner's steps in the primary colour, the
// agent's muted with an "Agent" prefix, finished ones faint.
export function ActionPill({ prospect }: { prospect: OutreachProspect }) {
  const { action } = prospect;
  if (action.who === "owner") {
    return (
      <span className="whitespace-nowrap text-xs font-medium text-primary">
        {action.label}
      </span>
    );
  }
  return (
    <span
      className={`whitespace-nowrap text-xs ${action.who === "agent" ? "text-base-content/60" : "text-base-content/40"}`}
    >
      {action.who === "agent" ? `Agent · ${action.label}` : action.label}
    </span>
  );
}

export function Favicon({
  src,
  domain,
}: {
  src: string | undefined;
  domain: string;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="size-4 shrink-0 rounded-sm"
        loading="lazy"
      />
    );
  }
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-base-300 text-[10px] font-semibold uppercase text-base-content/60">
      {domain.charAt(0) || "?"}
    </span>
  );
}

export function formatDateTime(iso: string) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatNumber(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : value.toLocaleString("en-US");
}
