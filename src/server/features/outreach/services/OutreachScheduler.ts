/* eslint-disable max-lines -- the scheduler, its queue view and the owner's queue actions (fork feature) */
import { sort } from "remeda";
import {
  type MessageRow,
  type OutreachConfig,
  pendingMessage,
} from "@/server/features/outreach/outreachDomain";
import {
  dueState,
  planQueue,
  type ScheduleConfig,
  slotContaining,
  upcomingSlots,
} from "@/shared/outreachSchedule";
import { OutreachRepository } from "@/server/features/outreach/repositories/OutreachRepository";
import {
  OutreachError,
  OutreachService,
} from "@/server/features/outreach/services/OutreachService";
import type {
  OutreachProspect,
  OutreachScheduleItem,
  OutreachScheduleView,
  OutreachScheduleWaiting,
} from "@/shared/outreach";

// Scheduled sending for outreach (fork feature). Approved first emails and
// follow-ups go out by themselves on the project's sending days, inside the
// sending window, within the daily and weekly limits. The scheduler runs
// every five minutes (Cloudflare cron, or the Docker sidecar through the
// internal cron endpoint).
//
// Safety: nothing is sent unless the owner approved that exact email. Before
// each send everything is checked again: the approval hash, the prospect's
// status (declined, dropped and closed never get mail), an earlier send to
// the same address, the limits, and that the time is inside a window. The
// send itself is the app's ordinary send, which claims the email by writing
// its Message-ID first, so an email never goes twice, even after a restart.
// One email per project per run, so emails of one window leave minutes
// apart. A project lock keeps two runs from working one queue at once.

type ProjectRef = { id: string; domain: string | null };

const SCHEDULED_KINDS = new Set(["first", "follow-up"]);
const LOCK_MS = 4 * 60_000;
const STALE_MS = 15 * 60_000;
const VIA = "by the schedule";

function scheduleConfigOf(config: OutreachConfig): ScheduleConfig {
  return {
    timeZone: config.scheduleTimeZone,
    days: config.scheduleDays,
    time: config.scheduleTime,
    windowMinutes: config.scheduleWindowMinutes,
    limitsTimeZone: config.timeZone,
    dailyMax: config.dailyMax,
    weeklyMax: config.weeklyMax,
  };
}

/** "Tue Nov 24, 09:02 New York time". */
function slotText(at: string, timeZone: string) {
  const text = new Date(at).toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const city = timeZone.split("/").at(-1)?.replace(/_/gu, " ") ?? timeZone;
  return `${text} ${city} time`;
}

type Entry = {
  prospect: OutreachProspect;
  prospectId: string;
  message: MessageRow;
};

type Loaded = {
  config: OutreachConfig;
  schedule: ScheduleConfig;
  entries: Entry[];
  messages: MessageRow[];
  sentContacts: Map<string, number>;
};

async function loadQueue(project: ProjectRef): Promise<Loaded> {
  const config = await OutreachService.getConfig(project);
  const [loaded, snapshot] = await Promise.all([
    OutreachRepository.load(project.id),
    OutreachService.getSnapshot(project),
  ]);
  const byNumber = new Map(snapshot.prospects.map((p) => [p.number, p]));
  const entries: Entry[] = [];
  // Addresses already emailed, and by which prospect, for the duplicate check.
  const sentContacts = new Map<string, number>();
  for (const row of loaded.rows) {
    const messages = loaded.messages.filter((m) => m.prospectId === row.id);
    if (messages.some((m) => m.sentAt && SCHEDULED_KINDS.has(m.kind))) {
      sentContacts.set(row.contact.trim().toLowerCase(), row.number);
    }
    const pending = pendingMessage(messages);
    const prospect = byNumber.get(row.number);
    if (!pending || !prospect || !SCHEDULED_KINDS.has(pending.kind)) continue;
    entries.push({ prospect, prospectId: row.id, message: pending });
  }
  return {
    config,
    schedule: scheduleConfigOf(config),
    entries,
    messages: loaded.messages,
    sentContacts,
  };
}

