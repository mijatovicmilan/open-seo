import { useState } from "react";
import { ChoiceMenu, SegmentGroup } from "@/client/features/charts/ChoiceMenu";
import { countryName } from "@/client/features/gsc-history/countryNames";
import { CalendarRange, X } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Switch } from "@/client/components/ui/switch";
import type { Granularity } from "@/client/features/gsc-history/searchSeries";
import type {
  SearchInsightsCompare,
  SearchInsightsRange,
} from "@/types/schemas/gsc-history";

// Period, comparison and granularity controls for Search Insights, in the
// app's toolbar style: a segmented period group and same-height dropdowns.

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
  { value: "day", label: "By day" },
  { value: "week", label: "By week" },
  { value: "month", label: "By month" },
];

const ALL = "all";

export function InsightsControls({
  range,
  start,
  end,
  compare,
  fresh,
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
  fresh: boolean;
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
    fresh?: boolean;
    gran?: Granularity;
    country?: string;
    device?: Device;
  }) => void;
}) {
  const [draftStart, setDraftStart] = useState(start ?? "");
  const [draftEnd, setDraftEnd] = useState(end ?? "");
  const [editing, setEditing] = useState(false);
  const showCustom = range === "custom" || editing;
  const resolvedLabel =
    GRANULARITY_LABELS.find((item) => item.value === resolvedGranularity)
      ?.label ?? resolvedGranularity;
  const countryOptions = [
    { value: ALL, label: "All countries" },
    ...(country && !countries.some((row) => row.country === country)
      ? [{ value: country, label: countryName(country) }]
      : []),
    ...countries.map((row) => ({
      value: row.country,
      label: countryName(row.country),
      hint: row.impressions.toLocaleString("en-US"),
    })),
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentGroup
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
        <div className="flex flex-wrap items-center gap-2">
          <ChoiceMenu
            label="Compare with"
            value={compare}
            options={COMPARE_OPTIONS}
            onChange={(value) => onChange({ compare: value })}
            menuWidth="w-52"
          />
          <ChoiceMenu
            label="Granularity"
            value={granularity}
            display={
              granularity === "auto" ? (
                <>
                  {resolvedLabel}{" "}
                  <span className="text-muted-foreground">· auto</span>
                </>
              ) : undefined
            }
            options={GRANULARITY_LABELS.map((item) =>
              item.value === "auto"
                ? { ...item, label: "Auto", hint: resolvedLabel }
                : item,
            )}
            onChange={(value) => onChange({ gran: value })}
            menuWidth="w-44"
          />
          <ChoiceMenu
            label="Country"
            value={country ?? ALL}
            options={countryOptions}
            searchable
            searchPlaceholder="Search countries"
            narrowed={Boolean(country)}
            display={country ? countryName(country) : "All countries"}
            onChange={(value) =>
              onChange({ country: value === ALL ? undefined : value })
            }
            menuWidth="w-64"
          />
          <ChoiceMenu
            label="Device"
            value={device ?? ALL}
            options={[{ value: ALL, label: "All devices" }, ...DEVICE_OPTIONS]}
            narrowed={Boolean(device)}
            onChange={(value) =>
              onChange({
                device: DEVICE_OPTIONS.find((option) => option.value === value)
                  ?.value,
              })
            }
            menuWidth="w-44"
          />
          {/* Fork addition (FORK-CHANGES.md): count the partial days too. */}
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm whitespace-nowrap">
            <Switch
              checked={fresh}
              onCheckedChange={(next) => onChange({ fresh: next })}
            />
            Include partial days
          </label>
        </div>
        {segmentsPending ? (
          <span className="text-xs text-muted-foreground">
            Country and device data is still being added for older days.
          </span>
        ) : null}
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
          <CalendarRange className="size-4 text-muted-foreground" />
          <Input
            type="date"
            className="h-9 w-40 text-sm"
            value={draftStart}
            min={bounds.oldest ?? undefined}
            max={bounds.newest ?? undefined}
            onChange={(event) => setDraftStart(event.target.value)}
            aria-label="From"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            className="h-9 w-40 text-sm"
            value={draftEnd}
            min={bounds.oldest ?? undefined}
            max={bounds.newest ?? undefined}
            onChange={(event) => setDraftEnd(event.target.value)}
            aria-label="To"
          />
          <Button type="submit" className="h-9">
            Apply
          </Button>
          {range !== "custom" ? (
            <Button
              type="button"
              variant="ghost"
              className="h-9"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
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
    <Badge
      variant="outline"
      className="h-6 max-w-full gap-1 bg-muted pr-0.5 pl-2 font-normal text-foreground/80"
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[14rem] min-w-0 truncate" title={value}>
        {value}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        className="size-5 rounded-full text-muted-foreground"
        aria-label={`Clear ${label.toLowerCase()} filter`}
        onClick={() => onClear(key)}
      >
        <X className="size-3" />
      </Button>
    </Badge>
  );
  let path = page ?? "";
  try {
    path = page ? new URL(page).pathname || "/" : "";
  } catch {
    path = page ?? "";
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Filtered to</span>
      {page ? chip("page", "Page", path) : null}
      {query ? chip("query", "Query", query) : null}
      {country ? chip("country", "Country", countryName(country)) : null}
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
