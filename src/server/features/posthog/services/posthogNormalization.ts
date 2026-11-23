import type { HogqlResult } from "@/server/lib/posthogClient";
import { Ga4MalformedResponseError } from "@/server/lib/ga4Errors";
import type { NormalizedGa4Report } from "@/server/features/ga4/services/Ga4ReportNormalization";
import type { PosthogMetricRow, PosthogQuery } from "./posthogQueries";

// Fork addition (FORK-CHANGES.md): HogQL rows → the normalized GA4 report
// (dimension values as strings, metrics as finite numbers, GA4 names).

const EMPTY_METADATA: NormalizedGa4Report["reportMetadata"] = {
  dataLossFromOtherRow: false,
  subjectToThresholding: false,
  sampling: [],
  restrictedMetrics: [],
  emptyReason: null,
  hasLimitedData: false,
};

function finiteNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Ga4MalformedResponseError();
  return parsed;
}

export function normalizePosthogResult(
  result: HogqlResult,
  spec: Pick<
    PosthogQuery,
    "dimensions" | "rawMetrics" | "metrics" | "derived" | "hasTotal"
  >,
): NormalizedGa4Report {
  const expected = [
    ...spec.dimensions,
    ...spec.rawMetrics,
    ...(spec.hasTotal ? ["__total"] : []),
  ];
  if (result.columns.join("\0") !== expected.join("\0")) {
    throw new Ga4MalformedResponseError();
  }
  const rows = result.rows.map((values) => {
    if (values.length !== expected.length) {
      throw new Ga4MalformedResponseError();
    }
    const raw: PosthogMetricRow = {};
    spec.rawMetrics.forEach((name, index) => {
      raw[name] = finiteNumber(values[spec.dimensions.length + index]);
    });
    const row: Record<string, string | number | null> = {};
    spec.dimensions.forEach((name, index) => {
      const value = values[index];
      row[name] =
        value === null || value === undefined || value === ""
          ? "(not set)"
          : String(value);
    });
    for (const metric of spec.metrics) {
      const derive = spec.derived[metric];
      row[metric] =
        metric in raw ? (raw[metric] ?? 0) : derive ? derive(raw) : null;
    }
    return row;
  });
  const totalRowCount = spec.hasTotal
    ? finiteNumber(result.rows[0]?.at(-1) ?? 0)
    : rows.length;
  return {
    rows,
    totalRowCount,
    reportMetadata: EMPTY_METADATA,
    quota: null,
  };
}