/** Why an email cannot be in the queue, or null when it can. */
function blockedReason(entry: Entry, sentContacts: Map<string, number>) {
  const { prospect, message } = entry;
  if (prospect.status !== "approved" || !prospect.approval) {
    return "Not approved.";
  }
  if (prospect.approval.state !== "valid") {
    return "The email changed after approval: approve it again.";
  }
  if (prospect.contact.kind !== "email") {
    return "Contact form: send it by hand.";
  }
  if (prospect.lowScore && !prospect.scoreKept) {
    return "Low score: keep or drop it first.";
  }
  if (message.messageId) {
    return "A send was interrupted: check the mailbox's Sent folder.";
  }
  const earlier = sentContacts.get(prospect.contact.value.toLowerCase());
  if (message.kind === "first" && earlier && earlier !== prospect.number) {
    return `#${earlier} already emailed this address.`;
  }
  return null;
}

async function addEvent(
  project: ProjectRef,
  input: {
    prospectId: string;
    type: string;
    detail: string;
    actor: "owner" | "agent";
    at: string;
  },
) {
  await OutreachRepository.insertEvent(OutreachRepository.executor, {
    projectId: project.id,
    ...input,
  });
}

/** Brings the queue up to date: takes out what may no longer go, moves what
 *  missed its window, and places newly approved emails in the first window
 *  with room. Sends nothing. */
async function plan(project: ProjectRef, now = new Date().toISOString()) {
  const loaded = await loadQueue(project);
  const { schedule, config } = loaded;
  const fixed: Array<{ id: number; scheduledFor: string }> = [];
  const pending: Entry[] = [];
  for (const entry of loaded.entries) {
    const { message } = entry;
    const reason = blockedReason(entry, loaded.sentContacts);
    if (reason) {
      if (message.scheduledFor) {
        await OutreachRepository.setMessageSchedule(
          project.id,
          message.id,
          {
            scheduledFor: null,
            scheduleNote: reason,
          },
          { evenIfClaimed: true },
        );
        await addEvent(project, {
          prospectId: entry.prospectId,
          type: "unscheduled",
          detail: reason,
          actor: "agent",
          at: now,
        });
      } else if (
        message.scheduleNote !== reason &&
        entry.prospect.status === "approved"
      ) {
        await OutreachRepository.setMessageSchedule(
          project.id,
          message.id,
          {
            scheduledFor: null,
            scheduleNote: reason,
          },
          { evenIfClaimed: true },
        );
      }
      continue;
    }
    if (!message.scheduledFor) {
      // Taken out of the queue by the owner: stays out.
      if (message.scheduleManual !== 1) pending.push(entry);
      continue;
    }
    if (dueState(schedule, message.scheduledFor, now) === "missed") {
      // A future time outside the windows means the sending days or time
      // changed: it is simply placed again. A past one was missed.
      if (!config.schedulePaused && message.scheduledFor <= now) {
        await addEvent(project, {
          prospectId: entry.prospectId,
          type: "send skipped",
          detail: `Missed ${slotText(message.scheduledFor, schedule.timeZone)} (the scheduler did not run in time); moved to the next sending day.`,
          actor: "agent",
          at: now,
        });
      }
      pending.unshift(entry);
      continue;
    }
    fixed.push({ id: message.id, scheduledFor: message.scheduledFor });
  }
  const ordered = [
    ...pending.filter((entry) => entry.message.scheduledFor),
    ...sort(
      pending.filter((entry) => !entry.message.scheduledFor),
      (a, b) =>
        (a.message.approvedAt ?? "").localeCompare(
          b.message.approvedAt ?? "",
        ) || a.prospect.number - b.prospect.number,
    ),
  ];
  const planned = planQueue({
    config: schedule,
    now,
    sentAt: loaded.messages
      .filter((m) => m.sentAt && m.kind !== "reply-in")
      .map((m) => m.sentAt ?? now),
    fixed,
    pending: ordered.map((entry) => ({ id: entry.message.id })),
  });
  for (const entry of ordered) {
    const at = planned.get(entry.message.id);
    const set = await OutreachRepository.setMessageSchedule(
      project.id,
      entry.message.id,
      at
        ? { scheduledFor: at, scheduleManual: 0, scheduleNote: null }
        : {
            scheduledFor: null,
            scheduleManual: 0,
            scheduleNote: "No room under the limits in the next 8 weeks.",
          },
    );
    if (set && at) {
      await addEvent(project, {
        prospectId: entry.prospectId,
        type: "scheduled",
        detail: `For ${slotText(at, schedule.timeZone)}`,
        actor: "agent",
        at: now,
      });
    }
  }
}

