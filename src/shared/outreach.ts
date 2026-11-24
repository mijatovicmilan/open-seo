/* eslint-disable max-lines -- the client-safe outreach contract (fork), ported as one unit */
// Client-safe outreach contract (fork feature, see FORK-CHANGES.md): types,
// status buckets, list filters and sorting. Ported from the Weight Tracker
// operations dashboard. Domain rules live in
// src/server/features/outreach/outreachDomain.ts.

import { reverse, sort } from "remeda";

export type OutreachStatus =
  | "drafted"
  | "awaiting approval"
  | "approved"
  | "sent"
  | "follow-up sent"
  | "replied"
  | "linked"
  | "declined"
  | "no reply"
  | "dropped";

export type OutreachContact =
  | { kind: "email"; value: string; note?: string }
  | { kind: "form"; value: string; note?: string }
  | { kind: "none"; value: "" };

export type OutreachApprovalState =
  // Status is approved and the stored hash matches the current text.
  | "valid"
  // Status is approved but the text, subject, or recipient changed since.
  | "stale"
  // Status is approved but no stored hash exists for the row.
  | "missing";

export type OutreachHistoryEntry = {
  // The stored event type ("drafted", "enriched"); repeats are grouped by it.
  type: string;
  date: string | null;
  // The full timestamp, when the event has one.
  at?: string;
  label: string;
  detail?: string;
  // A background event (imported, enriched, scored), not an outreach step.
  background?: true;
  // Who acted: the owner in the dashboard or the agent through the CLI.
  actor?: "owner" | "agent";
};

export type OutreachMessageKind =
  | "first"
  | "follow-up"
  | "reply-in"
  | "reply-out";

// The one short next action shown as a pill in the Prospects table.
export type OutreachAction = {
  label: string;
  tone: "accent" | "good" | "warn" | "info" | "neutral" | "muted";
  // Whose step it is: the owner's (a button in the table), the agent's
  // (a muted pill), or nobody's (done or closed).
  who: "owner" | "agent" | null;
};

export type OutreachScoreKey =
  | "gain"
  | "strength"
  | "activity"
  | "reach"
  | "link";

export type OutreachScore = {
  // Null until all five components are set.
  total: number | null;
  band: "send first" | "later" | "do not send" | null;
  parts: Array<{
    key: OutreachScoreKey;
    label: string;
    max: number;
    value: number | null;
    reason: string;
  }>;
  // When the score was last set (ISO timestamp).
  scoredAt: string;
};

// Manual status moves allowed from the dashboard.
export type OutreachStatusMove = "drop" | "decline" | "reopen" | "keep";

export type OutreachProspect = {
  number: number;
  site: string;
  person: string;
  // Display name: "Site (Person)".
  prospect: string;
  contact: OutreachContact;
  theirPage: string;
  ourPage: string;
  gain: string;
  status: OutreachStatus;
  notes: string;
  droppedReason: string;
  // Why a closed prospect is closed, in a few words; empty while active.
  closedReason: string;
  linkUrl: string;
  rel: string;
  sentAt: string;
  followUpAt: string;
  replySummary: string;
  replyAt: string;
  // Date of the latest event or edit.
  lastActionAt: string;
  // The latest outreach step (draft, approval, send, reply, link, close): when
  // (ISO), what, and who. Background events never count; null before any step.
  lastAction: {
    at: string;
    label: string;
    actor: "owner" | "agent" | null;
  } | null;
  // When the prospect was added (ISO).
  createdAt: string;
  // What happens next, in a few words ("Review and approve", "Follow-up due").
  nextStep: string;
  // Why the owner should look now; null when nothing is due.
  attention:
    | "approval"
    | "reapprove"
    | "low-score"
    | "reply"
    | "follow-up"
    | "link-lost"
    | null;
  // Date of the latest link check, and whether a link found earlier is gone.
  linkCheckedAt: string;
  linkLost: boolean;
  action: OutreachAction;
  // The page of ours the email promotes (its first link to the project's site).
  ourPageUrl: string;
  score: OutreachScore | null;
  // Not yet sent and scored under the send-first threshold (7)...
  lowScore: boolean;
  // ...and the owner chose to keep it after its latest score change.
  scoreKept: boolean;
  statusMoves: OutreachStatusMove[];
  // Their site's host without www, the stored favicon's version, and measured
  // domain metrics (null until enriched).
  domain: string;
  // Their site's homepage, and the title of their article we want the link on.
  homepageUrl: string;
  theirPageTitle: string;
  // False while the title is only derived from the URL.
  theirPageTitleFromPage: boolean;
  // Why we write to them: an outreach_angles key (null until set), the note
  // the "other" angle requires.
  angle: string | null;
  angleNote: string | null;
  // When the stored favicon was fetched; empty if there is none. The images
  // are loaded separately (getOutreachFavicons), never inside this payload.
  faviconVersion: string;
  metrics: {
    authority: number | null;
    traffic: number | null;
    trafficLocation: string | null;
    referringDomains: number | null;
    measuredAt: string;
    source: string;
  } | null;
  // The outgoing message shown in the detail panel: the pending draft if one
  // exists, otherwise the last one sent.
  messageId: number | null;
  messageKind: OutreachMessageKind | null;
  messageSentAt: string;
  subject: string;
  // The full outgoing body, signature included, exactly as it will be sent.
  body: string;
  // sha256 of recipient, subject, and outgoing body.
  hash: string;
  problems: string[];
  canApprove: boolean;
  canUndo: boolean;
  approval: {
    state: OutreachApprovalState;
    approvedAt: string | null;
  } | null;
  // The pending email's place in the send schedule: when it is due (null
  // while not placed), whether the owner picked the day or took it out of
  // the queue, and why the scheduler last passed it over.
  schedule: {
    at: string | null;
    manual: boolean;
    note: string | null;
  } | null;
  history: OutreachHistoryEntry[];
};

