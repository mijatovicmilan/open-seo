import { z } from "zod";
import {
  PosthogApiError,
  PosthogNotConfiguredError,
} from "@/server/lib/posthogErrors";
import {
  Ga4MalformedResponseError,
  Ga4ReportError,
} from "@/server/lib/ga4Errors";

// Fork addition (FORK-CHANGES.md): PostHog failures as the GA4 report
// errors the screens and MCP tools already explain.

export function mapPosthogError(error: unknown, projectId?: string): never {
  if (error instanceof Ga4ReportError) throw error;
  if (error instanceof PosthogNotConfiguredError) {
    throw new Ga4ReportError(
      "ga4_not_connected",
      "PostHog is this project's analytics source, but no PostHog API key is connected. Connect one in Settings → Integrations.",
    );
  }
  if (error instanceof PosthogApiError) {
    const project = projectId ? ` project ${projectId}` : " project";
    if (error.status === 401 || error.code === "authentication_failed") {
      throw new Ga4ReportError(
        "ga4_reconnect_required",
        "PostHog rejected the API key (expired or revoked).",
      );
    }
    if (error.status === 403 || error.status === 404) {
      throw new Ga4ReportError(
        "ga4_property_inaccessible",
        `The PostHog API key cannot read PostHog${project} (it needs query:read on it).`,
      );
    }
    if (error.status === 429) {
      throw new Ga4ReportError(
        "ga4_quota_exhausted",
        "PostHog's query rate limit is reached. Try again later.",
        error.retryAfterSeconds,
      );
    }
    if (error.status === 400) {
      // Our query's fault, not the person's: PostHog's reason helps fix it.
      console.error("posthog.query_rejected", { detail: error.message });
      throw new Ga4ReportError(
        "ga4_report_incompatible",
        "PostHog rejected this report's query.",
      );
    }
    throw new Ga4ReportError(
      "ga4_upstream_unavailable",
      "PostHog is temporarily unavailable.",
    );
  }
  if (
    error instanceof Ga4MalformedResponseError ||
    error instanceof z.ZodError
  ) {
    throw new Ga4ReportError(
      "ga4_malformed_response",
      "PostHog returned an invalid report.",
    );
  }
  throw error;
}
