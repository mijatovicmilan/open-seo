import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

// Fork addition (FORK-CHANGES.md): agent setup lives under Settings →
// Agent setup (AgentSetupContent); /ai keeps working for links in guides.
const aiSearchSchema = z.object({
  tab: z.enum(["skills"]).optional().catch(undefined),
});

export const Route = createFileRoute("/_app/ai")({
  validateSearch: aiSearchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/settings/agent", search, replace: true });
  },
});
