import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getProjectFavicon } from "@/server/features/projects/services/projectFavicon";
import { requireProjectContext } from "@/serverFunctions/middleware";

// Fork feature (FORK-CHANGES.md): the project switcher's site icon.
export const getProjectFaviconFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(z.object({ projectId: z.string().min(1) }))
  .handler(({ context }) =>
    context.project.domain
      ? getProjectFavicon(context.organizationId, context.project.domain)
      : null,
  );