/** Sends the earliest due email of a project, if any. A refusal or a failed
 *  send moves it to the next sending day with the reason in the history. */
async function sendDue(project: ProjectRef, now: string) {
  const loaded = await loadQueue(project);
  if (loaded.config.schedulePaused) return null;
  const due = sort(
    loaded.entries.filter(
      (entry) =>
        entry.message.scheduledFor &&
        dueState(loaded.schedule, entry.message.scheduledFor, now) === "due" &&
        !blockedReason(entry, loaded.sentContacts),
    ),
    (a, b) =>
      (a.message.scheduledFor ?? "").localeCompare(
        b.message.scheduledFor ?? "",
      ),
  )[0];
  if (!due) return null;
  try {
    await OutreachService.send(project, {
      number: due.prospect.number,
      channel: "email",
      via: VIA,
    });
    return due.prospect.number;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The send failed.";
    const slot = slotContaining(
      loaded.schedule,
      due.message.scheduledFor ?? now,
    );
    const next = upcomingSlots(loaded.schedule, slot?.end ?? now, 1)[0];
    await OutreachRepository.setMessageSchedule(project.id, due.message.id, {
      scheduledFor: next?.start ?? null,
      scheduleManual: 0,
      scheduleNote: reason,
    });
    await addEvent(project, {
      prospectId: due.prospectId,
      type: "send skipped",
      detail: next
        ? `${reason} Moved to ${slotText(next.start, loaded.schedule.timeZone)}.`
        : reason,
      actor: "agent",
      at: now,
    });
    if (!(error instanceof OutreachError))
      console.error("[outreach] scheduled send failed", error);
    return null;
  }
}

/** One scheduler run over every project with outreach settings. */
async function tick(now = new Date().toISOString()) {
  const projects = await OutreachRepository.listOutreachProjects();
  const sent: Array<{ projectId: string; number: number }> = [];
  for (const project of projects) {
    const until = new Date(Date.parse(now) + LOCK_MS).toISOString();
    if (!(await OutreachRepository.takeSchedulerLock(project.id, now, until))) {
      continue;
    }
    try {
      await plan(project, now);
      const number = await sendDue(project, now);
      if (number) sent.push({ projectId: project.id, number });
    } catch (error) {
      console.error("[outreach] scheduler run failed", project.id, error);
    } finally {
      await OutreachRepository.releaseSchedulerLock(project.id, until);
    }
  }
  return { projects: projects.length, sent };
}

async function view(
  project: ProjectRef,
  now = new Date().toISOString(),
): Promise<OutreachScheduleView> {
  const loaded = await loadQueue(project);
  const { config, schedule } = loaded;
  const queue: OutreachScheduleItem[] = [];
  const waiting: OutreachScheduleWaiting[] = [];
  for (const { prospect, message } of loaded.entries) {
    if (prospect.status !== "approved") continue;
    const base = {
      number: prospect.number,
      prospect: prospect.prospect,
      domain: prospect.domain,
      faviconVersion: prospect.faviconVersion,
      subject: message.subject,
      kind: message.kind,
    };
    if (message.scheduledFor) {
      queue.push({
        ...base,
        at: message.scheduledFor,
        manual: message.scheduleManual === 1,
      });
    } else {
      const held = message.scheduleManual === 1;
      waiting.push({
        ...base,
        held,
        reason:
          message.scheduleNote ??
          (held ? "Taken out of the queue." : "Placed at the next check."),
      });
    }
  }
  const ordered = sort(queue, (a, b) => a.at.localeCompare(b.at));
  const first = ordered[0];
  const firstSlot = first ? slotContaining(schedule, first.at) : null;
  const checkedAt = config.schedulerCheckedAt;
  return {
    paused: config.schedulePaused,
    timeZone: schedule.timeZone,
    days: schedule.days,
    time: schedule.time,
    windowMinutes: schedule.windowMinutes,
    limitsTimeZone: schedule.limitsTimeZone,
    dailyMax: schedule.dailyMax,
    weeklyMax: schedule.weeklyMax,
    checkedAt,
    stale: !checkedAt || Date.parse(now) - Date.parse(checkedAt) > STALE_MS,
    nextSlots: upcomingSlots(schedule, now, 5),
    queue: ordered,
    waiting,
    nextSend: first
      ? {
          at: first.at,
          count: firstSlot
            ? ordered.filter(
                (item) => item.at >= firstSlot.start && item.at < firstSlot.end,
              ).length
            : 1,
        }
      : null,
    readAt: now,
  };
}

