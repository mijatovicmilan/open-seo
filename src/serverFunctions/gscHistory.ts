import { createServerFn } from "@tanstack/react-start";
import { AppError } from "@/server/lib/errors";
import { GscHistoryService } from "@/server/features/gsc-history/services/GscHistoryService";
import {
  GscHistorySyncService,
  PAGE_DETAIL_DAYS_PER_RUN,
} from "@/server/features/gsc-history/services/GscHistorySyncService";
import { KeywordPositionsService } from "@/server/features/gsc-history/services/KeywordPositionsService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  createAnnotationInputSchema,
  keywordPositionsInputSchema,
  deleteAnnotationInputSchema,
  updateAnnotationInputSchema,
  searchHistoryProjectInputSchema,
  searchInsightsInputSchema,
  SEARCH_INSIGHTS_RANGES,
} from "@/types/schemas/gsc-history";

// Search Insights (fork feature). The `projectId` in each validator triggers
// project authorization in the middleware; services never authorize.

/** Insight sections, the chart and the sync status, all from stored history. */
export const getSearchInsights = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(searchInsightsInputSchema)
  .handler(async ({ data, context }) =>
    GscHistoryService.getInsights(context.projectId, {
      range: data.range,
      presetDays:
        data.range === "custom"
          ? undefined
          : SEARCH_INSIGHTS_RANGES[data.range],
      start: data.start,
      end: data.end,
      compare: data.compare,
      fresh: data.fresh,
      page: data.page,
      query: data.query,
      section: data.section,
      country: data.country,
      device: data.device,
    }),
  );

/** One bounded catch-up run. The page calls again while days remain. */
export const syncSearchHistory = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(searchHistoryProjectInputSchema)
  .handler(async ({ context }) => {
    const result = await GscHistorySyncService.syncProject(context.projectId, {
      maxDetailDays: PAGE_DETAIL_DAYS_PER_RUN,
    });
    const status = await GscHistoryService.getStatus(context.projectId);
    return { result, status };
  });

export const addSearchAnnotation = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(createAnnotationInputSchema)
  .handler(async ({ data, context }) =>
    GscHistoryService.addAnnotation({
      projectId: context.projectId,
      date: data.date,
      kind: data.kind,
      label: data.label,
      url: data.url,
    }),
  );

export const updateSearchAnnotation = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(updateAnnotationInputSchema)
  .handler(async ({ data, context }) => {
    const updated = await GscHistoryService.updateAnnotation({
      projectId: context.projectId,
      annotationId: data.annotationId,
      date: data.date,
      kind: data.kind,
      label: data.label,
      url: data.url,
    });
    if (!updated) throw new AppError("NOT_FOUND", "Annotation not found.");
    return { updated };
  });

export const deleteSearchAnnotation = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(deleteAnnotationInputSchema)
  .handler(async ({ data, context }) => {
    const deleted = await GscHistoryService.deleteAnnotation(
      context.projectId,
      data.annotationId,
    );
    if (!deleted) throw new AppError("NOT_FOUND", "Annotation not found.");
    return { deleted };
  });

/** Search Console position, clicks and impressions for saved or tracked
 *  keywords over the last 28 settled days, from stored history. */
export const getKeywordGscPositions = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(keywordPositionsInputSchema)
  .handler(({ data, context }) =>
    KeywordPositionsService.getPositions(context.projectId, data.keywords),
  );
