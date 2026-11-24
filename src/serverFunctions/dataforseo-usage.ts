import { createServerFn } from "@tanstack/react-start";
import { DataforseoUsageService } from "@/server/features/dataforseo-usage/services/DataforseoUsageService";
import { AppError } from "@/server/lib/errors";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";

// Fork feature (FORK-CHANGES.md). Self-hosted only: the hosted app bills
// through Autumn and logs nothing here.
export const getDataforseoUsage = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    if (await isHostedServerAuthMode()) throw new AppError("NOT_FOUND");
    return DataforseoUsageService.getUsage(context.organizationId);
  });