export type OutreachCounts = {
  ready: number;
  approved: number;
  approvedStale: number;
  sent: number;
  replied: number;
  linked: number;
  declined: number;
};

// Sending pace against the daily and weekly limits, in the owner's time zone.
export type OutreachLimits = {
  timeZone: string;
  timeZoneLabel: string;
  // Local dates, YYYY-MM-DD; weeks start on Monday.
  today: string;
  sentToday: number;
  dailyMin: number;
  dailyMax: number;
  weekStart: string;
  sentWeek: number;
  weeklyMin: number;
  weeklyMax: number;
  // How many more may go now without breaking either limit.
  allowedNow: number;
};

// An outreach angle from the outreach_angles table. color is a dashboard tone.
export type OutreachAngle = {
  key: string;
  label: string;
  description: string;
  color: OutreachAngleColor;
  active: boolean;
  sortOrder: number;
};

export const OUTREACH_ANGLE_COLORS = [
  "red",
  "amber",
  "lime",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
  "gray",
] as const;
export type OutreachAngleColor = (typeof OUTREACH_ANGLE_COLORS)[number];

// Set aside when no angle is chosen yet; also the "other" key.
export const OUTREACH_ANGLE_OTHER = "other";

export type OutreachBreakdownRow = {
  label: string;
  prospects: number;
  sent: number;
  replied: number;
  linked: number;
};

export type OutreachAnalytics = {
  timeZoneLabel: string;
  // First emails and follow-ups per local day (14 days) and week (8 weeks).
  sentPerDay: Array<{ date: string; value: number }>;
  sentPerWeek: Array<{ date: string; value: number }>;
  contacted: number;
  replied: number;
  medianReplyHours: number | null;
  linksWon: number;
  linksLost: number;
  byOurPage: OutreachBreakdownRow[];
  byBand: OutreachBreakdownRow[];
  // Per angle, in the angles' sort order, then "No angle".
  byAngle: OutreachBreakdownRow[];
};

// The project's outreach identity and pacing, as the app shows and edits it.
// The SMTP password is never part of it, only whether one is saved.
export type OutreachSettingsView = {
  siteUrl: string;
  linkDomains: string[];
  senderName: string;
  senderEmail: string;
  signature: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPasswordSet: boolean;
  timeZone: string;
  dailyMin: number;
  dailyMax: number;
  weeklyMin: number;
  weeklyMax: number;
  followUpDays: number;
  schedulePaused: boolean;
  scheduleTimeZone: string;
  scheduleDays: number[];
  scheduleTime: string;
  scheduleWindowMinutes: number;
  schedulerCheckedAt: string | null;
  mailReady: boolean;
  // Why sending from the app is off, when it is.
  mailProblem: string | null;
};

export type OutreachSnapshot = {
  settings: OutreachSettingsView;
  counts: OutreachCounts;
  limits: OutreachLimits;
  analytics: OutreachAnalytics;
  angles: OutreachAngle[];
  prospects: OutreachProspect[];
  readAt: string;
};

export type OutreachFilter = "awaiting" | "active" | "closed" | "all";

