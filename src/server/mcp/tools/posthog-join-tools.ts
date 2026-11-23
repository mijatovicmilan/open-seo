import { z } from "zod";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { formatMcpTable } from "@/server/mcp/table";
import { projectIdSchema } from "@/server/mcp/schemas";
import { GscHistoryRepository } from "@/server/features/gsc-history/repositories/GscHistoryRepository";
import { shiftGa4Date } from "@/server/features/ga4/services/Ga4Dates";
import { PosthogJoinService } from "@/server/features/posthog/services/PosthogJoinService";
import { Ga4ReportError } from "@/server/lib/ga4Errors";

// Fork addition (FORK-CHANGES.md): MCP tools for our joins of Search
// Console, outreach and PostHog. Read-only, no credits.

const NOT_POSTHOG =
  "This project's analytics source is not PostHog. Choose PostHog in Settings → Integrations to join visits and signups.";

const pct = (value: unknown) =>
  typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "—";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Inclusive YYYY-MM-DD date. Provide both startDate and endDate.");

const searchSignupsInputSchema = {
  projectId: projectIdSchema,
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  page: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .optional()
    .describe("Limit to one page URL as Search Console reports it."),
  limit: z.number().int().min(1).max(200).optional().default(50),
} as const;

function errorText(error: unknown): string {
  if (error instanceof Ga4ReportError) return error.message;
  throw error;
}

export const getSearchSignupsTool = {
  name: "get_search_signups",
  config: {
    title: "Get search clicks to signups",
    description:
      "Per page: Search Console clicks, impressions and position (stored history) joined with PostHog visits from Google organic search and signups (visits with one of the project's key events), plus totals for the period. Use it to find pages that rank and get clicks but don't convert, or convert well and deserve more search traffic. Defaults to the 28 days ending on the newest stored Search Console day. Needs PostHog as the project's analytics source. Visits are sessions; on cookieless sites they are estimates. Read-only and uses no credits.",
    inputSchema: searchSignupsInputSchema,
    outputSchema: z.looseObject({
      available: z.boolean(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (
      args: z.infer<z.ZodObject<typeof searchSignupsInputSchema>>,
      context,
    ) => {
      const meta = buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/search-insights`,
      );
      if (Boolean(args.startDate) !== Boolean(args.endDate)) {
        throw new Error("Provide both startDate and endDate, or neither.");
      }
      const bounds = await GscHistoryRepository.getHistoryBounds(
        args.projectId,
      );
      const end =
        args.endDate ??
        bounds.newest ??
        shiftGa4Date(new Date().toISOString().slice(0, 10), -3);
      const start = args.startDate ?? shiftGa4Date(end, -27);
      let result;
      try {
        result = await PosthogJoinService.getSearchSignups({
          projectId: args.projectId,
          current: { start, end },
          page: args.page,
        });
      } catch (error) {
        const message = errorText(error);
        return mcpResponse({
          text: message,
          meta,
          structuredContent: { available: false, error: message },
        });
      }
      if (!result.available) {
        return mcpResponse({
          text: NOT_POSTHOG,
          meta,
          structuredContent: { available: false, reason: NOT_POSTHOG },
        });
      }
      const pages = result.pages.slice(0, args.limit);
      const totals = result.totals;
      const summary = `Search to signups, ${start} to ${end} (key events: ${result.source.keyEvents.join(", ") || "none set"}): ${totals?.visits ?? 0} Google visits, ${totals?.signups ?? 0} signups. ${pages.length} of ${result.pages.length} pages shown.${bounds.newest ? "" : " No Search Console history is stored, so clicks are 0."}`;
      return mcpResponse({
        text: `${summary}\n${formatMcpTable(pages, [
          { header: "page", value: (row) => row.page },
          { header: "clicks", value: (row) => row.clicks },
          { header: "impressions", value: (row) => row.impressions },
          { header: "position", value: (row) => row.position },
          { header: "googleVisits", value: (row) => row.visits },
          { header: "signups", value: (row) => row.signups },
          {
            header: "signupRate",
            value: (row) => row.signupRate,
            format: pct,
          },
        ])}`,
        meta,
        structuredContent: {
          available: true,
          source: result.source,
          dateRange: { startDate: start, endDate: end },
          totals,
          rowCount: pages.length,
          totalRowCount: result.pages.length,
          pages,
          notes: [
            "Search Console days are Pacific time; PostHog days are in the PostHog project's time zone.",
            "A signup is a visit with at least one key event.",
          ],
        },
      });
    },
  ),
};

const linkTrafficInputSchema = { projectId: projectIdSchema } as const;

export const getOutreachLinkTrafficTool = {
  name: "get_outreach_link_traffic",
  config: {
    title: "Get outreach link traffic",
    description:
      "For each link earned through outreach: PostHog visits from the linking site since the link was found, the signups those visits brought (visits with a key event), visits whose referrer is the exact linking page (zero when the site sends only its domain), and the last visit day. Up to a year back. Needs PostHog as the project's analytics source. Read-only and uses no credits.",
    inputSchema: linkTrafficInputSchema,
    outputSchema: z.looseObject({
      available: z.boolean(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (
      args: z.infer<z.ZodObject<typeof linkTrafficInputSchema>>,
      context,
    ) => {
      const meta = buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/outreach`,
      );
      let result;
      try {
        result = await PosthogJoinService.getOutreachLinkTraffic(
          args.projectId,
        );
      } catch (error) {
        const message = errorText(error);
        return mcpResponse({
          text: message,
          meta,
          structuredContent: { available: false, error: message },
        });
      }
      if (!result.available) {
        return mcpResponse({
          text: NOT_POSTHOG,
          meta,
          structuredContent: { available: false, reason: NOT_POSTHOG },
        });
      }
      const visits = result.links.reduce((sum, link) => sum + link.visits, 0);
      const signups = result.links.reduce((sum, link) => sum + link.signups, 0);
      return mcpResponse({
        text: `${result.links.length} earned link(s): ${visits} visits and ${signups} signups from the linking sites.\n${formatMcpTable(
          result.links,
          [
            { header: "#", value: (row) => row.number },
            { header: "site", value: (row) => row.site },
            { header: "theirPage", value: (row) => row.theirPage },
            { header: "since", value: (row) => row.since },
            { header: "visits", value: (row) => row.visits },
            { header: "fromPage", value: (row) => row.fromPage.visits },
            { header: "signups", value: (row) => row.signups },
            { header: "lastVisit", value: (row) => row.lastVisitAt },
          ],
        )}`,
        meta,
        structuredContent: {
          available: true,
          source: result.source,
          links: result.links,
        },
      });
    },
  ),
};
