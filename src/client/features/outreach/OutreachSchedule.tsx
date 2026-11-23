/* eslint-disable max-lines -- the schedule strip, the Scheduled tab and its rows (fork feature) */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  Clock,
  Loader2,
  Pause,
  Play,
  Send,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ChoiceMenu } from "@/client/features/charts/ChoiceMenu";
import {
  Favicon,
  outreachQueryKey,
} from "@/client/features/outreach/outreachUi";
import {
  ago,
  bothTimes,
  clock,
  dateKey,
  dayLabel,
  ownZone,
  zoneCity,
} from "@/client/features/outreach/scheduleTime";
import {
  getOutreachSchedule,
  rescheduleOutreach,
  setOutreachPaused,
  setOutreachQueued,
} from "@/serverFunctions/outreach";
import type {
  OutreachScheduleItem,
  OutreachScheduleView,
} from "@/shared/outreach";

// Scheduled sending in the outreach screen (fork feature): the strip on the
// overview, and the Scheduled tab. Every time is shown twice: the owner's own
// (the browser's zone) and the recipients' (the schedule's zone).

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

// Under the snapshot's key, so every outreach change re-reads the schedule.
export const outreachScheduleKey = (projectId: string) =>
  ["outreach", projectId, "schedule"] as const;

function useOutreachSchedule(projectId: string) {
  return useQuery({
    queryKey: outreachScheduleKey(projectId),
    queryFn: () => getOutreachSchedule({ data: { projectId } }),
    refetchInterval: 60_000,
  });
}

function useScheduleAction<Vars>(
  projectId: string,
  run: (vars: Vars) => Promise<Result<OutreachScheduleView>>,
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
      queryClient.setQueryData(outreachScheduleKey(projectId), result.value);
      void queryClient.invalidateQueries({
        queryKey: outreachQueryKey(projectId),
      });
      if (success) toast.success(success);
    },
    onError: () => toast.error("Something went wrong. Nothing was changed."),
  });
}

/** Pause, or resume after a second click (resuming starts real sends). */
function PauseButton({
  projectId,
  view,
}: {
  projectId: string;
  view: OutreachScheduleView;
}) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 5000);
    return () => window.clearTimeout(timer);
  }, [confirming]);
  const action = useScheduleAction(projectId, (paused: boolean) =>
    setOutreachPaused({ data: { projectId, paused } }),
  );
  if (!view.paused) {
    return (
      <button
        type="button"
        className="btn btn-ghost btn-sm gap-1.5"
        disabled={action.isPending}
        onClick={() => action.mutate(true)}
      >
        <Pause className="size-4" /> Pause sending
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`btn btn-sm gap-1.5 ${confirming ? "btn-primary" : "btn-ghost"}`}
      disabled={action.isPending}
      title="Approved emails in the queue go out at their times."
      onClick={() => {
        if (!confirming) {
          setConfirming(true);
          return;
        }
        setConfirming(false);
        action.mutate(false);
      }}
    >
      <Play className="size-4" />
      {confirming
        ? `Confirm: send ${view.queue.length} queued`
        : "Resume sending"}
    </button>
  );
}

function StatusDot({ view }: { view: OutreachScheduleView }) {
  const tone = view.paused
    ? "bg-base-content/30"
    : view.stale
      ? "bg-warning"
      : "bg-success";
  return (
    <span className={`size-1.5 shrink-0 rounded-full ${tone}`} aria-hidden />
  );
}

function statusText(view: OutreachScheduleView) {
  if (view.paused) return "Sending paused";
  if (view.stale) return "Sending on, but the scheduler is late";
  return "Sending on";
}

function StaleWarning({ view }: { view: OutreachScheduleView }) {
  if (!view.stale) return null;
  return (
    <p className="flex items-start gap-2 text-xs text-warning">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>
        The scheduler last ran {ago(view.checkedAt)}. Nothing goes out until it
        runs again: is the Mac awake and Docker running?
      </span>
    </p>
  );
}