export const OUTREACH_FILTERS: Array<{ value: OutreachFilter; label: string }> =
  [
    { value: "awaiting", label: "Review" },
    { value: "active", label: "Active" },
    { value: "closed", label: "Closed" },
    { value: "all", label: "All" },
  ];

// Closed: dropped, declined, no reply, or done (linked). Active is everything
// else, so Active + Closed = All. Review is the part of Active waiting for
// the owner's approval.
const OUTREACH_CLOSED_STATUSES: OutreachStatus[] = [
  "dropped",
  "declined",
  "no reply",
  "linked",
];

const FILTER_STATUSES = {
  ready: ["drafted", "awaiting approval"] as OutreachStatus[],
  sent: ["sent", "follow-up sent"] as OutreachStatus[],
};

function matchesOutreachFilter(
  prospect: Pick<OutreachProspect, "status" | "attention">,
  filter: OutreachFilter,
) {
  if (filter === "awaiting") {
    return (
      prospect.attention === "approval" || prospect.attention === "reapprove"
    );
  }
  if (filter === "all") return true;
  const closed = OUTREACH_CLOSED_STATUSES.includes(prospect.status);
  return filter === "closed" ? closed : !closed;
}

export function outreachFilterCounts(
  prospects: OutreachProspect[],
): Record<OutreachFilter, number> {
  const count = (filter: OutreachFilter) =>
    prospects.filter((prospect) => matchesOutreachFilter(prospect, filter))
      .length;
  return {
    awaiting: count("awaiting"),
    active: count("active"),
    closed: count("closed"),
    all: count("all"),
  };
}

export function filterOutreachProspects(
  prospects: OutreachProspect[],
  filter: OutreachFilter,
  query: string,
) {
  const needle = query.trim().toLowerCase();
  return prospects.filter(
    (prospect) =>
      matchesOutreachFilter(prospect, filter) &&
      (!needle ||
        [
          prospect.prospect,
          prospect.ourPage,
          prospect.contact.value,
          prospect.theirPage,
          prospect.notes,
          prospect.subject,
        ].some((value) => value.toLowerCase().includes(needle))),
  );
}

export function countOutreach(prospects: OutreachProspect[]): OutreachCounts {
  const count = (statuses: OutreachStatus[]) =>
    prospects.filter((prospect) => statuses.includes(prospect.status)).length;
  return {
    ready: count(FILTER_STATUSES.ready),
    approved: count(["approved"]),
    approvedStale: prospects.filter(
      (prospect) =>
        prospect.status === "approved" && prospect.approval?.state !== "valid",
    ).length,
    sent: count(FILTER_STATUSES.sent),
    replied: count(["replied"]),
    linked: count(["linked"]),
    declined: count(["declined"]),
  };
}

export const OUTREACH_STATUS_MOVE_LABELS: Record<OutreachStatusMove, string> = {
  drop: "Drop",
  decline: "Mark declined",
  reopen: "Reopen as drafted",
  keep: "Keep despite score",
};

// Short labels for status pills. Statuses stay separate (not merged).
const STATUS_LABELS: Record<OutreachStatus, string> = {
  drafted: "Draft",
  "awaiting approval": "Needs approval",
  approved: "Approved",
  sent: "Sent",
  "follow-up sent": "Followed up",
  replied: "Replied",
  linked: "Linked",
  declined: "Declined",
  "no reply": "No reply",
  dropped: "Dropped",
};

export function outreachStatusLabel(status: OutreachStatus) {
  return STATUS_LABELS[status];
}

// Visual tone for a status badge, reusing the dashboard health palette.
export function outreachStatusTone(
  prospect: Pick<OutreachProspect, "status" | "approval">,
): "healthy" | "degraded" | "attention" | "unknown" | "down" {
  switch (prospect.status) {
    case "approved":
      return prospect.approval?.state === "valid" ? "healthy" : "degraded";
    case "linked":
      return "healthy";
    case "replied":
    case "awaiting approval":
      return "attention";
    case "declined":
      return "down";
    default:
      return "unknown";
  }
}

export const OUTREACH_TAB_VALUES = [
  "overview",
  "prospects",
  "scheduled",
  "replies",
  "links",
  "settings",
] as const;
export type OutreachTab = (typeof OUTREACH_TAB_VALUES)[number];

export const OUTREACH_TABS: Array<{ value: OutreachTab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "prospects", label: "Prospects" },
  { value: "scheduled", label: "Scheduled" },
  { value: "replies", label: "Replies" },
  { value: "links", label: "Links" },
  { value: "settings", label: "Settings" },
];

