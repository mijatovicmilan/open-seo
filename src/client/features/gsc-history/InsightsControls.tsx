import { useState } from "react";
import { CalendarRange, X } from "lucide-react";
import type { Granularity } from "@/client/features/gsc-history/searchSeries";
import type {
  SearchInsightsCompare,
  SearchInsightsRange,
} from "@/types/schemas/gsc-history";

// Period, comparison and granularity controls for Search Insights, in the
// rank-tracking toggle style (joined extra-small buttons).

const RANGE_LABELS: Array<{ value: SearchInsightsRange; label: string }> = [
  { value: "7d", label: "7d" },
  { value: "28d", label: "28d" },
  { value: "3m", label: "3m" },
  { value: "6m", label: "6m" },
  { value: "12m", label: "12m" },
  { value: "16m", label: "16m" },
  { value: "custom", label: "Custom" },
];

const COMPARE_OPTIONS: Array<{ value: SearchInsightsCompare; label: string }> =
  [
    { value: "previous", label: "vs previous period" },
    { value: "year", label: "vs a year earlier" },
    { value: "none", label: "No comparison" },
  ];

type Device = "desktop" | "mobile" | "tablet";

const DEVICE_OPTIONS: Array<{ value: Device; label: string }> = [
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
  { value: "tablet", label: "Tablet" },
];

const GRANULARITY_LABELS: Array<{ value: Granularity; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

function JoinToggle<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="join" role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={value === item.value}
          className={`btn btn-xs join-item ${value === item.value ? "btn-active" : "btn-ghost"}`}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function InsightsControls({
  range,
  start,
  end,
  compare,
  granularity,
  resolvedGranularity,
  bounds,
  country,
  device,
  countries,
  segmentsPending,
  onChange,
}: {
  range: SearchInsightsRange;
  start?: string;
  end?: string;
  compare: SearchInsightsCompare;
  granularity: Granularity;
  resolvedGranularity: "day" | "week" | "month";
  bounds: { oldest: string | null; newest: string | null };
  country?: string;
  device?: Device;
  countries: Array<{ country: string; impressions: number }>;
  segmentsPending: boolean;
  onChange: (patch: {
    range?: SearchInsightsRange;
    start?: string;
    end?: string;
    compare?: SearchInsightsCompare;
    gran?: Granularity;
    country?: string;
    device?: Device;
  }) => void;
}) {
  const [draftStart, setDraftStart] = useState(start ?? "");
  const [draftEnd, setDraftEnd] = useState(end ?? "");
  const [editing, setEditing] = useState(false);
  const showCustom = range === "custom" || editing;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <JoinToggle
          label="Period"
          items={RANGE_LABELS}
          value={showCustom ? "custom" : range}
          onChange={(value) => {
            if (value === "custom") {
              setDraftStart(start ?? bounds.oldest ?? "");
              setDraftEnd(end ?? bounds.newest ?? "");
              setEditing(true);
              return;
            }
            setEditing(false);
            onChange({ range: value, start: undefined, end: undefined });
          }}
        />
        <select
          className="select select-bordered select-xs w-auto"
          value={compare}
          aria-label="Compare with"
          onChange={(event) => {
            const next = COMPARE_OPTIONS.find(
              (option) => option.value === event.target.value,
            );
            if (next) onChange({ compare: next.value });
          }}
        >
          {COMPARE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <JoinToggle
          label="Granularity"
          items={GRANULARITY_LABELS.map((item) =>
            item.value === "auto"
              ? { ...item, label: `Auto (${resolvedGranularity})` }
              : item,
          )}
          value={granularity}
          onChange={(value) => onChange({ gran: value })}
        />
        <select
          className="select select-bordered select-xs w-auto"
          value={country ?? ""}
          aria-label="Country"
          title={
            segmentsPending
              ? "Country data is still being added for older days"
              : undefined
          }
          onChange={(event) =>
            onChange({ country: event.target.value || undefined })
          }
        >
          <option value="">All countries</option>
          {country && !countries.some((row) => row.country === country) ? (
            <option value={country}>{country.toUpperCase()}</option>
          ) : null}
          {countries.map((row) => (
            <option key={row.country} value={row.country}>
              {row.country.toUpperCase()} ·{" "}
              {row.impressions.toLocaleString("en-US")}
            </option>
          ))}
        </select>
        <select
          className="select select-bordered select-xs w-auto"
          value={device ?? ""}
          aria-label="Device"
          onChange={(event) => {
            const next = DEVICE_OPTIONS.find(
              (option) => option.value === event.target.value,
            );
            onChange({ device: next?.value });
          }}
        >
          <option value="">All devices</option>
          {DEVICE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {showCustom ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draftStart || !draftEnd) return;
            setEditing(false);
            onChange({ range: "custom", start: draftStart, end: draftEnd });
          }}
        >
          <CalendarRange className="size-4 text-base-content/50" />
          <input
            type="date"
            className="input input-bordered input-xs w-36"
            value={draftStart}
            min={bounds.oldest ?? undefined}
            max={bounds.newest ?? undefined}
            onChange={(event) => setDraftStart(event.target.value)}
            aria-label="From"
          />
          <span className="text-xs text-base-content/50">to</span>
          <input
            type="date"
            className="input input-bordered input-xs w-36"
            value={draftEnd}
            min={bounds.oldest ?? undefined}
            max={bounds.newest ?? undefined}
            onChange={(event) => setDraftEnd(event.target.value)}
            aria-label="To"
          />
          <button type="submit" className="btn btn-primary btn-xs">
            Apply
          </button>
          {range !== "custom" ? (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

type FilterKey = "page" | "query" | "country" | "device";

export function FilterChips({
  page,
  query,
  country,
  device,
  onClear,
}: {
  page?: string;
  query?: string;
  country?: string;
  device?: Device;
  onClear: (key: FilterKey) => void;
}) {
  if (!page && !query && !country && !device) return null;
  const chip = (key: FilterKey, label: string, value: string) => (
    <span className="badge badge-sm gap-1 border-base-300 bg-base-200 py-2.5 pl-2 pr-1 text-base-content/80">
      <span className="text-base-content/50">{label}</span>
      <span className="max-w-[14rem] truncate" title={value}>
        {value}
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-xs btn-circle size-4 min-h-0"
        aria-label={`Clear ${label.toLowerCase()} filter`}
        onClick={() => onClear(key)}
      >
        <X className="size-3" />
      </button>
    </span>
  );
  let path = page ?? "";
  try {
    path = page ? new URL(page).pathname || "/" : "";
  } catch {
    path = page ?? "";
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-base-content/50">Filtered to</span>
      {page ? chip("page", "Page", path) : null}
      {query ? chip("query", "Query", query) : null}
      {country ? chip("country", "Country", country.toUpperCase()) : null}
      {device
        ? chip(
            "device",
            "Device",
            DEVICE_OPTIONS.find((option) => option.value === device)?.label ??
              device,
          )
        : null}
    </div>
  );
}
