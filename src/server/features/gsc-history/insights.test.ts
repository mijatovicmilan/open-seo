import { describe, expect, it } from "vitest";
import {
  buildCtrCurve,
  buildCtrGaps,
  buildNearPageOne,
  buildNewPages,
  buildPageChanges,
  countRankingFlips,
  findCannibalizationCandidates,
  insightPeriods,
  minImpressionsFor,
  rankCannibalization,
  topQueryDrivers,
} from "@/server/features/gsc-history/insights";

const row = (
  query: string,
  page: string,
  position: number,
  impressions: number,
  clicks = 0,
) => ({ query, page, position, impressions, clicks });

const defaultCurve = buildCtrCurve([], 10);

const day = (date: string, page: string, position: number) => ({
  date,
  page,
  position,
  impressions: 10,
});

const metrics = (page: string, clicks: number, impressions: number) => ({
  page,
  clicks,
  impressions,
  position: 5,
});

describe("insightPeriods", () => {
  it("ends at the newest settled day and mirrors the previous period", () => {
    const today = new Date("2026-11-23T08:00:00Z");
    expect(insightPeriods("2026-11-22", today, 28)).toEqual({
      current: { start: "2026-10-24", end: "2026-11-20" },
      previous: { start: "2026-09-26", end: "2026-10-23" },
    });
  });

  it("ends at the newest stored day when history stops earlier", () => {
    const today = new Date("2026-11-23T08:00:00Z");
    expect(insightPeriods("2026-11-01", today, 7).current).toEqual({
      start: "2026-10-26",
      end: "2026-11-01",
    });
  });
});

describe("minImpressionsFor", () => {
  it("keeps a floor for small sites and scales with big ones", () => {
    expect(minImpressionsFor(500, 28)).toBe(20);
    expect(minImpressionsFor(500, 7)).toBe(5);
    expect(minImpressionsFor(2_000_000, 28)).toBe(1000);
  });
});

describe("buildCtrCurve", () => {
  it("uses the site's median where a bucket has enough rows", () => {
    const rows = Array.from({ length: 21 }, (_, i) =>
      row(`q${i}`, "/a", 1, 100, 50),
    );
    const curve = buildCtrCurve(rows, 10);
    expect(curve.source).toBe("mixed");
    expect(curve.byPosition[0]).toBeCloseTo(0.5);
    expect(curve.byPosition[1]).toBe(defaultCurve.byPosition[1]);
  });
});

describe("buildNearPageOne", () => {
  it("keeps queries whose best page is at 8-20 and ranks by potential", () => {
    const rows = [
      row("small", "/a", 12, 50),
      row("big", "/b", 15, 900),
      row("already-top", "/c", 3, 500),
      row("already-top", "/d", 11, 400),
      row("below-floor", "/e", 9, 5),
      row("page-three", "/f", 25, 800),
    ];
    const result = buildNearPageOne(rows, 20, defaultCurve);
    expect(result.map((r) => r.query)).toEqual(["big", "small"]);
    // 900 impressions x 10% expected CTR at #3, minus 0 clicks.
    expect(result[0].potentialClicks).toBe(90);
  });
});

describe("buildCtrGaps", () => {
  it("flags page-one rows far under the expected CTR, biggest gap first", () => {
    const rows = [
      row("fine", "/a", 1, 1000, 300),
      row("low", "/b", 1, 1000, 50),
      row("lower-volume", "/c", 2, 200, 2),
      row("page-two", "/d", 14, 5000, 0),
    ];
    const gaps = buildCtrGaps(rows, 20, defaultCurve);
    expect(gaps.map((g) => g.query)).toEqual(["low", "lower-volume"]);
    // 1000 x 28% expected at #1 = 280 clicks, minus 50 actual.
    expect(gaps[0].clickGap).toBe(230);
  });
});

describe("cannibalization", () => {
  it("finds queries split between pages and puts flipping ones first", () => {
    const rows = [
      row("split", "/a", 6, 300),
      row("split", "/b", 7, 200),
      row("split", "/tiny", 30, 10),
      row("steady", "/c", 4, 600),
      row("steady", "/d", 5, 400),
      row("one-page", "/e", 2, 900),
      row("lopsided", "/f", 3, 950),
      row("lopsided", "/g", 9, 50),
    ];
    const candidates = findCannibalizationCandidates(rows, 20);
    expect(candidates.map((c) => c.query)).toEqual(["steady", "split"]);
    expect(candidates[1].pages.map((p) => p.page)).toEqual(["/a", "/b"]);

    const ranked = rankCannibalization(
      candidates,
      new Map([
        ["split", 3],
        ["steady", 0],
      ]),
    );
    expect(ranked.map((c) => [c.query, c.flips])).toEqual([
      ["split", 3],
      ["steady", 0],
    ]);
  });

  it("counts the days the best-ranking page changed", () => {
    expect(
      countRankingFlips([
        day("2026-11-01", "/a", 5),
        day("2026-11-01", "/b", 8),
        day("2026-11-02", "/b", 4),
        day("2026-11-02", "/a", 6),
        day("2026-11-03", "/b", 5),
        day("2026-11-04", "/a", 3),
      ]),
    ).toBe(2);
  });
});

describe("page changes", () => {
  it("splits rising and falling pages and finds the queries behind them", () => {
    const { rising, falling } = buildPageChanges(
      [metrics("/up", 50, 1000), metrics("/new", 5, 100)],
      [metrics("/up", 10, 800), metrics("/gone", 30, 600)],
    );
    expect(rising.map((r) => r.page)).toEqual(["/up", "/new"]);
    expect(falling.map((r) => r.page)).toEqual(["/gone"]);

    const drivers = topQueryDrivers(
      "/up",
      "up",
      [row("winner", "/up", 4, 600, 40), row("flat", "/up", 6, 400, 10)],
      [row("winner", "/up", 9, 400, 0), row("flat", "/up", 6, 400, 10)],
    );
    expect(drivers.map((d) => d.query)).toEqual(["winner"]);
  });
});

describe("buildNewPages", () => {
  it("sums impressions per week since the first day", () => {
    const [page] = buildNewPages(
      [{ page: "/p", firstDate: "2026-11-01", clicks: 3, impressions: 60 }],
      [
        { page: "/p", date: "2026-11-01", impressions: 10 },
        { page: "/p", date: "2026-11-07", impressions: 5 },
        { page: "/p", date: "2026-11-08", impressions: 20 },
        { page: "/p", date: "2026-11-16", impressions: 25 },
      ],
      "2026-11-16",
    );
    expect(page.weeklyImpressions).toEqual([15, 20, 25]);
  });
});
