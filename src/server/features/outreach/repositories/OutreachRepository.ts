/* eslint-disable max-lines -- the one repository for the outreach tables (fork feature) */
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  max,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  outreachAngles,
  outreachEvents,
  outreachLinkChecks,
  outreachMessages,
  outreachProspects,
  outreachSettings,
} from "@/db/schema";
import { runBatch } from "@/db/runBatch";
import type {
  EventRow,
  LinkCheckRow,
  MessageRow,
  OutreachActor,
  ProspectRow,
} from "@/server/features/outreach/outreachDomain";

// Backing store for outreach (fork feature). Every query is scoped by
// project_id as well as the row id: callers authorize the project they were
// given, not the child row, so an id from another project never resolves.

type Executor = typeof db;

const prospectColumns = {
  id: outreachProspects.id,
  number: outreachProspects.number,
  site: outreachProspects.site,
  person: outreachProspects.person,
  contact: outreachProspects.contact,
  contactKind: outreachProspects.contactKind,
  contactNote: outreachProspects.contactNote,
  theirPage: outreachProspects.theirPage,
  theirPageTitle: outreachProspects.theirPageTitle,
  ourPage: outreachProspects.ourPage,
  gain: outreachProspects.gain,
  status: outreachProspects.status,
  notes: outreachProspects.notes,
  droppedReason: outreachProspects.droppedReason,
  linkUrl: outreachProspects.linkUrl,
  linkRel: outreachProspects.linkRel,
  angleKey: outreachAngles.key,
  angleNote: outreachProspects.angleNote,
  scoreGain: outreachProspects.scoreGain,
  scoreGainReason: outreachProspects.scoreGainReason,
  scoreActivity: outreachProspects.scoreActivity,
  scoreActivityReason: outreachProspects.scoreActivityReason,
  scoreReach: outreachProspects.scoreReach,
  scoreReachReason: outreachProspects.scoreReachReason,
  scoreLink: outreachProspects.scoreLink,
  scoreLinkReason: outreachProspects.scoreLinkReason,
  scoredAt: outreachProspects.scoredAt,
  faviconFetchedAt: outreachProspects.faviconFetchedAt,
  metricAuthority: outreachProspects.metricAuthority,
  metricTraffic: outreachProspects.metricTraffic,
  metricTrafficLocation: outreachProspects.metricTrafficLocation,
  metricReferringDomains: outreachProspects.metricReferringDomains,
  metricsMeasuredAt: outreachProspects.metricsMeasuredAt,
  metricsSource: outreachProspects.metricsSource,
  createdAt: outreachProspects.createdAt,
  updatedAt: outreachProspects.updatedAt,
};

const messageColumns = {
  id: outreachMessages.id,
  prospectId: outreachMessages.prospectId,
  kind: outreachMessages.kind,
  subject: outreachMessages.subject,
  body: outreachMessages.body,
  approvedHash: outreachMessages.approvedHash,
  approvedAt: outreachMessages.approvedAt,
  sentAt: outreachMessages.sentAt,
  messageId: outreachMessages.messageId,
  receivedAt: outreachMessages.receivedAt,
  inReplyToId: outreachMessages.inReplyToId,
  createdAt: outreachMessages.createdAt,
};

const eventColumns = {
  id: outreachEvents.id,
  prospectId: outreachEvents.prospectId,
  type: outreachEvents.type,
  detail: outreachEvents.detail,
  actor: outreachEvents.actor,
  at: outreachEvents.at,
};

const linkCheckColumns = {
  id: outreachLinkChecks.id,
  prospectId: outreachLinkChecks.prospectId,
  checkedAt: outreachLinkChecks.checkedAt,
  found: outreachLinkChecks.found,
  url: outreachLinkChecks.url,
  href: outreachLinkChecks.href,
  rel: outreachLinkChecks.rel,
  actor: outreachLinkChecks.actor,
  detail: outreachLinkChecks.detail,
};

export type OutreachLoaded = {
  rows: ProspectRow[];
  messages: MessageRow[];
  events: EventRow[];
  linkChecks: LinkCheckRow[];
};