/** The overview's one-line summary: the next send and the switch. */
export function ScheduleStrip({
  projectId,
  onOpen,
}: {
  projectId: string;
  onOpen: () => void;
}) {
  const query = useOutreachSchedule(projectId);
  const view = query.data;
  if (!view) return null;
  return (
    <div className="space-y-2 rounded-lg border border-base-300 bg-base-100 px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          className="flex min-w-0 items-start gap-3 text-left"
          onClick={onOpen}
        >
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-base-content/50" />
          <span className="min-w-0 text-sm">
            {view.nextSend ? (
              <>
                <span className="text-base-content/60">Next send </span>
                <span className="font-medium">
                  {bothTimes(view.nextSend.at, view.timeZone)}
                </span>
                <span className="text-base-content/60">
                  {" "}
                  · {view.nextSend.count}{" "}
                  {view.nextSend.count === 1 ? "email" : "emails"}
                </span>
              </>
            ) : (
              <span className="text-base-content/60">
                Nothing scheduled. Approved emails join the queue by themselves.
              </span>
            )}
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-base-content/60">
              <StatusDot view={view} />
              {statusText(view)}
              {view.queue.length ? ` · ${view.queue.length} in the queue` : ""}
            </span>
          </span>
        </button>
        <span className="shrink-0 self-start sm:self-auto">
          <PauseButton projectId={projectId} view={view} />
        </span>
      </div>
      <StaleWarning view={view} />
    </div>
  );
}

function ScheduleRow({
  projectId,
  item,
  view,
  favicon,
  onProspect,
}: {
  projectId: string;
  item: OutreachScheduleItem;
  view: OutreachScheduleView;
  favicon: string | undefined;
  onProspect: (number: number) => void;
}) {
  const own = ownZone();
  const move = useScheduleAction(
    projectId,
    (date: string) =>
      rescheduleOutreach({ data: { projectId, number: item.number, date } }),
    `#${item.number} moved`,
  );
  const remove = useScheduleAction(
    projectId,
    () =>
      setOutreachQueued({
        data: { projectId, number: item.number, queued: false },
      }),
    `#${item.number} is out of the queue; it stays approved`,
  );
  const current = view.nextSlots.find(
    (slot) => item.at >= slot.start && item.at < slot.end,
  );
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex shrink-0 items-baseline gap-2 sm:w-40 sm:flex-col sm:gap-0">
        <span className="text-sm font-medium tabular-nums">
          {clock(item.at, own)} {zoneCity(own)}
        </span>
        {own === view.timeZone ? null : (
          <span className="text-xs tabular-nums text-base-content/55">
            {clock(item.at, view.timeZone)} {zoneCity(view.timeZone)}
          </span>
        )}
      </div>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={() => onProspect(item.number)}
      >
        <Favicon src={favicon} domain={item.domain} />
        <span className="min-w-0">
          <span className="block truncate text-sm">
            <span className="text-base-content/50">#{item.number}</span>{" "}
            {item.prospect}
            {item.kind === "follow-up" ? (
              <span className="ml-2 text-xs text-base-content/55">
                Follow-up
              </span>
            ) : null}
          </span>
          <span className="block truncate text-xs text-base-content/60">
            {item.subject}
            {item.manual ? " · day picked by hand" : ""}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        <ChoiceMenu
          label={`Move #${item.number} to another day`}
          value={current?.date ?? ""}
          options={view.nextSlots.map((slot) => ({
            value: slot.date,
            label: `${dayLabel(slot.start, own, new Date())} · ${clock(slot.start, own)}`,
            hint:
              own === view.timeZone
                ? undefined
                : `${clock(slot.start, view.timeZone)} ${zoneCity(view.timeZone)}`,
          }))}
          menuWidth="w-72"
          display={
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="size-3.5" /> Move
            </span>
          }
          onChange={(date) => {
            if (date !== current?.date) move.mutate(date);
          }}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm gap-1.5"
          title="Open the email; send it from there now"
          onClick={() => onProspect(item.number)}
        >
          <Send className="size-3.5" /> Send now
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-square text-base-content/60"
          aria-label={`Take #${item.number} out of the queue`}
          title="Take out of the queue (stays approved)"
          disabled={remove.isPending}
          onClick={() => remove.mutate(undefined)}
        >
          <X className="size-4" />
        </button>
      </div>
    </li>
  );
}

