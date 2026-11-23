import { runHogql } from "@/server/lib/posthogClient";
import { Ga4ReportError } from "@/server/lib/ga4Errors";
import { getGa4ReportConfiguration } from "@/server/features/ga4/services/Ga4ReportDefinitions";
import {
  buildReportComparison,
  buildReportSpecificEnhancements,
  comparisonValue,
  COMPLETE_REPORT_LIMIT,
  needsCompleteReport,
  previousPeriod,
  supportsComparison,
} from "@/server/features/ga4/services/Ga4ReportEnhancements";
import {
  normalizeLimit,
  normalizeOffset,
  resolveGa4DateRange,
  type Ga4ReportInput,
} from "@/server/features/ga4/services/Ga4ReportingService";
import { keyEventDiagnostics } from "@/server/features/ga4/services/Ga4OrganicOverviewService";
import type { PosthogSource } from "./posthogSource";
import {
  buildPosthogOverviewQuery,
  buildPosthogReportQuery,
  POSTHOG_HEALTH_QUERIES,
  unsupportedPosthogReason,
  type PosthogQuery,
} from "./posthogQueries";
import { hogqlText, normalizePosthogResult } from "./posthogNormalization";
import { mapPosthogError } from "./posthogErrorMap";

// Fork addition (FORK-CHANGES.md): the GA4 reports, organic overview and
// measurement health answered from PostHog, in the GA4 services' output
// shape. Ga4ReportingService, Ga4OrganicOverviewService and
// Ga4MeasurementHealthService hand PostHog projects to these functions.

/** Personal API keys cannot use OFFSET; pages come from the top rows. */
const MAX_FETCH_ROWS = 10_000;

/** Metrics that count visitors or visits: estimates without cookies. */
const ESTIMATED_METRICS = new Set(["activeUsers", "totalUsers", "sessions"]);
const POSTHOG_ESTIMATE_WARNING = "posthog_users_and_sessions_estimated";

function posthogSourceInfo(source: PosthogSource) {
  return {
    provider: "posthog" as const,
    propertyId: source.posthogProjectId,
    propertyDisplayName: `PostHog project ${source.posthogProjectId}`,
  };
}

function sourceWarnings(source: PosthogSource, metrics: string[]): string[] {
  return [
    ...(metrics.some((metric) => ESTIMATED_METRICS.has(metric))
      ? [POSTHOG_ESTIMATE_WARNING]
      : []),
    ...(source.keyEvents.length === 0 ? ["posthog_no_key_events"] : []),
  ];
}

async function query(source: PosthogSource, spec: PosthogQuery) {
  const result = await runHogql({
    credential: source.credential,
    projectId: source.posthogProjectId,
    query: spec.query,
    values: spec.values,
  });
  return normalizePosthogResult(result, spec);
}

