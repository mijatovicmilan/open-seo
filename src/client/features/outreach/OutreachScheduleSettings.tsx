import { sort } from "remeda";
import { cn } from "cn";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { ago, bothTimes } from "@/client/features/outreach/scheduleTime";
import type { OutreachSettingsFormState } from "@/client/features/outreach/OutreachSettingsForm";
import { upcomingSlots } from "@/shared/outreachSchedule";

// The Schedule part of the outreach settings (fork feature).

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WINDOWS = [30, 60, 120, 180, 240].map((minutes) => ({
  value: minutes,
  label: minutes < 60 ? `${minutes} min` : `${minutes / 60} h`,
}));
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
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h3 className="font-semibold">Schedule</h3>
        <p className="text-sm text-muted-foreground">
          Approved emails go out by themselves on these days, at this time in
          the recipients&rsquo; time zone, within the window and the limits
          above. A window the Mac sleeps through moves to the next sending day.
        </p>
      </div>
      <div>
        <span className="mb-1 block text-sm font-medium">Days</span>
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
                className={cn(
                  "h-8 min-w-12 rounded-md border px-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                  on
                    ? "border-primary/50 bg-primary/10 font-medium text-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
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
          <span className="mb-1 text-sm font-medium">Time</span>
          <Input
            type="time"
            className="h-9"
            value={form.scheduleTime}
            onChange={(event) => onChange({ scheduleTime: event.target.value })}
          />
        </label>
        <label className="flex flex-col">
          <span className="mb-1 text-sm font-medium">
            Recipients&rsquo; time zone
          </span>
          <Input
            className="h-9"
            aria-invalid={zoneOk ? undefined : true}
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
        <div className="flex flex-col">
          <span
            id="outreach-schedule-window"
            className="mb-1 text-sm font-medium"
          >
            Window
          </span>
          <Select
            items={WINDOWS}
            value={form.scheduleWindowMinutes}
            onValueChange={(minutes) => {
              if (minutes != null) onChange({ scheduleWindowMinutes: minutes });
            }}
          >
            <SelectTrigger
              className="w-full data-[size=default]:h-9"
              aria-labelledby="outreach-schedule-window"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOWS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="rounded-lg bg-muted px-3 py-2.5">
        <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
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
          <p className="text-sm text-muted-foreground">
            {zoneOk ? "Pick at least one day." : "Unknown time zone."}
          </p>
        )}
      </div>
      <p
        className={cn(
          "text-xs",
          stale
            ? "text-warning-foreground dark:text-warning"
            : "text-muted-foreground",
        )}
      >
        Scheduler: last check {ago(checkedAt)}
        {stale
          ? ". It runs every 5 minutes while the app is up; a late check means the Mac is asleep or Docker is stopped."
          : "."}
      </p>
    </section>
  );
}
