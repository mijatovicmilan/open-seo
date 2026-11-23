import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "cn";
import { Badge } from "@/client/components/ui/badge";
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
  down: "bg-destructive",
  unknown: "bg-muted-foreground/40",
} as const;

export function StatusBadge({
  prospect,
}: {
  prospect: Pick<OutreachProspect, "status" | "approval">;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          STATUS_DOTS[outreachStatusTone(prospect)],
        )}
        aria-hidden
      />
      {outreachStatusLabel(prospect.status)}
    </span>
  );
}

// The score's band as an upstream badge tone: good scores green, borderline
// amber, low red, unscored a quiet outline.
const SCORE_BADGE = {
  top: "success",
  good: "success",
  warn: "warning",
  low: "destructive",
  none: "outline",
} as const;

export function ScorePill({ prospect }: { prospect: OutreachProspect }) {
  const tone = outreachScoreTone(outreachScorePercent(prospect.score));
  return (
    <Badge
      variant={SCORE_BADGE[tone]}
      className={cn("tabular-nums", tone === "none" && "text-muted-foreground")}
      title={
        prospect.score
          ? `${prospect.score.total ?? "?"}/10, ${prospect.score.band ?? "incomplete"}`
          : "Not scored"
      }
    >
      {prospect.score?.total ?? "—"}
    </Badge>
  );
}

// The next step as text: the owner's steps in the primary colour, the
// agent's muted with an "Agent" prefix, finished ones faint.
export function ActionPill({ prospect }: { prospect: OutreachProspect }) {
  const { action } = prospect;
  if (action.who === "owner") {
    return (
      <span className="text-xs font-medium whitespace-nowrap text-primary">
        {action.label}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "text-xs whitespace-nowrap",
        action.who === "agent"
          ? "text-muted-foreground"
          : "text-muted-foreground/70",
      )}
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
    <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold text-muted-foreground uppercase">
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
