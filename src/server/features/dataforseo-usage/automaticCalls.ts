import { DataforseoSettingsRepository } from "./repositories/DataforseoSettingsRepository";

/**
 * Fork feature (FORK-CHANGES.md). With automatic calls turned off in
 * Settings → DataForSEO usage, the DataForSEO calls nobody asked for by name
 * wait for a click: the dashboard's New backlinks card and Backlinks tab
 * (shown from the saved result), and a rank tracker's keyword suggestions
 * and its check and stats right after keywords are added. Searches, checks
 * and refreshes a person starts still run.
 */
export async function automaticDataforseoCallsOff(
  organizationId: string,
): Promise<boolean> {
  return !(await DataforseoSettingsRepository.getAutomaticCalls(
    organizationId,
  ));
}
