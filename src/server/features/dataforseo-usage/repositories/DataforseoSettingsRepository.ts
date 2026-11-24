import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dataforseoSettings } from "@/db/schema";

// Fork feature (FORK-CHANGES.md): the organization's DataForSEO settings.

async function getAutomaticCalls(organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ automaticCalls: dataforseoSettings.automaticCalls })
    .from(dataforseoSettings)
    .where(eq(dataforseoSettings.organizationId, organizationId));
  return row?.automaticCalls ?? true;
}

async function setAutomaticCalls(organizationId: string, enabled: boolean) {
  const updatedAt = new Date().toISOString();
  await db
    .insert(dataforseoSettings)
    .values({ organizationId, automaticCalls: enabled, updatedAt })
    .onConflictDoUpdate({
      target: dataforseoSettings.organizationId,
      set: { automaticCalls: enabled, updatedAt },
    });
}

export const DataforseoSettingsRepository = {
  getAutomaticCalls,
  setAutomaticCalls,
};
