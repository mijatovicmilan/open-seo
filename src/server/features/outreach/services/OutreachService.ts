/* eslint-disable max-lines -- one service for the outreach feature (fork), ported as a unit from the Weight Tracker dashboard */
import { runBatch } from "@/db/runBatch";
import {
  buildOutgoingBody,
  buildOutreachProspect,
  buildScore,
  CLOSED_STATUSES,
  DEFAULT_OUTREACH_ANGLES,
  findFaviconCandidates,
  findLinkToUs,
  isValidTimeZone,
  KEPT_EVENT,
  type LinkRel,
  OUTGOING_KINDS,
  OUTREACH_SCORE_MODEL,
  OUTREACH_SCORE_PARTS,
  outreachAnalytics,
  outreachBelowSendThreshold,
  type OutreachActor,
  type OutreachConfig,
  outreachDomain,
  outreachHash,
  outreachPageTitle,
  outreachScoreBand,
  outreachSendingLimits,
  outreachStrengthFromMetrics,
  parseLinkDomains,
  pendingMessage,
  previousStatusFromEvents,
  rowMetrics,
  signatureText,
} from "@/server/features/outreach/outreachDomain";
import {
  buildOutreachMail,
  isLogTransport,
  mailProblem,
  outreachMessageId,
  sendOutreachMail,
  testMailConnection,
} from "@/server/features/outreach/mail";
import {
  fetchFavicon,
  fetchPageHtml,
} from "@/server/features/outreach/pageFetch";
import {
  type OutreachLoaded,
  OutreachRepository,
} from "@/server/features/outreach/repositories/OutreachRepository";
import { isScheduleTime, parseScheduleDays } from "@/shared/outreachSchedule";
import { encryptSecret, SecretKeyMissingError } from "@/server/lib/secretBox";
import { AppError } from "@/server/lib/errors";
import {
  countOutreach,
  OUTREACH_ANGLE_COLORS,
  OUTREACH_ANGLE_OTHER,
  type OutreachAngle,
  type OutreachMessageKind,
  outreachSendBlocker,
  type OutreachSendChannel,
  type OutreachSettingsView,
  type OutreachSnapshot,
  type OutreachStatus,
  type OutreachStatusMove,
} from "@/shared/outreach";

// Link outreach (fork feature, see FORK-CHANGES.md). Every caller (server
// function, MCP tool) comes through here. Authorization is NOT done here:
// the caller has already authorized `projectId`, and every query is scoped
// to it.
//
// Safety rules carried over from the growth kit and the Weight Tracker
// dashboard:
// - Only the owner approves, in the app, and the approval is the hash of the
//   exact recipient, subject and body; any change voids it.
// - Nothing is sent without a valid approval, within the daily and weekly
//   limits, and never twice (the send is claimed by writing its Message-ID
//   first). MCP has no send tool: an agent sends with the growth kit's mail
//   script after the owner's "šalji" and records the send here.
// - Declined, dropped, no-reply and linked prospects are never emailed again.

export class OutreachError extends AppError {
  constructor(
    code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "CONFLICT"
      | "VALIDATION_ERROR"
      | "UPSTREAM_UNAVAILABLE",
    message: string,
  ) {
    super(code, message);
    this.name = "OutreachError";
  }
}

type ProjectRef = { id: string; domain: string | null };

const nowIso = () => new Date().toISOString();
const clean = (value: string) => value.trim().replace(/\s+/gu, " ");

// ---- Settings ---------------------------------------------------------------

type SettingsRow = NonNullable<
  Awaited<ReturnType<typeof OutreachRepository.getSettings>>
>;

function configFrom(row: SettingsRow): OutreachConfig {
  return {
    siteUrl: row.siteUrl,
    linkDomains: parseLinkDomains(row.linkDomains),
    senderName: row.senderName,
    senderEmail: row.senderEmail,
    signature: row.signature,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpUser: row.smtpUser,
    smtpPasswordEncrypted: row.smtpPasswordEncrypted,
    timeZone: isValidTimeZone(row.timeZone) ? row.timeZone : "UTC",
    dailyMin: row.dailyMin,
    dailyMax: row.dailyMax,
    weeklyMin: row.weeklyMin,
    weeklyMax: row.weeklyMax,
    followUpDays: row.followUpDays,
    schedulePaused: row.schedulePaused === 1,
    scheduleTimeZone: isValidTimeZone(row.scheduleTimeZone)
      ? row.scheduleTimeZone
      : "America/New_York",
    scheduleDays: parseScheduleDays(row.scheduleDays),
    scheduleTime: isScheduleTime(row.scheduleTime) ? row.scheduleTime : "09:00",
    scheduleWindowMinutes: row.scheduleWindowMinutes,
    schedulerCheckedAt: row.schedulerCheckedAt,
  };
}

// The project's settings, created with defaults (and the growth kit's
// angles) the first time outreach is used.
async function getConfig(project: ProjectRef): Promise<OutreachConfig> {
  const existing = await OutreachRepository.getSettings(project.id);
  if (existing) return configFrom(existing);
  const domain = (project.domain ?? "").replace(/^www\./u, "");
  await OutreachRepository.createSettings(
    {
      projectId: project.id,
      siteUrl: domain ? `https://${domain}` : "",
      linkDomains: domain,
    },
    DEFAULT_OUTREACH_ANGLES.map((angle, index) => ({
      ...angle,
      id: crypto.randomUUID(),
      sortOrder: angle.key === OUTREACH_ANGLE_OTHER ? 900 : (index + 1) * 10,
    })),
  );
  const created = await OutreachRepository.getSettings(project.id);
  if (!created) throw new OutreachError("CONFLICT", "Settings were not saved.");
  return configFrom(created);
}

function settingsView(config: OutreachConfig): OutreachSettingsView {
  const { smtpPasswordEncrypted, ...visible } = config;
  const problem = mailProblem(config);
  return {
    ...visible,
    smtpPasswordSet: smtpPasswordEncrypted !== null,
    mailReady: problem === null,
    mailProblem: problem,
  };
}

async function getSettings(project: ProjectRef) {
  return settingsView(await getConfig(project));
}

