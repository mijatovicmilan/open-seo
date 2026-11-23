import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AgentSetupContent } from "@/client/features/ai-mcp/AgentSetupContent";
import { pageHead } from "@/client/lib/pageHead";

// Fork addition (FORK-CHANGES.md): the MCP connection is per instance, so
// agent setup sits in the app's Settings instead of the sidebar.
const agentSearchSchema = z.object({
  // Active tab. Omitted for the default "setup" tab.
  tab: z.enum(["skills"]).optional().catch(undefined),
});

export const Route = createFileRoute("/_app/settings/agent")({
  head: () => pageHead("Agent setup"),
  validateSearch: agentSearchSchema,
  component: AgentSettingsRoute,
});

function AgentSettingsRoute() {
  const { tab = "setup" } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AgentSetupContent
      tab={tab}
      onTab={(next) =>
        void navigate({
          search: { tab: next === "skills" ? "skills" : undefined },
          replace: true,
        })
      }
    />
  );
}
