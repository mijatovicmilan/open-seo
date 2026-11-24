import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DataforseoSettingsRepository } from "@/server/features/dataforseo-usage/repositories/DataforseoSettingsRepository";
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

// Fork feature (FORK-CHANGES.md): the switch on the DataForSEO usage page.
export const setDataforseoAutomaticCalls = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(z.object({ enabled: z.boolean() }))
  .handler(async ({ context, data }) => {
    if (await isHostedServerAuthMode()) throw new AppError("NOT_FOUND");
    await DataforseoSettingsRepository.setAutomaticCalls(
      context.organizationId,
      data.enabled,
    );
    return { enabled: data.enabled };
  });
