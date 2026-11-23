import { z } from "zod";

// Fork addition (FORK-CHANGES.md): analytics source settings and our joins.

export const MAX_KEY_EVENTS = 20;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");
const range = z
  .object({ start: isoDay, end: isoDay })
  .refine((value) => value.start <= value.end, "Start must not be after end");

export const posthogProjectIdSchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}$/, "A PostHog project ID is a number, e.g. 352215");

// PostHog event names as they are captured: anything printable, short.
export const posthogEventNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\p{Cc}]+$/u, "No control characters");

export const analyticsSourceProjectSchema = z.object({
  projectId: z.string().min(1),
});

const apiKeySchema = z
  .string()
  .trim()
  .min(20, "Paste the whole personal API key")
  .max(200)
  .regex(/^[\x21-\x7e]+$/, "The key has no spaces or special characters");

/** Where a key comes from: pasted now, one the organization already
 *  stored, the server's env, or the one this project already uses. */
export const credentialRefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("new"),
    host: z.string().trim().url().max(200),
    apiKey: apiKeySchema,
  }),
  z.object({ kind: z.literal("existing"), id: z.string().min(1) }),
  z.object({ kind: z.literal("env") }),
  z.object({ kind: z.literal("project") }),
]);

const keyEventsSchema = z
  .array(posthogEventNameSchema)
  .max(MAX_KEY_EVENTS)
  .default([]);

export const checkPosthogKeySchema = z.object({
  projectId: z.string().min(1),
  key: credentialRefSchema,
});

export const listPosthogEventsSchema = z.object({
  projectId: z.string().min(1),
  key: credentialRefSchema,
  posthogProjectId: posthogProjectIdSchema,
});

export const connectPosthogSchema = z.object({
  projectId: z.string().min(1),
  key: credentialRefSchema,
  posthogProjectId: posthogProjectIdSchema,
  keyEvents: keyEventsSchema,
});

export const setKeyEventsSchema = z.object({
  projectId: z.string().min(1),
  keyEvents: keyEventsSchema,
});

export const replacePosthogKeySchema = z.object({
  projectId: z.string().min(1),
  apiKey: apiKeySchema,
});

export const searchSignupsInputSchema = z.object({
  projectId: z.string().min(1),
  current: range,
  previous: range.nullish(),
  chart: range.optional(),
  page: z.string().trim().min(1).max(2000).optional(),
  query: z.string().trim().min(1).max(500).optional(),
  country: z.string().trim().max(3).optional(),
  device: z.enum(["desktop", "mobile", "tablet"]).optional(),
});
