import { describe, expect, it, vi } from "vitest";
import { buildChartPoints } from "./searchSeries";

vi.mock("@/client/features/gsc-history/annotationStyles", () => ({
  ANNOTATION_STYLES: {},
}));

const day = (date: string, impressions: number, partial = false) => ({
  date,
  clicks: 0,
  impressions,
  ctr: null,
  position: null,
  partial,
  compare: null,
});

describe("buildChartPoints", () => {
  it("marks a week the range cuts short, so it does not read as a drop", () => {
    // Sun Nov 15 ends the week of Nov 9; the next week is whole.
    const series = [
      day("2026-11-15", 5),
      ...["16", "17", "18", "19", "20", "21", "22"].map((d) =>
        day(`2026-11-${d}`, 10),
      ),
    ];
    const points = buildChartPoints({
      series,
      annotations: [],
      granularity: "week",
      from: null,
      hasCompare: false,
    });
    expect(
      points.map((p) => [p.key, p.values.impressions, p.partialNote]),
    ).toEqual([
      ["2026-11-09", 5, "1 of 7 days"],
      ["2026-11-16", 70, undefined],
    ]);
  });
});
