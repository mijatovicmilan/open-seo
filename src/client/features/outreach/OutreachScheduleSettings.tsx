import { sort } from "remeda";
import { ago, bothTimes } from "@/client/features/outreach/scheduleTime";
import type { OutreachSettingsFormState } from "@/client/features/outreach/OutreachSettingsForm";
import { upcomingSlots } from "@/shared/outreachSchedule";

// The Schedule part of the outreach settings (fork feature).

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WINDOWS = [30, 60, 120, 180, 240];
const ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Belgrade",
  "Asia/Bangkok",
  "Australia/Sydney",
  "UTC",
];
const STALE_MS = 15 * 60_000;

function validZone(zone: string) {
  try {
    return Boolean(
      new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions()
        .timeZone,
    );
  } catch {
    return false;
  }
}

/** When approved emails go out by themselves, with the next five sending
 *  times in both zones. */
export function ScheduleSection({
  form,
  checkedAt,
  onChange,
}: {
  form: OutreachSettingsFormState;
  checkedAt: string | null;
  onChange: (values: Partial<OutreachSettingsFormState>) => void;
}) {
  const zoneOk = validZone(form.scheduleTimeZone);
  const preview =
    zoneOk && /^\d{2}:\d{2}$/u.test(form.scheduleTime)
      ? upcomingSlots(
          {
            timeZone: form.scheduleTimeZone,
            days: form.scheduleDays,
            time: form.scheduleTime,
            windowMinutes: form.scheduleWindowMinutes,
            limitsTimeZone: form.timeZone,
            dailyMax: form.dailyMax,
            weeklyMax: form.weeklyMax,
          },
          new Date().toISOString(),
          5,
        )
      : [];
  const stale = !checkedAt || Date.now() - Date.parse(checkedAt) > STALE_MS;
  return (
    <section className="space-y-3 rounded-xl border border-base-300 bg-base-100 p-4">
      <div>
        <h3 className="font-semibold">Schedule</h3>
        <p className="text-sm text-base-content/60">
          Approved emails go out by themselves on these days, at this time in
          the recipients&rsquo; time zone, within the window and the limits
          above. A window the Mac sleeps through moves to the next sending day.
        </p>
      </div>
      <div>
        <span className="label-text mb-1 block text-sm font-medium">Days</span>
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Sending days"
        >
          {WEEKDAYS.map((name, index) => {
            const day = index + 1;
            const on = form.scheduleDays.includes(day);
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                className={`h-8 min-w-12 rounded-md border px-2.5 text-sm transition-colors ${
                  on
                    ? "border-primary/50 bg-primary/10 font-medium text-base-content"
                    : "border-base-300 text-base-content/60 hover:border-base-content/30"
                }`}
                onClick={() =>
                  onChange({
                    scheduleDays: on
                      ? form.scheduleDays.filter((item) => item !== day)
                      : sort([...form.scheduleDays, day], (a, b) => a - b),
                  })
                }
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr_9rem]">
        <label className="flex flex-col">
          <span className="label-text mb-1 text-sm font-medium">Time</span>
          <input
            type="time"
            className="input input-sm input-bordered w-full"
            value={form.scheduleTime}
            onChange={(event) => onChange({ scheduleTime: event.target.value })}
          />
        </label>
        <label className="flex flex-col">
          <span className="label-text mb-1 text-sm font-medium">
            Recipients&rsquo; time zone
          </span>
          <input
            className={`input input-sm input-bordered w-full ${zoneOk ? "" : "input-error"}`}
            list="outreach-schedule-zones"
            value={form.scheduleTimeZone}
            onChange={(event) =>
              onChange({ scheduleTimeZone: event.target.value.trim() })
            }
          />
          <datalist id="outreach-schedule-zones">
            {ZONES.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col">
          <span className="label-text mb-1 text-sm font-medium">Window</span>
          <select
            className="select select-sm select-bordered w-full"
            value={form.scheduleWindowMinutes}
            onChange={(event) =>
              onChange({ scheduleWindowMinutes: Number(event.target.value) })
            }
          >
            {WINDOWS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="rounded-lg bg-base-200/60 px-3 py-2.5">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-base-content/50">
          Next sending times
        </div>
        {preview.length ? (
          <ul className="space-y-0.5 text-sm tabular-nums">
            {preview.map((slot) => (
              <li key={slot.start}>
                {bothTimes(slot.start, form.scheduleTimeZone)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-base-content/60">
            {zoneOk ? "Pick at least one day." : "Unknown time zone."}
          </p>
        )}
      </div>
      <p
        className={`text-xs ${stale ? "text-warning" : "text-base-content/55"}`}
      >
        Scheduler: last check {ago(checkedAt)}
        {stale
          ? ". It runs every 5 minutes while the app is up; a late check means the Mac is asleep or Docker is stopped."
          : "."}
      </p>
    </section>
  );
}
