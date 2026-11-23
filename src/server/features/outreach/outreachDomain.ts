/* eslint-disable max-lines -- the outreach domain rules (fork), ported as one unit from the Weight Tracker dashboard */
// Outreach domain rules (fork feature, see FORK-CHANGES.md): pure functions
// ported from the Weight Tracker operations dashboard (outreach-core.ts,
// outreach-score.ts, outreach-activity.ts). Every value that was written in
// for one site (domain, signature, sender, link check) now comes from the
// project's outreach settings. No I/O here.

import { createHash } from "node:crypto";
import { sort } from "remeda";
import type {
  OutreachAction,
  OutreachAnalytics,
  OutreachAngle,
  OutreachApprovalState,
  OutreachBreakdownRow,
  OutreachContact,
  OutreachHistoryEntry,
  OutreachLimits,
  OutreachMessageKind,
  OutreachProspect,
  OutreachScore,
  OutreachScoreKey,
  OutreachStatus,
  OutreachStatusMove,
} from "@/shared/outreach";

// ---- Settings ---------------------------------------------------------------

export type OutreachConfig = {
  siteUrl: string;
  linkDomains: string[];
  senderName: string;
  senderEmail: string;
  signature: string;
  smtpHost: string;
  smtpPort: number;
  mailEnvKey: string;
  timeZone: string;
  dailyMin: number;
  dailyMax: number;
  weeklyMin: number;
  weeklyMax: number;
  followUpDays: number;
};

export function parseLinkDomains(value: string) {
  return [
    ...new Set(
      value
        .split(/[\s,]+/u)
        .map((host) =>
          host
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//u, "")
            .replace(/\/.*$/u, "")
            .replace(/^www\./u, ""),
        )
        .filter(Boolean),
    ),
  ];
}

function hostMatches(host: string, domains: string[]) {
  const normalized = host.toLowerCase().replace(/^www\./u, "");
  return domains.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}

// ---- Rows -------------------------------------------------------------------

export type OutreachActor = "owner" | "agent";

export type ProspectRow = {
  id: string;
  number: number;
  site: string;
  person: string | null;
  contact: string;
  contactKind: "email" | "form";
  contactNote: string | null;
  theirPage: string;
  theirPageTitle: string | null;
  ourPage: string;
  gain: string | null;
  status: OutreachStatus;
  notes: string;
  droppedReason: string | null;
  linkUrl: string | null;
  linkRel: string | null;
  angleKey: string | null;
  angleNote: string | null;
  scoreGain: number | null;
  scoreGainReason: string | null;
  scoreActivity: number | null;
  scoreActivityReason: string | null;
  scoreReach: number | null;
  scoreReachReason: string | null;
  scoreLink: number | null;
  scoreLinkReason: string | null;
  scoredAt: string | null;
  faviconFetchedAt: string | null;
  metricAuthority: number | null;
  metricTraffic: number | null;
  metricTrafficLocation: string | null;
  metricReferringDomains: number | null;
  metricsMeasuredAt: string | null;
  metricsSource: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MessageRow = {
  id: number;
  prospectId: string;
  kind: OutreachMessageKind;
  subject: string;
  body: string;
  approvedHash: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  messageId: string | null;
  receivedAt: string | null;
  inReplyToId: number | null;
  createdAt: string;
};

export type EventRow = {
  id: number;
  prospectId: string;
  type: string;
  detail: string | null;
  actor: OutreachActor;
  at: string;
};

export type LinkCheckRow = {
  id: number;
  prospectId: string;
  checkedAt: string;
  found: number;
  url: string;
  href: string | null;
  rel: string | null;
  actor: OutreachActor;
  detail: string | null;
};

const OUTREACH_STATUSES: OutreachStatus[] = [
  "drafted",
  "awaiting approval",
  "approved",
  "sent",
  "follow-up sent",
  "replied",
  "linked",
  "declined",
  "no reply",
  "dropped",
];

// Stop rules: these prospects are never emailed again.
export const CLOSED_STATUSES: OutreachStatus[] = [
  "declined",
  "dropped",
  "linked",
  "no reply",
];
export const OUTGOING_KINDS: OutreachMessageKind[] = [
  "first",
  "follow-up",
  "reply-out",
];
export const LINK_RELS = ["follow", "nofollow", "ugc", "sponsored"] as const;
export type LinkRel = (typeof LINK_RELS)[number];

export function outreachDomain(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./u, "");
  } catch {
    return "";
  }
}

// ---- Score model ------------------------------------------------------------

type OutreachMetrics = {
  authority: number | null;
  traffic: number | null;
  trafficLocation: string | null;
  referringDomains: number | null;
  measuredAt: string;
  source: string;
};