async function runReport(
  input: Ga4ReportInput,
  source: PosthogSource,
  opts: { now?: Date } = {},
) {
  const unsupported = unsupportedPosthogReason(input);
  if (unsupported) {
    throw new Ga4ReportError("ga4_report_incompatible", unsupported);
  }
  const limit = normalizeLimit(input.limit);
  const offset = normalizeOffset(input.offset);
  if (offset + limit > MAX_FETCH_ROWS) {
    throw new Ga4ReportError(
      "validation_error",
      `PostHog reports page through the first ${MAX_FETCH_ROWS} rows; offset + limit must stay within that.`,
    );
  }
  const channel = input.channel ?? "organic_search";
  const dateRange = resolveGa4DateRange(input, source.timeZone, opts.now);
  if (input.comparePreviousPeriod && !supportsComparison(input)) {
    throw new Ga4ReportError(
      "validation_error",
      "Previous-period comparison is only available for event key events, channel-group acquisition, device audiences, and new-versus-returning audiences.",
    );
  }
  const fetchLimit = Math.max(
    needsCompleteReport(input) ? COMPLETE_REPORT_LIMIT : 0,
    offset + limit,
  );
  const reportConfiguration = getGa4ReportConfiguration({
    ...input,
    ...dateRange.resolvedDateRange,
    channel,
    limit,
    offset,
  });
  const specFor = (range: { startDate: string; endDate: string }) =>
    buildPosthogReportQuery(
      {
        ...input,
        ...range,
        channel,
        fetchLimit,
        keyEvents: source.keyEvents,
      },
      reportConfiguration.metrics,
    );
  const spec = specFor(dateRange.resolvedDateRange);
  const previousDateRange = input.comparePreviousPeriod
    ? previousPeriod(dateRange.resolvedDateRange)
    : null;

  try {
    const [normalized, previousNormalized] = await Promise.all([
      query(source, spec),
      previousDateRange ? query(source, specFor(previousDateRange)) : null,
    ]);
    const rows = normalized.rows.slice(offset, offset + limit);
    const nextOffset = offset + rows.length;
    const hasMore = nextOffset < normalized.totalRowCount;
    const comparison =
      previousNormalized && previousDateRange
        ? buildReportComparison({
            current: normalized,
            previous: previousNormalized,
            previousDateRange,
            dimensions: reportConfiguration.dimensions,
            metrics: spec.metrics,
          })
        : undefined;
    return {
      status: "ok",
      source: posthogSourceInfo(source),
      request: {
        requestedDateRange: dateRange.requestedDateRange,
        resolvedDateRange: dateRange.resolvedDateRange,
        propertyTimeZone: source.timeZone,
        currencyCode: null,
        channel,
        ...reportConfiguration,
        metrics: spec.metrics,
        limit,
        offset,
      },
      rowCount: rows.length,
      totalRowCount: normalized.totalRowCount,
      rows,
      pageInfo: {
        offset,
        limit,
        hasMore,
        nextOffset: hasMore ? nextOffset : null,
      },
      reportMetadata: normalized.reportMetadata,
      quota: null,
      warnings: [
        ...dateRange.warnings,
        ...(comparison && !comparison.coverage.complete
          ? ["comparison_incomplete"]
          : []),
        ...sourceWarnings(source, spec.metrics),
      ],
      ...buildReportSpecificEnhancements(
        normalized,
        input,
        dateRange.resolvedDateRange,
      ),
      comparison,
    };
  } catch (error) {
    mapPosthogError(error, source.posthogProjectId);
  }
}

function numberOf(
  row: Record<string, string | number | null> | null,
  metric: string,
): number | null {
  const value = row?.[metric];
  return typeof value === "number" ? value : null;
}

async function getOrganicOverview(
  input: {
    startDate?: string;
    endDate?: string;
    trend?: "daily" | "weekly";
  },
  source: PosthogSource,
  opts: { now?: Date } = {},
) {
  const dateRange = resolveGa4DateRange(input, source.timeZone, opts.now);
  const previousDateRange = previousPeriod(dateRange.resolvedDateRange);
  const trend = input.trend ?? "daily";
  const keyEvents = source.keyEvents;
  const currentSpec = buildPosthogOverviewQuery({
    ...dateRange.resolvedDateRange,
    keyEvents,
  });
  try {
    const [current, previous, trendReport] = await Promise.all([
      query(source, currentSpec),
      query(
        source,
        buildPosthogOverviewQuery({ ...previousDateRange, keyEvents }),
      ),
      query(
        source,
        buildPosthogOverviewQuery({
          ...dateRange.resolvedDateRange,
          keyEvents,
          trend,
        }),
      ),
    ]);
    const currentSummary = current.rows[0] ?? null;
    const previousSummary = previous.rows[0] ?? null;
    return {
      status: "ok" as const,
      source: posthogSourceInfo(source),
      request: {
        requestedDateRange: dateRange.requestedDateRange,
        resolvedDateRange: dateRange.resolvedDateRange,
        previousDateRange,
        propertyTimeZone: source.timeZone,
        currencyCode: null,
        channel: "organic_search" as const,
        trend,
      },
      current: currentSummary,
      previous: previousSummary,
      comparison: Object.fromEntries(
        currentSpec.metrics.map((metric) => [
          metric,
          comparisonValue(
            numberOf(currentSummary, metric),
            numberOf(previousSummary, metric),
          ),
        ]),
      ),
      trend: trendReport.rows,
      diagnostics: keyEventDiagnostics(currentSummary, previousSummary, false),
      reportMetadata: {
        hasLimitedData: false,
        reports: [current, previous, trendReport].map(
          (report) => report.reportMetadata,
        ),
      },
      quota: null,
      warnings: [
        ...dateRange.warnings,
        ...(trendReport.rows.length >= 1_000 ? ["trend_truncated"] : []),
        ...sourceWarnings(source, currentSpec.metrics),
      ],
    };
  } catch (error) {
    mapPosthogError(error, source.posthogProjectId);
  }
}

