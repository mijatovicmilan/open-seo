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

const STATUS_CLASSES = {
  healthy: "badge-success",
  degraded: "badge-warning",
  attention: "badge-info",
  down: "badge-error",
  unknown: "badge-ghost",
} as const;

export function StatusBadge({
  prospect,
}: {
  prospect: Pick<OutreachProspect, "status" | "approval">;
}) {
  return (
    <span
      className={`badge badge-sm whitespace-nowrap ${STATUS_CLASSES[outreachStatusTone(prospect)]}`}
    >
      {outreachStatusLabel(prospect.status)}
    </span>
  );
}

const SCORE_CLASSES = {
  top: "badge-success",
  good: "badge-success badge-outline",
  warn: "badge-warning",
  low: "badge-error badge-outline",
  none: "badge-ghost",
} as const;

export function ScorePill({ prospect }: { prospect: OutreachProspect }) {
  const percent = outreachScorePercent(prospect.score);
  return (
    <span
      className={`badge badge-sm tabular-nums ${SCORE_CLASSES[outreachScoreTone(percent)]}`}
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

const ACTION_CLASSES = {
  accent: "badge-primary",
  good: "badge-success",
  warn: "badge-warning",
  info: "badge-info",
  neutral: "badge-ghost",
  muted: "badge-ghost opacity-60",
} as const;

export function ActionPill({ prospect }: { prospect: OutreachProspect }) {
  const { action } = prospect;
  return (
    <span
      className={`badge badge-sm whitespace-nowrap ${ACTION_CLASSES[action.tone]}`}
      title={
        action.who === "owner"
          ? "Your step"
          : action.who === "agent"
            ? "The agent's step"
            : undefined
      }
    >
      {action.label}
      {action.who === "agent" ? " · agent" : ""}
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
