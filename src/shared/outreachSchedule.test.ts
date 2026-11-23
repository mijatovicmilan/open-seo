import { describe, expect, it } from "vitest";
import {
  dueState,
  planQueue,
  type ScheduleConfig,
  SCHEDULE_GAP_MINUTES,
  slotContaining,
  upcomingSlots,
  zonedTimeToUtc,
} from "./outreachSchedule";

// Weekdays at 09:00 New York, open two hours; limits counted in Bangkok
// (the owner's zone), 3 a day and 20 a week, as outreach uses them.
const config: ScheduleConfig = {
  timeZone: "America/New_York",
  days: [1, 2, 3, 4, 5],
  time: "09:00",
  windowMinutes: 120,
  limitsTimeZone: "Asia/Bangkok",
  dailyMax: 3,
  weeklyMax: 20,
};

const bangkok = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Bangkok",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

describe("zonedTimeToUtc", () => {
  it("is 21:00 in Bangkok in winter and 20:00 in summer (US daylight time)", () => {
    const winter = zonedTimeToUtc("2026-11-24", "09:00", "America/New_York");
    expect(winter.toISOString()).toBe("2026-11-24T14:00:00.000Z");
    expect(bangkok(winter.toISOString())).toBe("Tue 21:00");
    const summer = zonedTimeToUtc("2026-07-07", "09:00", "America/New_York");
    expect(summer.toISOString()).toBe("2026-07-07T13:00:00.000Z");
    expect(bangkok(summer.toISOString())).toBe("Tue 20:00");
  });

  it("gets the days around the daylight saving changes right", () => {
    // US clocks go forward on Sun 8 Mar 2026 and back on Sun 1 Nov 2026.
    expect(
      zonedTimeToUtc("2026-03-06", "09:00", "America/New_York").toISOString(),
    ).toBe("2026-03-06T14:00:00.000Z");
    expect(
      zonedTimeToUtc("2026-03-09", "09:00", "America/New_York").toISOString(),
    ).toBe("2026-03-09T13:00:00.000Z");
    expect(
      zonedTimeToUtc("2026-10-30", "09:00", "America/New_York").toISOString(),
    ).toBe("2026-10-30T13:00:00.000Z");
    expect(
      zonedTimeToUtc("2026-11-02", "09:00", "America/New_York").toISOString(),
    ).toBe("2026-11-02T14:00:00.000Z");
  });
});

describe("upcomingSlots", () => {
  it("keeps today's window while it is open and skips the weekend", () => {
    // Fri 20 Nov, 10:30 in New York: inside Friday's window.
    const slots = upcomingSlots(config, "2026-11-20T15:30:00.000Z", 3);
    expect(slots.map((slot) => slot.date)).toEqual([
      "2026-11-20",
      "2026-11-23",
      "2026-11-24",
    ]);
    expect(slots[0]).toMatchObject({
      start: "2026-11-20T14:00:00.000Z",
      end: "2026-11-20T16:00:00.000Z",
    });
  });

  it("moves to the next sending day once the window has closed", () => {
    // Fri 20 Nov, 11:30 in New York: the window closed at 11:00.
    const slots = upcomingSlots(config, "2026-11-20T16:30:00.000Z", 1);
    expect(slots[0]?.date).toBe("2026-11-23");
  });

  it("has no windows without sending days", () => {
    expect(
      upcomingSlots({ ...config, days: [] }, "2026-11-20T00:00:00.000Z", 3),
    ).toEqual([]);
  });
});

