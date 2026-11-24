import { env } from "cloudflare:workers";

/**
 * Fork feature (FORK-CHANGES.md). DATAFORSEO_AUTO_CALLS=off stops the
 * DataForSEO calls nobody asked for by name: the dashboard's New backlinks
 * card and Backlinks tab (shown from the saved result, loaded on a click),
 * and a rank tracker's keyword suggestions and its check and stats right
 * after keywords are added. Searches, checks and refreshes a person starts
 * still run.
 */
export function automaticDataforseoCallsOff(): boolean {
  const value: unknown = Reflect.get(env, "DATAFORSEO_AUTO_CALLS");
  return typeof value === "string" && value.trim().toLowerCase() === "off";
}
