import { z } from "zod";

// Fork addition (FORK-CHANGES.md): reads a PostHog project over the HogQL
// Query API with a read-only personal API key. Keys are passed in by the
// caller (decrypted from the database, or the server's env fallback) and
// are never logged or returned.

const REQUEST_TIMEOUT_MS = 30_000;

export type PosthogCredential = { host: string; apiKey: string };

export class PosthogNotConfiguredError extends Error {
  constructor() {
    super("No PostHog API key is connected for this project.");
    this.name = "PosthogNotConfiguredError";
  }
}

export class PosthogApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds: number | null = null,
    /** PostHog's error code, e.g. "authentication_failed" (bad key or
     *  wrong region) or "permission_denied" (scope or project). */
    public readonly code: string | null = null,
  ) {
    super(message);
    this.name = "PosthogApiError";
  }
}

const hogqlResponseSchema = z.object({
  columns: z.array(z.string()),
  results: z.array(z.array(z.unknown())),
  timezone: z.string().nullish(),
});

const errorBodySchema = z
  .object({ detail: z.string().nullish(), code: z.string().nullish() })
  .passthrough();

const projectListSchema = z.object({
  results: z.array(
    z
      .object({
        id: z.number(),
        name: z.string(),
        timezone: z.string().nullish(),
      })
      .passthrough(),
  ),
});

export type HogqlResult = {
  columns: string[];
  rows: unknown[][];
  /** The PostHog project's time zone; dates in results are in it. */
  timeZone: string | null;
};

export const POSTHOG_PROJECT_ID_PATTERN = /^\d{1,12}$/;

/** An https API origin ("https://eu.posthog.com"), or null. */
export function normalizePosthogHost(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** "phx_…abcd": enough to tell keys apart, never enough to use one. */
export function posthogKeyHint(apiKey: string): string {
  const key = apiKey.trim();
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

async function request(
  credential: PosthogCredential,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const host = normalizePosthogHost(credential.host);
  if (!host || !credential.apiKey.trim()) throw new PosthogNotConfiguredError();
  let response: Response;
  try {
    response = await fetch(`${host}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${credential.apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new PosthogApiError(503, "PostHog did not answer in time.");
  }
  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(
      await response.json().catch(() => null),
    );
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new PosthogApiError(
      response.status,
      parsed.success && parsed.data.detail
        ? parsed.data.detail
        : `PostHog answered ${response.status}.`,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      parsed.success ? (parsed.data.code ?? null) : null,
    );
  }
  return response.json();
}

/** Run one HogQL query. `values` fill `{name}` placeholders (never string
 *  concatenation for anything a person typed); `{filters}` applies the
 *  project's own test-account filter. */
export async function runHogql(input: {
  credential: PosthogCredential | null;
  /** A project ID, or "@current" (the key's default project). */
  projectId: string;
  query: string;
  values?: Record<string, unknown>;
}): Promise<HogqlResult> {
  if (!input.credential) throw new PosthogNotConfiguredError();
  if (
    input.projectId !== "@current" &&
    !POSTHOG_PROJECT_ID_PATTERN.test(input.projectId)
  ) {
    throw new PosthogApiError(400, "Invalid PostHog project ID.");
  }
  const body = hogqlResponseSchema.parse(
    await request(input.credential, `/api/projects/${input.projectId}/query/`, {
      method: "POST",
      body: JSON.stringify({
        name: "openseo",
        query: {
          kind: "HogQLQuery",
          query: input.query,
          values: input.values ?? {},
          filters: { filterTestAccounts: true },
        },
      }),
    }),
  );
  return {
    columns: body.columns,
    rows: body.results,
    timeZone: body.timezone ?? null,
  };
}

/** Projects the key can list. A key limited to chosen projects cannot list
 *  them (PostHog answers 403); then `projects` is null and the key itself
 *  is still fine. A rejected key throws (401). */
export async function listPosthogProjects(
  credential: PosthogCredential,
): Promise<Array<{ id: string; name: string }> | null> {
  try {
    const body = projectListSchema.parse(
      await request(credential, "/api/projects/?limit=200"),
    );
    return body.results.map((project) => ({
      id: String(project.id),
      name: project.name,
    }));
  } catch (error) {
    if (error instanceof PosthogApiError && error.status === 403) return null;
    throw error;
  }
}
