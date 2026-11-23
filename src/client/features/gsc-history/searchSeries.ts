import type {
  ChartMetric,
  ChartNote,
  ChartPoint,
} from "@/client/features/charts/TimeSeriesChart";
import { ANNOTATION_STYLES } from "@/client/features/gsc-history/annotationStyles";
import type { Insights } from "@/client/features/gsc-history/types";
import { GSC_ANNOTATION_KINDS } from "@/types/schemas/gsc-history";

// Turns the server's daily series into chart points with every metric at a
// chosen granularity, with the notes that fall in each bucket.

export type MetricKey = "clicks" | "impressions" | "ctr" | "position";
export type Granularity = "auto" | "day" | "week" | "month";

const count = (value: number) => Math.round(value).toLocaleString("en-US");

export const METRICS: Record<
  MetricKey,
  ChartMetric & { key: MetricKey; color: string }
> = {
  // One fixed theme colour per metric: card, line and tooltip dot.
  clicks: {
    key: "clicks",
    name: "Clicks",
    integer: true,
    format: count,
    // Small floors (Plausible-style whole ticks above them): one click is
    // a quarter of the height, five impressions half of it.
    minTop: 4,
    color: "var(--color-primary)",
  },
  impressions: {
    key: "impressions",
    name: "Impressions",
    integer: true,
    format: count,
    minTop: 10,
    color: "var(--color-warning)",
  },
  ctr: {
    key: "ctr",
    name: "CTR",
    integer: false,
    percent: true,
    format: (value) => `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`,
    minTop: 0.02,
    color: "var(--color-success)",
  },
  position: {
    key: "position",
    name: "Avg position",
    integer: false,
    inverted: true,
    format: (value) => value.toFixed(1),
    minTop: 10,
    // Orange-red, apart from the blue clicks line (as in Search Console).
    color: "var(--color-error)",
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

/** The page's path; the tooltip truncates it with "…" and shows it whole
 *  on hover. */
function pathOf(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function noteFor(annotation: Insights["annotations"][number]): ChartNote {
  const style = ANNOTATION_STYLES[annotation.kind];
  const text =
    annotation.kind === "first_seen" && annotation.url
      ? pathOf(annotation.url)
      : annotation.label;
  return {
    kind: annotation.kind,
    label: style.label,
    color: style.color,
    text,
    date: annotation.date,
    url: annotation.url,
    id: annotation.id,
    editable:
      Boolean(annotation.id) &&
      GSC_ANNOTATION_KINDS.some((kind) => kind === annotation.kind),
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

export const METRIC_KEYS: MetricKey[] = [
  "clicks",
  "impressions",
  "ctr",
  "position",
];

/** The metrics in the URL ("clicks,ctr"); clicks and impressions by default. */
export function parseMetrics(value: string | undefined): MetricKey[] {
  const picked = METRIC_KEYS.filter((key) =>
    (value ?? "").split(",").includes(key),
  );
  return picked.length ? picked : ["clicks", "impressions"];
}
const EMPTY_VALUES: Record<MetricKey, null> = {
  clicks: null,
  impressions: null,
  ctr: null,
  position: null,
};

function valuesOf(sums: Sums): Record<MetricKey, number | null> {
  return {
    clicks: valueOf(sums, "clicks"),
    impressions: valueOf(sums, "impressions"),
    ctr: valueOf(sums, "ctr"),
    position: valueOf(sums, "position"),
  };
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
  // A young site's chart starts on its first day with data (the week or
  // month holding it), not on empty days before it.
  const from = bucketKey(firstDataDay, granularity);
  return from > first ? from : first;
}

export function buildChartPoints(input: {
  series: Insights["series"];
  annotations: Insights["annotations"];
  granularity: "day" | "week" | "month";
  from: string | null;
  hasCompare: boolean;
  /** Nothing is drawn for buckets that end before this day. */
  firstDataDay?: string | null;
}): ChartPoint[] {
  const { granularity } = input;
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
      lastDate: string;
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
      lastDate: day.date,
    };
    bucket.days += 1;
    bucket.lastDate = day.date;
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
      // Before the first day with impressions there is no data, not zero.
      values:
        input.firstDataDay && bucket.lastDate < input.firstDataDay
          ? EMPTY_VALUES
          : valuesOf(bucket.current),
      ...(input.hasCompare
        ? {
            compare: bucket.hasCompare
              ? valuesOf(bucket.compare)
              : EMPTY_VALUES,
            // Short: it heads a narrow tooltip column.
            compareLabel: bucket.compareStart
              ? fmt(bucket.compareStart, {
                  month: "short",
                  day: "numeric",
                  ...(bucket.compareStart.slice(0, 4) !== key.slice(0, 4)
                    ? { year: "2-digit" }
                    : {}),
                })
              : undefined,
          }
        : {}),
      partial: bucket.partial || short,
      ...(bucket.partial
        ? { partialNote: "partial data (fresh)" }
        : short
          ? { partialNote: `${bucket.days} of ${fullDays(key)} days` }
          : {}),
      ...(notesByKey.has(key) ? { notes: notesByKey.get(key) } : {}),
    };
  });
}