// The one place for the score's weights, bands, and the site-strength rule.
// Recalibrate only with the owner, once results show which parts predict
// replies and links.
export const OUTREACH_SCORE_MODEL = {
  // Each part's maximum is its weight; the total is their sum (0 to 10).
  parts: [
    { key: "gain", label: "Gain for the author", max: 3 },
    { key: "strength", label: "Site strength", max: 3 },
    { key: "activity", label: "Activity", max: 1 },
    { key: "reach", label: "Reachability", max: 2 },
    { key: "link", label: "Link value", max: 1 },
  ] as Array<{ key: OutreachScoreKey; label: string; max: number }>,
  bands: { sendFirst: 7, later: 4 },
  strength: {
    levels: [
      { value: 3, authority: 40, traffic: 1_000 },
      { value: 2, authority: 30, traffic: 100 },
      { value: 1, authority: 30, traffic: 0 },
      { value: 1, authority: 15, traffic: 100 },
    ],
    weak: 0,
    unknown: 1,
  },
} as const;

export const OUTREACH_SCORE_PARTS = OUTREACH_SCORE_MODEL.parts;

export const OUTREACH_SCORE_RULES = {
  gain: "3 = a dead link or an outdated source at that spot; 2 = a sum readers do by hand, a static chart or table, or a recommended tool with no link, where ours fits; 1 = advice with no worked example, our guide adds one; 0 = no gain. A mistake in their own text is never the gain.",
  strength:
    "Derived from measured metrics: 3 = authority 40+ and 1,000+ organic visits a month; 2 = authority 30+ and 100+; 1 = authority 30+ under 100 visits, or authority 15 to 29 and 100+; else 0. 1 until measured.",
  activity:
    "1 = the page or the blog was updated within 12 months (page dates, newest sitemap entry); else 0.",
  reach:
    "2 = named person with a direct email; 1 = contact form or generic address; 0 = none.",
  link: "1 = an in-body editorial link is realistic; 0 = comment, forum or link list.",
  bands:
    "Send 7 and up first, 4 to 6 later, never under 4 or with gain 0 (drop with the reason).",
} as const;

export function outreachScoreBand(
  total: number,
  gain: number,
): OutreachScore["band"] {
  const { bands } = OUTREACH_SCORE_MODEL;
  if (gain === 0 || total < bands.later) return "do not send";
  return total >= bands.sendFirst ? "send first" : "later";
}

export function outreachBelowSendThreshold(total: number | null) {
  return total !== null && total < OUTREACH_SCORE_MODEL.bands.sendFirst;
}

export function outreachStrengthFromMetrics(metrics: OutreachMetrics | null) {
  const { strength } = OUTREACH_SCORE_MODEL;
  if (!metrics || (metrics.authority === null && metrics.traffic === null)) {
    return {
      value: strength.unknown,
      reason: "Unknown: no measured metrics yet.",
    };
  }
  const authority = metrics.authority ?? 0;
  const traffic = metrics.traffic ?? 0;
  const value =
    strength.levels.find(
      (level) => authority >= level.authority && traffic >= level.traffic,
    )?.value ?? strength.weak;
  const parts = [
    metrics.authority === null
      ? "authority unknown"
      : `authority ${metrics.authority}/100`,
    metrics.traffic === null
      ? "traffic unknown"
      : `about ${metrics.traffic.toLocaleString("en-US")} organic visits a month${metrics.trafficLocation ? ` (${metrics.trafficLocation})` : ""}`,
    ...(metrics.referringDomains === null
      ? []
      : [
          `${metrics.referringDomains.toLocaleString("en-US")} referring domains`,
        ]),
  ];
  const sentence = parts.join(", ");
  return {
    value,
    reason: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} (${metrics.source || "measured"}, ${metrics.measuredAt.slice(0, 10)}).`,
  };
}

export function rowMetrics(row: ProspectRow): OutreachMetrics | null {
  if (!row.metricsMeasuredAt) return null;
  return {
    authority: row.metricAuthority,
    traffic: row.metricTraffic,
    trafficLocation: row.metricTrafficLocation,
    referringDomains: row.metricReferringDomains,
    measuredAt: row.metricsMeasuredAt,
    source: row.metricsSource ?? "",
  };
}

const STORED_SCORE: Record<
  Exclude<OutreachScoreKey, "strength">,
  { value: keyof ProspectRow; reason: keyof ProspectRow }
> = {
  gain: { value: "scoreGain", reason: "scoreGainReason" },
  activity: { value: "scoreActivity", reason: "scoreActivityReason" },
  reach: { value: "scoreReach", reason: "scoreReachReason" },
  link: { value: "scoreLink", reason: "scoreLinkReason" },
};

// Site strength is never stored: it is derived from the stored metrics with
// the current rule, so a rule change re-scores every prospect at once.
export function buildScore(row: ProspectRow): OutreachScore | null {
  if (!row.scoredAt) return null;
  const strength = outreachStrengthFromMetrics(rowMetrics(row));
  const parts = OUTREACH_SCORE_PARTS.map((part) => {
    if (part.key === "strength") {
      return { ...part, value: strength.value, reason: strength.reason };
    }
    const columns = STORED_SCORE[part.key];
    const value = row[columns.value];
    const reason = row[columns.reason];
    return {
      ...part,
      value: typeof value === "number" ? value : null,
      reason: typeof reason === "string" ? reason : "",
    };
  });
  const complete = parts.every((part) => part.value !== null);
  const total = complete
    ? parts.reduce((sum, part) => sum + (part.value ?? 0), 0)
    : null;
  return {
    total,
    band:
      total === null ? null : outreachScoreBand(total, parts[0]?.value ?? 0),
    parts,
    scoredAt: row.scoredAt,
  };
}

// ---- Body, signature, hash --------------------------------------------------

export function signatureText(config: Pick<OutreachConfig, "signature">) {
  return config.signature
    .replace(/\\n/gu, "\n")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

// Closing lines dropped before the signature is appended: a "[Your name]"
// placeholder, a hand-typed copy of the signature, or the bare site address.
function placeholderClosers(config: OutreachConfig) {
  const host = outreachDomain(config.siteUrl);
  return new Set(
    [
      "[your name]",
      ...signatureText(config).split("\n"),
      host,
      host ? `https://${host}` : "",
      config.senderName,
    ]
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean),
  );
}

