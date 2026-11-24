import type { getKeywordGscPositions } from "@/serverFunctions/gscHistory";

// Search Console positions for saved and tracked keywords (fork feature, see
// FORK-CHANGES.md), from the stored history: no DataForSEO credits. This file
// imports no server function (only its type): the rank tracker columns that
// use it also build into the standalone report widgets bundle.

export type KeywordGscPosition = Awaited<
  ReturnType<typeof getKeywordGscPositions>
>["rows"][number];

export const GSC_POSITION_HELP =
  "Search Console average position over the last 28 days with settled data, all countries and devices, for the query with exactly these words. The first number is the 28 days before. From the stored Search Console history, so it uses no DataForSEO credits.";

const round = (value: number) => Math.round(value * 10) / 10;

export function GscPositionCell({
  value,
}: {
  value: KeywordGscPosition | undefined;
}) {
  if (!value) {
    return (
      <span
        className="text-muted-foreground"
        title="No Search Console impressions in the last 28 days"
      >
        -
      </span>
    );
  }
  const position = round(value.position);
  const previous =
    value.previousPosition === null ? null : round(value.previousPosition);
  const change = previous === null ? 0 : previous - position;
  let badgeClass = "bg-muted text-foreground";
  if (change > 0) badgeClass = "bg-success/20 text-success";
  if (change < 0) badgeClass = "bg-warning/20 text-warning";
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1.5">
        {previous === null ? null : (
          <>
            <span className="font-mono text-xs text-muted-foreground">
              {previous}
            </span>
            <span className="text-muted-foreground/60">→</span>
          </>
        )}
        <span
          className={`font-mono rounded px-1.5 py-0.5 text-xs font-semibold ${badgeClass}`}
        >
          {position}
        </span>
      </span>
      <span className="text-xs whitespace-nowrap text-muted-foreground">
        {value.clicks.toLocaleString()} clicks ·{" "}
        {value.impressions.toLocaleString()} impr.
      </span>
    </span>
  );
}