const ATTENTION_ORDER: Record<
  NonNullable<OutreachProspect["attention"]>,
  number
> = {
  approval: 0,
  reapprove: 1,
  "low-score": 2,
  reply: 3,
  "link-lost": 4,
  "follow-up": 5,
};

export const OUTREACH_ATTENTION_LABELS: Record<
  NonNullable<OutreachProspect["attention"]>,
  string
> = {
  approval: "Awaiting approval",
  reapprove: "Changed after approval",
  "low-score": "Score fell below 7",
  reply: "New reply",
  "link-lost": "Link lost",
  "follow-up": "Follow-up due",
};

export function outreachAttention(prospects: OutreachProspect[]) {
  return sort(
    prospects.filter((prospect) => prospect.attention),
    (a, b) =>
      ATTENTION_ORDER[a.attention!] - ATTENTION_ORDER[b.attention!] ||
      a.number - b.number,
  );
}

export function outreachReplyQueue(prospects: OutreachProspect[]) {
  return sort(
    prospects.filter((prospect) => prospect.attention === "reply"),
    (a, b) =>
      (b.replyAt || "").localeCompare(a.replyAt || "") || a.number - b.number,
  );
}

export function outreachLinks(prospects: OutreachProspect[]) {
  return sort(
    prospects.filter((prospect) => prospect.status === "linked"),
    (a, b) =>
      b.lastActionAt.localeCompare(a.lastActionAt) || a.number - b.number,
  );
}

export type OutreachSortKey =
  // Score, then traffic, then authority (highest first), then newest.
  | "default"
  | "number"
  | "site"
  | "theirPage"
  | "ourPage"
  | "angle"
  | "score"
  | "authority"
  | "traffic"
  | "status"
  | "contact"
  | "lastAction"
  | "created";

const STATUS_ORDER: OutreachStatus[] = [
  "awaiting approval",
  "approved",
  "drafted",
  "replied",
  "sent",
  "follow-up sent",
  "linked",
  "no reply",
  "declined",
  "dropped",
];

// The Prospects default order: score, then organic traffic, then authority
// (highest first; unscored and unmeasured last), then the newest prospect.
function compareDefault(a: OutreachProspect, b: OutreachProspect) {
  const keys = [
    (p: OutreachProspect) => p.score?.total ?? -1,
    (p: OutreachProspect) => p.metrics?.traffic ?? -1,
    (p: OutreachProspect) => p.metrics?.authority ?? -1,
  ];
  for (const key of keys) {
    const difference = key(b) - key(a);
    if (difference) return difference;
  }
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.number - b.number;
}

export function sortOutreachProspects(
  prospects: OutreachProspect[],
  key: OutreachSortKey,
  direction: "asc" | "desc",
) {
  if (key === "default") return sort(prospects, compareDefault);
  const value = (prospect: OutreachProspect): string | number => {
    switch (key) {
      case "number":
        return prospect.number;
      case "site":
        return prospect.prospect.toLowerCase();
      case "theirPage":
        return prospect.theirPageTitle.toLowerCase();
      case "ourPage":
        return prospect.ourPage.toLowerCase();
      case "angle":
        // Prospects without an angle sort after every angle.
        return prospect.angle ?? "~";
      case "status":
        return STATUS_ORDER.indexOf(prospect.status);
      case "contact":
        return prospect.contact.kind;
      case "lastAction":
        return prospect.lastAction?.at ?? "";
      case "created":
        return prospect.createdAt;
      case "score":
        // Unscored prospects sort below every score.
        return prospect.score?.total ?? -1;
      case "authority":
        return prospect.metrics?.authority ?? -1;
      case "traffic":
        return prospect.metrics?.traffic ?? -1;
    }
  };
  const sign = direction === "asc" ? 1 : -1;
  return sort(prospects, (a, b) => {
    const left = value(a);
    const right = value(b);
    if (left < right) return -sign;
    if (left > right) return sign;
    // Ties follow Created in the same direction, then the number.
    if (a.createdAt !== b.createdAt)
      return a.createdAt < b.createdAt ? -sign : sign;
    return a.number - b.number;
  });
}

// The score as a percentage (total out of 10, times 10); null until complete.
export function outreachScorePercent(score: OutreachScore | null) {
  return score?.total === null || score?.total === undefined
    ? null
    : score.total * 10;
}

