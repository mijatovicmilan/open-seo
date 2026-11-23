import type {
  Ga4Channel,
  Ga4ReportKind,
} from "@/server/features/ga4/services/Ga4ReportDefinitions";

// Fork addition (FORK-CHANGES.md): HogQL for the GA4-shaped reports. Every
// query returns its columns under GA4's dimension and metric names, so the
// GA4 report pipeline (paging, comparison, diagnostics) and every screen and
// MCP tool read PostHog rows unchanged.
//
// Sessions: PostHog's own session table (entry page, channel, bounce) joined
// to events; an engaged session is one PostHog does not count as a bounce
// (over 10 seconds, two pages, or an interaction), as GA4 does. Cookieless
// sites get a new visitor ID every day, so users (and sessions spanning a
// day) are estimates; page views and events are exact.
//
// Anything a person typed (key event names, a page path, link domains) goes
// in `values`, never into the query text. Personal API keys may not use
// OFFSET, so a query fetches the first offset + limit rows and the caller
// slices the page.

export type PosthogMetricRow = Record<string, number>;

export type PosthogQuery = {
  query: string;
  values: Record<string, unknown>;
  dimensions: string[];
  /** Metric columns the query returns, after the dimensions. */
  rawMetrics: string[];
  /** GA4 metrics in the report, in GA4's request order. */
  metrics: string[];
  derived: Record<string, (row: PosthogMetricRow) => number>;
  /** The query ends with a `__total` column: the row count before LIMIT. */
  hasTotal: boolean;
};

export type PosthogReportQueryInput = {
  kind: Ga4ReportKind;
  startDate: string;
  endDate: string;
  channel: Ga4Channel;
  /** Rows to fetch from the top (offset + page size). */
  fetchLimit: number;
  includeDate?: boolean;
  breakdown?: "event" | "event_and_landing_page";
  acquisitionBreakdown?: "channel_group" | "source_medium" | "campaign";
  audienceBreakdown?: "device" | "country" | "new_vs_returning";
  keyEvents: string[];
};

/** PostHog cannot answer these GA4 reports. */
export function unsupportedPosthogReason(
  input: Pick<PosthogReportQueryInput, "kind" | "audienceBreakdown">,
): string | null {
  if (input.kind === "ecommerce_performance") {
    return "Ecommerce reports need GA4 ecommerce events; this project's analytics source is PostHog.";
  }
  if (
    input.kind === "audience_breakdown" &&
    input.audienceBreakdown === "new_vs_returning"
  ) {
    return "New versus returning needs a visitor ID that lasts; this PostHog project counts visitors without cookies.";
  }
  return null;
}

/** GA4 metrics PostHog has no equivalent for; left out of PostHog reports. */
export const POSTHOG_UNSUPPORTED_METRICS = new Set([
  "transactions",
  "purchaseRevenue",
]);

export const ratio = (part: number, whole: number) =>
  whole > 0 ? part / whole : 0;

const engagementRate = (row: PosthogMetricRow) =>
  ratio(row.engagedSessions ?? 0, row.sessions ?? 0);
const sessionKeyEventRate = (row: PosthogMetricRow) =>
  ratio(row.convertedSessions ?? 0, row.sessions ?? 0);

/** No key events configured: an event name that never occurs keeps
 *  `IN {key_events}` valid. */
export function keyEventValues(keyEvents: string[]): string[] {
  return keyEvents.length > 0 ? keyEvents : [""];
}

const EVENT_WINDOW = `{filters}
    AND timestamp >= toDateTime({start}) - INTERVAL 1 DAY
    AND timestamp < toDateTime({end}) + INTERVAL 2 DAY`;

const ORGANIC_SESSION = "channel = 'Organic Search'";
const ORGANIC_EVENT = "session.$channel_type = 'Organic Search'";

/** One row per session that started in the range (days in the PostHog
 *  project's time zone). */
export const SESSIONS_SUBQUERY = `SELECT
    $session_id AS session_id,
    any(distinct_id) AS visitor,
    any(session.$entry_hostname) AS host,
    any(session.$entry_pathname) AS landing_page,
    any(session.$channel_type) AS channel,
    any(session.$is_bounce) AS is_bounce,
    any(session.$entry_referring_domain) AS referring_domain,
    any(session.$entry_utm_source) AS utm_source,
    any(session.$entry_utm_medium) AS utm_medium,
    any(session.$entry_utm_campaign) AS utm_campaign,
    argMin(properties.$device_type, timestamp) AS device,
    argMin(coalesce(nullIf(properties.$geoip_country_name, ''), properties.$geoip_country_code), timestamp) AS country,
    argMinIf(properties.$referrer, timestamp, event = '$pageview') AS referrer,
    toDate(min(timestamp)) AS day,
    countIf(event IN {key_events}) AS key_events
  FROM events
  WHERE ${EVENT_WINDOW}
    AND $session_id IS NOT NULL AND $session_id != ''
    AND (event = '$pageview' OR event IN {key_events})
  GROUP BY session_id
  HAVING day >= toDate({start}) AND day <= toDate({end})`;

