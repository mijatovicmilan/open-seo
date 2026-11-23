import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HogqlResult } from "@/server/lib/posthogClient";
import { PosthogApiError } from "@/server/lib/posthogErrors";
import { Ga4MalformedResponseError } from "@/server/lib/ga4Errors";
import { PosthogReportingService } from "./PosthogReportingService";
import { normalizePosthogResult } from "./posthogNormalization";
import { buildPosthogReportQuery } from "./posthogQueries";

const mocks = vi.hoisted(() => ({
  runHogql:
    vi.fn<
      (input: {
        query: string;
        values?: Record<string, unknown>;
      }) => Promise<HogqlResult>
    >(),
}));

vi.mock("@/server/lib/posthogClient", () => ({
  runHogql: mocks.runHogql,
}));

// The GA4 modules this service reuses pull in the auth client and the
// database; the reports here need neither.
vi.mock("@/server/lib/ga4Client", () => ({}));
vi.mock(
  "@/server/features/ga4/repositories/Ga4ConnectionRepository",
  () => ({}),
);
vi.mock("./posthogSource", () => ({}));

const source = {
  posthogProjectId: "352215",
  timeZone: "UTC",
  keyEvents: ["waitlist_joined"],
  credential: { host: "https://eu.posthog.com", apiKey: "phx_test" },
};
const range = { startDate: "2026-11-01", endDate: "2026-11-21" };
const now = new Date("2026-11-23T12:00:00Z");

// A HogQL response as PostHog returns it for the landing-page query.
const landingResult: HogqlResult = {
  columns: [
    "hostName",
    "landingPage",
    "sessions",
    "activeUsers",
    "engagedSessions",
    "keyEvents",
    "convertedSessions",
    "__total",
  ],
  rows: [
    ["tinythen.com", "/", 20, 18, 10, 2, 2, 3],
    ["tinythen.com", "/tools", 4, 4, 1, 0, 0, 3],
    [null, null, 1, 1, 0, 0, 0, 3],
  ],
  timeZone: "UTC",
};

beforeEach(() => {
  mocks.runHogql.mockResolvedValue(landingResult);
});

describe("PostHog reports in the GA4 shape", () => {
  it("returns GA4-named rows a page at a time, without revenue metrics", async () => {
    const result = await PosthogReportingService.runReport(
      { projectId: "p1", kind: "landing_pages", ...range, limit: 2 },
      source,
      { now },
    );

    expect(result.source.provider).toBe("posthog");
    expect(result.request.metrics).toEqual([
      "sessions",
      "activeUsers",
      "engagedSessions",
      "engagementRate",
      "keyEvents",
      "sessionKeyEventRate",
    ]);
    expect(result.rows).toEqual([
      {
        hostName: "tinythen.com",
        landingPage: "/",
        sessions: 20,
        activeUsers: 18,
        engagedSessions: 10,
        engagementRate: 0.5,
        keyEvents: 2,
        sessionKeyEventRate: 0.1,
      },
      expect.objectContaining({ landingPage: "/tools", engagementRate: 0.25 }),
    ]);
    expect(result.pageInfo).toEqual({
      offset: 0,
      limit: 2,
      hasMore: true,
      nextOffset: 2,
    });
    expect(result.warnings).toContain("posthog_users_and_sessions_estimated");
    // Key events travel as query values, never inside the query text.
    const call = mocks.runHogql.mock.calls[0]?.[0];
    expect(call).toMatchObject({ values: { key_events: ["waitlist_joined"] } });
    expect(call?.query).not.toContain("waitlist_joined");
    expect(call?.query).toContain("channel = 'Organic Search'");
  });

  it("refuses ecommerce without querying PostHog", async () => {
    await expect(
      PosthogReportingService.runReport(
        { projectId: "p1", kind: "ecommerce_performance", ...range },
        source,
        { now },
      ),
    ).rejects.toMatchObject({ code: "ga4_report_incompatible" });
    expect(mocks.runHogql).not.toHaveBeenCalled();
  });

  it("reports a site without search as an empty state, not an error", async () => {
    mocks.runHogql.mockResolvedValue({
      columns: [
        "searchTerm",
        "eventCount",
        "activeUsers",
        "sessions",
        "engagedSessions",
        "__total",
      ],
      rows: [],
      timeZone: "UTC",
    });
    const result = await PosthogReportingService.runReport(
      { projectId: "p1", kind: "site_search", ...range, channel: "all" },
      source,
      { now },
    );
    expect(result.rows).toEqual([]);
    expect(result).toMatchObject({ siteSearchActivity: { status: "none" } });
  });

  it("explains a key that cannot read the project", async () => {
    mocks.runHogql.mockRejectedValue(
      new PosthogApiError(403, "denied", null, "permission_denied"),
    );
    await expect(
      PosthogReportingService.runReport(
        { projectId: "p1", kind: "landing_pages", ...range },
        source,
        { now },
      ),
    ).rejects.toMatchObject({ code: "ga4_property_inaccessible" });
  });
});

describe("normalizePosthogResult", () => {
  const spec = buildPosthogReportQuery(
    {
      kind: "landing_pages",
      ...range,
      channel: "organic_search",
      fetchLimit: 10,
      keyEvents: [],
    },
    ["sessions", "engagementRate"],
  );

  it("names missing dimension values (not set) and keeps the total", () => {
    const report = normalizePosthogResult(landingResult, spec);
    expect(report.rows[2]).toMatchObject({
      hostName: "(not set)",
      landingPage: "(not set)",
    });
    expect(report.totalRowCount).toBe(3);
  });

  it("rejects columns that do not match the query", () => {
    expect(() =>
      normalizePosthogResult(
        { ...landingResult, columns: landingResult.columns.slice(1) },
        spec,
      ),
    ).toThrow(Ga4MalformedResponseError);
  });
});