// The body as it is sent: hard wraps joined into paragraphs, a placeholder
// closer removed, and the signature right under a trailing comma sign-off
// (no blank line), otherwise after one blank line.
export function buildOutgoingBody(body: string, config: OutreachConfig) {
  const signature = signatureText(config);
  const closers = placeholderClosers(config);
  const lines = (signature ? body.replaceAll(signature, "") : body)
    .split(/\r?\n/u)
    .map((line) => line.trim());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines.at(-1)) lines.pop();
  while (lines.length && closers.has((lines.at(-1) ?? "").toLowerCase())) {
    lines.pop();
    while (lines.length && !lines.at(-1)) lines.pop();
  }

  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) paragraphs.push(current.join(""));
    current = [];
  };
  for (const line of lines) {
    if (!line) {
      flush();
      continue;
    }
    if (!current.length) current.push(line);
    else if (/^(?:[-*] |\d+[.)] )/u.test(line)) current.push(`\n${line}`);
    else current.push(` ${line}`);
  }
  flush();

  const text = paragraphs.join("\n\n");
  if (!text) return "";
  if (!signature) return text;
  return `${text}${text.endsWith(",") ? "\n" : "\n\n"}${signature}`;
}

export function outreachHash(input: {
  to: string;
  subject: string;
  body: string;
}) {
  return createHash("sha256")
    .update(`${input.to}\n${input.subject}\n\n${input.body}`, "utf8")
    .digest("hex");
}

