import type { PosthogCredential } from "@/server/lib/posthogClient";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { decryptSecret } from "@/server/lib/secretBox";
import { AnalyticsSourceRepository } from "@/server/features/posthog/repositories/AnalyticsSourceRepository";

// Fork addition (FORK-CHANGES.md): which analytics source feeds a project's
// GA4-shaped reports. Kept free of GA4 service imports so the GA4 services
// can ask it first without an import cycle. Never return a PosthogSource
// (it holds the decrypted key) to a client or an MCP response.

export const DEFAULT_POSTHOG_HOST = "https://eu.posthog.com";

export type PosthogSource = {
  posthogProjectId: string;
  timeZone: string;
  keyEvents: string[];
  /** Null when no key is stored and the server has no env fallback. */
  credential: PosthogCredential | null;
};

/** The server's POSTHOG_PERSONAL_API_KEY / POSTHOG_HOST, a fallback for
 *  projects without a stored key and the seed for importing one. */
export async function envPosthogCredential(): Promise<PosthogCredential | null> {
  const apiKey = (
    await getOptionalEnvValue("POSTHOG_PERSONAL_API_KEY")
  )?.trim();
  if (!apiKey) return null;
  const host =
    (await getOptionalEnvValue("POSTHOG_HOST"))?.trim() || DEFAULT_POSTHOG_HOST;
  return { host, apiKey };
}

export async function decryptCredential(row: {
  host: string;
  encryptedKey: string;
}): Promise<PosthogCredential> {
  return { host: row.host, apiKey: await decryptSecret(row.encryptedKey) };
}

/** The project's PostHog source when PostHog is its analytics source. */
export async function getActivePosthogSource(
  projectId: string,
): Promise<PosthogSource | null> {
  const source = await AnalyticsSourceRepository.get(projectId);
  if (source?.provider !== "posthog" || !source.posthogProjectId) return null;
  const stored = source.posthogCredentialId
    ? await AnalyticsSourceRepository.getCredentialForProject(
        projectId,
        source.posthogCredentialId,
      )
    : null;
  return {
    posthogProjectId: source.posthogProjectId,
    timeZone: source.posthogTimeZone ?? "UTC",
    keyEvents: source.keyEvents,
    credential: stored
      ? await decryptCredential(stored).catch(() => {
          // BETTER_AUTH_SECRET changed since the key was stored: the key
          // must be connected again. Nothing about the key is logged.
          console.warn("posthog.key_decrypt_failed");
          return null;
        })
      : await envPosthogCredential(),
  };
}
