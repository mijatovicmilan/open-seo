import { and, asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  analyticsKeyEvents,
  analyticsSources,
  posthogCredentials,
  projects,
} from "@/db/schema";

// Fork addition (FORK-CHANGES.md). Sources are scoped by project_id and
// credentials by organization_id; callers authorize both.

type AnalyticsSource = {
  provider: "ga4" | "posthog";
  posthogCredentialId: string | null;
  posthogProjectId: string | null;
  posthogTimeZone: string | null;
  keyEvents: string[];
  updatedAt: string;
};

type PosthogCredentialRow = typeof posthogCredentials.$inferSelect;

async function get(projectId: string): Promise<AnalyticsSource | null> {
  const [rows, events] = await Promise.all([
    db
      .select()
      .from(analyticsSources)
      .where(eq(analyticsSources.projectId, projectId))
      .limit(1),
    db
      .select({ eventName: analyticsKeyEvents.eventName })
      .from(analyticsKeyEvents)
      .where(eq(analyticsKeyEvents.projectId, projectId))
      .orderBy(asc(analyticsKeyEvents.eventName)),
  ]);
  const row = rows[0];
  if (!row) return null;
  return {
    provider: row.provider,
    posthogCredentialId: row.posthogCredentialId,
    posthogProjectId: row.posthogProjectId,
    posthogTimeZone: row.posthogTimeZone,
    keyEvents: events.map((event) => event.eventName),
    updatedAt: row.updatedAt,
  };
}

async function save(input: {
  projectId: string;
  provider: "ga4" | "posthog";
  posthogCredentialId: string | null;
  posthogProjectId: string | null;
  posthogTimeZone: string | null;
  keyEvents: string[];
}): Promise<void> {
  const values = {
    provider: input.provider,
    posthogCredentialId: input.posthogCredentialId,
    posthogProjectId: input.posthogProjectId,
    posthogTimeZone: input.posthogTimeZone,
    updatedAt: new Date().toISOString(),
  };
  await runBatch((tx) => [
    tx
      .insert(analyticsSources)
      .values({ projectId: input.projectId, ...values })
      .onConflictDoUpdate({ target: analyticsSources.projectId, set: values }),
    tx
      .delete(analyticsKeyEvents)
      .where(eq(analyticsKeyEvents.projectId, input.projectId)),
    ...(input.keyEvents.length > 0
      ? [
          tx.insert(analyticsKeyEvents).values(
            input.keyEvents.map((eventName) => ({
              projectId: input.projectId,
              eventName,
            })),
          ),
        ]
      : []),
  ]);
}

async function getCredential(
  organizationId: string,
  credentialId: string,
): Promise<PosthogCredentialRow | null> {
  const rows = await db
    .select()
    .from(posthogCredentials)
    .where(
      and(
        eq(posthogCredentials.organizationId, organizationId),
        eq(posthogCredentials.id, credentialId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** A key the project may use: one of its own organization's. */
async function getCredentialForProject(
  projectId: string,
  credentialId: string,
): Promise<PosthogCredentialRow | null> {
  const rows = await db
    .select({ credential: posthogCredentials })
    .from(posthogCredentials)
    .innerJoin(
      projects,
      eq(projects.organizationId, posthogCredentials.organizationId),
    )
    .where(
      and(eq(projects.id, projectId), eq(posthogCredentials.id, credentialId)),
    )
    .limit(1);
  return rows[0]?.credential ?? null;
}

/** The organization's keys (never decrypted here), with how many of its
 *  projects use each. */
async function listCredentials(organizationId: string) {
  const [credentials, usage] = await Promise.all([
    db
      .select({
        id: posthogCredentials.id,
        host: posthogCredentials.host,
        keyHint: posthogCredentials.keyHint,
        encryptedKey: posthogCredentials.encryptedKey,
        createdAt: posthogCredentials.createdAt,
      })
      .from(posthogCredentials)
      .where(eq(posthogCredentials.organizationId, organizationId))
      .orderBy(asc(posthogCredentials.createdAt)),
    db
      .select({
        credentialId: analyticsSources.posthogCredentialId,
        projects: count(),
      })
      .from(analyticsSources)
      .innerJoin(projects, eq(projects.id, analyticsSources.projectId))
      .where(eq(projects.organizationId, organizationId))
      .groupBy(analyticsSources.posthogCredentialId),
  ]);
  return credentials.map((credential) => ({
    ...credential,
    projectCount:
      usage.find((row) => row.credentialId === credential.id)?.projects ?? 0,
  }));
}

async function insertCredential(input: {
  organizationId: string;
  host: string;
  encryptedKey: string;
  keyHint: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(posthogCredentials).values({ id, ...input });
  return id;
}

async function updateCredentialKey(input: {
  organizationId: string;
  credentialId: string;
  encryptedKey: string;
  keyHint: string;
}): Promise<void> {
  await db
    .update(posthogCredentials)
    .set({
      encryptedKey: input.encryptedKey,
      keyHint: input.keyHint,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(posthogCredentials.organizationId, input.organizationId),
        eq(posthogCredentials.id, input.credentialId),
      ),
    );
}

async function deleteCredential(
  organizationId: string,
  credentialId: string,
): Promise<void> {
  await db
    .delete(posthogCredentials)
    .where(
      and(
        eq(posthogCredentials.organizationId, organizationId),
        eq(posthogCredentials.id, credentialId),
      ),
    );
}

/** PostHog project IDs the organization's projects already read. */
async function listUsedPosthogProjects(organizationId: string) {
  return db
    .select({
      posthogProjectId: analyticsSources.posthogProjectId,
      posthogCredentialId: analyticsSources.posthogCredentialId,
      projectName: projects.name,
    })
    .from(analyticsSources)
    .innerJoin(projects, eq(projects.id, analyticsSources.projectId))
    .where(eq(projects.organizationId, organizationId));
}

export const AnalyticsSourceRepository = {
  get,
  save,
  getCredential,
  getCredentialForProject,
  listCredentials,
  insertCredential,
  updateCredentialKey,
  deleteCredential,
  listUsedPosthogProjects,
};
