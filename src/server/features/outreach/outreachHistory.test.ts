import { describe, expect, it } from "vitest";
import { outreachTimeline, type OutreachHistoryEntry } from "@/shared/outreach";
import { describeOutreachEvent } from "./outreachHistory";

describe("outreach history wording", () => {
  it("turns stored agent strings into short human labels", () => {
    expect(
      describeOutreachEvent({
        type: "drafted",
        detail: "first: The chart in your post",
      }),
    ).toEqual({ label: "Email drafted", detail: "The chart in your post" });
    expect(
      describeOutreachEvent({
        type: "status",
        detail: "awaiting approval: Shown to the owner for approval",
      }),
    ).toEqual({ label: "Sent for your approval" });
    expect(
      describeOutreachEvent({
        type: "rescored",
        detail: "Score model 2: site strength 0-3, activity 0-1",
      }),
    ).toEqual({ label: "Score recalculated" });
  });
});

const entry = (
  overrides: Partial<OutreachHistoryEntry>,
): OutreachHistoryEntry => ({
  type: "drafted",
  date: "2026-11-10",
  at: "2026-11-10T08:00:00.000Z",
  label: "Email drafted",
  actor: "agent",
  ...overrides,
});

describe("outreach timeline", () => {
  it("lists newest first and merges same-day repeats, keeping the latest detail", () => {
    const items = outreachTimeline([
      entry({
        at: "2026-11-09T15:00:00.000Z",
        date: "2026-11-09",
        detail: "v1",
      }),
      entry({ at: "2026-11-10T06:50:00.000Z", detail: "v2" }),
      entry({ at: "2026-11-10T07:33:00.000Z", detail: "v3" }),
      entry({
        type: "approved",
        label: "You approved the email",
        actor: "owner",
        at: "2026-11-10T09:00:00.000Z",
      }),
    ]);
    expect(items.map((item) => [item.type, item.count, item.detail])).toEqual([
      ["approved", 1, undefined],
      ["drafted", 2, "v3"],
      ["drafted", 1, "v1"],
    ]);
  });
});