// The page we promote, taken from the email itself so it matches what they get.
function outreachOurPageUrl(body: string, domains: string[]) {
  for (const [match] of body.matchAll(/https?:\/\/[^\s<>()"']+/gu)) {
    const url = match.replace(/[.,;:!?]+$/u, "");
    if (hostMatches(outreachDomain(url), domains)) return url;
  }
  return "";
}

// ---- Prospect view ----------------------------------------------------------

const PRE_SEND_STATUSES: OutreachStatus[] = [
  "drafted",
  "awaiting approval",
  "approved",
];
const SCORE_CHANGE_EVENTS = new Set(["scored", "rescored"]);
export const KEPT_EVENT = "kept below threshold";

function lowScoreState(
  status: OutreachStatus,
  score: OutreachScore | null,
  events: EventRow[],
) {
  const low =
    PRE_SEND_STATUSES.includes(status) &&
    outreachBelowSendThreshold(score?.total ?? null);
  if (!low) return { lowScore: false, scoreKept: false };
  const lastChange =
    events.filter((event) => SCORE_CHANGE_EVENTS.has(event.type)).at(-1)?.at ??
    "";
  const lastKept =
    events.filter((event) => event.type === KEPT_EVENT).at(-1)?.at ?? "";
  return {
    lowScore: true,
    scoreKept: Boolean(lastKept) && lastKept >= lastChange,
  };
}

function statusMoves(
  status: OutreachStatus,
  needsKeepDecision = false,
): OutreachStatusMove[] {
  const moves: OutreachStatusMove[] = [];
  if (needsKeepDecision) moves.push("keep");
  if (!["linked", "dropped"].includes(status)) moves.push("drop");
  if (!["linked", "declined", "dropped"].includes(status))
    moves.push("decline");
  if (["dropped", "declined", "no reply"].includes(status))
    moves.push("reopen");
  return moves;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Outreach steps the owner cares about. Everything else (added, imported,
// enriched, scored, link checks) is background: it never moves Last action.
const OUTREACH_STEP_EVENTS = new Set([
  "drafted",
  "edited",
  "approved",
  "approval undone",
  KEPT_EVENT,
  "sent",
  "follow-up sent",
  "reply sent",
  "replied",
  "bounced",
  "link found",
  "link lost",
  "declined",
  "dropped",
  "reopened",
  "status",
]);

const EVENT_LABELS: Record<string, string> = {
  edited: "Edited by owner",
  replied: "Reply",
  "reply sent": "Reply sent",
  status: "Status changed",
};

export function pendingMessage(messages: MessageRow[]) {
  return (
    messages
      .filter((m) => OUTGOING_KINDS.includes(m.kind) && !m.sentAt)
      .at(-1) ?? null
  );
}

export function previousStatusFromEvents(events: EventRow[]): OutreachStatus {
  const approved = events.filter((event) => event.type === "approved").at(-1);
  const previous = approved?.detail?.match(/^was (.+)$/u)?.[1];
  const match = OUTREACH_STATUSES.find((status) => status === previous);
  return match && match !== "approved" ? match : "awaiting approval";
}

const DAY = 86_400_000;

function daysSince(date: string, now: string) {
  return Math.floor((Date.parse(now) - Date.parse(date.slice(0, 10))) / DAY);
}

function addDays(date: string, days: number) {
  return new Date(Date.parse(date.slice(0, 10)) + days * DAY)
    .toISOString()
    .slice(0, 10);
}

function actionFor(input: {
  status: OutreachStatus;
  attention: OutreachProspect["attention"];
  approvalState: OutreachApprovalState | null;
  canApprove: boolean;
}): OutreachAction {
  const { status, attention, approvalState, canApprove } = input;
  if (["declined", "no reply", "dropped"].includes(status)) {
    return { label: "Closed", tone: "muted", who: null };
  }
  if (attention === "link-lost") {
    return { label: "Check link", tone: "warn", who: "agent" };
  }
  if (status === "linked") return { label: "Done", tone: "good", who: null };
  if (attention === "low-score") {
    return { label: "Decide", tone: "warn", who: "owner" };
  }
  if (status === "approved" && approvalState === "valid") {
    return { label: "Send", tone: "good", who: "owner" };
  }
  if (attention === "approval" || attention === "reapprove" || canApprove) {
    return { label: "Approve", tone: "accent", who: "owner" };
  }
  if (attention === "reply") {
    return { label: "Reply", tone: "info", who: "agent" };
  }
  if (attention === "follow-up") {
    return status === "follow-up sent"
      ? { label: "Close", tone: "warn", who: "agent" }
      : { label: "Follow up", tone: "warn", who: "agent" };
  }
  if (
    status === "sent" ||
    status === "follow-up sent" ||
    status === "replied"
  ) {
    return { label: "Wait for reply", tone: "neutral", who: "agent" };
  }
  return { label: "Draft", tone: "neutral", who: "agent" };
}

function nextStepFor(input: {
  status: OutreachStatus;
  approvalState: OutreachApprovalState | null;
  pending: MessageRow | null;
  sentAt: string | null;
  followUpAt: string | null;
  linkLost: boolean;
  needsKeepDecision: boolean;
  followUpDays: number;
  now: string;
}): { nextStep: string; attention: OutreachProspect["attention"] } {
  const { status, approvalState, pending, sentAt, followUpAt, now } = input;
  const wait = input.followUpDays;
  if (input.linkLost) {
    return { nextStep: "Link gone: check the page", attention: "link-lost" };
  }
  if (input.needsKeepDecision) {
    return {
      nextStep: `Score below ${OUTREACH_SCORE_MODEL.bands.sendFirst}: keep or drop`,
      attention: "low-score",
    };
  }
  if (status === "approved") {
    return approvalState === "valid"
      ? { nextStep: "Send", attention: null }
      : { nextStep: "Approve again", attention: "reapprove" };
  }
  if (status === "awaiting approval") {
    return pending
      ? { nextStep: "Review and approve", attention: "approval" }
      : { nextStep: "Agent: write the draft", attention: null };
  }
  if (status === "drafted") {
    return pending
      ? { nextStep: "Agent: request approval", attention: null }
      : { nextStep: "Agent: write the draft", attention: null };
  }
  if (status === "replied") {
    return pending
      ? { nextStep: "Review the reply draft", attention: "approval" }
      : { nextStep: "Answer the reply", attention: "reply" };
  }
  if (status === "sent") {
    if (pending) {
      return { nextStep: "Review the follow-up", attention: "approval" };
    }
    if (sentAt && daysSince(sentAt, now) >= wait) {
      return { nextStep: "Follow-up due", attention: "follow-up" };
    }
    return {
      nextStep: sentAt
        ? `Follow-up from ${addDays(sentAt, wait)}`
        : "Wait for a reply",
      attention: null,
    };
  }
  if (status === "follow-up sent") {
    if (followUpAt && daysSince(followUpAt, now) >= wait) {
      return { nextStep: "Close as no reply", attention: "follow-up" };
    }
    return {
      nextStep: followUpAt
        ? `Wait until ${addDays(followUpAt, wait)}`
        : "Wait for a reply",
      attention: null,
    };
  }
  if (status === "linked") {
    return { nextStep: "Recheck the link later", attention: null };
  }
  return { nextStep: "None", attention: null };
}

function outreachTitleFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname
      .split("/")
      .filter((part) => part && !/^\d+$/u.test(part))
      .at(-1);
    if (!segment) return parsed.hostname.replace(/^www\./u, "");
    const words = decodeURIComponent(segment)
      .replace(/\.[a-z]+$/iu, "")
      .replace(/[-_]+/gu, " ")
      .trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  } catch {
    return url;
  }
}

const day = (iso: string | null | undefined) => iso?.slice(0, 10) ?? "";

function contactOf(row: ProspectRow): OutreachContact {
  if (!row.contact) return { kind: "none", value: "" };
  return {
    kind: row.contactKind,
    value: row.contact,
    ...(row.contactNote ? { note: row.contactNote } : {}),
  };
}

function problemsFor(contact: OutreachContact, subject: string, body: string) {
  const problems: string[] = [];
  if (contact.kind === "none")
    problems.push("No email address or contact form.");
  if (!subject.trim()) problems.push("The draft has no subject line.");
  if (!body.trim()) problems.push("The draft has no email body.");
  if (/\[[^\]]+\]/u.test(body)) {
    problems.push("The body still contains a [placeholder].");
  }
  return problems;
}

function approvalStateFor(
  status: OutreachStatus,
  pending: MessageRow | null,
  hash: string,
): OutreachApprovalState | null {
  if (status !== "approved") return null;
  if (!pending?.approvedHash) return "missing";
  return pending.approvedHash === hash ? "valid" : "stale";
}

function closedReasonFor(row: ProspectRow, reply: MessageRow | undefined) {
  switch (row.status) {
    case "dropped":
      return row.droppedReason || "Dropped";
    case "declined":
      return reply?.body || "They declined";
    case "no reply":
      return "No reply after the follow-up";
    case "linked":
      return `Link live${row.linkRel ? ` (${row.linkRel})` : ""}`;
    default:
      return "";
  }
}

function homepageOf(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

// The latest outreach step; a prospect imported with its draft and no step
// since shows when that draft was written.
function lastStepFor(
  ordered: EventRow[],
  messages: MessageRow[],
): OutreachProspect["lastAction"] {
  const latestStep = ordered
    .filter((event) => OUTREACH_STEP_EVENTS.has(event.type))
    .at(-1);
  if (latestStep) {
    return {
      at: latestStep.at,
      label: EVENT_LABELS[latestStep.type] ?? capitalize(latestStep.type),
      actor: latestStep.actor,
    };
  }
  const firstDraft = messages.find((m) => OUTGOING_KINDS.includes(m.kind));
  return firstDraft
    ? { at: firstDraft.createdAt, label: "Drafted", actor: "agent" }
    : null;
}

function historyFrom(ordered: EventRow[]): OutreachHistoryEntry[] {
  return ordered.map((event) => ({
    date: day(event.at),
    at: event.at,
    label: EVENT_LABELS[event.type] ?? capitalize(event.type),
    ...(event.detail ? { detail: event.detail } : {}),
    actor: event.actor,
    ...(OUTREACH_STEP_EVENTS.has(event.type) ? {} : { background: true }),
  }));
}

// The pending draft, the message shown (pending, else the last sent), and
// the first send, latest follow-up and latest reply.
function messageView(messages: MessageRow[]) {
  const pending = pendingMessage(messages);
  const outgoingSent = messages.filter(
    (m) => OUTGOING_KINDS.includes(m.kind) && m.sentAt,
  );
  return {
    pending,
    shown: pending ?? outgoingSent.at(-1) ?? null,
    sent: outgoingSent.find((m) => m.kind === "first"),
    followUp: outgoingSent.filter((m) => m.kind === "follow-up").at(-1),
    reply: messages.filter((m) => m.kind === "reply-in").at(-1),
  };
}

// "Site (Person)"; some rows already carry the person in the site name.
function displayName(row: ProspectRow) {
  return row.person && !row.site.includes(`(${row.person}`)
    ? `${row.site} (${row.person})`
    : row.site;
}

// A later miss after an earlier find.
function linkLostFrom(linkChecks: LinkCheckRow[]) {
  const last = linkChecks.at(-1);
  return Boolean(
    last && !last.found && linkChecks.some((check) => check.found),
  );
}

// The signature carries the site address too; the promoted page is the
// first link to us above it.
function promotedPageUrl(body: string, config: OutreachConfig) {
  const signature = signatureText(config);
  return outreachOurPageUrl(
    signature ? body.replace(signature, "") : body,
    config.linkDomains,
  );
}

export function buildOutreachProspect(input: {
  row: ProspectRow;
  messages: MessageRow[];
  events: EventRow[];
  linkChecks: LinkCheckRow[];
  config: OutreachConfig;
  now?: string;
}): OutreachProspect {
  const { row, messages, events, linkChecks, config } = input;
  const now = input.now ?? new Date().toISOString();
  const contact = contactOf(row);
  const { pending, shown, sent, followUp, reply } = messageView(messages);
  const subject = shown?.subject ?? "";
  const body = shown?.body ?? "";
  const hash = outreachHash({ to: contact.value, subject, body });
  const problems = pending ? problemsFor(contact, subject, body) : [];
  const approvalState = approvalStateFor(row.status, pending, hash);

  const lastCheck = linkChecks.at(-1);
  const linkLost = linkLostFrom(linkChecks);
  const score = buildScore(row);
  const { lowScore, scoreKept } = lowScoreState(row.status, score, events);
  const needsKeepDecision = lowScore && !scoreKept;
  const { nextStep, attention } = nextStepFor({
    status: row.status,
    approvalState,
    pending,
    sentAt: sent?.sentAt ?? null,
    followUpAt: followUp?.sentAt ?? null,
    linkLost,
    needsKeepDecision,
    followUpDays: config.followUpDays,
    now,
  });
  const ordered = sort(
    events,
    (a, b) => a.at.localeCompare(b.at) || a.id - b.id,
  );
  const canApprove =
    Boolean(pending) &&
    problems.length === 0 &&
    !CLOSED_STATUSES.includes(row.status) &&
    approvalState !== "valid";

  return {
    number: row.number,
    site: row.site,
    person: row.person ?? "",
    prospect: displayName(row),
    contact,
    theirPage: row.theirPage,
    ourPage: row.ourPage,
    gain: row.gain ?? "",
    status: row.status,
    notes: row.notes,
    droppedReason: row.droppedReason ?? "",
    closedReason: closedReasonFor(row, reply),
    linkUrl: row.linkUrl ?? "",
    rel: row.linkRel ?? "",
    sentAt: day(sent?.sentAt),
    followUpAt: day(followUp?.sentAt),
    replySummary: reply?.body ?? "",
    replyAt: day(reply?.receivedAt ?? reply?.sentAt),
    linkCheckedAt: day(lastCheck?.checkedAt),
    linkLost,
    lastActionAt: day(ordered.at(-1)?.at ?? row.updatedAt),
    lastAction: lastStepFor(ordered, messages),
    createdAt: row.createdAt,
    nextStep,
    attention,
    action: actionFor({
      status: row.status,
      attention,
      approvalState,
      canApprove,
    }),
    ourPageUrl: promotedPageUrl(body, config),
    score,
    lowScore,
    scoreKept,
    domain: outreachDomain(row.theirPage),
    homepageUrl: homepageOf(row.theirPage),
    theirPageTitle: row.theirPageTitle || outreachTitleFromUrl(row.theirPage),
    theirPageTitleFromPage: Boolean(row.theirPageTitle),
    angle: row.angleKey,
    angleNote: row.angleNote,
    faviconVersion: row.faviconFetchedAt ?? "",
    metrics: rowMetrics(row),
    statusMoves: statusMoves(row.status, needsKeepDecision),
    messageId: shown?.id ?? null,
    messageKind: shown?.kind ?? null,
    messageSentAt: day(shown?.sentAt),
    subject,
    body,
    hash,
    problems,
    canApprove,
    canUndo: row.status === "approved",
    approval: approvalState
      ? { state: approvalState, approvedAt: day(pending?.approvedAt) || null }
      : null,
    history: historyFrom(ordered),
  };
}

// ---- Pacing -----------------------------------------------------------------

const SEND_KINDS = new Set(["first", "follow-up", "reply-out"]);
const PACED_KINDS = new Set(["first", "follow-up"]);

function outreachLocalDate(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY)
    .toISOString()
    .slice(0, 10);
}

function weekStart(date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftDate(date, -((weekday + 6) % 7));
}

function outreachTimeZoneLabel(timeZone: string) {
  let offset = "";
  try {
    offset =
      new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "shortOffset" })
        .formatToParts(new Date())
        .find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    offset = "";
  }
  const city = timeZone.split("/").at(-1)?.replace(/_/gu, " ") ?? timeZone;
  return `${city} time${offset ? ` (${offset})` : ""}`;
}

