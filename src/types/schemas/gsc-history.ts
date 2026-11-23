import { z } from "zod";

/** Period lengths (days) offered by Search Insights. */
export const SEARCH_INSIGHTS_PERIODS = [7, 28, 90] as const;
export type SearchInsightsPeriod = (typeof SEARCH_INSIGHTS_PERIODS)[number];

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
  days: searchInsightsPeriodSchema,
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