const SESSION_METRICS = `count() AS sessions,
  uniqExact(visitor) AS activeUsers,
  countIf(is_bounce = 0) AS engagedSessions,
  sum(key_events) AS keyEvents,
  countIf(key_events > 0) AS convertedSessions`;
const SESSION_RAW_METRICS = [
  "sessions",
  "activeUsers",
  "engagedSessions",
  "keyEvents",
  "convertedSessions",
];

/** "www.example.com" → "example.com"; "$direct" stays. */
export const domainExpr = (column: string) =>
  `if(startsWith(${column}, 'www.'), substring(${column}, 5, length(${column})), ${column})`;
const IS_DIRECT =
  "(referring_domain IS NULL OR referring_domain = '' OR referring_domain = '$direct')";
const SOURCE_EXPR = `coalesce(nullIf(utm_source, ''), if(${IS_DIRECT}, '(direct)', ${domainExpr("referring_domain")}))`;
const MEDIUM_EXPR = `coalesce(nullIf(utm_medium, ''), multiIf(${IS_DIRECT}, '(none)', channel = 'Organic Search', 'organic', 'referral'))`;

const ACQUISITION_DIMENSIONS = {
  channel_group: {
    name: "sessionDefaultChannelGroup",
    expr: "if(channel IS NULL OR channel IN ('', 'Unknown'), 'Unassigned', channel)",
  },
  source_medium: {
    name: "sessionSourceMedium",
    expr: `concat(${SOURCE_EXPR}, ' / ', ${MEDIUM_EXPR})`,
  },
  campaign: {
    name: "sessionCampaignName",
    expr: `coalesce(nullIf(utm_campaign, ''), multiIf(${IS_DIRECT}, '(direct)', channel = 'Organic Search', '(organic)', channel = 'Referral', '(referral)', '(not set)'))`,
  },
} as const;

const AUDIENCE_DIMENSIONS = {
  device: {
    name: "deviceCategory",
    expr: "lower(coalesce(nullIf(device, ''), '(not set)'))",
  },
  country: {
    name: "country",
    expr: "coalesce(nullIf(country, ''), '(not set)')",
  },
} as const;

/** GA4 site-search parameters, from page URLs or a custom search event. */
const SEARCH_TERM_EXPR = `lower(trim(decodeURLComponent(replaceAll(coalesce(
      if(event = '$pageview', coalesce(
        nullIf(extractURLParameter(properties.$current_url, 'q'), ''),
        nullIf(extractURLParameter(properties.$current_url, 's'), ''),
        nullIf(extractURLParameter(properties.$current_url, 'search'), ''),
        nullIf(extractURLParameter(properties.$current_url, 'query'), ''),
        nullIf(extractURLParameter(properties.$current_url, 'keyword'), '')), NULL),
      toString(coalesce(properties.search_term, properties.query, properties.q, properties.keyword)),
      ''), '+', ' '))))`;

function sessionReport(input: {
  dimensions: Array<{ name: string; expr: string }>;
  where: string;
  fetchLimit: number;
}): Pick<PosthogQuery, "query" | "dimensions" | "rawMetrics" | "hasTotal"> {
  const names = input.dimensions.map((dimension) => dimension.name);
  return {
    query: `SELECT
  ${input.dimensions.map((d) => `${d.expr} AS ${d.name}`).join(",\n  ")},
  ${SESSION_METRICS},
  count() OVER () AS __total
FROM (${SESSIONS_SUBQUERY})
WHERE ${input.where}
GROUP BY ${names.join(", ")}
ORDER BY sessions DESC, ${names.map((name) => `${name} ASC`).join(", ")}
LIMIT ${input.fetchLimit}`,
    dimensions: names,
    rawMetrics: SESSION_RAW_METRICS,
    hasTotal: true,
  };
}

const HOST = { name: "hostName", expr: "coalesce(host, '(not set)')" };
const LANDING = {
  name: "landingPage",
  expr: "coalesce(landing_page, '(not set)')",
};