type OutreachSettingsInput = {
  siteUrl: string;
  linkDomains: string;
  senderName: string;
  senderEmail: string;
  signature: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  timeZone: string;
  dailyMin: number;
  dailyMax: number;
  weeklyMin: number;
  weeklyMax: number;
  followUpDays: number;
  scheduleTimeZone: string;
  scheduleDays: number[];
  scheduleTime: string;
  scheduleWindowMinutes: number;
};

// `smtpPassword` replaces the saved password when given; it is stored
// encrypted and never returned.
async function updateSettings(
  project: ProjectRef,
  input: Partial<OutreachSettingsInput>,
  smtpPassword?: string,
) {
  await getConfig(project);
  for (const zone of [input.timeZone, input.scheduleTimeZone]) {
    if (zone !== undefined && !isValidTimeZone(zone)) {
      throw new OutreachError(
        "VALIDATION_ERROR",
        `Unknown time zone: ${zone}.`,
      );
    }
  }
  if (input.scheduleTime !== undefined && !isScheduleTime(input.scheduleTime)) {
    throw new OutreachError("VALIDATION_ERROR", "Use a time like 09:00.");
  }
  if (input.siteUrl) {
    if (!outreachDomain(input.siteUrl)) {
      throw new OutreachError("VALIDATION_ERROR", "The site URL is not valid.");
    }
  }
  const { scheduleDays, ...rest } = input;
  const values = {
    ...rest,
    ...(scheduleDays !== undefined
      ? { scheduleDays: parseScheduleDays(scheduleDays.join(" ")).join(" ") }
      : {}),
    ...(input.linkDomains !== undefined
      ? { linkDomains: parseLinkDomains(input.linkDomains).join(" ") }
      : {}),
    ...(input.signature !== undefined
      ? { signature: signatureText({ signature: input.signature }) }
      : {}),
    ...(smtpPassword
      ? { smtpPasswordEncrypted: await encryptSmtpPassword(smtpPassword) }
      : {}),
  };
  await OutreachRepository.updateSettings(project.id, values);
  return getSettings(project);
}

async function encryptSmtpPassword(password: string) {
  try {
    return await encryptSecret(password);
  } catch (error) {
    if (error instanceof SecretKeyMissingError) {
      throw new OutreachError(
        "VALIDATION_ERROR",
        "The server needs BETTER_AUTH_SECRET in .env to store the SMTP password encrypted.",
      );
    }
    throw error;
  }
}

// Log in to the SMTP server and out again; sends nothing.
async function testMail(project: ProjectRef) {
  const config = await getConfig(project);
  const problem = mailProblem(config);
  if (problem) throw new OutreachError("FORBIDDEN", problem);
  try {
    await testMailConnection(config);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new OutreachError(
      "UPSTREAM_UNAVAILABLE",
      `Mail login failed: ${reason}.`,
    );
  }
  if (isLogTransport()) {
    return "Log transport (OUTREACH_MAIL_TRANSPORT=log): no mail server is used and nothing is ever sent.";
  }
  return `Logged in to ${config.smtpHost} as ${config.smtpUser}; nothing was sent.`;
}

// ---- Reads ------------------------------------------------------------------

async function listAngles(projectId: string): Promise<OutreachAngle[]> {
  const rows = await OutreachRepository.listAngles(projectId);
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    description: row.description,
    color: OUTREACH_ANGLE_COLORS.find((color) => color === row.color) ?? "gray",
    active: row.active === 1,
    sortOrder: row.sortOrder,
  }));
}

function assemble(loaded: OutreachLoaded, config: OutreachConfig, now: string) {
  return loaded.rows.map((row) => ({
    id: row.id,
    ...buildOutreachProspect({
      row,
      messages: loaded.messages.filter((m) => m.prospectId === row.id),
      events: loaded.events.filter((e) => e.prospectId === row.id),
      linkChecks: loaded.linkChecks.filter((c) => c.prospectId === row.id),
      config,
      now,
    }),
  }));
}

function stripId<T extends { id: string }>(item: T): Omit<T, "id"> {
  const { id: _id, ...rest } = item;
  return rest;
}

async function getSnapshot(
  project: ProjectRef,
  now = nowIso(),
): Promise<OutreachSnapshot> {
  const config = await getConfig(project);
  const [loaded, angles] = await Promise.all([
    OutreachRepository.load(project.id),
    listAngles(project.id),
  ]);
  const withIds = assemble(loaded, config, now);
  const prospects = withIds.map(stripId);
  return {
    settings: settingsView(config),
    counts: countOutreach(prospects),
    limits: outreachSendingLimits(loaded.messages, config, now),
    analytics: outreachAnalytics({
      prospects: withIds,
      messages: loaded.messages,
      linkChecks: loaded.linkChecks,
      angles,
      timeZone: config.timeZone,
      now,
    }),
    angles,
    prospects,
    readAt: now,
  };
}

async function loadOne(project: ProjectRef, number: number, now = nowIso()) {
  const prospectId = await OutreachRepository.findProspectId(
    project.id,
    number,
  );
  if (!prospectId) {
    throw new OutreachError("NOT_FOUND", `Prospect #${number} was not found.`);
  }
  const config = await getConfig(project);
  const loaded = await OutreachRepository.load(project.id, prospectId);
  const [prospect] = assemble(loaded, config, now);
  const row = loaded.rows[0];
  if (!prospect || !row) {
    throw new OutreachError("NOT_FOUND", `Prospect #${number} was not found.`);
  }
  return { prospect, prospectId, loaded, row, config };
}

async function getProspect(project: ProjectRef, number: number) {
  return stripId((await loadOne(project, number)).prospect);
}

async function getFavicons(projectId: string) {
  const rows = await OutreachRepository.listFavicons(projectId);
  return Object.fromEntries(
    rows.flatMap((row) => (row.favicon ? [[row.number, row.favicon]] : [])),
  ) as Record<number, string>;
}

// ---- Owner actions ----------------------------------------------------------

function event(
  ids: { projectId: string; prospectId: string },
  type: string,
  detail: string | null,
  actor: OutreachActor,
  at: string,
) {
  return { ...ids, type, detail, actor, at };
}

