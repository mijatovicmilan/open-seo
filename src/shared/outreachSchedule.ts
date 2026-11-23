import { sort } from "remeda";

// Scheduled sending for outreach (fork feature). Pure functions: when the
// next sending windows are, which window an instant falls in, and which
// approved emails go into which window within the daily and weekly limits.
//
// A window opens on each sending weekday at the set time in the recipients'
// zone (09:00 New York) and stays open `windowMinutes`. Emails are only ever
// sent inside a window; one that misses its window moves to the next one.
// Limits are counted as the rest of outreach counts them: days and weeks
// (from Monday) in the limits zone.

export type ScheduleConfig = {
  /** IANA zone the time and weekdays are read in (the recipients'). */
  timeZone: string;
  /** ISO weekdays, Monday = 1. */
  days: number[];
  /** "HH:MM", 24-hour. */
  time: string;
  windowMinutes: number;
  /** Zone the daily and weekly limits count days in. */
  limitsTimeZone: string;
  dailyMax: number;
  weeklyMax: number;
};

type ScheduleSlot = {
  /** UTC ISO instants. */
  start: string;
  end: string;
  /** The sending day in the schedule zone (YYYY-MM-DD). */
  date: string;
};

/** Minutes between two emails of one window. */
export const SCHEDULE_GAP_MINUTES = 5;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

