import { describe, expect, it } from "vitest";
import { niceTicks } from "./TimeSeriesChart";

describe("niceTicks", () => {
  it("keeps count axes on whole, round steps", () => {
    expect(niceTicks(1, true)).toEqual([0, 1]);
    expect(niceTicks(7, true)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(300, true)).toEqual([0, 100, 200, 300]);
  });
});