function reportBody(
  input: PosthogReportQueryInput,
): Pick<PosthogQuery, "query" | "dimensions" | "rawMetrics" | "hasTotal"> {
  const organic = input.channel === "organic_search";
  switch (input.kind) {
    case "landing_pages":
      return sessionReport({
        dimensions: [HOST, LANDING],
        where: organic ? ORGANIC_SESSION : "1 = 1",
        fetchLimit: input.fetchLimit,
      });
    case "traffic_acquisition":
      return sessionReport({
        dimensions: [
          ACQUISITION_DIMENSIONS[input.acquisitionBreakdown ?? "channel_group"],
        ],
        where: "1 = 1",
        fetchLimit: input.fetchLimit,
      });
    case "audience_breakdown": {
      const breakdown =
        input.audienceBreakdown === "country" ? "country" : "device";
      return sessionReport({
        dimensions: [AUDIENCE_DIMENSIONS[breakdown]],
        where: organic ? ORGANIC_SESSION : "1 = 1",
        fetchLimit: input.fetchLimit,
      });
    }
    case "page_performance": {
      const organicEvents = organic ? ORGANIC_EVENT : "1 = 1";
      const dimensions = ["hostName", "pagePath"];
      if (input.includeDate) dimensions.push("date");
      return {
        query: `SELECT
  coalesce(host, '(not set)') AS hostName,
  coalesce(path, '(not set)') AS pagePath,${input.includeDate ? "\n  formatDateTime(day, '%Y%m%d') AS date," : ""}
  sum(views) AS screenPageViews,
  uniqExactIf(visitor, views > 0) AS activeUsers,
  round(sum(duration)) AS userEngagementDuration,
  sum(conversions) AS keyEvents,
  count() OVER () AS __total
FROM (
  SELECT properties.$host AS host, properties.$pathname AS path,
    distinct_id AS visitor, toDate(timestamp) AS day,
    if(event = '$pageview', 1, 0) AS views, 0.0 AS duration,
    if(event IN {key_events}, 1, 0) AS conversions
  FROM events
  WHERE ${EVENT_WINDOW}
    AND (event = '$pageview' OR event IN {key_events}) AND ${organicEvents}
  UNION ALL
  SELECT properties.$host, properties.$prev_pageview_pathname, distinct_id,
    toDate(timestamp), 0, toFloat(properties.$prev_pageview_duration), 0
  FROM events
  WHERE ${EVENT_WINDOW}
    AND event IN ('$pageview', '$pageleave')
    AND properties.$prev_pageview_duration IS NOT NULL AND ${organicEvents}
)
WHERE day >= toDate({start}) AND day <= toDate({end})
GROUP BY ${dimensions.join(", ")}
HAVING screenPageViews > 0
ORDER BY screenPageViews DESC, ${dimensions.map((name) => `${name} ASC`).join(", ")}
LIMIT ${input.fetchLimit}`,
        dimensions,
        rawMetrics: [
          "screenPageViews",
          "activeUsers",
          "userEngagementDuration",
          "keyEvents",
        ],
        hasTotal: true,
      };
    }
    case "key_events": {
      const withLanding = input.breakdown === "event_and_landing_page";
      const dimensions = withLanding
        ? ["eventName", "hostName", "landingPage"]
        : ["eventName"];
      return {
        query: `SELECT
  event AS eventName,${withLanding ? "\n  coalesce(session.$entry_hostname, '(not set)') AS hostName,\n  coalesce(session.$entry_pathname, '(not set)') AS landingPage," : ""}
  count() AS keyEvents,
  uniqExact(distinct_id) AS totalUsers,
  count() OVER () AS __total
FROM events
WHERE ${EVENT_WINDOW}
  AND event IN {key_events}
  AND toDate(timestamp) >= toDate({start}) AND toDate(timestamp) <= toDate({end})
  AND ${organic ? ORGANIC_EVENT : "1 = 1"}
GROUP BY ${dimensions.join(", ")}
ORDER BY keyEvents DESC, ${dimensions.map((name) => `${name} ASC`).join(", ")}
LIMIT ${input.fetchLimit}`,
        dimensions,
        rawMetrics: ["keyEvents", "totalUsers"],
        hasTotal: true,
      };
    }
    case "site_search":
      return {
        query: `SELECT
  term AS searchTerm,
  count() AS eventCount,
  uniqExact(visitor) AS activeUsers,
  uniqExact(session_id) AS sessions,
  uniqExactIf(session_id, is_bounce = 0) AS engagedSessions,
  count() OVER () AS __total
FROM (
  SELECT distinct_id AS visitor, $session_id AS session_id,
    session.$is_bounce AS is_bounce, toDate(timestamp) AS day,
    ${SEARCH_TERM_EXPR} AS term
  FROM events
  WHERE ${EVENT_WINDOW}
    AND (event = '$pageview' OR (event ILIKE '%search%' AND NOT startsWith(event, '$')))
)
WHERE term != '' AND day >= toDate({start}) AND day <= toDate({end})
GROUP BY searchTerm
ORDER BY eventCount DESC, searchTerm ASC
LIMIT ${input.fetchLimit}`,
        dimensions: ["searchTerm"],
        rawMetrics: [
          "eventCount",
          "activeUsers",
          "sessions",
          "engagedSessions",
        ],
        hasTotal: true,
      };
    case "ecommerce_performance":
      throw new Error("Ecommerce has no PostHog query.");
  }
}