// All prospects of a project with their messages, events and link checks,
// or one prospect when prospectId is given.
async function load(
  projectId: string,
  prospectId?: string,
): Promise<OutreachLoaded> {
  const prospectFilter = prospectId
    ? and(
        eq(outreachProspects.projectId, projectId),
        eq(outreachProspects.id, prospectId),
      )
    : eq(outreachProspects.projectId, projectId);
  const [rows, messages, events, linkChecks] = await Promise.all([
    db
      .select(prospectColumns)
      .from(outreachProspects)
      .leftJoin(
        outreachAngles,
        eq(outreachAngles.id, outreachProspects.angleId),
      )
      .where(prospectFilter)
      .orderBy(asc(outreachProspects.number)),
    db
      .select(messageColumns)
      .from(outreachMessages)
      .where(
        prospectId
          ? and(
              eq(outreachMessages.projectId, projectId),
              eq(outreachMessages.prospectId, prospectId),
            )
          : eq(outreachMessages.projectId, projectId),
      )
      .orderBy(asc(outreachMessages.id)),
    db
      .select(eventColumns)
      .from(outreachEvents)
      .where(
        prospectId
          ? and(
              eq(outreachEvents.projectId, projectId),
              eq(outreachEvents.prospectId, prospectId),
            )
          : eq(outreachEvents.projectId, projectId),
      )
      .orderBy(asc(outreachEvents.at), asc(outreachEvents.id)),
    db
      .select(linkCheckColumns)
      .from(outreachLinkChecks)
      .where(
        prospectId
          ? and(
              eq(outreachLinkChecks.projectId, projectId),
              eq(outreachLinkChecks.prospectId, prospectId),
            )
          : eq(outreachLinkChecks.projectId, projectId),
      )
      .orderBy(asc(outreachLinkChecks.checkedAt), asc(outreachLinkChecks.id)),
  ]);
  return { rows, messages, events, linkChecks };
}