export function outreachReplaceProspect<
  T extends { prospects: OutreachProspect[] },
>(data: T, prospect: OutreachProspect): T & { counts: OutreachCounts } {
  const prospects = data.prospects.map((item) =>
    item.number === prospect.number ? prospect : item,
  );
  return { ...data, prospects, counts: countOutreach(prospects) };
}

// Color band for a score pill: 90 to 100% top, 80% good, 70% warn, under 70%
// low (the flagged band).
export function outreachScoreTone(
  percent: number | null,
): "top" | "good" | "warn" | "low" | "none" {
  if (percent === null) return "none";
  if (percent >= 90) return "top";
  if (percent >= 80) return "good";
  if (percent >= 70) return "warn";
  return "low";
}

export type OutreachSendChannel = "email" | "form";

// Why a send from the dashboard is refused right now, or null when it may go:
// a valid approval, the right contact kind, no held low score, and room in
// the daily and weekly limits.
export function outreachSendBlocker(
  prospect: OutreachProspect,
  limits: OutreachLimits,
  channel: OutreachSendChannel,
): string | null {
  if (prospect.status !== "approved" || !prospect.approval)
    return "Approve this email first.";
  if (prospect.approval.state !== "valid")
    return "The email changed after approval: approve it again.";
  if (prospect.contact.kind !== channel) {
    return channel === "email"
      ? "This prospect has a contact form, not an email address."
      : "This prospect has an email address.";
  }
  if (prospect.lowScore && !prospect.scoreKept)
    return "The score fell below the send-first line: keep or drop it first.";
  if (limits.allowedNow < 1) {
    return limits.sentToday >= limits.dailyMax
      ? `Today's limit is reached (${limits.sentToday} of ${limits.dailyMax}).`
      : `This week's limit is reached (${limits.sentWeek} of ${limits.weeklyMax}).`;
  }
  return null;
}

export type OutreachTimelineItem = {
  type: string;
  label: string;
  detail?: string;
  at: string;
  actor?: "owner" | "agent";
  background: boolean;
  // How many consecutive events of this kind the row stands for.
  count: number;
};

// History newest first, with consecutive events of the same kind on the same
// day merged into one row (four page reads in two minutes are one row, six
// drafts are "6 versions"). The latest event's detail is kept.
export function outreachTimeline(
  history: OutreachHistoryEntry[],
): OutreachTimelineItem[] {
  const items: OutreachTimelineItem[] = [];
  for (const entry of reverse(history)) {
    const at = entry.at ?? entry.date ?? "";
    const previous = items.at(-1);
    if (
      previous &&
      previous.type === entry.type &&
      previous.label === entry.label &&
      previous.actor === entry.actor &&
      previous.at.slice(0, 10) === at.slice(0, 10)
    ) {
      previous.count += 1;
      continue;
    }
    items.push({
      type: entry.type,
      label: entry.label,
      ...(entry.detail ? { detail: entry.detail } : {}),
      at,
      ...(entry.actor ? { actor: entry.actor } : {}),
      background: Boolean(entry.background),
      count: 1,
    });
  }
  return items;
}

// ---- Scheduled sending (fork feature) ----------------------------------------

export type OutreachScheduleItem = {
  number: number;
  prospect: string;
  domain: string;
  faviconVersion: string;
  subject: string;
  kind: OutreachMessageKind | null;
  /** When it is due (UTC ISO). */
  at: string;
  /** The owner picked the day. */
  manual: boolean;
};

export type OutreachScheduleWaiting = {
  number: number;
  prospect: string;
  domain: string;
  faviconVersion: string;
  subject: string;
  kind: OutreachMessageKind | null;
  /** Why it is not in the queue. */
  reason: string;
  /** The owner took it out of the queue (it can go back in). */
  held: boolean;
};

export type OutreachScheduleView = {
  paused: boolean;
  timeZone: string;
  days: number[];
  time: string;
  windowMinutes: number;
  /** The zone the daily and weekly limits count days in. */
  limitsTimeZone: string;
  dailyMax: number;
  weeklyMax: number;
  /** The scheduler's last run, and whether it is overdue (over 15 minutes). */
  checkedAt: string | null;
  stale: boolean;
  /** The next sending windows (UTC ISO). */
  nextSlots: Array<{ start: string; end: string; date: string }>;
  queue: OutreachScheduleItem[];
  waiting: OutreachScheduleWaiting[];
  /** The first window with emails in it. */
  nextSend: { at: string; count: number } | null;
  readAt: string;
};
