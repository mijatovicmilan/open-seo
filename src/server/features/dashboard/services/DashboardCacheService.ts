import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  buildCacheKey,
  cacheObjectPrefix,
  getCached,
  setCached,
} from "@/server/lib/r2-cache";
import { deleteR2Prefix } from "@/server/lib/r2";
import { DataRefreshClaimRepository } from "@/server/features/dashboard/repositories/DataRefreshClaimRepository";
import { AppError, asAppError } from "@/server/lib/errors";
import { errorCodeSchema, type ErrorCode } from "@/shared/error-codes";

// Fork addition (FORK-CHANGES.md): see the backoff in readThrough.
const BILLING_CODES = new Set<ErrorCode>([
  "BACKLINKS_BILLING_ISSUE",
  "AI_SEARCH_BILLING_ISSUE",
  "INSUFFICIENT_CREDITS",
]);
const failureSchema = z.object({ code: errorCodeSchema });
// Provider loads take a few seconds; a claim held longer is a backoff.
const WAIT_STEP_MS = 500;
const MAX_WAIT_MS = 15_000;

// Cached provider responses are disposable; keep them longer than their refresh
// cadence so credit/provider failures can display the last successful result.
async function readThrough<T>(input: {
  namespace: string;
  organizationId: string;
  params: Record<string, unknown>;
  schema: z.ZodType<T>;
  maxAgeMs: number;
  load: () => Promise<T>;
  // Results that should not outlive the request, such as a dead Google grant:
  // a reconnect only rewrites the account row, so the cache key would not change.
  shouldCache?: (value: T) => boolean;
}) {
  const key = await buildCacheKey(input.namespace, {
    ...input.params,
    organizationId: input.organizationId,
  });
  const schema = z.object({ value: input.schema, fetchedAt: z.string() });
  const parsed = schema.safeParse(await getCached(key));
  const cached = parsed.success ? parsed.data : null;
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < input.maxAgeMs) {
    return { ...cached, stale: false, refreshError: null };
  }
  const token = await DataRefreshClaimRepository.claim(
    key,
    input.organizationId,
  );
  if (!token) {
    if (cached)
      return {
        ...cached,
        stale: true,
        refreshError: "Update already running or temporarily paused.",
      };
    // Fork addition (FORK-CHANGES.md): a visit that overlaps a running load
    // (a reload, a second tab) waits for its result; while a failed refresh
    // backs off, a retry gets that failure's reason. Neither is "too many
    // requests".
    for (let waited = 0; ; waited += WAIT_STEP_MS) {
      const failure = failureSchema.safeParse(
        await getCached(`${key}:failure`),
      );
      if (failure.success) throw new AppError(failure.data.code);
      const done = schema.safeParse(await getCached(key));
      if (
        done.success &&
        Date.now() - Date.parse(done.data.fetchedAt) < input.maxAgeMs
      )
        return { ...done.data, stale: false, refreshError: null };
      if (waited >= MAX_WAIT_MS) break;
      await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
    }
    throw new AppError(
      "RATE_LIMITED",
      "An update is already running or temporarily paused. Try again shortly.",
    );
  }
  try {
    // Recheck after winning the claim: a preceding request may have completed
    // between the initial cache read and this database write.
    const latest = schema.safeParse(await getCached(key));
    if (
      latest.success &&
      Date.now() - Date.parse(latest.data.fetchedAt) < input.maxAgeMs
    ) {
      await DataRefreshClaimRepository.finish(key, token, 0);
      return { ...latest.data, stale: false, refreshError: null };
    }
    const value = input.schema.parse(await input.load());
    const result = { value, fetchedAt: new Date().toISOString() };
    if (input.shouldCache?.(value) ?? true)
      await setCached(key, result, 90 * 86400);
    await DataRefreshClaimRepository.finish(key, token, 0);
    return { ...result, stale: false, refreshError: null };
  } catch (error) {
    // Fork addition (FORK-CHANGES.md): an empty DataForSEO balance is not
    // fixed in five minutes, so back off for an hour and keep the reason.
    const code = asAppError(error)?.code ?? "INTERNAL_ERROR";
    const backoffMs = BILLING_CODES.has(code) ? 60 * 60_000 : 5 * 60_000;
    await DataRefreshClaimRepository.finish(key, token, backoffMs);
    if (!cached) {
      await setCached(`${key}:failure`, { code }, backoffMs / 1000);
      throw error;
    }
    return {
      ...cached,
      stale: true,
      refreshError: asAppError(error)?.code ?? "UPSTREAM_UNAVAILABLE",
    };
  }
}

// Fork addition (FORK-CHANGES.md): the saved result without loading, for when
// automatic DataForSEO calls are off. Null when nothing was ever loaded.
async function peek<T>(input: {
  namespace: string;
  organizationId: string;
  params: Record<string, unknown>;
  schema: z.ZodType<T>;
  maxAgeMs: number;
}) {
  const key = await buildCacheKey(input.namespace, {
    ...input.params,
    organizationId: input.organizationId,
  });
  const schema = z.object({ value: input.schema, fetchedAt: z.string() });
  const parsed = schema.safeParse(await getCached(key));
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    stale: Date.now() - Date.parse(parsed.data.fetchedAt) >= input.maxAgeMs,
    refreshError: null,
  };
}

// Search Console rows are Google data the privacy policy lets users remove, so
// every cached copy for a project sits under one prefix that disconnect,
// project deletion, and account erasure can drop.
function gscNamespace(projectId: string, name: string) {
  return `dashboard:gsc:${projectId}:${name}`;
}

async function deleteGscCache(projectId: string) {
  return deleteR2Prefix(
    env.R2,
    cacheObjectPrefix(`dashboard:gsc:${projectId}`),
  );
}

export const DashboardCacheService = {
  readThrough,
  peek,
  gscNamespace,
  deleteGscCache,
};