export function isValidTimeZone(timeZone: string) {
  try {
    const formatter = new Intl.DateTimeFormat("en", { timeZone });
    return Boolean(formatter.resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

export function outreachSendingLimits(
  messages: MessageRow[],
  config: OutreachConfig,
  now: string,
): OutreachLimits {
  const { timeZone } = config;
  const today = outreachLocalDate(now, timeZone);
  const start = weekStart(today);
  const sentDates = messages
    .filter((message) => SEND_KINDS.has(message.kind) && message.sentAt)
    .map((message) => outreachLocalDate(message.sentAt ?? now, timeZone));
  const sentToday = sentDates.filter((date) => date === today).length;
  const sentWeek = sentDates.filter(
    (date) => date >= start && date <= today,
  ).length;
  return {
    timeZone,
    timeZoneLabel: outreachTimeZoneLabel(timeZone),
    today,
    sentToday,
    dailyMin: config.dailyMin,
    dailyMax: config.dailyMax,
    weekStart: start,
    sentWeek,
    weeklyMin: config.weeklyMin,
    weeklyMax: config.weeklyMax,
    allowedNow: Math.min(
      Math.max(0, config.dailyMax - sentToday),
      Math.max(0, config.weeklyMax - sentWeek),
    ),
  };
}

// Split approved, unchanged emails into what may go now and what the daily or
// weekly limit holds back. Higher scores go first, then lower numbers.
export function planOutreachBatch(
  sendable: OutreachProspect[],
  limits: OutreachLimits,
) {
  const undecided = sendable.filter((p) => p.lowScore && !p.scoreKept);
  const ordered = sort(
    sendable.filter((p) => !(p.lowScore && !p.scoreKept)),
    (a, b) =>
      (b.score?.total ?? -1) - (a.score?.total ?? -1) || a.number - b.number,
  );
  const send = ordered.slice(0, limits.allowedNow);
  const held = ordered.slice(limits.allowedNow);
  const reason =
    held.length === 0
      ? null
      : limits.dailyMax - limits.sentToday <= limits.weeklyMax - limits.sentWeek
        ? `today's limit (${limits.sentToday} of ${limits.dailyMax} sent, ${limits.timeZoneLabel})`
        : `this week's limit (${limits.sentWeek} of ${limits.weeklyMax} sent since ${limits.weekStart})`;
  return { send, held, reason, undecided };
}

// ---- Link and page reading --------------------------------------------------

const REL_ORDER = ["sponsored", "ugc", "nofollow"] as const;

function attribute(tag: string, name: string) {
  const match = tag.match(
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "iu"),
  );
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

// Find a link to one of our hosts in their page's HTML. rel reports the most
// restrictive value found (sponsored, ugc, nofollow), else follow.
export function findLinkToUs(html: string, pageUrl: string, domains: string[]) {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/gu, "");
  for (const [tag] of withoutComments.matchAll(/<a\b[^>]*>/giu)) {
    const href = attribute(tag, "href");
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(href.replace(/&amp;/gu, "&"), pageUrl);
    } catch {
      continue;
    }
    if (!hostMatches(url.hostname, domains)) continue;
    const tokens = (attribute(tag, "rel") ?? "").toLowerCase().split(/\s+/u);
    const rel: LinkRel =
      REL_ORDER.find((value) => tokens.includes(value)) ?? "follow";
    return { found: true as const, href: url.toString(), rel };
  }
  return { found: false as const, href: null, rel: null };
}

// An article's own title from <title>, og:title, or the first <h1>, without a
// site-name part (judged against the domain, e.g. "| Example Blog").
function decodeTitle(raw: string) {
  return raw
    .replace(/<[^>]+>/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&#0?39;|&#8217;|&rsquo;/gu, "'")
    .replace(/&quot;|&#8220;|&#8221;/gu, '"')
    .replace(/&[a-z#0-9]+;/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function squash(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

export function outreachPageTitle(html: string, domain = "") {
  const site = squash(domain.replace(/^www\./u, "").replace(/\.[a-z.]+$/u, ""));
  const isSite = (part: string) => {
    const value = squash(part);
    return (
      Boolean(site) &&
      Boolean(value) &&
      (site.includes(value) || value.includes(site))
    );
  };
  const candidates = [
    html.match(/<title[^>]*>([^<]+)<\/title>/iu)?.[1],
    html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/iu,
    )?.[1],
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/iu,
    )?.[1],
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/iu)?.[1],
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const parts = decodeTitle(raw)
      .split(/\s+(?:\||–|—|·|::|-)\s+/u)
      .map((part) => part.trim())
      .filter(Boolean);
    const kept =
      parts.length > 1 ? parts.filter((part) => !isSite(part)) : parts;
    const title = (kept.length ? kept : parts)[0];
    if (title && !isSite(title)) return title.slice(0, 200);
  }
  return null;
}

// Icon candidates from a page's <link rel="... icon ..."> tags, best first,
// then /favicon.ico as a fallback.
export function findFaviconCandidates(html: string, pageUrl: string) {
  const ranked: Array<{ url: string; rank: number }> = [];
  for (const [tag] of html
    .replace(/<!--[\s\S]*?-->/gu, "")
    .matchAll(/<link\b[^>]*>/giu)) {
    const rel = (attribute(tag, "rel") ?? "").toLowerCase();
    if (!/\bicon\b/u.test(rel)) continue;
    const href = attribute(tag, "href");
    if (!href || href.startsWith("data:")) continue;
    try {
      const url = new URL(href.replace(/&amp;/gu, "&"), pageUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      ranked.push({
        url: url.toString(),
        rank: rel.includes("apple-touch") ? 2 : rel === "icon" ? 0 : 1,
      });
    } catch {
      // Ignore a malformed href.
    }
  }
  const fallback = new URL("/favicon.ico", pageUrl).toString();
  return [
    ...new Set([
      ...sort(ranked, (a, b) => a.rank - b.rank).map((item) => item.url),
      fallback,
    ]),
  ];
}

// ---- Analytics --------------------------------------------------------------

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = sort(values, (a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function breakdown(
  prospects: Array<OutreachProspect & { id: string }>,
  messages: MessageRow[],
  key: (prospect: OutreachProspect) => string,
  order?: string[],
): OutreachBreakdownRow[] {
  const groups = new Map<string, OutreachBreakdownRow>();
  for (const prospect of prospects) {
    if (prospect.status === "dropped") continue;
    const label = key(prospect);
    const row = groups.get(label) ?? {
      label,
      prospects: 0,
      sent: 0,
      replied: 0,
      linked: 0,
    };
    const own = messages.filter(
      (message) => message.prospectId === prospect.id,
    );
    row.prospects += 1;
    if (own.some((message) => message.kind === "first" && message.sentAt)) {
      row.sent += 1;
    }
    if (own.some((message) => message.kind === "reply-in")) row.replied += 1;
    if (prospect.status === "linked" || prospect.linkLost) row.linked += 1;
    groups.set(label, row);
  }
  const rows = [...groups.values()];
  return order
    ? sort(rows, (a, b) => order.indexOf(a.label) - order.indexOf(b.label))
    : sort(
        rows,
        (a, b) => b.prospects - a.prospects || a.label.localeCompare(b.label),
      );
}

const BAND_ORDER = ["Send first", "Later", "Do not send", "Not scored"];
const NO_ANGLE = "No angle";

export function outreachAnalytics(input: {
  prospects: Array<OutreachProspect & { id: string }>;
  messages: MessageRow[];
  linkChecks: LinkCheckRow[];
  angles: OutreachAngle[];
  timeZone: string;
  now: string;
}): OutreachAnalytics {
  const { prospects, messages, linkChecks, angles, timeZone, now } = input;
  const angleLabel = new Map(angles.map((angle) => [angle.key, angle.label]));
  const today = outreachLocalDate(now, timeZone);
  const paced = messages
    .filter((message) => PACED_KINDS.has(message.kind) && message.sentAt)
    .map((message) => outreachLocalDate(message.sentAt ?? now, timeZone));

  const days = Array.from({ length: 14 }, (_, index) =>
    shiftDate(today, index - 13),
  );
  const thisWeek = weekStart(today);
  const weeks = Array.from({ length: 8 }, (_, index) =>
    shiftDate(thisWeek, (index - 7) * 7),
  );

  const contacted = new Set(
    messages
      .filter((m) => m.kind === "first" && m.sentAt)
      .map((m) => m.prospectId),
  );
  const replies = messages.filter((m) => m.kind === "reply-in");
  const repliedProspects = new Set(
    replies.map((m) => m.prospectId).filter((p) => contacted.has(p)),
  );

  const replyHours = replies.flatMap((reply) => {
    const receivedAt = reply.receivedAt ?? reply.sentAt;
    if (!receivedAt) return [];
    const answered =
      messages.find((m) => m.id === reply.inReplyToId) ??
      messages
        .filter(
          (m) =>
            m.prospectId === reply.prospectId &&
            SEND_KINDS.has(m.kind) &&
            m.sentAt &&
            m.sentAt <= receivedAt,
        )
        .at(-1);
    if (!answered?.sentAt) return [];
    return [(Date.parse(receivedAt) - Date.parse(answered.sentAt)) / 3_600_000];
  });

  const everFound = new Set(
    linkChecks.filter((check) => check.found).map((check) => check.prospectId),
  );
  const won = prospects.filter(
    (p) => p.status === "linked" || everFound.has(p.id),
  );

  return {
    timeZoneLabel: outreachTimeZoneLabel(timeZone),
    sentPerDay: days.map((date) => ({
      date,
      value: paced.filter((d) => d === date).length,
    })),
    sentPerWeek: weeks.map((date) => ({
      date,
      value: paced.filter((d) => d >= date && d < shiftDate(date, 7)).length,
    })),
    contacted: contacted.size,
    replied: repliedProspects.size,
    medianReplyHours: median(replyHours),
    linksWon: won.length,
    linksLost: prospects.filter((p) => p.linkLost).length,
    byOurPage: breakdown(prospects, messages, (p) => p.ourPage || "Unknown"),
    byBand: breakdown(
      prospects,
      messages,
      (p) =>
        p.score?.band === "send first"
          ? "Send first"
          : p.score?.band === "later"
            ? "Later"
            : p.score?.band === "do not send"
              ? "Do not send"
              : "Not scored",
      BAND_ORDER,
    ),
    byAngle: breakdown(
      prospects,
      messages,
      (p) => (p.angle ? (angleLabel.get(p.angle) ?? p.angle) : NO_ANGLE),
      [...angles.map((angle) => angle.label), NO_ANGLE],
    ),
  };
}

// ---- Default angles (growth kit link-outreach skill) ------------------------

export const DEFAULT_OUTREACH_ANGLES: Array<
  Pick<OutreachAngle, "key" | "label" | "description" | "color">
> = [
  {
    key: "broken_link",
    label: "Broken link",
    description: "Their link is dead; we offer a working replacement.",
    color: "red",
  },
  {
    key: "outdated_source",
    label: "Outdated source",
    description:
      "A stat, range or rule they quote has since changed at its source; our page uses the current version.",
    color: "amber",
  },
  {
    key: "manual_math",
    label: "Manual math",
    description: "Their readers compute by hand; our tool does it for them.",
    color: "blue",
  },
  {
    key: "static_tool",
    label: "Static tool",
    description: "An image or table where a working tool helps their readers.",
    color: "teal",
  },
  {
    key: "missing_piece",
    label: "Missing piece",
    description: "A specific piece their readers miss that our page has.",
    color: "violet",
  },
  {
    key: "resource_list",
    label: "Resource list",
    description: "A maintained list of useful tools or sources on the topic.",
    color: "green",
  },
  {
    key: "other",
    label: "Other",
    description: "Anything else; needs a short note saying what the gain is.",
    color: "gray",
  },
];
