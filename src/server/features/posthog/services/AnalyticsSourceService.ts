import { hogqlText } from "./posthogNormalization";
import {
  PosthogApiError,
  PosthogNotConfiguredError,
} from "@/server/lib/posthogErrors";
import {
  listPosthogProjects,
  normalizePosthogHost,
  posthogKeyHint,
  runHogql,
  type PosthogCredential,
} from "@/server/lib/posthogClient";
import { encryptSecret, SecretKeyMissingError } from "@/server/lib/secretBox";
import { AnalyticsSourceRepository } from "@/server/features/posthog/repositories/AnalyticsSourceRepository";
import {
  decryptCredential,
  DEFAULT_POSTHOG_HOST,
  envPosthogCredential,
} from "./posthogSource";

// Fork addition (FORK-CHANGES.md): connecting a project to PostHog. A key
// is stored once per organization, encrypted, and can serve any of its
// projects; the UI only ever sees its hint ("phx_…abcd").

export class AnalyticsSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsSourceError";
  }
}

/** Where the key for a request comes from. */
type CredentialRef =
  | { kind: "new"; host: string; apiKey: string }
  | { kind: "existing"; id: string }
  | { kind: "env" }
  | { kind: "project" };

function explain(error: unknown, posthogProjectId?: string): never {
  if (error instanceof AnalyticsSourceError) throw error;
  if (error instanceof SecretKeyMissingError) {
    throw new AnalyticsSourceError(
      "The server needs BETTER_AUTH_SECRET in .env to store API keys encrypted.",
    );
  }
  if (error instanceof PosthogNotConfiguredError) {
    throw new AnalyticsSourceError(
      "No PostHog key: paste one, or set POSTHOG_PERSONAL_API_KEY on the server.",
    );
  }
  if (error instanceof PosthogApiError) {
    if (error.status === 401 || error.code === "authentication_failed") {
      throw new AnalyticsSourceError(
        "PostHog rejected this key. Check that it is a personal API key (phx_…), that it was not revoked, and that the host matches its region (EU or US).",
      );
    }
    if (error.status === 403 || error.status === 404) {
      throw new AnalyticsSourceError(
        posthogProjectId
          ? `This key cannot read PostHog project ${posthogProjectId}. In PostHog → Settings → Personal API keys, give the key the "Query: read" scope and include this project (or the whole organization).`
          : `PostHog refused the key: ${error.message}`,
      );
    }
    throw new AnalyticsSourceError(
      `PostHog could not be reached (${error.status}). Try again shortly.`,
    );
  }
  throw error;
}

async function resolveCredential(
  organizationId: string,
  projectId: string,
  ref: CredentialRef,
): Promise<{ credential: PosthogCredential; storedId: string | null }> {
  if (ref.kind === "new") {
    const host = normalizePosthogHost(ref.host);
    if (!host) {
      throw new AnalyticsSourceError("The PostHog host must be an https URL.");
    }
    return { credential: { host, apiKey: ref.apiKey.trim() }, storedId: null };
  }
  if (ref.kind === "env") {
    const credential = await envPosthogCredential();
    if (!credential) {
      throw new AnalyticsSourceError(
        "The server has no POSTHOG_PERSONAL_API_KEY.",
      );
    }
    return { credential, storedId: null };
  }
  const id =
    ref.kind === "existing"
      ? ref.id
      : (await AnalyticsSourceRepository.get(projectId))?.posthogCredentialId;
  const row = id
    ? await AnalyticsSourceRepository.getCredential(organizationId, id)
    : null;
  if (!row) {
    if (ref.kind === "project") {
      const credential = await envPosthogCredential();
      if (credential) return { credential, storedId: null };
    }
    throw new AnalyticsSourceError("That PostHog key is no longer stored.");
  }
  try {
    return { credential: await decryptCredential(row), storedId: row.id };
  } catch {
    throw new AnalyticsSourceError(
      "The stored key can no longer be decrypted (the server secret changed). Replace the key.",
    );
  }
}