// Approve the pending message exactly as the owner reviewed it.
async function approve(
  project: ProjectRef,
  input: { number: number; expectedHash: string },
) {
  const now = nowIso();
  const { prospect, prospectId, loaded } = await loadOne(project, input.number);
  if (prospect.hash !== input.expectedHash) {
    throw new OutreachError(
      "CONFLICT",
      "The email changed since this page loaded. Reload and review it again.",
    );
  }
  if (!prospect.canApprove) {
    throw new OutreachError(
      "FORBIDDEN",
      prospect.problems[0] ??
        `A ${prospect.status} prospect has no email to approve.`,
    );
  }
  const message = pendingMessage(loaded.messages);
  if (!message) {
    throw new OutreachError("FORBIDDEN", "There is no email to approve.");
  }
  const previous =
    prospect.status === "approved"
      ? previousStatusFromEvents(loaded.events)
      : prospect.status;
  // Guarded on the exact text so a concurrent edit is never approved.
  const approved = await OutreachRepository.guardedMessageUpdate(
    project.id,
    message,
    { approvedHash: prospect.hash, approvedAt: now },
    { unsent: true },
  );
  if (!approved) {
    throw new OutreachError(
      "CONFLICT",
      "The email changed while approving. Reload and try again.",
    );
  }
  await runBatch((tx) => [
    OutreachRepository.updateProspect(tx, project.id, prospectId, {
      status: "approved",
      updatedAt: now,
    }),
    OutreachRepository.insertEvent(
      tx,
      event(
        { projectId: project.id, prospectId: prospectId },
        "approved",
        `was ${previous}`,
        "owner",
        now,
      ),
    ),
  ]);
  return getProspect(project, input.number);
}

async function undoApproval(project: ProjectRef, number: number) {
  const now = nowIso();
  const { prospect, prospectId, loaded } = await loadOne(project, number);
  if (!prospect.canUndo) {
    throw new OutreachError(
      "FORBIDDEN",
      `A ${prospect.status} prospect has no approval to undo.`,
    );
  }
  const previous = previousStatusFromEvents(loaded.events);
  const message = pendingMessage(loaded.messages);
  const changed = await OutreachRepository.guardedProspectUpdate(
    project.id,
    prospectId,
    { status: previous, updatedAt: now },
    "approved",
  );
  if (!changed) {
    throw new OutreachError(
      "CONFLICT",
      "The prospect changed while undoing. Reload and try again.",
    );
  }
  await runBatch((tx) => [
    ...(message
      ? [
          OutreachRepository.updateUnsentMessage(tx, project.id, message.id, {
            approvedHash: null,
            approvedAt: null,
          }),
        ]
      : []),
    OutreachRepository.insertEvent(
      tx,
      event(
        { projectId: project.id, prospectId: prospectId },
        "approval undone",
        null,
        "owner",
        now,
      ),
    ),
  ]);
  return getProspect(project, number);
}

// The owner edits the pending email until it is sent. An approved email stays
// approved with the new text (the owner's edit counts as approval); the
// previous version is kept in the "edited" event.
async function editEmail(
  project: ProjectRef,
  input: {
    number: number;
    subject: string;
    body: string;
    expectedHash: string;
  },
) {
  const now = nowIso();
  const { prospect, prospectId, loaded, config } = await loadOne(
    project,
    input.number,
  );
  if (prospect.hash !== input.expectedHash) {
    throw new OutreachError(
      "CONFLICT",
      "The email changed since this page loaded. Reload and edit again.",
    );
  }
  const message = pendingMessage(loaded.messages);
  if (!message) {
    throw new OutreachError(
      "FORBIDDEN",
      "This email was sent; it can no longer be edited.",
    );
  }
  if (CLOSED_STATUSES.includes(prospect.status)) {
    throw new OutreachError(
      "FORBIDDEN",
      `Prospect #${input.number} is ${prospect.status}.`,
    );
  }
  const subject = input.subject.replace(/\s+/gu, " ").trim();
  if (!subject)
    throw new OutreachError("VALIDATION_ERROR", "The subject is empty.");
  const body = buildOutgoingBody(input.body, config);
  const signature = signatureText(config);
  if (!body.replace(signature, "").trim()) {
    throw new OutreachError("VALIDATION_ERROR", "The email is empty.");
  }
  if (subject === message.subject && body === message.body) {
    return stripId(prospect);
  }
  const keepApproved = prospect.status === "approved";
  const hash = outreachHash({ to: prospect.contact.value, subject, body });
  const changed = await OutreachRepository.guardedMessageUpdate(
    project.id,
    message,
    {
      subject,
      body,
      approvedHash: keepApproved ? hash : null,
      approvedAt: keepApproved ? now : null,
    },
    { unsent: true, unclaimed: true },
  );
  if (!changed) {
    throw new OutreachError(
      "CONFLICT",
      "The email changed or is being sent. Reload and try again.",
    );
  }
  await runBatch((tx) => [
    OutreachRepository.updateProspect(tx, project.id, prospectId, {
      updatedAt: now,
    }),
    OutreachRepository.insertEvent(
      tx,
      event(
        { projectId: project.id, prospectId: prospectId },
        "edited",
        `Subject: ${message.subject}\n\n${message.body}`,
        "owner",
        now,
      ),
    ),
  ]);
  return getProspect(project, input.number);
}

