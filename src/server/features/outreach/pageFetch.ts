// Reading a prospect's page (fork feature): the HTML for a link check, the
// article title, and a small favicon. Every hop is re-validated against the
// SSRF guard the site audit uses, and responses are size-bounded.

import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 3_000_000;
const MAX_ICON_BYTES = 30_000;
const MAX_HOPS = 4;
// A browser-like UA: many blogs refuse unknown bots, and we only read one
// public page the way a reader would.
const USER_AGENT =
  "Mozilla/5.0 (compatible; OpenSEO-LinkCheck/1.0; +https://openseo.so)";

type Fetched = { response: Response; url: string };

async function fetchFollowing(
  url: string,
  accept: string,
): Promise<Fetched | { error: string }> {
  let current: string;
  try {
    current = await normalizeAndValidateStartUrl(url);
  } catch {
    return { error: "the address is not a public web page" };
  }
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        headers: { "user-agent": USER_AGENT, accept },
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      return { error: "the page did not answer" };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location)
        return { error: `redirect without a target (${response.status})` };
      try {
        current = await normalizeAndValidateStartUrl(
          new URL(location, current).toString(),
        );
      } catch {
        return { error: "the page redirects to a blocked address" };
      }
      continue;
    }
    return { response, url: current };
  }
  return { error: "too many redirects" };
}

async function readBounded(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchPageHtml(
  url: string,
): Promise<{ html: string; url: string } | { error: string }> {
  const fetched = await fetchFollowing(url, "text/html,*/*;q=0.8");
  if ("error" in fetched) return fetched;
  if (!fetched.response.ok) {
    return { error: `the page answered ${fetched.response.status}` };
  }
  const bytes = await readBounded(fetched.response, MAX_HTML_BYTES);
  if (!bytes) return { error: "the page is too large to read" };
  return { html: new TextDecoder().decode(bytes), url: fetched.url };
}

const ICON_TYPES = new Set([
  "image/png",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/gif",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

// The first candidate that is a small image, as a data URI.
export async function fetchFavicon(candidates: string[]) {
  for (const candidate of candidates.slice(0, 4)) {
    const fetched = await fetchFollowing(candidate, "image/*");
    if ("error" in fetched || !fetched.response.ok) continue;
    const type = (fetched.response.headers.get("content-type") ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase();
    if (!type || !ICON_TYPES.has(type)) continue;
    const bytes = await readBounded(fetched.response, MAX_ICON_BYTES);
    if (!bytes?.byteLength) continue;
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:${type};base64,${btoa(binary)}`;
  }
  return null;
}
