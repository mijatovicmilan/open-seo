// Times for scheduled outreach (fork feature): each shown in the owner's own
// zone (the browser's) and, when it differs, in the recipients' zone.

export function ownZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function zoneCity(zone: string) {
  return zone.split("/").at(-1)?.replace(/_/gu, " ") ?? zone;
}

export function clock(at: string, zone: string) {
  return new Date(at).toLocaleTimeString("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function weekday(at: string, zone: string) {
  return new Date(at).toLocaleDateString("en-US", {
    timeZone: zone,
    weekday: "short",
  });
}

export function dateKey(at: string, zone: string) {
  return new Date(at).toLocaleDateString("en-CA", { timeZone: zone });
}

/** "Today", "Tomorrow" or "Wed, Nov 25", in the owner's zone. */
export function dayLabel(at: string, zone: string, now: Date) {
  const key = dateKey(at, zone);
  const today = dateKey(now.toISOString(), zone);
  const tomorrow = dateKey(
    new Date(now.getTime() + 86_400_000).toISOString(),
    zone,
  );
  if (key === today) return "Today";
  if (key === tomorrow) return "Tomorrow";
  return new Date(at).toLocaleDateString("en-US", {
    timeZone: zone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "Tue 21:00 Bangkok · 09:00 New York". */
export function bothTimes(at: string, scheduleZone: string) {
  const own = ownZone();
  const local = `${weekday(at, own)} ${clock(at, own)} ${zoneCity(own)}`;
  if (own === scheduleZone) return local;
  return `${local} · ${clock(at, scheduleZone)} ${zoneCity(scheduleZone)}`;
}

export function ago(iso: string | null, now = Date.now()) {
  if (!iso) return "never";
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