function WaitingRow({
  projectId,
  item,
  favicon,
  onProspect,
}: {
  projectId: string;
  item: OutreachScheduleView["waiting"][number];
  favicon: string | undefined;
  onProspect: (number: number) => void;
}) {
  const back = useScheduleAction(
    projectId,
    () =>
      setOutreachQueued({
        data: { projectId, number: item.number, queued: true },
      }),
    `#${item.number} is back in the queue`,
  );
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={() => onProspect(item.number)}
      >
        <Favicon src={favicon} domain={item.domain} />
        <span className="min-w-0">
          <span className="block truncate text-sm">
            <span className="text-base-content/50">#{item.number}</span>{" "}
            {item.prospect}
          </span>
          <span className="block truncate text-xs text-base-content/60">
            {item.reason}
          </span>
        </span>
      </button>
      {item.held ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm shrink-0 gap-1.5 self-start sm:self-auto"
          disabled={back.isPending}
          onClick={() => back.mutate(undefined)}
        >
          <Undo2 className="size-3.5" /> Back in the queue
        </button>
      ) : null}
    </li>
  );
}

export function ScheduledTab({
  projectId,
  favicons,
  onProspect,
  onSettings,
}: {
  projectId: string;
  favicons: Record<number, string>;
  onProspect: (number: number) => void;
  onSettings: () => void;
}) {
  const query = useOutreachSchedule(projectId);
  const view = query.data;
  if (!view) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-base-content/60">
        <Loader2 className="size-4 animate-spin" /> Loading the schedule…
      </div>
    );
  }
  const own = ownZone();
  const now = new Date();
  const days = new Map<string, OutreachScheduleItem[]>();
  for (const item of view.queue) {
    const key = dateKey(item.at, own);
    days.set(key, [...(days.get(key) ?? []), item]);
  }
  const dayNames = view.days
    .map((day) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day - 1])
    .join(", ");
  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-xl border border-base-300 bg-base-100 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <StatusDot view={view} />
              {statusText(view)}
            </div>
            <p className="text-sm text-base-content/70">
              {dayNames} at {view.time} {zoneCity(view.timeZone)}
              {view.nextSlots[0]
                ? ` (${clock(view.nextSlots[0].start, own)} ${zoneCity(own)})`
                : ""}
              , within{" "}
              {view.windowMinutes / 60 >= 1 && view.windowMinutes % 60 === 0
                ? `${view.windowMinutes / 60} h`
                : `${view.windowMinutes} min`}
              . At most {view.dailyMax} a day and {view.weeklyMax} a week.
            </p>
            <p className="flex items-center gap-1.5 text-xs text-base-content/55">
              <Clock className="size-3.5" /> Scheduler: last check{" "}
              {ago(view.checkedAt)}
              <button
                type="button"
                className="link link-hover ml-2 whitespace-nowrap"
                onClick={onSettings}
              >
                Schedule settings
              </button>
            </p>
          </div>
          <span className="shrink-0">
            <PauseButton projectId={projectId} view={view} />
          </span>
        </div>
        <StaleWarning view={view} />
      </div>

      {view.queue.length === 0 ? (
        <div className="rounded-xl border border-base-300 bg-base-100 px-4 py-10 text-center text-sm text-base-content/60">
          The queue is empty. An email you approve joins it by itself, on the
          next sending day with room.
        </div>
      ) : (
        [...days.entries()].map(([key, items]) => (
          <section
            key={key}
            className="overflow-hidden rounded-xl border border-base-300 bg-base-100"
          >
            <header className="flex items-baseline justify-between gap-2 border-b border-base-300 px-4 py-2.5">
              <h3 className="text-sm font-semibold">
                {dayLabel(items[0]?.at ?? "", own, now)}
              </h3>
              <span className="text-xs text-base-content/55">
                {items.length} {items.length === 1 ? "email" : "emails"}
              </span>
            </header>
            <ul className="divide-y divide-base-300">
              {items.map((item) => (
                <ScheduleRow
                  key={item.number}
                  projectId={projectId}
                  item={item}
                  view={view}
                  favicon={favicons[item.number]}
                  onProspect={onProspect}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {view.waiting.length ? (
        <section className="overflow-hidden rounded-xl border border-base-300 bg-base-100">
          <header className="border-b border-base-300 px-4 py-2.5">
            <h3 className="text-sm font-semibold">
              Approved, not in the queue
            </h3>
          </header>
          <ul className="divide-y divide-base-300">
            {view.waiting.map((item) => (
              <WaitingRow
                key={item.number}
                projectId={projectId}
                item={item}
                favicon={favicons[item.number]}
                onProspect={onProspect}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
