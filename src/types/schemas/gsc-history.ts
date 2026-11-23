import { z } from "zod";

/** Range presets on the Search Insights page, with their length in days.
 *  16 months is everything Search Console keeps. */
export const SEARCH_INSIGHTS_RANGES = {
  "7d": 7,
  "28d": 28,
  "3m": 91,
  "6m": 182,
  "12m": 364,
  "16m": 486,
} as const;
export const SEARCH_INSIGHTS_RANGE_KEYS = [
  "7d",
  "28d",
  "3m",
  "6m",
  "12m",
  "16m",
  "custom",
] as const;
export type SearchInsightsRange = (typeof SEARCH_INSIGHTS_RANGE_KEYS)[number];
export const SEARCH_INSIGHTS_COMPARE = ["previous", "year", "none"] as const;
export type SearchInsightsCompare = (typeof SEARCH_INSIGHTS_COMPARE)[number];

export const GSC_ANNOTATION_KINDS = ["deploy", "page", "link", "note"] as const;
export type GscAnnotationKind = (typeof GSC_ANNOTATION_KINDS)[number];

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: "Not a real date",
  });

export const searchInsightsPeriodSchema = z
  .union([z.literal(7), z.literal(28), z.literal(90)])
  .default(28);

export const searchInsightsInputSchema = z.object({
  projectId: z.string().min(1),
  range: z.enum(SEARCH_INSIGHTS_RANGE_KEYS).default("28d"),
  start: isoDay.optional(),
  end: isoDay.optional(),
  compare: z.enum(SEARCH_INSIGHTS_COMPARE).default("previous"),
  page: z.string().trim().min(1).max(2000).optional(),
  query: z.string().trim().min(1).max(500).optional(),
});

/** URL state of the Search Insights page. Granularity and metric only change
 *  how the chart draws; the rest decides what the server reads. */
export const searchInsightsSearchSchema = z.object({
  range: z.enum(SEARCH_INSIGHTS_RANGE_KEYS).optional(),
  start: isoDay.optional(),
  end: isoDay.optional(),
  compare: z.enum(SEARCH_INSIGHTS_COMPARE).optional(),
  gran: z.enum(["auto", "day", "week", "month"]).optional(),
  metric: z.enum(["clicks", "impressions", "ctr", "position"]).optional(),
  page: z.string().max(2000).optional(),
  query: z.string().max(500).optional(),
});

export const searchHistoryProjectInputSchema = z.object({
  projectId: z.string().min(1),
});

export const annotationFieldsSchema = {
  date: isoDay,
  kind: z.enum(GSC_ANNOTATION_KINDS),
  label: z.string().trim().min(1).max(200),
  url: z.string().trim().url().max(2000).optional(),
};

export const createAnnotationInputSchema = z.object({
  projectId: z.string().min(1),
  ...annotationFieldsSchema,
});

export const deleteAnnotationInputSchema = z.object({
  projectId: z.string().min(1),
  annotationId: z.string().min(1),
});