// Manual moves the owner may make: drop, decline, reopen, keep despite score.
// Sent, replied and linked are recorded only after real events.
async function moveStatus(
  project: ProjectRef,
  input: {
    number: number;
    move: OutreachStatusMove;
    reason?: string;
    actor?: OutreachActor;
  },
) {
  const now = nowIso();
  const actor = input.actor ?? "owner";
  const { prospect, prospectId, loaded } = await loadOne(project, input.number);
  if (!prospect.statusMoves.includes(input.move)) {
    throw new OutreachError(
      "FORBIDDEN",
      `A ${prospect.status} prospect cannot be moved that way.`,
    );
  }
  const reason = input.reason?.trim().replace(/\s+/gu, " ") ?? "";
  if (input.move === "drop" && !reason) {
    throw new OutreachError("VALIDATION_ERROR", "Dropping needs a reason.");
  }
  if (input.move === "keep") {
    await OutreachRepository.insertEvent(
      OutreachRepository.executor,
      event(
        { projectId: project.id, prospectId: prospectId },
        KEPT_EVENT,
        `score ${prospect.score?.total ?? "?"}/10${reason ? `: ${reason}` : ""}`,
        actor,
        now,
      ),
    );
    return getProspect(project, input.number);
  }
  const move = input.move;
  const next: Record<"drop" | "decline" | "reopen", OutreachStatus> = {
    drop: "dropped",
    decline: "declined",
    reopen: "drafted",
  };
  const changed = await OutreachRepository.guardedProspectUpdate(
    project.id,
    prospectId,
    {
      status: next[input.move],
      updatedAt: now,
      ...(input.move === "drop" ? { droppedReason: reason } : {}),
      ...(input.move === "reopen" ? { droppedReason: null } : {}),
    },
    prospect.status,
  );
  if (!changed) {
    throw new OutreachError(
      "CONFLICT",
      "The prospect changed meanwhile. Reload and try again.",
    );
  }
  const pending = pendingMessage(loaded.messages);
  await runBatch((tx) => [
    OutreachRepository.insertEvent(
      tx,
      event(
        { projectId: project.id, prospectId: prospectId },
        { drop: "dropped", decline: "declined", reopen: "reopened" }[move],
        reason || null,
        actor,
        now,
      ),
    ),
    // A closed prospect keeps no live approval.
    ...(pending && move !== "reopen"
      ? [
          OutreachRepository.updateUnsentMessage(tx, project.id, pending.id, {
            approvedHash: null,
            approvedAt: null,
          }),
        ]
      : []),
  ]);
  return getProspect(project, input.number);
}

// ---- Sending ----------------------------------------------------------------

async function loadForSend(
  project: ProjectRef,
  number: number,
  channel: OutreachSendChannel,
) {
  const now = nowIso();
  const one = await loadOne(project, number, now);
  const all = await OutreachRepository.load(project.id);
  const limits = outreachSendingLimits(all.messages, one.config, now);
  const blocker = outreachSendBlocker(stripId(one.prospect), limits, channel);
  if (blocker) throw new OutreachError("FORBIDDEN", blocker);
  const message = pendingMessage(one.loaded.messages);
  if (!message) {
    throw new OutreachError(
      "FORBIDDEN",
      "There is no email waiting to be sent.",
    );
  }
  if (message.messageId) {
    throw new OutreachError(
      "CONFLICT",
      "A send of this email is already in progress or was interrupted. Check the mailbox's Sent folder before trying again.",
    );
  }
  return { ...one, message, now };
}

async function markSent(
  project: ProjectRef,
  input: {
    prospectId: string;
    message: { id: number; kind: OutreachMessageKind; subject: string };
    approvedHash: string;
    messageId: string | null;
    actor: OutreachActor;
    now: string;
    /** Added to the history line ("by the schedule"). */
    via?: string;
  },
) {
  const { kind } = input.message;
  const status: OutreachStatus =
    kind === "follow-up"
      ? "follow-up sent"
      : kind === "reply-out"
        ? "replied"
        : "sent";
  const eventType =
    kind === "follow-up"
      ? "follow-up sent"
      : kind === "reply-out"
        ? "reply sent"
        : "sent";
  const marked = await OutreachRepository.markMessageSent(project.id, {
    id: input.message.id,
    sentAt: input.now,
    messageId: input.messageId,
    approvedHash: input.approvedHash,
  });
  if (!marked) {
    throw new OutreachError(
      "CONFLICT",
      "The send was not recorded: the email changed or was already recorded.",
    );
  }
  await runBatch((tx) => [
    OutreachRepository.updateProspect(tx, project.id, input.prospectId, {
      status,
      updatedAt: input.now,
    }),
    OutreachRepository.insertEvent(
      tx,
      event(
        { projectId: project.id, prospectId: input.prospectId },
        eventType,
        input.via
          ? `${input.message.subject} · ${input.via}`
          : input.message.subject,
        input.actor,
        input.now,
      ),
    ),
  ]);
}

// Send one approved email now from the app (owner), or record that the owner
// sent it through their contact form. A failed SMTP send gives the claim back
// and changes nothing.
async function send(
  project: ProjectRef,
  input: {
    number: number;
    channel: OutreachSendChannel;
    /** Set when the scheduler sends it (history says so). */
    via?: string;
  },
) {
  const { prospect, prospectId, loaded, message, config, now } =
    await loadForSend(project, input.number, input.channel);
  const base = {
    prospectId,
    message,
    approvedHash: prospect.hash,
    actor: "owner" as const,
    now,
    via: input.via,
  };
  if (input.channel === "form") {
    await markSent(project, { ...base, messageId: null });
    return getProspect(project, input.number);
  }
  const problem = mailProblem(config);
  if (problem) throw new OutreachError("FORBIDDEN", problem);
  const claim = outreachMessageId(config.senderEmail);
  const claimed = await OutreachRepository.guardedMessageUpdate(
    project.id,
    message,
    { messageId: claim },
    { unsent: true, unclaimed: true, approvedHash: prospect.hash },
  );
  if (!claimed) {
    throw new OutreachError(
      "CONFLICT",
      "This email is already being sent or changed. Reload and check.",
    );
  }
  const theirs =
    message.kind === "reply-out"
      ? loaded.messages
          .filter((m) => m.kind === "reply-in" && m.messageId)
          .at(-1)
      : undefined;
  try {
    const raw = buildOutreachMail({
      config,
      to: prospect.contact.value,
      subject: message.subject,
      body: message.body,
      messageId: claim,
      date: new Date(now),
      inReplyTo: theirs?.messageId ?? null,
    });
    await sendOutreachMail({ config, to: prospect.contact.value, raw });
  } catch (error) {
    await OutreachRepository.releaseClaim(project.id, message.id, claim);
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new OutreachError(
      "UPSTREAM_UNAVAILABLE",
      `Not sent: ${reason}. Nothing changed.`,
    );
  }
  try {
    await markSent(project, { ...base, messageId: claim });
  } catch {
    throw new OutreachError(
      "CONFLICT",
      `The email was sent (${claim}) but recording it failed. Do not send again; reload and check.`,
    );
  }
  return getProspect(project, input.number);
}