describe("dueState", () => {
  const at = "2026-11-24T14:02:00.000Z";
  it("waits before its time, sends inside the window, and misses after it", () => {
    expect(dueState(config, at, "2026-11-24T13:59:00.000Z")).toBe("waiting");
    expect(dueState(config, at, "2026-11-24T14:05:00.000Z")).toBe("due");
    // The Mac woke at 10:55 New York: still inside the window.
    expect(dueState(config, at, "2026-11-24T15:55:00.000Z")).toBe("due");
    // Woke at 11:05: never send outside the window.
    expect(dueState(config, at, "2026-11-24T16:05:00.000Z")).toBe("missed");
  });

  it("treats a time outside every window as missed", () => {
    expect(
      dueState(config, "2026-11-24T20:00:00.000Z", "2026-11-24T19:00:00.000Z"),
    ).toBe("missed");
    expect(slotContaining(config, "2026-11-28T14:30:00.000Z")).toBeNull(); // Saturday
  });
});

describe("planQueue", () => {
  const now = "2026-11-23T05:00:00.000Z"; // Mon, before the window

  it("fills the first window up to the daily limit, minutes apart, then the next day", () => {
    const planned = planQueue({
      config,
      now,
      sentAt: [],
      fixed: [],
      pending: [1, 2, 3, 4, 5].map((id) => ({ id })),
    });
    const times = [1, 2, 3, 4, 5].map((id) => planned.get(id) ?? "");
    expect(times.slice(0, 3).every((t) => t.startsWith("2026-11-23T14:"))).toBe(
      true,
    );
    expect(times.slice(3).every((t) => t.startsWith("2026-11-24T14:"))).toBe(
      true,
    );
    for (const [a, b] of [
      [times[0], times[1]],
      [times[1], times[2]],
    ]) {
      expect(Date.parse(b ?? "") - Date.parse(a ?? "")).toBeGreaterThanOrEqual(
        SCHEDULE_GAP_MINUTES * 60_000,
      );
    }
    for (const time of times) {
      expect(dueState(config, time, time)).toBe("due");
    }
  });

  it("counts what was already sent that day (in the limits zone)", () => {
    // Two sent on Monday Bangkok time already: one more fits on Monday.
    const planned = planQueue({
      config,
      now,
      sentAt: ["2026-11-23T02:00:00.000Z", "2026-11-23T03:00:00.000Z"],
      fixed: [],
      pending: [{ id: 1 }, { id: 2 }],
    });
    expect(planned.get(1)?.startsWith("2026-11-23")).toBe(true);
    expect(planned.get(2)?.startsWith("2026-11-24")).toBe(true);
  });

  it("stops at the weekly limit and continues next week", () => {
    const planned = planQueue({
      config: { ...config, weeklyMax: 4 },
      now,
      sentAt: [],
      fixed: [],
      pending: [1, 2, 3, 4, 5].map((id) => ({ id })),
    });
    expect(planned.get(5)?.startsWith("2026-11-30")).toBe(true);
  });

  it("leaves a fixed email where it is and places others after it", () => {
    const fixedAt = "2026-11-23T14:00:00.000Z";
    const planned = planQueue({
      config,
      now,
      sentAt: [],
      fixed: [{ id: 9, scheduledFor: fixedAt }],
      pending: [{ id: 1 }],
    });
    expect(
      Date.parse(planned.get(1) ?? "") - Date.parse(fixedAt),
    ).toBeGreaterThanOrEqual(SCHEDULE_GAP_MINUTES * 60_000);
  });

  it("inside an open window, starts from now, never in the past", () => {
    const inside = "2026-11-23T15:10:30.000Z";
    const planned = planQueue({
      config,
      now: inside,
      sentAt: [],
      fixed: [],
      pending: [{ id: 1 }],
    });
    expect((planned.get(1) ?? "") > inside).toBe(true);
  });

  it("places a picked day only in that window, or nowhere", () => {
    const full = planQueue({
      config: { ...config, dailyMax: 1 },
      now,
      sentAt: [],
      fixed: [{ id: 9, scheduledFor: "2026-11-24T14:00:00.000Z" }],
      pending: [{ id: 1 }],
      onlySlot: "2026-11-24T14:00:00.000Z",
    });
    expect(full.has(1)).toBe(false);
  });
});
