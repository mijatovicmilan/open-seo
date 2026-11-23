import type {
  ChartMetric,
  ChartNote,
  ChartPoint,
} from "@/client/features/charts/TimeSeriesChart";
import { ANNOTATION_STYLES } from "@/client/features/gsc-history/annotationStyles";
import type { Insights } from "@/client/features/gsc-history/types";

// Turns the server's daily series into chart points for one metric at a
// chosen granularity, with the notes that fall in each bucket.

export type MetricKey = "clicks" | "impressions" | "ctr" | "position";
export type Granularity = "auto" | "day" | "week" | "month";

const count = (value: number) => Math.round(value).toLocaleString("en-US");

export const METRICS: Record<MetricKey, ChartMetric & { key: MetricKey }> = {
  clicks: { key: "clicks", name: "Clicks", integer: true, format: count },
  impressions: {
    key: "impressions",
    name: "Impressions",
    integer: true,
    format: count,
  },
  ctr: {
    key: "ctr",
    name: "CTR",
    integer: false,
    percent: true,
    format: (value) => `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`,
  },
  position: {
    key: "position",
    name: "Avg position",
    integer: false,
    inverted: true,
    format: (value) => value.toFixed(1),
  },
};

/** Day for up to three months (with the reporting days), week beyond. */
export function resolveGranularity(
  granularity: Granularity,
  days: number,
): Exclude<Granularity, "auto"> {
  if (granularity !== "auto") return granularity;
  return days <= 100 ? "day" : "week";
}

const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const fmt = (day: string, options: Intl.DateTimeFormatOptions) =>
  utc(day).toLocaleDateString("en-US", { timeZone: "UTC", ...options });

function addDays(day: string, delta: number) {
  return new Date(utc(day).getTime() + delta * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function bucketKey(day: string, granularity: "day" | "week" | "month") {
  if (granularity === "day") return day;
  if (granularity === "month") return `${day.slice(0, 7)}-01`;
  const weekday = utc(day).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

function shortPath(url: string) {
  try {
    const path = new URL(url).pathname;
    return path.length > 48 ? `${path.slice(0, 47)}…` : path;
  } catch {
    return url.length > 48 ? `${url.slice(0, 47)}…` : url;
  }
}

function noteFor(annotation: Insights["annotations"][number]): ChartNote {
  const style = ANNOTATION_STYLES[annotation.kind];
  const text =
    annotation.kind === "first_seen" && annotation.url
      ? shortPath(annotation.url)
      : annotation.label;
  return {
    kind: annotation.kind,
    label: style.label,
    color: style.color,
    text,
  };
}

type Sums = { clicks: number; impressions: number; weighted: number };

function valueOf(sums: Sums, metric: MetricKey): number | null {
  switch (metric) {
    case "clicks":
      return sums.clicks;
    case "impressions":
      return sums.impressions;
    case "ctr":
      return sums.impressions > 0 ? sums.clicks / sums.impressions : null;
    case "position":
      return sums.impressions > 0 ? sums.weighted / sums.impressions : null;
  }
}

function add(
  sums: Sums,
  day: { clicks: number; impressions: number; position: number | null },
) {
  sums.clicks += day.clicks;
  sums.impressions += day.impressions;
  sums.weighted += (day.position ?? 0) * day.impressions;
}

/** The first day the chart shows: a young site starts a few days before its
 *  first impressions instead of a long flat line at zero. */
export function chartStart(
  series: Insights["series"],
  firstDataDay: string | null,
  granularity: "day" | "week" | "month",
) {
  const first = series[0]?.date;
  if (!first || !firstDataDay || firstDataDay <= first) return first ?? null;
  // Start on a whole week or month so the first bucket is not cut short.
  const from = bucketKey(addDays(firstDataDay, -3), granularity);
  return from > first ? from : first;
}

export function buildChartPoints(input: {
  series: Insights["series"];
  annotations: Insights["annotations"];
  metric: MetricKey;
  granularity: "day" | "week" | "month";
  from: string | null;
  hasCompare: boolean;
}): ChartPoint[] {
  const { metric, granularity } = input;
  const days = input.from
    ? input.series.filter((day) => day.date >= (input.from ?? ""))
    : input.series;
  const buckets = new Map<
    string,
    {
      current: Sums;
      compare: Sums;
      compareStart: string | null;
      partial: boolean;
      hasCompare: boolean;
      days: number;
    }
  >();
  for (const day of days) {
    const key = bucketKey(day.date, granularity);
    const bucket = buckets.get(key) ?? {
      current: { clicks: 0, impressions: 0, weighted: 0 },
      compare: { clicks: 0, impressions: 0, weighted: 0 },
      compareStart: null,
      partial: false,
      hasCompare: false,
      days: 0,
    };
    bucket.days += 1;
    add(bucket.current, day);
    if (day.compare) {
      add(bucket.compare, day.compare);
      bucket.compareStart ??= day.compare.date;
      bucket.hasCompare = true;
    }
    bucket.partial ||= day.partial;
    buckets.set(key, bucket);
  }
  const first = days[0]?.date ?? "";
  const last = days.at(-1)?.date ?? "";
  const spansYears = first.slice(0, 4) !== last.slice(0, 4);
  const notesByKey = new Map<string, ChartNote[]>();
  for (const annotation of input.annotations) {
    if (annotation.date < first || annotation.date > last) continue;
    const key = bucketKey(annotation.date, granularity);
    notesByKey.set(key, [...(notesByKey.get(key) ?? []), noteFor(annotation)]);
  }
  const entries = [...buckets.entries()];
  const fullDays = (key: string) => {
    if (granularity === "day") return 1;
    if (granularity === "week") return 7;
    const date = utc(key);
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
  };
  return entries.map(([key, bucket], index) => {
    // The range can cut the first and last week or month short; such a
    // bucket is lower only because it has fewer days.
    const edge = index === 0 || index === entries.length - 1;
    const short = edge && bucket.days < fullDays(key);
    const label =
      granularity === "day"
        ? fmt(key, {
            weekday: "short",
            month: "short",
            day: "numeric",
            ...(spansYears ? { year: "numeric" } : {}),
          })
        : granularity === "week"
          ? `Week of ${fmt(key, { month: "short", day: "numeric", ...(spansYears ? { year: "numeric" } : {}) })}`
          : fmt(key, { month: "long", year: "numeric" });
    const tick =
      granularity === "month"
        ? fmt(key, {
            month: "short",
            ...(spansYears ? { year: "2-digit" } : {}),
          })
        : fmt(key, { month: "short", day: "numeric" });
    return {
      key,
      label,
      tick,
      value: valueOf(bucket.current, metric),
      ...(input.hasCompare
        ? {
            compare: bucket.hasCompare ? valueOf(bucket.compare, metric) : null,
            compareLabel: bucket.compareStart
              ? granularity === "day"
                ? fmt(bucket.compareStart, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : `From ${fmt(bucket.compareStart, { month: "short", day: "numeric", year: "numeric" })}`
              : undefined,
          }
        : {}),
      partial: bucket.partial || short,
      ...(bucket.partial
        ? { partialNote: "still reporting" }
        : short
          ? { partialNote: `${bucket.days} of ${fullDays(key)} days` }
          : {}),
      ...(notesByKey.has(key) ? { notes: notesByKey.get(key) } : {}),
    };
  });
}