async function findEntry(project: ProjectRef, number: number) {
  const loaded = await loadQueue(project);
  const entry = loaded.entries.find((item) => item.prospect.number === number);
  if (!entry) {
    throw new OutreachError(
      "NOT_FOUND",
      `#${number} has no approved email waiting.`,
    );
  }
  return { loaded, entry };
}

/** The owner (or an agent) picks the sending day of one approved email. */
async function reschedule(
  project: ProjectRef,
  input: { number: number; date: string; actor: "owner" | "agent" },
) {
  const now = new Date().toISOString();
  const { loaded, entry } = await findEntry(project, input.number);
  const reason = blockedReason(entry, loaded.sentContacts);
  if (reason) throw new OutreachError("FORBIDDEN", reason);
  const slot = upcomingSlots(loaded.schedule, now, 40).find(
    (item) => item.date === input.date,
  );
  if (!slot) {
    throw new OutreachError(
      "VALIDATION_ERROR",
      "Pick one of the next sending days.",
    );
  }
  const others = loaded.entries.filter(
    (item) => item.message.id !== entry.message.id && item.message.scheduledFor,
  );
  const planned = planQueue({
    config: loaded.schedule,
    now,
    sentAt: loaded.messages
      .filter((m) => m.sentAt && m.kind !== "reply-in")
      .map((m) => m.sentAt ?? now),
    fixed: others.map((item) => ({
      id: item.message.id,
      scheduledFor: item.message.scheduledFor ?? now,
    })),
    pending: [{ id: entry.message.id }],
    onlySlot: slot.start,
  }).get(entry.message.id);
  if (!planned) {
    throw new OutreachError(
      "CONFLICT",
      "That day is full (the window or the daily or weekly limit). Pick another.",
    );
  }
  await OutreachRepository.setMessageSchedule(project.id, entry.message.id, {
    scheduledFor: planned,
    scheduleManual: 1,
    scheduleNote: null,
  });
  await addEvent(project, {
    prospectId: entry.prospectId,
    type: "rescheduled",
    detail: `For ${slotText(planned, loaded.schedule.timeZone)}`,
    actor: input.actor,
    at: now,
  });
  return view(project);
}

/** Takes an email out of the queue (it stays approved), or puts it back. */
async function setQueued(
  project: ProjectRef,
  input: { number: number; queued: boolean; actor: "owner" | "agent" },
) {
  const now = new Date().toISOString();
  const { entry } = await findEntry(project, input.number);
  const done = await OutreachRepository.setMessageSchedule(
    project.id,
    entry.message.id,
    input.queued
      ? { scheduledFor: null, scheduleManual: 0, scheduleNote: null }
      : { scheduledFor: null, scheduleManual: 1, scheduleNote: null },
  );
  if (!done)
    throw new OutreachError("CONFLICT", "This email is already being sent.");
  await addEvent(project, {
    prospectId: entry.prospectId,
    type: input.queued ? "queued" : "unscheduled",
    detail: input.queued
      ? "Back in the send queue"
      : "Taken out of the send queue",
    actor: input.actor,
    at: now,
  });
  if (input.queued) await plan(project, now);
  return view(project);
}

/** Pauses or resumes every scheduled send of the project. */
async function setPaused(project: ProjectRef, paused: boolean) {
  await OutreachService.getConfig(project);
  await OutreachRepository.updateSettings(project.id, {
    schedulePaused: paused ? 1 : 0,
  });
  if (!paused) await plan(project);
  return view(project);
}

export const OutreachScheduler = {
  plan,
  tick,
  view,
  reschedule,
  setQueued,
  setPaused,
} as const;