/** The PostHog query for a GA4 report kind. `gaMetrics` are the metrics
 *  GA4 would return; PostHog returns those it can compute. */
export function buildPosthogReportQuery(
  input: PosthogReportQueryInput,
  gaMetrics: string[],
): PosthogQuery {
  const body = reportBody(input);
  return {
    ...body,
    values: {
      start: input.startDate,
      end: input.endDate,
      key_events: keyEventValues(input.keyEvents),
    },
    metrics: gaMetrics.filter(
      (metric) => !POSTHOG_UNSUPPORTED_METRICS.has(metric),
    ),
    derived: { engagementRate, sessionKeyEventRate },
  };
}

/** Organic totals for one range, or the organic trend by day or week. */
export function buildPosthogOverviewQuery(input: {
  startDate: string;
  endDate: string;
  keyEvents: string[];
  trend?: "daily" | "weekly";
}): PosthogQuery {
  const trendDimension = input.trend
    ? input.trend === "daily"
      ? { name: "date", expr: "formatDateTime(day, '%Y%m%d')" }
      : { name: "yearWeek", expr: "toString(toYearWeek(day, 0))" }
    : null;
  const select = trendDimension
    ? `${trendDimension.expr} AS ${trendDimension.name},\n  `
    : "";
  const groupBy = trendDimension
    ? `\nGROUP BY ${trendDimension.name}\nORDER BY ${trendDimension.name} ASC\nLIMIT 1000`
    : "";
  return {
    query: `SELECT
  ${select}${SESSION_METRICS}
FROM (${SESSIONS_SUBQUERY})
WHERE ${ORGANIC_SESSION}${groupBy}`,
    values: {
      start: input.startDate,
      end: input.endDate,
      key_events: keyEventValues(input.keyEvents),
    },
    dimensions: trendDimension ? [trendDimension.name] : [],
    rawMetrics: SESSION_RAW_METRICS,
    metrics: [
      "sessions",
      "activeUsers",
      "engagedSessions",
      "engagementRate",
      "keyEvents",
    ],
    derived: { engagementRate },
    hasTotal: false,
  };
}

/** Measurement health: every event of the last 30 days, page views by
 *  host, and whether any page view or event carried a search term. */
export const POSTHOG_HEALTH_QUERIES = {
  events: `SELECT event, count() AS events, max(timestamp) AS lastSeenAt
FROM events
WHERE {filters} AND timestamp >= now() - INTERVAL 30 DAY
GROUP BY event
ORDER BY events DESC, event ASC
LIMIT 500`,
  hosts: `SELECT properties.$host AS host, count() AS pageviews,
  max(timestamp) AS lastSeenAt,
  countIf(properties.$cookieless_mode = true) AS cookielessPageviews
FROM events
WHERE {filters} AND event = '$pageview' AND timestamp >= now() - INTERVAL 30 DAY
GROUP BY host
ORDER BY pageviews DESC, host ASC
LIMIT 50`,
  siteSearch: `SELECT countIf(${SEARCH_TERM_EXPR} != '') AS searches
FROM events
WHERE {filters} AND timestamp >= now() - INTERVAL 30 DAY
  AND (event = '$pageview' OR (event ILIKE '%search%' AND NOT startsWith(event, '$')))`,
} as const;

// ---------------------------------------------------------------------------
// Our joins: Search Console pages → visits from Google → signups, and
// outreach links → visits from the linking site → signups. A signup is a
// session with at least one key event.
// ---------------------------------------------------------------------------

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

export type JoinRange = { startDate: string; endDate: string };

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
FROM (${SESSIONS_SUBQUERY})
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
FROM (${SESSIONS_SUBQUERY})
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
