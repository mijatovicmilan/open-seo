import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { formatDay } from "@/client/features/gsc-history/annotationStyles";
import { PageCell } from "@/client/features/gsc-history/SearchInsightsSections";
import type { Insights } from "@/client/features/gsc-history/types";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";

// The New pages table of Search Insights, with a weekly impressions
// sparkline per page.

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const maxValue = Math.max(...values, 1);
  const width = 80;
  const height = 20;
  const step = width / (values.length - 1);
  const points = values
    .map(
      (v, i) =>
        `${(i * step).toFixed(1)},${(height - (v / maxValue) * height).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg width={width} height={height} aria-hidden className="text-info">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      />
    </svg>
  );
}

export function NewPagesTable({ rows }: { rows: Insights["newPages"] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Page</TableHead>
          <TableHead>First impressions</TableHead>
          <TableHead className="text-right">Impr.</TableHead>
          <TableHead className="text-right">Clicks</TableHead>
          <TableHead>Weekly impressions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.page}>
            <TableCell>
              <PageCell url={row.page} />
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {formatDay(row.firstDate)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCount(row.impressions)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCount(row.clicks)}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Sparkline values={row.weeklyImpressions} />
                <span className="text-xs text-muted-foreground">
                  {row.weeklyImpressions.length} wk
                </span>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
