/* eslint-disable max-lines -- five small tools over one feature, kept together */
import { omit } from "remeda";
import { z } from "zod";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { formatMcpTable, type McpTableColumn } from "@/server/mcp/table";
import { projectIdSchema } from "@/server/mcp/schemas";
import {
  GscHistoryService,
  type SearchHistoryStatus,
  type SearchInsights,
} from "@/server/features/gsc-history/services/GscHistoryService";
import { GscHistorySyncService } from "@/server/features/gsc-history/services/GscHistorySyncService";
import {
  annotationFieldsSchema,
  GSC_DEVICES,
  gscCountrySchema,
  searchInsightsPeriodSchema,
} from "@/types/schemas/gsc-history";

const INSIGHTS_PATH = (projectId: string) => `/p/${projectId}/search-insights`;

const pct = (value: unknown) =>
  typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "—";
const pos = (value: unknown) =>
  typeof value === "number" ? value.toFixed(1) : "—";
const signed = (value: unknown) =>
  typeof value === "number" ? `${value > 0 ? "+" : ""}${value}` : "—";

function statusLine(status: SearchHistoryStatus): string {
  const parts = [
    `${status.daysStored} days stored`,
    status.oldestDay ? `from ${status.oldestDay} to ${status.newestDay}` : null,
    `${status.missingDays} days still to fetch`,
    `last sync ${status.lastSuccessAt ?? "never"}`,
    status.running ? "a sync is running" : null,
    status.lastError ? `last error: ${status.lastError}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

const statusOutputSchema = z.looseObject({
  connected: z.boolean(),
  daysStored: z.number(),
  oldestDay: z.string().nullable(),
  newestDay: z.string().nullable(),
  missingDays: z.number(),
  lastSuccessAt: z.string().nullable(),
  lastError: z.string().nullable(),
  running: z.boolean(),
});

// ---------------------------------------------------------------------------
// sync_search_console_history
// ---------------------------------------------------------------------------

const syncInputSchema = { projectId: projectIdSchema } as const;

export const syncSearchConsoleHistoryTool = {
  name: "sync_search_console_history",
  config: {
    title: "Sync Search Console history",
    description:
      "Store the connected Search Console property's daily data (totals, pages, query x page; web search) so get_search_insights can compare periods beyond GSC's live limits. One call is one bounded run: the newest 3 days are always refreshed, then missing days are filled newest first, up to 30 days with data per call. When remainingDays is above 0, call again to continue the backfill (GSC keeps ~16 months). Uses no credits.",
    inputSchema: syncInputSchema,
    outputSchema: z.looseObject({
      result: z.looseObject({ status: z.string() }),
      status: statusOutputSchema,
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof syncInputSchema>>, context) => {
      const result = await GscHistorySyncService.syncProject(args.projectId);
      const status = await GscHistoryService.getStatus(args.projectId);
      const head =
        result.status === "synced"
          ? `Synced ${result.detailDays} days with data and ${result.emptyDays} empty days (${result.rowsWritten} rows). ${result.remainingDays > 0 ? `${result.remainingDays} days remain: call again to continue.` : "History is complete."}`
          : result.status === "busy"
            ? "Another sync is running for this project. Try again in a few minutes."
            : result.status === "not_connected"
              ? `Search Console is not connected for this project. Connect it at ${context.baseUrl}${INSIGHTS_PATH(args.projectId)}`
              : `Sync failed: ${result.error}`;
      return mcpResponse({
        text: `${head}\n${statusLine(status)}`,
        meta: buildProjectMeta(
          context,
          args.projectId,
          INSIGHTS_PATH(args.projectId),
        ),
        structuredContent: { result, status },
      });
    },
  ),
};

// ---------------------------------------------------------------------------
// get_search_insights
// ---------------------------------------------------------------------------

type Data = SearchInsights;

const CHANGE_COLUMNS: McpTableColumn<Data["changes"]["rising"][number]>[] = [
  { header: "page", value: (r) => r.page },
  { header: "clicks", value: (r) => r.clicks },
  { header: "Δclicks", value: (r) => r.clicks - r.prevClicks, format: signed },
  {
    header: "Δimpr",
    value: (r) => r.impressions - r.prevImpressions,
    format: signed,
  },
  {
    header: "driven by",
    value: (r) =>
      r.drivers
        .map(
          (d) =>
            `${d.query} (${signed(d.clicks - d.prevClicks)} clicks, ${signed(d.impressions - d.prevImpressions)} impr)`,
        )
        .join("; "),
  },
];

const NEW_QUERY_COLUMNS: McpTableColumn<Data["newQueries"][number]>[] = [
  { header: "query", value: (r) => r.query },
  { header: "first seen", value: (r) => r.firstDate },
  { header: "impr", value: (r) => r.impressions },
  { header: "clicks", value: (r) => r.clicks },
  { header: "pos", value: (r) => r.position, format: pos },
  { header: "best page", value: (r) => r.page },
];

const NEAR_COLUMNS: McpTableColumn<Data["nearPageOne"][number]>[] = [
  { header: "query", value: (r) => r.query },
  { header: "best page", value: (r) => r.page },
  { header: "pos", value: (r) => r.position, format: pos },
  { header: "impr", value: (r) => r.impressions },
  { header: "clicks", value: (r) => r.clicks },
  { header: "+clicks at #3", value: (r) => r.potentialClicks },
];

const CTR_COLUMNS: McpTableColumn<Data["ctrGaps"][number]>[] = [
  { header: "query", value: (r) => r.query },
  { header: "page", value: (r) => r.page },
  { header: "pos", value: (r) => r.position, format: pos },
  { header: "CTR", value: (r) => r.ctr, format: pct },
  { header: "expected", value: (r) => r.expectedCtr, format: pct },
  { header: "click gap", value: (r) => r.clickGap },
];

const CANNIBAL_COLUMNS: McpTableColumn<Data["cannibalization"][number]>[] = [
  { header: "query", value: (r) => r.query },
  { header: "impr", value: (r) => r.impressions },
  {
    header: "pages (share, pos)",
    value: (r) =>
      r.pages
        .map(
          (p) =>
            `${p.page} (${Math.round(p.share * 100)}%, ${p.position.toFixed(1)})`,
        )
        .join("; "),
  },
  { header: "flips", value: (r) => r.flips },
];

const NEW_PAGE_COLUMNS: McpTableColumn<Data["newPages"][number]>[] = [
  { header: "page", value: (r) => r.page },
  { header: "first seen", value: (r) => r.firstDate },
  { header: "impr", value: (r) => r.impressions },
  { header: "clicks", value: (r) => r.clicks },
  { header: "weekly impr", value: (r) => r.weeklyImpressions.join(" ") },
];

function section<T>(
  title: string,
  rows: T[],
  columns: McpTableColumn<T>[],
  empty: string,
): string {
  return rows.length > 0
    ? `## ${title} (${rows.length})\n${formatMcpTable(rows, columns)}`
    : `## ${title}\n${empty}`;
}

function insightsText(data: Data): string {
  const { period, totals, prevTotals } = data;
  const header =
    `Period ${period.current.start}→${period.current.end}${period.previous ? ` vs ${period.previous.start}→${period.previous.end}` : ""}. ` +
    `Clicks ${totals.clicks}${prevTotals ? ` (prev ${prevTotals.clicks})` : ""}, impressions ${totals.impressions}${prevTotals ? ` (prev ${prevTotals.impressions})` : ""}, ` +
    `CTR ${pct(totals.ctr)}, position ${pos(totals.position)}. Rows count from ${data.minImpressions} impressions; expected CTR source: ${data.ctrCurve.source}.`;
  const filters = Object.entries(data.filter)
    .map(([key, value]) => `${key} ${value}`)
    .join(", ");
  return [
    filters ? `${header}\nFiltered to ${filters}.` : header,
    section("Rising pages", data.changes.rising, CHANGE_COLUMNS, "None."),
    section("Falling pages", data.changes.falling, CHANGE_COLUMNS, "None."),
    section(
      "New queries",
      data.newQueries,
      NEW_QUERY_COLUMNS,
      data.hasNewBaseline
        ? "None."
        : "Needs 28 days of stored history before the period.",
    ),
    section(
      "Near page one (pos 8-20)",
      data.nearPageOne,
      NEAR_COLUMNS,
      "None.",
    ),
    section("CTR below expected", data.ctrGaps, CTR_COLUMNS, "None."),
    section("Cannibalization", data.cannibalization, CANNIBAL_COLUMNS, "None."),
    section(
      "New pages (last 90 days)",
      data.newPages,
      NEW_PAGE_COLUMNS,
      "None.",
    ),
  ].join("\n\n");
}

const insightsInputSchema = {
  projectId: projectIdSchema,
  days: searchInsightsPeriodSchema.describe(
    "Period length in days: 7, 28 (default) or 90, compared with the same length before it.",
  ),
  page: z
    .string()
    .url()
    .max(2000)
    .optional()
    .describe(
      "Limit everything to one page (full URL as Search Console reports it).",
    ),
  query: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe("Limit everything to one query."),
  country: gscCountrySchema
    .optional()
    .describe(
      "Limit to one country: ISO 3166-1 alpha-3 code in lower case, e.g. usa, gbr, srb.",
    ),
  device: z.enum(GSC_DEVICES).optional().describe("Limit to one device."),
} as const;

export const getSearchInsightsTool = {
  name: "get_search_insights",
  config: {
    title: "Get Search Console insights",
    description:
      "Decisions from stored Search Console history (run sync_search_console_history first if nothing is stored): rising and falling pages with the queries driving them, new queries, queries near page one (position 8-20), page-one results with CTR below the expected curve for their position, cannibalization (2+ pages splitting a query, with ranking-page flips), and new pages with weekly impressions. Each section is sorted by impact. Read-only; uses no credits and makes no Google calls.",
    inputSchema: insightsInputSchema,
    outputSchema: z.looseObject({
      status: statusOutputSchema,
      insights: z.looseObject({}).nullable(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof insightsInputSchema>>, context) => {
      const { status, data } = await GscHistoryService.getInsights(
        args.projectId,
        {
          range: "preset",
          presetDays: args.days,
          compare: "previous",
          page: args.page,
          query: args.query,
          country: args.country,
          device: args.device,
        },
      );
      const meta = buildProjectMeta(
        context,
        args.projectId,
        INSIGHTS_PATH(args.projectId),
      );
      if (!data) {
        return mcpResponse({
          text: `No Search Console history stored yet. ${status.connected ? "Run sync_search_console_history." : "Connect Search Console for this project first."}\n${statusLine(status)}`,
          meta,
          structuredContent: { status, insights: null },
        });
      }
      // The chart series and annotations stay out of the agent's context.
      const insights = omit(data, ["series", "annotations", "countries"]);
      return mcpResponse({
        text: `${insightsText(data)}\n\n${statusLine(status)}`,
        meta,
        structuredContent: { status, insights },
      });
    },
  ),
};

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

const annotationOutputSchema = z.looseObject({
  id: z.string(),
  date: z.string(),
  kind: z.string(),
  label: z.string(),
  url: z.string().nullable(),
});

const ANNOTATION_COLUMNS: McpTableColumn<{
  id: string;
  date: string;
  kind: string;
  label: string;
  url: string | null;
}>[] = [
  { header: "id", value: (r) => r.id },
  { header: "date", value: (r) => r.date },
  { header: "kind", value: (r) => r.kind },
  { header: "label", value: (r) => r.label },
  { header: "url", value: (r) => r.url },
];

const addInputSchema = {
  projectId: projectIdSchema,
  ...annotationFieldsSchema,
} as const;

export const addSearchAnnotationTool = {
  name: "add_search_annotation",
  config: {
    title: "Add Search Insights annotation",
    description:
      "Mark an event on the Search Insights chart so traffic changes can be traced to a cause: kind 'deploy', 'page' (published or changed), 'link' (earned elsewhere) or 'note'. date is YYYY-MM-DD. Outreach links and new pages are added automatically. Uses no credits.",
    inputSchema: addInputSchema,
    outputSchema: z.looseObject({
      annotation: annotationOutputSchema,
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof addInputSchema>>, context) => {
      const row = await GscHistoryService.addAnnotation(args);
      const annotation = {
        id: row.id,
        date: row.date,
        kind: row.kind,
        label: row.label,
        url: row.url,
      };
      return mcpResponse({
        text: `Added ${row.kind} annotation on ${row.date}: ${row.label} (id ${row.id}).`,
        meta: buildProjectMeta(
          context,
          args.projectId,
          INSIGHTS_PATH(args.projectId),
        ),
        structuredContent: { annotation },
      });
    },
  ),
};

const listInputSchema = { projectId: projectIdSchema } as const;

export const listSearchAnnotationsTool = {
  name: "list_search_annotations",
  config: {
    title: "List Search Insights annotations",
    description:
      "List the stored chart annotations (deploys, pages, links, notes) for a project, oldest first, with ids for delete_search_annotation. Derived outreach links and new pages are not stored and not listed. Read-only; uses no credits.",
    inputSchema: listInputSchema,
    outputSchema: z.looseObject({
      annotations: z.array(annotationOutputSchema),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof listInputSchema>>, context) => {
      const rows = await GscHistoryService.listAnnotations(args.projectId);
      const annotations = rows.map((row) => ({
        id: row.id,
        date: row.date,
        kind: row.kind,
        label: row.label,
        url: row.url,
      }));
      return mcpResponse({
        text:
          annotations.length > 0
            ? `${annotations.length} annotation${annotations.length === 1 ? "" : "s"}\n${formatMcpTable(annotations, ANNOTATION_COLUMNS)}`
            : "No annotations stored for this project.",
        meta: buildProjectMeta(
          context,
          args.projectId,
          INSIGHTS_PATH(args.projectId),
        ),
        structuredContent: { annotations },
      });
    },
  ),
};

const deleteInputSchema = {
  projectId: projectIdSchema,
  annotationId: z
    .string()
    .min(1)
    .describe("The annotation id from list_search_annotations."),
} as const;

export const deleteSearchAnnotationTool = {
  name: "delete_search_annotation",
  config: {
    title: "Delete Search Insights annotation",
    description:
      "Permanently delete one stored chart annotation by id (from list_search_annotations). Uses no credits.",
    inputSchema: deleteInputSchema,
    outputSchema: z.looseObject({
      annotationId: z.string(),
      deleted: z.boolean(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof deleteInputSchema>>, context) => {
      const deleted = await GscHistoryService.deleteAnnotation(
        args.projectId,
        args.annotationId,
      );
      return mcpResponse({
        text: deleted
          ? `Deleted annotation ${args.annotationId}.`
          : `No annotation ${args.annotationId} in this project.`,
        meta: buildProjectMeta(
          context,
          args.projectId,
          INSIGHTS_PATH(args.projectId),
        ),
        structuredContent: { annotationId: args.annotationId, deleted },
      });
    },
  ),
};