async function getView(projectId: string, organizationId: string) {
  const [source, credentials, used, env] = await Promise.all([
    AnalyticsSourceRepository.get(projectId),
    AnalyticsSourceRepository.listCredentials(organizationId),
    AnalyticsSourceRepository.listUsedPosthogProjects(organizationId),
    envPosthogCredential(),
  ]);
  const credential = credentials.find(
    (row) => row.id === source?.posthogCredentialId,
  );
  return {
    provider: source?.provider ?? ("ga4" as const),
    posthogProjectId: source?.posthogProjectId ?? null,
    posthogTimeZone: source?.posthogTimeZone ?? null,
    keyEvents: source?.keyEvents ?? [],
    key: credential
      ? {
          kind: "stored" as const,
          id: credential.id,
          host: credential.host,
          hint: credential.keyHint,
          projectCount: credential.projectCount,
        }
      : source?.provider === "posthog" && env
        ? {
            kind: "env" as const,
            host: env.host,
            hint: posthogKeyHint(env.apiKey),
          }
        : null,
    savedKeys: credentials.map((row) => ({
      id: row.id,
      host: row.host,
      hint: row.keyHint,
      projectCount: row.projectCount,
    })),
    // Offered as a choice only while no stored key matches it.
    envKey:
      env &&
      !credentials.some(
        (row) =>
          row.host === normalizePosthogHost(env.host) &&
          row.keyHint === posthogKeyHint(env.apiKey),
      )
        ? { host: env.host, hint: posthogKeyHint(env.apiKey) }
        : null,
    defaultHost: DEFAULT_POSTHOG_HOST,
    // PostHog projects this organization already reads, for quick picks.
    usedPosthogProjects: used
      .filter((row) => row.posthogProjectId)
      .map((row) => ({
        posthogProjectId: row.posthogProjectId ?? "",
        credentialId: row.posthogCredentialId,
        projectName: row.projectName,
      })),
  };
}

/** Check a key: PostHog accepts it, and the projects it can list (null
 *  when the key is limited to chosen projects and cannot list them). */
async function checkKey(
  organizationId: string,
  projectId: string,
  ref: CredentialRef,
) {
  try {
    const { credential } = await resolveCredential(
      organizationId,
      projectId,
      ref,
    );
    // A query against the key's default project proves the key, its
    // region and its query scope; listing projects needs more.
    await runHogql({ credential, projectId: "@current", query: "SELECT 1" });
    return { projects: await listPosthogProjects(credential) };
  } catch (error) {
    explain(error);
  }
}

/** Custom events PostHog saw in the last 90 days, most frequent first. */
async function listEvents(
  organizationId: string,
  projectId: string,
  ref: CredentialRef,
  posthogProjectId: string,
) {
  try {
    const { credential } = await resolveCredential(
      organizationId,
      projectId,
      ref,
    );
    const result = await runHogql({
      credential,
      projectId: posthogProjectId,
      query: `SELECT event, count() AS events
FROM events
WHERE {filters} AND timestamp >= now() - INTERVAL 90 DAY
  AND NOT startsWith(event, '$')
GROUP BY event
ORDER BY events DESC, event ASC
LIMIT 100`,
    });
    return result.rows.map(([event, total]) => ({
      eventName: hogqlText(event),
      countLast90Days: Number(total) || 0,
    }));
  } catch (error) {
    explain(error, posthogProjectId);
  }
}

/** Store a key once per organization: the same key pasted (or imported)
 *  again reuses its row. */
async function storeKey(
  organizationId: string,
  credential: PosthogCredential,
): Promise<string> {
  const hint = posthogKeyHint(credential.apiKey);
  for (const row of await AnalyticsSourceRepository.listCredentials(
    organizationId,
  )) {
    if (row.host !== credential.host || row.keyHint !== hint) continue;
    const existing = await decryptCredential(row).catch(() => null);
    if (existing?.apiKey === credential.apiKey) return row.id;
  }
  return AnalyticsSourceRepository.insertCredential({
    organizationId,
    host: credential.host,
    encryptedKey: await encryptSecret(credential.apiKey),
    keyHint: hint,
  });
}

