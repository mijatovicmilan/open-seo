import {
  domainExpr,
  keyEventValues,
  PACIFIC_SESSIONS_SUBQUERY,
  SESSIONS_SUBQUERY,
} from "./posthogQueries";

// Fork addition (FORK-CHANGES.md): HogQL for our joins. Uses the session
// rows of posthogQueries (one per session, with its key events).

// ---------------------------------------------------------------------------
// Our joins: Search Console pages → visits from Google → signups, and
// outreach links → visits from the linking site → signups. A signup is a
// session with at least one key event.
// ---------------------------------------------------------------------------

// Google visits and signups are counted on Search Console's days (Pacific
// time), so they line up with its clicks day by day.

/** Google organic sessions; Search Console's own "open page" links
 *  (search.google.com) are not search traffic. */
const GOOGLE_SESSION = `channel = 'Organic Search'
  AND referring_domain LIKE '%google.%'
  AND referring_domain != 'search.google.com'`;

/** "/guides/x/" → "/guides/x"; "/" stays. */
const pathExpr = (column: string) =>
  `if(length(${column}) > 1 AND endsWith(${column}, '/'), substring(${column}, 1, length(${column}) - 1), ${column})`;

const JOIN_METRICS = `count() AS visits,
  countIf(key_events > 0) AS signups,
  sum(key_events) AS keyEvents`;

type JoinRange = { startDate: string; endDate: string };

/** Google visits and signups per day, optionally for one page or device. */
export function buildGoogleDailyQuery(
  input: JoinRange & {
    keyEvents: string[];
    page?: { host: string; path: string };
    device?: string;
  },
) {
  return {
    query: `SELECT toString(day) AS date, ${JOIN_METRICS}
FROM (${PACIFIC_SESSIONS_SUBQUERY})
WHERE ${GOOGLE_SESSION}${input.page ? `\n  AND ${domainExpr("host")} = {page_host} AND ${pathExpr("landing_page")} = {page_path}` : ""}${input.device ? "\n  AND lower(device) = {device}" : ""}
GROUP BY date
ORDER BY date ASC
LIMIT 2000`,
    values: {
      start: input.startDate,
      end: input.endDate,
      key_events: keyEventValues(input.keyEvents),
      ...(input.page
        ? { page_host: input.page.host, page_path: input.page.path }
        : {}),
      ...(input.device ? { device: input.device } : {}),
    },
  };
}

/** Google visits and signups per landing page. */
export function buildGooglePagesQuery(
  input: JoinRange & { keyEvents: string[]; device?: string },
) {
  return {
    query: `SELECT ${domainExpr("coalesce(host, '')")} AS host,
  ${pathExpr("coalesce(landing_page, '/')")} AS path,
  ${JOIN_METRICS}
FROM (${PACIFIC_SESSIONS_SUBQUERY})
WHERE ${GOOGLE_SESSION}${input.device ? "\n  AND lower(device) = {device}" : ""}
GROUP BY host, path
ORDER BY visits DESC, host ASC, path ASC
LIMIT 1000`,
    values: {
      start: input.startDate,
      end: input.endDate,
      key_events: keyEventValues(input.keyEvents),
      ...(input.device ? { device: input.device } : {}),
    },
  };
}

/** Visits and signups from the given referring domains (no "www."), per
 *  domain, day and referring URL. */
export function buildReferralQuery(
  input: JoinRange & { keyEvents: string[]; domains: string[] },
) {
  return {
    query: `SELECT ${domainExpr("referring_domain")} AS domain,
  toString(day) AS date,
  coalesce(referrer, '') AS referrer,
  ${JOIN_METRICS}
FROM (${SESSIONS_SUBQUERY})
WHERE ${domainExpr("referring_domain")} IN {domains}
GROUP BY domain, date, referrer
ORDER BY date ASC, domain ASC, referrer ASC
LIMIT 10000`,
    values: {
      start: input.startDate,
      end: input.endDate,
      key_events: keyEventValues(input.keyEvents),
      domains: input.domains.length > 0 ? input.domains : [""],
    },
  };
}
