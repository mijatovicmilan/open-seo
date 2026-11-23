import { describe, expect, it } from "vitest";
import {
  addDays,
  historyWindow,
  planSync,
  selectDays,
} from "@/server/features/gsc-history/syncPlan";

const TODAY = new Date("2026-11-23T10:00:00Z");

function allDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

describe("historyWindow", () => {
  it("ends yesterday and starts two days inside GSC's 16 months", () => {
    expect(historyWindow(TODAY)).toEqual({
      oldest: "2025-07-25",
      latest: "2026-11-22",
    });
  });

  it("clamps the 16-month floor to a short month", () => {
    // 2026-06-30 minus 16 months = 2025-02-28 (no Feb 30), plus two days.
    expect(historyWindow(new Date("2026-06-30T00:00:00Z")).oldest).toBe(
      "2025-03-02",
    );
  });
});

describe("planSync", () => {
  it("fetches every day newest first on the first sync", () => {
    const plan = planSync(TODAY, []);
    expect(plan.candidates[0]).toBe("2026-11-22");
    expect(plan.candidates.at(-1)).toBe(plan.oldest);
    expect(plan.candidates).toHaveLength(
      allDays(plan.oldest, plan.latest).length,
    );
    // The three provisional days are not part of the backfill count.
    expect(plan.missingCount).toBe(plan.candidates.length - 3);
  });

  it("re-fetches the provisional days and fills only the gaps", () => {
    const { oldest, latest } = historyWindow(TODAY);
    const stored = allDays(oldest, latest).filter(
      (day) => day !== "2026-10-01" && day !== "2026-09-15",
    );
    const plan = planSync(TODAY, stored);
    expect(plan.candidates).toEqual([
      "2026-11-22",
      "2026-11-21",
      "2026-11-20",
      "2026-10-01",
      "2026-09-15",
    ]);
    expect(plan.missingCount).toBe(2);
  });

  it("ignores stored days older than GSC still keeps", () => {
    const { oldest, latest } = historyWindow(TODAY);
    const stored = ["2024-01-01", ...allDays(oldest, latest)];
    const plan = planSync(TODAY, stored);
    expect(plan.missingCount).toBe(0);
    expect(plan.candidates).toHaveLength(3);
  });
});

describe("selectDays", () => {
  it("stores empty days without spending the detail budget", () => {
    const candidates = ["d5", "d4", "d3", "d2", "d1"];
    const impressions = new Map([
      ["d5", 10],
      ["d3", 4],
      ["d2", 7],
      ["d1", 1],
    ]);
    expect(selectDays(candidates, impressions, 2)).toEqual({
      detailDays: ["d5", "d3"],
      emptyDays: ["d4"],
      deferredCount: 2,
    });
  });
});
