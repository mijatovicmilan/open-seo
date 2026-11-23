import { beforeEach, describe, expect, it, vi } from "vitest";
import { linkTraffic, PosthogJoinService } from "./PosthogJoinService";

const mocks = vi.hoisted(() => ({
  runHogql: vi.fn(),
  aggregatePages: vi.fn(),
  getActivePosthogSource: vi.fn(),
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
vi.mock("@/db", () => ({}));
vi.mock("@/db/schema", () => ({}));
vi.mock(
  "@/server/features/gsc-history/repositories/GscHistoryRepository",
  () => ({ GscHistoryRepository: { aggregatePages: mocks.aggregatePages } }),
);
vi.mock("./posthogSource", () => ({
  getActivePosthogSource: mocks.getActivePosthogSource,
}));

const metrics = { visits: 0, signups: 0, keyEvents: 0 };

beforeEach(() => {
  mocks.getActivePosthogSource.mockResolvedValue({
    posthogProjectId: "352215",
    timeZone: "UTC",
    keyEvents: ["waitlist_joined"],
    credential: { host: "https://eu.posthog.com", apiKey: "phx_test" },
  });
  mocks.aggregatePages.mockResolvedValue([
    {
      page: "https://www.tinythen.com/tools/baby-age-calculator/",
      clicks: 4,
      impressions: 500,
      position: 8,
    },
  ]);
  mocks.runHogql.mockImplementation(async ({ query }: { query: string }) =>
    query.includes("GROUP BY date")
      ? { columns: [], rows: [["2026-11-19", 2, 1, 1]], timeZone: "UTC" }
      : {
          columns: [],
          rows: [
            ["tinythen.com", "/tools/baby-age-calculator", 2, 1, 1],
            ["tinythen.com", "/gift", 1, 0, 0],
          ],
          timeZone: "UTC",
        },
  );
});

describe("search clicks to signups", () => {
  it("joins a Search Console URL to PostHog's landing path despite www and a trailing slash", async () => {
    const result = await PosthogJoinService.getSearchSignups({
      projectId: "p1",
      current: { start: "2026-11-01", end: "2026-11-21" },
    });
    if (!result.available) throw new Error("expected PostHog");
    expect(result.pages).toEqual([
      expect.objectContaining({
        page: "https://www.tinythen.com/tools/baby-age-calculator/",
        clicks: 4,
        visits: 2,
        signups: 1,
        visitsPerClick: 0.5,
        signupRate: 0.5,
      }),
      // Visits from Google to a page Search Console has no clicks for.
      expect.objectContaining({
        page: "https://tinythen.com/gift",
        clicks: 0,
        visits: 1,
      }),
    ]);
    expect(result.totals).toEqual({ visits: 2, signups: 1, keyEvents: 1 });
  });

  it("leaves visits out when filtered by query (PostHog has no queries)", async () => {
    const result = await PosthogJoinService.getSearchSignups({
      projectId: "p1",
      current: { start: "2026-11-01", end: "2026-11-21" },
      query: "baby age calculator",
    });
    expect(result).toMatchObject({ unsupportedFilter: "query", totals: null });
    expect(mocks.runHogql).not.toHaveBeenCalled();
  });
});

describe("linkTraffic", () => {
  it("counts visits from the linking site on or after the link day only", () => {
    const traffic = linkTraffic(
      { theirPage: "https://www.blog.example/post/", since: "2026-11-10" },
      [
        {
          ...metrics,
          domain: "blog.example",
          date: "2026-11-09",
          referrer: "",
          visits: 5,
        },
        {
          domain: "blog.example",
          date: "2026-11-12",
          referrer: "https://blog.example/post",
          visits: 3,
          signups: 1,
          keyEvents: 1,
        },
        {
          ...metrics,
          domain: "blog.example",
          date: "2026-11-15",
          referrer: "https://blog.example",
          visits: 2,
        },
        {
          ...metrics,
          domain: "other.example",
          date: "2026-11-15",
          referrer: "",
          visits: 9,
        },
      ],
    );
    expect(traffic).toEqual({
      visits: 5,
      signups: 1,
      keyEvents: 1,
      fromPage: { visits: 3, signups: 1, keyEvents: 1 },
      lastVisitAt: "2026-11-15",
    });
  });
});
