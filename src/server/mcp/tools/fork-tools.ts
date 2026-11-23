import type { OpenSeoToolDefinition, ToolSchema } from "@/server/mcp/server";
import {
  addSearchAnnotationTool,
  deleteSearchAnnotationTool,
  getSearchInsightsTool,
  listSearchAnnotationsTool,
  syncSearchConsoleHistoryTool,
} from "@/server/mcp/tools/search-history-tools";
import {
  getOutreachOverviewTool,
  getOutreachProspectTool,
  getApprovedOutreachBatchTool,
  addOutreachProspectTool,
  updateOutreachProspectTool,
  scoreOutreachProspectTool,
  setOutreachAngleTool,
  addOutreachAngleTool,
  enrichOutreachProspectTool,
  draftOutreachEmailTool,
  recordOutreachSendTool,
  recordOutreachReplyTool,
  recordOutreachBounceTool,
  checkOutreachLinkTool,
  setOutreachStatusTool,
  updateOutreachSettingsTool,
} from "@/server/mcp/tools/outreach-tools";
import {
  getOutreachScheduleTool,
  pauseOutreachScheduleTool,
  rescheduleOutreachEmailTool,
  setOutreachQueuedTool,
} from "@/server/mcp/tools/outreach-schedule-tools";
import {
  getOutreachLinkTrafficTool,
  getSearchSignupsTool,
} from "@/server/mcp/tools/posthog-join-tools";

// The fork's MCP tools (see FORK-CHANGES.md): Search Console history, link
// outreach and its send schedule, and the PostHog joins. Registered after
// upstream's tools by registerOpenSeoTools.
export function registerForkTools(
  register: <Input extends ToolSchema>(
    tool: OpenSeoToolDefinition<Input>,
  ) => void,
) {
  register(syncSearchConsoleHistoryTool);
  register(getSearchInsightsTool);
  register(addSearchAnnotationTool);
  register(listSearchAnnotationsTool);
  register(deleteSearchAnnotationTool);
  register(getSearchSignupsTool);
  register(getOutreachLinkTrafficTool);
  register(getOutreachOverviewTool);
  register(getOutreachProspectTool);
  register(getApprovedOutreachBatchTool);
  register(addOutreachProspectTool);
  register(updateOutreachProspectTool);
  register(scoreOutreachProspectTool);
  register(setOutreachAngleTool);
  register(addOutreachAngleTool);
  register(enrichOutreachProspectTool);
  register(draftOutreachEmailTool);
  register(recordOutreachSendTool);
  register(recordOutreachReplyTool);
  register(recordOutreachBounceTool);
  register(checkOutreachLinkTool);
  register(setOutreachStatusTool);
  register(updateOutreachSettingsTool);
  register(getOutreachScheduleTool);
  register(rescheduleOutreachEmailTool);
  register(setOutreachQueuedTool);
  register(pauseOutreachScheduleTool);
}