// An agent sent the approved email with the growth kit's mail script after
// the owner's "šalji" in chat; record it. Refused unless the approval is
// valid (so the recorded text is the approved text) and within the limits.
async function recordSend(
  project: ProjectRef,
  input: {
    number: number;
    messageId?: string | null;
    channel: OutreachSendChannel;
  },
) {
  const { prospect, prospectId, message, now } = await loadForSend(
    project,
    input.number,
    input.channel,
  );
  await markSent(project, {
    prospectId,
    message,
    approvedHash: prospect.hash,
    messageId: input.messageId?.trim() || null,
    actor: "agent",
    now,
  });
  return getProspect(project, input.number);
}

// ---- Agent actions ----------------------------------------------------------

async function addProspect(
  project: ProjectRef,
  input: {
    site: string;
    person?: string;
    contact?: string;
    contactKind: "email" | "form";
    contactNote?: string;
    theirPage: string;
    ourPage: string;
    gain?: string;
    notes?: string;
  },
) {
  const now = nowIso();
  await getConfig(project);
  const domain = outreachDomain(input.theirPage);
  if (!domain) {
    throw new OutreachError(
      "VALIDATION_ERROR",
      "Their page must be a full URL.",
    );
  }
  const duplicates = await OutreachRepository.findDuplicates(project.id, {
    domain,
    contact: input.contact?.trim() ?? "",
  });
  const sameSite = duplicates.filter(
    (row) =>
      outreachDomain(row.theirPage) === domain ||
      (input.contact &&
        row.contact.toLowerCase() === input.contact.toLowerCase()),
  );
  const closed = sameSite.find((row) =>
    ["declined", "dropped"].includes(row.status),
  );
  if (closed?.status === "declined") {
    throw new OutreachError(
      "CONFLICT",
      `#${closed.number} (${closed.site}) declined; this domain stays closed.`,
    );
  }
  const open = sameSite.find((row) => !CLOSED_STATUSES.includes(row.status));
  if (open) {
    throw new OutreachError(
      "CONFLICT",
      `Already tracked as #${open.number} (${open.site}, ${open.status}).`,
    );
  }
  const number = await OutreachRepository.nextNumber(project.id);
  const id = crypto.randomUUID();
  await runBatch((tx) => [
    OutreachRepository.insertProspect(tx, {
      id,
      projectId: project.id,
      number,
      site: input.site.trim(),
      person: input.person?.trim() || null,
      contact: input.contact?.trim() ?? "",
      contactKind: input.contactKind,
      contactNote: input.contactNote?.trim() || null,
      theirPage: input.theirPage.trim(),
      ourPage: input.ourPage.trim(),
      gain: input.gain?.trim() || null,
      status: "drafted",
      notes: input.notes?.trim() ?? "",
      createdAt: now,
      updatedAt: now,
    }),
    OutreachRepository.insertEvent(
      tx,
      event(
        { projectId: project.id, prospectId: id },
        "added",
        null,
        "agent",
        now,
      ),
    ),
  ]);
  return getProspect(project, number);
}