function parts(instant: Date, timeZone: string) {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(values.find((item) => item.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** The zone's offset from UTC at an instant, in milliseconds. */
function offsetMs(instant: Date, timeZone: string) {
  const p = parts(instant, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** A wall-clock time on a date in a zone, as a UTC instant. Twice through
 *  the offset, so days on which daylight saving time changes come out right. */
export function zonedTimeToUtc(date: string, time: string, timeZone: string) {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall - offsetMs(new Date(wall), timeZone);
  guess = wall - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** The date (YYYY-MM-DD) an instant falls on in a zone. */
function localDate(instant: Date | string, timeZone: string) {
  const p = parts(new Date(instant), timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function shiftDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function isoWeekday(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function weekStartOf(date: string) {
  return shiftDate(date, -(isoWeekday(date) - 1));
}

function slotOn(config: ScheduleConfig, date: string): ScheduleSlot {
  const start = zonedTimeToUtc(date, config.time, config.timeZone);
  return {
    start: start.toISOString(),
    end: new Date(
      start.getTime() + config.windowMinutes * MINUTE_MS,
    ).toISOString(),
    date,
  };
}

/** The next `count` windows still open at `now` (the current one first, if
 *  `now` is inside it). Looks at most 8 weeks ahead. */
export function upcomingSlots(
  config: ScheduleConfig,
  now: string,
  count: number,
): ScheduleSlot[] {
  if (config.days.length === 0 || count < 1) return [];
  const out: ScheduleSlot[] = [];
  // From the day before, so a window that started yesterday in the zone and
  // is still open is not missed.
  let date = shiftDate(localDate(now, config.timeZone), -1);
  for (
    let i = 0;
    i < 60 && out.length < count;
    i += 1, date = shiftDate(date, 1)
  ) {
    if (!config.days.includes(isoWeekday(date))) continue;
    const slot = slotOn(config, date);
    if (slot.end > now) out.push(slot);
  }
  return out;
}

/** The window an instant falls inside, or null when it is outside every
 *  window (settings changed, or a time picked by hand). */
export function slotContaining(
  config: ScheduleConfig,
  instant: string,
): ScheduleSlot | null {
  const date = localDate(instant, config.timeZone);
  for (const candidate of [date, shiftDate(date, -1)]) {
    if (!config.days.includes(isoWeekday(candidate))) continue;
    const slot = slotOn(config, candidate);
    if (instant >= slot.start && instant < slot.end) return slot;
  }
  return null;
}

/** A small, stable spread inside the window (0–119 s) so emails do not leave
 *  on the exact minute. */
function jitterMs(id: number) {
  return ((id * 7919) % 120) * 1000;
}

type Capacity = {
  config: ScheduleConfig;
  perDay: Map<string, number>;
  perWeek: Map<string, number>;
};

function countIn(capacity: Capacity, instant: string) {
  const day = localDate(instant, capacity.config.limitsTimeZone);
  const week = weekStartOf(day);
  capacity.perDay.set(day, (capacity.perDay.get(day) ?? 0) + 1);
  capacity.perWeek.set(week, (capacity.perWeek.get(week) ?? 0) + 1);
}

function hasRoom(capacity: Capacity, instant: string) {
  const day = localDate(instant, capacity.config.limitsTimeZone);
  const week = weekStartOf(day);
  return (
    (capacity.perDay.get(day) ?? 0) < capacity.config.dailyMax &&
    (capacity.perWeek.get(week) ?? 0) < capacity.config.weeklyMax
  );
}

type QueueInput = {
  config: ScheduleConfig;
  now: string;
  /** When emails were already sent (they use up the limits). */
  sentAt: string[];
  /** Emails that keep their time (picked by hand, or planned and still in
   *  an open window). */
  fixed: Array<{ id: number; scheduledFor: string }>;
  /** Emails to place, in the order they should go. */
  pending: Array<{ id: number }>;
  /** Only this window (its start), for a day the owner picked. */
  onlySlot?: string;
};

/** Places each pending email in the first window with room under the
 *  limits, a few minutes after the previous email of that window. Returns
 *  the planned time per id; ids with no room in the next 8 weeks are left
 *  out. */
export function planQueue(input: QueueInput): Map<number, string> {
  const { config, now } = input;
  const capacity: Capacity = { config, perDay: new Map(), perWeek: new Map() };
  for (const at of input.sentAt) countIn(capacity, at);
  const taken = new Map<string, number[]>();
  for (const item of input.fixed) {
    countIn(capacity, item.scheduledFor);
    const slot = slotContaining(config, item.scheduledFor);
    if (slot) {
      taken.set(slot.start, [
        ...(taken.get(slot.start) ?? []),
        Date.parse(item.scheduledFor),
      ]);
    }
  }
  const planned = new Map<number, string>();
  const slots = upcomingSlots(config, now, 40).filter(
    (slot) => !input.onlySlot || slot.start === input.onlySlot,
  );
  for (const item of input.pending) {
    for (const slot of slots) {
      const used = taken.get(slot.start) ?? [];
      const base = Math.max(
        Date.parse(slot.start),
        // Inside an open window: from the next whole minute.
        Math.ceil(Date.parse(now) / MINUTE_MS) * MINUTE_MS,
        ...used.map((at) => at + SCHEDULE_GAP_MINUTES * MINUTE_MS),
      );
      const at = base + jitterMs(item.id);
      if (at >= Date.parse(slot.end)) continue;
      const iso = new Date(at).toISOString();
      if (!hasRoom(capacity, iso)) continue;
      countIn(capacity, iso);
      taken.set(slot.start, [...used, at]);
      planned.set(item.id, iso);
      break;
    }
  }
  return planned;
}

/** What to do with a scheduled email at `now`: wait, send, or move it
 *  because its window passed (or it sits outside every window). */
export function dueState(
  config: ScheduleConfig,
  scheduledFor: string,
  now: string,
): "waiting" | "due" | "missed" {
  const slot = slotContaining(config, scheduledFor);
  if (!slot) return "missed";
  if (now >= slot.end) return "missed";
  return scheduledFor <= now ? "due" : "waiting";
}

/** "1 2 3 4 5" → [1, 2, 3, 4, 5], ignoring anything that is not a weekday. */
export function parseScheduleDays(value: string): number[] {
  const days = value
    .split(/[\s,]+/u)
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
  return sort([...new Set(days)], (a, b) => a - b);
}

export function isScheduleTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value);
}