async function findProspectId(projectId: string, number: number) {
  const [row] = await db
    .select({ id: outreachProspects.id })
    .from(outreachProspects)
    .where(
      and(
        eq(outreachProspects.projectId, projectId),
        eq(outreachProspects.number, number),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function nextNumber(projectId: string) {
  const [row] = await db
    .select({ value: max(outreachProspects.number) })
    .from(outreachProspects)
    .where(eq(outreachProspects.projectId, projectId));
  return (row?.value ?? 0) + 1;
}

// Same domain or person already tracked (a declined domain stays closed).
async function findDuplicates(
  projectId: string,
  input: { domain: string; contact: string },
) {
  return db
    .select({
      number: outreachProspects.number,
      site: outreachProspects.site,
      status: outreachProspects.status,
      theirPage: outreachProspects.theirPage,
      contact: outreachProspects.contact,
    })
    .from(outreachProspects)
    .where(
      and(
        eq(outreachProspects.projectId, projectId),
        input.contact
          ? sql`(lower(${outreachProspects.theirPage}) LIKE ${`%${input.domain}%`} OR lower(${outreachProspects.contact}) = ${input.contact.toLowerCase()})`
          : sql`lower(${outreachProspects.theirPage}) LIKE ${`%${input.domain}%`}`,
      ),
    );
}

// ---- Settings and angles ----------------------------------------------------

async function getSettings(projectId: string) {
  const [row] = await db
    .select()
    .from(outreachSettings)
    .where(eq(outreachSettings.projectId, projectId))
    .limit(1);
  return row ?? null;
}

type SettingsInsert = typeof outreachSettings.$inferInsert;

async function createSettings(
  values: SettingsInsert,
  angles: Array<{
    id: string;
    key: string;
    label: string;
    description: string;
    color: string;
    sortOrder: number;
  }>,
) {
  await runBatch((tx) => [
    tx.insert(outreachSettings).values(values).onConflictDoNothing(),
    ...angles.map((angle) =>
      tx
        .insert(outreachAngles)
        .values({ ...angle, projectId: values.projectId, active: 1 })
        .onConflictDoNothing(),
    ),
  ]);
}

async function updateSettings(
  projectId: string,
  values: Partial<Omit<SettingsInsert, "projectId" | "createdAt">>,
) {
  await db
    .update(outreachSettings)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(outreachSettings.projectId, projectId));
}

async function listAngles(projectId: string) {
  return db
    .select({
      id: outreachAngles.id,
      key: outreachAngles.key,
      label: outreachAngles.label,
      description: outreachAngles.description,
      color: outreachAngles.color,
      active: outreachAngles.active,
      sortOrder: outreachAngles.sortOrder,
    })
    .from(outreachAngles)
    .where(eq(outreachAngles.projectId, projectId))
    .orderBy(asc(outreachAngles.sortOrder), asc(outreachAngles.key));
}

async function insertAngle(values: typeof outreachAngles.$inferInsert) {
  await db.insert(outreachAngles).values(values);
}

async function listFavicons(projectId: string) {
  return db
    .select({
      number: outreachProspects.number,
      favicon: outreachProspects.favicon,
    })
    .from(outreachProspects)
    .where(
      and(
        eq(outreachProspects.projectId, projectId),
        isNotNull(outreachProspects.favicon),
      ),
    );
}

// ---- Writes -----------------------------------------------------------------

type ProspectUpdate = Partial<
  Omit<typeof outreachProspects.$inferInsert, "id" | "projectId" | "number">
>;

function updateProspect(
  tx: Executor,
  projectId: string,
  prospectId: string,
  values: ProspectUpdate,
  expectedStatus?: ProspectRow["status"],
) {
  return tx
    .update(outreachProspects)
    .set(values)
    .where(
      and(
        eq(outreachProspects.projectId, projectId),
        eq(outreachProspects.id, prospectId),
        ...(expectedStatus
          ? [eq(outreachProspects.status, expectedStatus)]
          : []),
      ),
    );
}

function insertEvent(
  tx: Executor,
  input: {
    projectId: string;
    prospectId: string;
    type: string;
    detail: string | null;
    actor: OutreachActor;
    at: string;
  },
) {
  return tx.insert(outreachEvents).values(input);
}

// A guarded update whose condition decides whether the change happens at all:
// returns true when a row matched.
async function guardedProspectUpdate(
  projectId: string,
  prospectId: string,
  values: ProspectUpdate,
  expectedStatus: ProspectRow["status"],
) {
  const rows = await updateProspect(
    db,
    projectId,
    prospectId,
    values,
    expectedStatus,
  ).returning({ id: outreachProspects.id });
  return rows.length > 0;
}

async function guardedMessageUpdate(
  projectId: string,
  message: Pick<MessageRow, "id" | "subject" | "body">,
  values: Partial<typeof outreachMessages.$inferInsert>,
  guard: { unsent: true; unclaimed?: boolean; approvedHash?: string },
) {
  const rows = await db
    .update(outreachMessages)
    .set(values)
    .where(
      and(
        eq(outreachMessages.projectId, projectId),
        eq(outreachMessages.id, message.id),
        isNull(outreachMessages.sentAt),
        eq(outreachMessages.subject, message.subject),
        eq(outreachMessages.body, message.body),
        ...(guard.unclaimed ? [isNull(outreachMessages.messageId)] : []),
        ...(guard.approvedHash
          ? [eq(outreachMessages.approvedHash, guard.approvedHash)]
          : []),
      ),
    )
    .returning({ id: outreachMessages.id });
  return rows.length > 0;
}

async function releaseClaim(
  projectId: string,
  messageRowId: number,
  claim: string,
) {
  await db
    .update(outreachMessages)
    .set({ messageId: null })
    .where(
      and(
        eq(outreachMessages.projectId, projectId),
        eq(outreachMessages.id, messageRowId),
        eq(outreachMessages.messageId, claim),
        isNull(outreachMessages.sentAt),
      ),
    );
}

function insertProspect(
  tx: Executor,
  values: typeof outreachProspects.$inferInsert,
) {
  return tx.insert(outreachProspects).values(values);
}

function insertMessage(
  tx: Executor,
  values: typeof outreachMessages.$inferInsert,
) {
  return tx.insert(outreachMessages).values(values);
}

function insertLinkCheck(
  tx: Executor,
  values: typeof outreachLinkChecks.$inferInsert,
) {
  return tx.insert(outreachLinkChecks).values(values);
}

// Changes an outgoing message only while it is unsent.
function updateUnsentMessage(
  tx: Executor,
  projectId: string,
  messageRowId: number,
  values: Partial<typeof outreachMessages.$inferInsert>,
) {
  return tx
    .update(outreachMessages)
    .set(values)
    .where(
      and(
        eq(outreachMessages.projectId, projectId),
        eq(outreachMessages.id, messageRowId),
        isNull(outreachMessages.sentAt),
      ),
    );
}

// Records the send of the approved text; false when the approval no longer
// matches or the send was already recorded.
async function markMessageSent(
  projectId: string,
  input: {
    id: number;
    sentAt: string;
    messageId: string | null;
    approvedHash: string;
  },
) {
  const rows = await db
    .update(outreachMessages)
    .set({ sentAt: input.sentAt, messageId: input.messageId })
    .where(
      and(
        eq(outreachMessages.projectId, projectId),
        eq(outreachMessages.id, input.id),
        isNull(outreachMessages.sentAt),
        eq(outreachMessages.approvedHash, input.approvedHash),
      ),
    )
    .returning({ id: outreachMessages.id });
  return rows.length > 0;
}

async function prospectCount(projectId: string) {
  const [row] = await db
    .select({ value: sql<number>`count(*)` })
    .from(outreachProspects)
    .where(eq(outreachProspects.projectId, projectId));
  return Number(row?.value ?? 0);
}

async function prospectIdsByNumber(projectId: string, numbers: number[]) {
  if (!numbers.length) return new Map<number, string>();
  const rows = await db
    .select({ id: outreachProspects.id, number: outreachProspects.number })
    .from(outreachProspects)
    .where(
      and(
        eq(outreachProspects.projectId, projectId),
        inArray(outreachProspects.number, numbers),
      ),
    );
  return new Map(rows.map((row) => [row.number, row.id]));
}

export const OutreachRepository = {
  // The plain handle, for single statements outside a batch.
  executor: db,
  load,
  findProspectId,
  nextNumber,
  findDuplicates,
  getSettings,
  createSettings,
  updateSettings,
  listAngles,
  insertAngle,
  listFavicons,
  updateProspect,
  insertEvent,
  guardedProspectUpdate,
  guardedMessageUpdate,
  releaseClaim,
  insertProspect,
  insertMessage,
  insertLinkCheck,
  updateUnsentMessage,
  markMessageSent,
  prospectCount,
  prospectIdsByNumber,
} as const;
