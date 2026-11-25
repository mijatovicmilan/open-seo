import { sort } from "remeda";
import { z } from "zod";
import { DashboardCacheService } from "@/server/features/dashboard/services/DashboardCacheService";
import { findFaviconCandidates } from "@/server/features/outreach/outreachDomain";
import {
  fetchFavicon,
  fetchPageHtml,
} from "@/server/features/outreach/pageFetch";

// Fork feature (FORK-CHANGES.md): a project's own favicon, read from its
// home page (the `<link rel="icon">` tags, then /favicon.ico) through the
// outreach page reader's SSRF guard, and kept for a day so a changed icon
// shows up the next day.

const DAY_MS = 86400_000;

// The switcher draws the icon at 24px (48px on a retina screen): a vector
// icon first, then the 180px Apple touch icon, then the small favicons.
function sharpness(a: string, b: string) {
  const rank = (url: string) =>
    /\.svg($|\?)/iu.test(url) ? 0 : /apple-touch/iu.test(url) ? 1 : 2;
  return rank(a) - rank(b);
}

/** The icon as a data URI, or null when the site has none we can read. */
export async function getProjectFavicon(
  organizationId: string,
  domain: string,
): Promise<string | null> {
  const cached = await DashboardCacheService.readThrough({
    namespace: "project:favicon:v2",
    organizationId,
    params: { domain },
    schema: z.string().nullable(),
    maxAgeMs: DAY_MS,
    load: async () => {
      const home = `https://${domain}/`;
      const page = await fetchPageHtml(home);
      return fetchFavicon(
        "error" in page
          ? [new URL("/favicon.ico", home).toString()]
          : sort(findFaviconCandidates(page.html, page.url), sharpness),
      );
    },
  });
  return cached.value;
}