async function updateProspectDetails(
  project: ProjectRef,
  input: {
    number: number;
    site?: string;
    person?: string | null;
    contact?: string;
    contactKind?: "email" | "form";
    contactNote?: string | null;
    ourPage?: string;
    gain?: string | null;
    notes?: string;
  },
) {
  const now = nowIso();
  const { prospect, prospectId, loaded } = await loadOne(project, input.number);
  const contactChanged =
    input.contact !== undefined &&
    input.contact.trim() !== prospect.contact.value;
  const pending = pendingMessage(loaded.messages);
  await runBatch((tx) => [
    OutreachRepository.updateProspect(tx, project.id, prospectId, {
      ...(input.site !== undefined ? { site: input.site.trim() } : {}),
      ...(input.person !== undefined
        ? { person: input.person?.trim() || null }
        : {}),
      ...(input.contact !== undefined ? { contact: input.contact.trim() } : {}),
      ...(input.contactKind !== undefined
        ? { contactKind: input.contactKind }
        : {}),
      ...(input.contactNote !== undefined
        ? { contactNote: input.contactNote?.trim() || null }
        : {}),
      ...(input.ourPage !== undefined ? { ourPage: input.ourPage.trim() } : {}),
      ...(input.gain !== undefined ? { gain: input.gain?.trim() || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
      updatedAt: now,
    }),
    OutreachRepository.insertEvent(
      tx,
      event(
        { projectId: project.id, prospectId: prospectId },
        "details updated",
        null,
        "agent",
        now,
      ),
    ),
    // A new recipient voids the approval (it is part of the hash anyway).
    ...(contactChanged && pending
      ? [
          OutreachRepository.updateUnsentMessage(tx, project.id, pending.id, {
            approvedHash: null,
            approvedAt: null,
          }),
        ]
      : []),
  ]);
  return getProspect(project, input.number);
}

// Add or replace the pending outgoing draft. Replacing clears any approval;
// a first draft on a drafted prospect asks the owner for approval.
async function draftMessage(
  project: ProjectRef,
  input: {
    number: number;
    kind: OutreachMessageKind;
    subject: string;
    body: string;
    ourPage?: string;
  },
) {
  if (!OUTGOING_KINDS.includes(input.kind)) {
    throw new OutreachError(
      "VALIDATION_ERROR",
      `Drafts are ${OUTGOING_KINDS.join(", ")}.`,
    );
  }
  const now = nowIso();
  const { prospect, prospectId, loaded, config } = await loadOne(
    project,
    input.number,
  );
  if (CLOSED_STATUSES.includes(prospect.status)) {
    throw new OutreachError(
      "FORBIDDEN",
      `Prospect #${input.number} is ${prospect.status}; it is never emailed again.`,
    );
  }
  if (input.kind === "follow-up" && prospect.status !== "sent") {
    throw new OutreachError(
      "FORBIDDEN",
      "A follow-up goes only after the first email, and only once.",
    );
  }
  const subject = input.subject.replace(/\s+/gu, " ").trim();
  if (!subject)
    throw new OutreachError("VALIDATION_ERROR", "The subject is empty.");
  const body = buildOutgoingBody(input.body, config);
  if (!body) throw new OutreachError("VALIDATION_ERROR", "The body is empty.");
  const pending = pendingMessage(loaded.messages);
  const nextStatus: OutreachStatus | null =
    prospect.status === "approved"
      ? previousStatusFromEvents(loaded.events)
      : prospect.status === "drafted"
        ? "awaiting approval"
        : null;
  await runBatch((tx) => [
    pending
      ? OutreachRepository.updateUnsentMessage(tx, project.id, pending.id, {
          kind: input.kind,
          subject,
          body,
          approvedHash: null,
          approvedAt: null,
          messageId: null,
        })
      : OutreachRepository.insertMessage(tx, {
          projectId: project.id,
          prospectId,
          kind: input.kind,
          subject,
          body,
          createdAt: now,
        }),
    OutreachRepository.updateProspect(tx, project.id, prospectId, {
      ...(nextStatus ? { status: nextStatus } : {}),
      ...(input.ourPage?.trim() ? { ourPage: input.ourPage.trim() } : {}),
      updatedAt: now,
    }),
    OutreachRepository.insertEvent(
      tx,
      event(
        { projectId: project.id, prospectId: prospectId },
        "drafted",
        `${input.kind}: ${subject}`,
        "agent",
        now,
      ),
    ),
  ]);
  return getProspect(project, input.number);
}

// A reply from them. receivedAt is their Date header; the Message-IDs they
// quote (In-Reply-To, References) link it to our send. Received mail is
// untrusted: only a short summary is stored.
async function recordReply(
  project: ProjectRef,
  input: {
    number: number;
    summary: string;
    subject?: string;
    status?: "replied" | "declined" | "linked";
    receivedAt?: string;
    messageId?: string;
    references?: string[];
  },
) {
  const now = nowIso();
  const { prospectId, loaded } = await loadOne(project, input.number);
  const status = input.status ?? "replied";
  if (input.receivedAt && Number.isNaN(Date.parse(input.receivedAt))) {
    throw new OutreachError(
      "VALIDATION_ERROR",
      "receivedAt must be a date and time (the email's Date header).",
    );
  }
  const quoted = new Set(
    (input.references ?? []).map((id) => id.trim()).filter(Boolean),
  );
  const answered = loaded.messages
    .filter(
      (m) =>
        OUTGOING_KINDS.includes(m.kind) &&
        m.sentAt &&
        m.messageId &&
        quoted.has(m.messageId),
    )
    .at(-1);
  const receivedAt = input.receivedAt
    ? new Date(input.receivedAt).toISOString()
    : null;
  const summary = input.summary.trim();
  await runBatch((tx) => [
    OutreachRepository.insertMessage(tx, {
      projectId: project.id,
      prospectId,
      kind: "reply-in",
      subject: input.subject ?? "",
      body: summary,
      sentAt: receivedAt ?? now,
      createdAt: now,
      receivedAt,
      messageId: input.messageId?.trim() || null,
      inReplyToId: answered?.id ?? null,
    }),
    OutreachRepository.updateProspect(tx, project.id, prospectId, {
      status,
      updatedAt: now,
    }),
    OutreachRepository.insertEvent(
      tx,
      event(
        { projectId: project.id, prospectId: prospectId },
        "replied",
        summary,
        "agent",
        now,
      ),
    ),
    // Anyone who declines is never emailed again: void a pending approval.
    ...(status !== "replied"
      ? loaded.messages
          .filter((m) => OUTGOING_KINDS.includes(m.kind) && !m.sentAt)
          .map((m) =>
            OutreachRepository.updateUnsentMessage(tx, project.id, m.id, {
              approvedHash: null,
              approvedAt: null,
            }),
          )
      : []),
  ]);
  return getProspect(project, input.number);
}

async function recordBounce(
  project: ProjectRef,
  input: { number: number; kind: "hard" | "soft"; detail: string },
) {
  const now = nowIso();
  const { prospect, prospectId, loaded } = await loadOne(project, input.number);
  const detail = `${input.kind}: ${input.detail.trim().replace(/\s+/gu, " ")}`;
  await runBatch((tx) => [
    OutreachRepository.insertEvent(
      tx,
      event(
        { projectId: project.id, prospectId: prospectId },
        "bounced",
        detail,
        "agent",
        now,
      ),
    ),
    ...(input.kind === "hard" && prospect.status !== "dropped"
      ? [
          OutreachRepository.updateProspect(tx, project.id, prospectId, {
            status: "dropped",
            droppedReason: `bounced (${input.detail.trim()})`,
            updatedAt: now,
          }),
          ...loaded.messages
            .filter((m) => OUTGOING_KINDS.includes(m.kind) && !m.sentAt)
            .map((m) =>
              OutreachRepository.updateUnsentMessage(tx, project.id, m.id, {
                approvedHash: null,
                approvedAt: null,
              }),
            ),
        ]
      : []),
  ]);
  return getProspect(project, input.number);
}

// Record one check of their page for a link to us. The first found check sets
// linked; a later miss after a find raises "link lost".
async function recordLinkCheck(
  project: ProjectRef,
  input: {
    number: number;
    url: string;
    found: boolean;
    href?: string | null;
    rel?: LinkRel | null;
    detail?: string | null;
    actor: OutreachActor;
  },
) {
  const now = nowIso();
  const { prospect, prospectId, loaded, config } = await loadOne(
    project,
    input.number,
  );
  const everFound = loaded.linkChecks.some((check) => check.found);
  const rel = input.found ? (input.rel ?? "follow") : null;
  const firstFound = input.found && prospect.status !== "linked";
  const lost = !input.found && everFound;
  const missDetail =
    input.detail ??
    `no link to ${config.linkDomains.join(" or ") || "our site"} on the page`;
  await runBatch((tx) => [
    OutreachRepository.insertLinkCheck(tx, {
      projectId: project.id,
      prospectId,
      checkedAt: now,
      found: input.found ? 1 : 0,
      url: input.url,
      href: input.href ?? null,
      rel,
      actor: input.actor,
      detail: input.detail ?? null,
    }),
    ...(firstFound
      ? [
          OutreachRepository.updateProspect(tx, project.id, prospectId, {
            status: "linked",
            linkUrl: input.url,
            linkRel: rel,
            updatedAt: now,
          }),
          OutreachRepository.insertEvent(
            tx,
            event(
              { projectId: project.id, prospectId: prospectId },
              "link found",
              `${input.url} (${rel})`,
              input.actor,
              now,
            ),
          ),
        ]
      : [
          OutreachRepository.insertEvent(
            tx,
            event(
              { projectId: project.id, prospectId: prospectId },
              lost ? "link lost" : "link checked",
              input.found ? `still there (${rel})` : missDetail,
              input.actor,
              now,
            ),
          ),
        ]),
  ]);
  return {
    prospect: await getProspect(project, input.number),
    firstFound,
    lost,
  };
}

// Fetch their page (the recorded link URL, else the page we pitched) and
// look for a link to one of our hosts.
async function checkLink(
  project: ProjectRef,
  input: { number: number; url?: string; actor: OutreachActor },
) {
  const { prospect, config } = await loadOne(project, input.number);
  if (!config.linkDomains.length) {
    throw new OutreachError(
      "FORBIDDEN",
      "Set the link domains in outreach settings first.",
    );
  }
  const url = input.url?.trim() || prospect.linkUrl || prospect.theirPage;
  const page = await fetchPageHtml(url);
  if ("error" in page) {
    // Unreadable is not "no link": record nothing that could flip a status.
    throw new OutreachError(
      "UPSTREAM_UNAVAILABLE",
      `Could not read ${url}: ${page.error}.`,
    );
  }
  const found = findLinkToUs(page.html, page.url, config.linkDomains);
  return recordLinkCheck(project, {
    number: input.number,
    url,
    found: found.found,
    href: found.href,
    rel: found.rel,
    actor: input.actor,
  });
}

async function setStatus(
  project: ProjectRef,
  input: {
    number: number;
    status: OutreachStatus;
    note?: string;
    linkUrl?: string;
    rel?: LinkRel;
    droppedReason?: string;
  },
) {
  if (input.status === "approved") {
    throw new OutreachError(
      "FORBIDDEN",
      "Only the owner's Approve button sets approved.",
    );
  }
  if (["sent", "follow-up sent"].includes(input.status)) {
    throw new OutreachError(
      "FORBIDDEN",
      "Record a send with record_outreach_send, which checks the approval.",
    );
  }
  const now = nowIso();
  const { prospectId, loaded } = await loadOne(project, input.number);
  await runBatch((tx) => [
    OutreachRepository.updateProspect(tx, project.id, prospectId, {
      status: input.status,
      updatedAt: now,
      ...(input.linkUrl ? { linkUrl: input.linkUrl } : {}),
      ...(input.rel ? { linkRel: input.rel } : {}),
      ...(input.droppedReason ? { droppedReason: input.droppedReason } : {}),
    }),
    OutreachRepository.insertEvent(
      tx,
      event(
        { projectId: project.id, prospectId: prospectId },
        "status",
        [input.status, input.note, input.linkUrl].filter(Boolean).join(": "),
        "agent",
        now,
      ),
    ),
    ...(CLOSED_STATUSES.includes(input.status)
      ? loaded.messages
          .filter((m) => OUTGOING_KINDS.includes(m.kind) && !m.sentAt)
          .map((m) =>
            OutreachRepository.updateUnsentMessage(tx, project.id, m.id, {
              approvedHash: null,
              approvedAt: null,
            }),
          )
      : []),
  ]);
  return getProspect(project, input.number);
}

async function score(
  project: ProjectRef,
  input: {
    number: number;
    values: { gain: number; activity: number; reach: number; link: number };
    reasons: { gain: string; activity: string; reach: string; link: string };
  },
) {
  for (const part of OUTREACH_SCORE_PARTS) {
    if (part.key === "strength") continue;
    const value = input.values[part.key];
    if (!Number.isInteger(value) || value < 0 || value > part.max) {
      throw new OutreachError(
        "VALIDATION_ERROR",
        `${part.label} is a whole number from 0 to ${part.max}.`,
      );
    }
    if (!input.reasons[part.key]?.trim()) {
      throw new OutreachError(
        "VALIDATION_ERROR",
        `${part.label} needs a one-line reason.`,
      );
    }
  }
  const now = nowIso();
  const { prospectId, row } = await loadOne(project, input.number);
  const strength = outreachStrengthFromMetrics(rowMetrics(row));
  const total =
    input.values.gain +
    input.values.activity +
    input.values.reach +
    input.values.link +
    strength.value;
  await runBatch((tx) => [
    OutreachRepository.updateProspect(tx, project.id, prospectId, {
      scoreGain: input.values.gain,
      scoreGainReason: clean(input.reasons.gain),
      scoreActivity: input.values.activity,
      scoreActivityReason: clean(input.reasons.activity),
      scoreReach: input.values.reach,
      scoreReachReason: clean(input.reasons.reach),
      scoreLink: input.values.link,
      scoreLinkReason: clean(input.reasons.link),
      scoredAt: now,
      updatedAt: now,
    }),
    OutreachRepository.insertEvent(
      tx,
      event(
        { projectId: project.id, prospectId: prospectId },
        "scored",
        `${total}/10, ${outreachScoreBand(total, input.values.gain)}`,
        "agent",
        now,
      ),
    ),
  ]);
  return getProspect(project, input.number);
}

async function setAngle(
  project: ProjectRef,
  input: { number: number; angle: string; note?: string | null },
) {
  const now = nowIso();
  const { prospectId } = await loadOne(project, input.number);
  const angles = await OutreachRepository.listAngles(project.id);
  const angle = angles.find((item) => item.key === input.angle);
  if (!angle) {
    throw new OutreachError(
      "VALIDATION_ERROR",
      `Unknown angle ${input.angle}. Known: ${angles.map((a) => a.key).join(", ")}.`,
    );
  }
  if (angle.active !== 1) {
    throw new OutreachError(
      "VALIDATION_ERROR",
      `The angle ${angle.key} is retired.`,
    );
  }
  const note = input.note?.trim().replace(/\s+/gu, " ") || null;
  if (angle.key === OUTREACH_ANGLE_OTHER && !note) {
    throw new OutreachError(
      "VALIDATION_ERROR",
      "The other angle needs a note saying what the gain is.",
    );
  }
  await runBatch((tx) => [
    OutreachRepository.updateProspect(tx, project.id, prospectId, {
      angleId: angle.id,
      angleNote: note,
      updatedAt: now,
    }),
    OutreachRepository.insertEvent(
      tx,
      event(
        { projectId: project.id, prospectId: prospectId },
        "angle set",
        `${angle.label}${note ? `: ${note}` : ""}`,
        "agent",
        now,
      ),
    ),
  ]);
  return getProspect(project, input.number);
}

async function addAngle(
  project: ProjectRef,
  input: { key: string; label: string; description: string; color: string },
) {
  await getConfig(project);
  const key = input.key.trim();
  if (!/^[a-z][a-z0-9_]{1,31}$/u.test(key)) {
    throw new OutreachError(
      "VALIDATION_ERROR",
      "The key is 2 to 32 lowercase letters, digits or underscores.",
    );
  }
  const label = input.label.trim();
  const description = input.description.trim().replace(/\s+/gu, " ");
  if (!label || !description) {
    throw new OutreachError(
      "VALIDATION_ERROR",
      "An angle needs a label and a one-line description.",
    );
  }
  const color = OUTREACH_ANGLE_COLORS.find((value) => value === input.color);
  if (!color) {
    throw new OutreachError(
      "VALIDATION_ERROR",
      `The color is one of ${OUTREACH_ANGLE_COLORS.join(", ")}.`,
    );
  }
  const existing = await OutreachRepository.listAngles(project.id);
  if (existing.some((angle) => angle.key === key)) {
    throw new OutreachError("CONFLICT", `The angle ${key} already exists.`);
  }
  const before = existing.filter((angle) => angle.key !== OUTREACH_ANGLE_OTHER);
  const sortOrder = (before.at(-1)?.sortOrder ?? 0) + 10;
  await OutreachRepository.insertAngle({
    id: crypto.randomUUID(),
    projectId: project.id,
    key,
    label,
    description,
    color,
    active: 1,
    sortOrder,
  });
  return listAngles(project.id);
}

// Read their page once for its title and favicon (free), and store domain
// metrics the agent measured with the OpenSEO research tools (those calls
// are billed there, not here). A scored prospect is re-scored from the new
// metrics automatically; a changed total is recorded.
async function enrich(
  project: ProjectRef,
  input: {
    number: number;
    readPage?: boolean;
    metrics?: {
      authority: number | null;
      traffic: number | null;
      trafficLocation: string | null;
      referringDomains: number | null;
      source: string;
    };
  },
) {
  const now = nowIso();
  const { prospect, prospectId, row } = await loadOne(project, input.number);
  const values: Parameters<typeof OutreachRepository.updateProspect>[3] = {};
  const details: string[] = [];
  if (input.readPage) {
    const page = await fetchPageHtml(prospect.theirPage);
    if (!("error" in page)) {
      const title = outreachPageTitle(page.html, prospect.domain);
      if (title) {
        values.theirPageTitle = title;
        details.push("page title");
      }
      const favicon = await fetchFavicon(
        findFaviconCandidates(page.html, page.url),
      );
      if (favicon) {
        values.favicon = favicon;
        values.faviconFetchedAt = now;
        details.push("favicon");
      }
    } else {
      details.push(`page not read (${page.error})`);
    }
  }
  let rescored: string | null = null;
  if (input.metrics) {
    const metrics = { ...input.metrics, measuredAt: now };
    values.metricAuthority = metrics.authority;
    values.metricTraffic = metrics.traffic;
    values.metricTrafficLocation = metrics.trafficLocation;
    values.metricReferringDomains = metrics.referringDomains;
    values.metricsMeasuredAt = now;
    values.metricsSource = metrics.source;
    const strength = outreachStrengthFromMetrics(metrics);
    details.push(strength.reason);
    const before = buildScore(row);
    if (before?.total !== null && before?.total !== undefined) {
      const oldStrength =
        before.parts.find((part) => part.key === "strength")?.value ?? 0;
      const after = before.total - oldStrength + strength.value;
      if (after !== before.total) {
        const gain =
          before.parts.find((part) => part.key === "gain")?.value ?? 0;
        rescored = `${before.total}/10 to ${after}/10, ${outreachScoreBand(after, gain)}${
          outreachBelowSendThreshold(after)
            ? `, below ${OUTREACH_SCORE_MODEL.bands.sendFirst}`
            : ""
        }`;
      }
    }
  }
  if (!details.length) return stripId(prospect);
  await runBatch((tx) => [
    OutreachRepository.updateProspect(tx, project.id, prospectId, {
      ...values,
      updatedAt: now,
    }),
    OutreachRepository.insertEvent(
      tx,
      event(
        { projectId: project.id, prospectId: prospectId },
        "enriched",
        details.join("; "),
        "agent",
        now,
      ),
    ),
    ...(rescored
      ? [
          OutreachRepository.insertEvent(
            tx,
            event(
              { projectId: project.id, prospectId: prospectId },
              "rescored",
              rescored,
              "agent",
              now,
            ),
          ),
        ]
      : []),
  ]);
  return getProspect(project, input.number);
}

// Emails approved and unchanged, split into what may go now and what the
// limits hold back, for an agent preparing a send after "šalji".
async function approvedBatch(project: ProjectRef) {
  const snapshot = await getSnapshot(project);
  const approved = snapshot.prospects.filter((p) => p.status === "approved");
  return {
    snapshot,
    sendable: approved.filter((p) => p.approval?.state === "valid"),
    needsReapproval: approved.filter((p) => p.approval?.state !== "valid"),
  };
}

export const OutreachService = {
  getConfig,
  getSettings,
  updateSettings,
  testMail,
  getSnapshot,
  getProspect,
  getFavicons,
  listAngles,
  approve,
  undoApproval,
  editEmail,
  moveStatus,
  send,
  recordSend,
  addProspect,
  updateProspectDetails,
  draftMessage,
  recordReply,
  recordBounce,
  recordLinkCheck,
  checkLink,
  setStatus,
  score,
  setAngle,
  addAngle,
  enrich,
  approvedBatch,
} as const;