/** Connect the project to a PostHog project: the key must read it. The
 *  key is stored encrypted (an env key is imported), and the project's
 *  time zone kept so report days match PostHog's. */
async function connect(input: {
  organizationId: string;
  projectId: string;
  key: CredentialRef;
  posthogProjectId: string;
  keyEvents: string[];
}) {
  try {
    const { credential, storedId } = await resolveCredential(
      input.organizationId,
      input.projectId,
      input.key,
    );
    const check = await runHogql({
      credential,
      projectId: input.posthogProjectId,
      query:
        "SELECT count() FROM events WHERE timestamp >= now() - INTERVAL 1 DAY",
    });
    const credentialId =
      storedId ?? (await storeKey(input.organizationId, credential));
    await AnalyticsSourceRepository.save({
      projectId: input.projectId,
      provider: "posthog",
      posthogCredentialId: credentialId,
      posthogProjectId: input.posthogProjectId,
      posthogTimeZone: check.timeZone ?? "UTC",
      keyEvents: [...new Set(input.keyEvents)],
    });
  } catch (error) {
    explain(error, input.posthogProjectId);
  }
  return getView(input.projectId, input.organizationId);
}

/** Change the key events only. */
async function setKeyEvents(input: {
  organizationId: string;
  projectId: string;
  keyEvents: string[];
}) {
  const source = await AnalyticsSourceRepository.get(input.projectId);
  if (!source) throw new AnalyticsSourceError("Connect PostHog first.");
  await AnalyticsSourceRepository.save({
    ...source,
    projectId: input.projectId,
    keyEvents: [...new Set(input.keyEvents)],
  });
  return getView(input.projectId, input.organizationId);
}

/** Replace the project's stored key (a rotated key): every project that
 *  shares it switches. The new key must read this project's PostHog
 *  project first. */
async function replaceKey(input: {
  organizationId: string;
  projectId: string;
  apiKey: string;
}) {
  const source = await AnalyticsSourceRepository.get(input.projectId);
  const row = source?.posthogCredentialId
    ? await AnalyticsSourceRepository.getCredential(
        input.organizationId,
        source.posthogCredentialId,
      )
    : null;
  if (!source?.posthogProjectId || !row) {
    throw new AnalyticsSourceError("This project has no stored PostHog key.");
  }
  const credential = { host: row.host, apiKey: input.apiKey.trim() };
  try {
    await runHogql({
      credential,
      projectId: source.posthogProjectId,
      query: "SELECT 1",
    });
    await AnalyticsSourceRepository.updateCredentialKey({
      organizationId: input.organizationId,
      credentialId: row.id,
      encryptedKey: await encryptSecret(credential.apiKey),
      keyHint: posthogKeyHint(credential.apiKey),
    });
  } catch (error) {
    explain(error, source.posthogProjectId);
  }
  return getView(input.projectId, input.organizationId);
}

/** Back to Google Analytics; the key is deleted when no other project of
 *  the organization uses it. The PostHog project ID and key events stay
 *  for a later reconnect. */
async function disconnect(input: {
  organizationId: string;
  projectId: string;
}) {
  const source = await AnalyticsSourceRepository.get(input.projectId);
  if (source) {
    await AnalyticsSourceRepository.save({
      ...source,
      projectId: input.projectId,
      provider: "ga4",
      posthogCredentialId: null,
    });
    const credentialId = source.posthogCredentialId;
    if (credentialId) {
      const keys = await AnalyticsSourceRepository.listCredentials(
        input.organizationId,
      );
      if (keys.find((key) => key.id === credentialId)?.projectCount === 0) {
        await AnalyticsSourceRepository.deleteCredential(
          input.organizationId,
          credentialId,
        );
      }
    }
  }
  return getView(input.projectId, input.organizationId);
}

export const AnalyticsSourceService = {
  getView,
  checkKey,
  listEvents,
  connect,
  setKeyEvents,
  replaceKey,
  disconnect,
};