const NON_PRODUCTION_HOST =
  /^(localhost|127\.|10\.|192\.168\.|\[?::1\]?)|\.local$|\.localhost$|^\d+\.\d+\.\d+\.\d+$/i;

async function getMeasurementHealth(source: PosthogSource) {
  const run = (text: string) =>
    runHogql({
      credential: source.credential,
      projectId: source.posthogProjectId,
      query: text,
    });
  try {
    const [events, hosts, siteSearch] = await Promise.all([
      run(POSTHOG_HEALTH_QUERIES.events),
      run(POSTHOG_HEALTH_QUERIES.hosts),
      run(POSTHOG_HEALTH_QUERIES.siteSearch),
    ]);
    const eventRows = events.rows.map(([name, count, lastSeenAt]) => ({
      eventName: hogqlText(name),
      countLast30Days: Number(count) || 0,
      lastSeenAt: hogqlText(lastSeenAt) || null,
    }));
    const eventCount = (name: string) =>
      eventRows.find((row) => row.eventName === name)?.countLast30Days ?? 0;
    const webStreams = hosts.rows.map(
      ([host, pageviews, lastSeenAt, cookieless]) => {
        const name = hogqlText(host) || "(not set)";
        const views = Number(pageviews) || 0;
        return {
          streamId: name,
          displayName: name,
          measurementId: null,
          defaultUri: name === "(not set)" ? null : `https://${name}`,
          createTime: null,
          updateTime: hogqlText(lastSeenAt) || null,
          pageviewsLast30Days: views,
          cookielessShare: views > 0 ? (Number(cookieless) || 0) / views : 0,
        };
      },
    );
    const keyEvents = source.keyEvents.map((eventName) => {
      const row = eventRows.find((event) => event.eventName === eventName);
      return {
        eventName,
        countLast30Days: row?.countLast30Days ?? 0,
        lastSeenAt: row?.lastSeenAt ?? null,
      };
    });
    const pageviews = eventCount("$pageview");
    const issues: string[] = [];
    if (pageviews === 0) issues.push("no_pageviews_last_30_days");
    if (pageviews > 0 && eventCount("$pageleave") === 0) {
      issues.push("no_pageleave_events");
    }
    if (keyEvents.length === 0) issues.push("no_key_events_configured");
    if (keyEvents.some((event) => event.countLast30Days === 0)) {
      issues.push("key_event_not_seen_last_30_days");
    }
    if (
      webStreams.some((stream) => NON_PRODUCTION_HOST.test(stream.streamId))
    ) {
      issues.push("non_production_host_detected");
    }
    const searches = Number(siteSearch.rows[0]?.[0]) || 0;
    return {
      status: "ok" as const,
      source: { ...posthogSourceInfo(source), provider: "posthog" as const },
      summary: {
        dataStreamCount: webStreams.length,
        webStreamCount: webStreams.length,
        keyEventCount: keyEvents.length,
        customDimensionCount: 0,
        customMetricCount: 0,
        issueCount: issues.length,
        pageviewsLast30Days: pageviews,
        siteSearchDetected: searches > 0,
        timeZone: source.timeZone,
      },
      issues,
      webStreams,
      otherStreams: [],
      keyEvents,
      customDefinitions: { dimensions: [], metrics: [] },
      // Custom events PostHog saw, so a key event can be picked from them.
      customEvents: eventRows.filter((row) => !row.eventName.startsWith("$")),
    };
  } catch (error) {
    mapPosthogError(error, source.posthogProjectId);
  }
}

export const PosthogReportingService = {
  runReport,
  getOrganicOverview,
  getMeasurementHealth,
};
