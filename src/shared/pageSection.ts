/**
 * Fork feature (FORK-CHANGES.md): a page's type in Search Insights, read from
 * its URL. The type is the first folder of the path ("/tools/age" and
 * "/tools/" are "tools"); the home page and other top-level pages
 * ("/", "/pricing") have none and share TOP_LEVEL_SECTION.
 */

export const TOP_LEVEL_SECTION = "/";

export function pageSection(url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Not a full URL: read it as a path.
  }
  const trimmed = path.replace(/^\/+/, "");
  const slash = trimmed.indexOf("/");
  return slash > 0 ? trimmed.slice(0, slash) : TOP_LEVEL_SECTION;
}

export function sectionLabel(section: string): string {
  return section === TOP_LEVEL_SECTION ? "top level" : section;
}
