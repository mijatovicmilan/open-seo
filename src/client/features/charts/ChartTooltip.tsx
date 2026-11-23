import { useEffect, useRef, useState } from "react";
import { ExternalLink, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import type {
  ChartMetric,
  ChartNote,
  ChartPoint,
  ChartSeries,
  ScreenPoint,
} from "@/client/features/charts/TimeSeriesChart";
import type { ShownDay } from "@/client/features/charts/useChartTooltip";

// The chart's tooltip card (fork feature). It can be reached with the
// mouse and pinned by a click, so its marks are usable: each mark is one
// line, a page opens in a new tab, a note opens its editor, and a day with
// many marks expands in place.

const VISIBLE_NOTES = 4;
const CARD_WIDTH = 288;

function shortDay(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The change against the comparison, as Plausible's tooltip shows it: a
 *  plain difference for small counts (2 → 5 is +3, not +150%), a percentage
 *  otherwise; position counts places, and fewer places is better. */
function ChangeCell({
  metric,
  value,
  prior,
}: {
  metric: ChartMetric;
  value: number | null | undefined;
  prior: number | null | undefined;
}) {
  if (
    value === null ||
    value === undefined ||
    prior === null ||
    prior === undefined
  ) {
    return <td className="py-0.5 pl-2 text-right text-muted-foreground">—</td>;
  }
  const diff = value - prior;
  let text: string;
  if (metric.inverted) {
    text = `${diff < 0 ? "+" : diff > 0 ? "−" : ""}${Math.abs(diff).toFixed(1)}`;
  } else if (metric.percent) {
    text = `${diff >= 0 ? "+" : "−"}${Math.abs(diff * 100).toFixed(1)} pt`;
  } else if (prior < 20) {
    text = `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${Math.abs(diff).toLocaleString("en-US")}`;
  } else {
    const pct = (diff / prior) * 100;
    text = `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)}%`;
  }
  const better = metric.inverted ? diff < 0 : diff > 0;
  const tone =
    Math.abs(diff) < 1e-9
      ? "text-muted-foreground"
      : better
        ? "text-success"
        : "text-destructive";
  return (
    <td className={`py-0.5 pl-2 text-right tabular-nums ${tone}`}>
      {Math.abs(diff) < 1e-9 ? "0" : text}
    </td>
  );
}

function MetricsTable({
  point,
  series,
}: {
  point: ChartPoint;
  series: ChartSeries[];
}) {
  const hasCompare = Boolean(point.compare);
  return (
    <table className="w-full">
      {hasCompare ? (
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <th />
            <th className="pb-1 text-right font-normal">This</th>
            <th
              className="max-w-20 truncate pb-1 pl-2 text-right font-normal"
              title={point.compareLabel}
            >
              {point.compareLabel ?? "Before"}
            </th>
            <th className="pb-1 pl-2 text-right font-normal">Change</th>
          </tr>
        </thead>
      ) : null}
      <tbody>
        {series.map((s) => {
          const value = point.values[s.key];
          const prior = point.compare?.[s.key];
          return (
            <tr key={s.key}>
              <td className="py-0.5">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  {s.metric.name}
                </span>
              </td>
              <td className="py-0.5 text-right font-medium tabular-nums text-foreground">
                {value === null || value === undefined
                  ? "—"
                  : s.metric.format(value)}
              </td>
              {hasCompare ? (
                <td className="py-0.5 pl-2 text-right tabular-nums text-muted-foreground">
                  {prior === null || prior === undefined
                    ? "—"
                    : s.metric.format(prior)}
                </td>
              ) : null}
              {hasCompare ? (
                <ChangeCell metric={s.metric} value={value} prior={prior} />
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const ICON_BUTTON = "text-muted-foreground";

function NoteRow({
  note,
  showDate,
  onEdit,
}: {
  note: ChartNote;
  showDate: boolean;
  onEdit?: (note: ChartNote) => void;
}) {
  const full = note.url && note.text !== note.url ? note.url : note.text;
  return (
    <li className="flex h-6 items-center gap-2">
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: note.color }}
        aria-hidden
      />
      {showDate && note.date ? (
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {shortDay(note.date)}
        </span>
      ) : null}
      <span className="shrink-0 text-muted-foreground">{note.label}</span>
      <span className="min-w-0 flex-1 truncate text-foreground/80" title={full}>
        {note.text}
      </span>
      {note.url ? (
        <Button
          variant="ghost"
          size="icon-xs"
          nativeButton={false}
          render={
            <a href={note.url} target="_blank" rel="noopener noreferrer" />
          }
          className={ICON_BUTTON}
          aria-label={`Open ${note.url} in a new tab`}
          title="Open in a new tab"
        >
          <ExternalLink className="size-3.5" />
        </Button>
      ) : null}
      {note.editable && onEdit ? (
        <Button
          variant="ghost"
          size="icon-xs"
          className={ICON_BUTTON}
          aria-label={`Edit note: ${note.text}`}
          title="Edit note"
          onClick={() => onEdit(note)}
        >
          <Pencil className="size-3.5" />
        </Button>
      ) : null}
    </li>
  );
}

function TooltipCard({
  point,
  series,
  notes,
  pinned,
  onClose,
  onAddNote,
  onEditNote,
  expandAll = false,
}: {
  point: ChartPoint;
  series: ChartSeries[];
  /** The day's marks, or every mark of a merged marker. */
  notes: ChartNote[];
  pinned: boolean;
  /** Open with every mark listed (a clicked marker). */
  expandAll?: boolean;
  onClose: () => void;
  onAddNote?: () => void;
  onEditNote?: (note: ChartNote) => void;
}) {
  const [expanded, setExpanded] = useState(expandAll);
  const showDates = new Set(notes.map((note) => note.date)).size > 1;
  const visible = expanded ? notes : notes.slice(0, VISIBLE_NOTES);
  const hidden = notes.length - visible.length;
  return (
    <div className="rounded-lg bg-popover p-3 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">{point.label}</span>
        <span className="flex items-center gap-1">
          {point.partial ? (
            <span className="text-muted-foreground">
              {point.partialNote ?? "partial data"}
            </span>
          ) : null}
          {pinned ? (
            <Button
              variant="ghost"
              size="icon-xs"
              className={ICON_BUTTON}
              aria-label="Close"
              onClick={onClose}
            >
              <X className="size-3.5" />
            </Button>
          ) : null}
        </span>
      </div>
      <MetricsTable point={point} series={series} />
      {notes.length ? (
        <div className="mt-2 border-t border-border pt-1.5">
          <ul
            className={
              expanded ? "max-h-48 overflow-y-auto overscroll-contain" : ""
            }
          >
            {visible.map((note, index) => (
              <NoteRow
                key={`${note.kind}-${note.date ?? ""}-${index}`}
                note={note}
                showDate={showDates}
                onEdit={onEditNote}
              />
            ))}
          </ul>
          {hidden > 0 ? (
            <Button
              variant="link"
              size="xs"
              className="mt-1 h-auto px-0 py-0.5"
              onClick={() => setExpanded(true)}
            >
              Show {hidden} more
            </Button>
          ) : null}
        </div>
      ) : null}
      {pinned && onAddNote ? (
        <div className="mt-2 flex justify-end border-t border-border pt-1.5">
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={onAddNote}
          >
            <Plus data-icon="inline-start" /> Note on this day
          </Button>
        </div>
      ) : !pinned && (notes.length || onAddNote) ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Click to pin{onAddNote ? " or add a note" : ""}
        </p>
      ) : null}
    </div>
  );
}

/** The card in the chart box, beside the day (or over it on a narrow
 *  screen), kept inside the chart's height where it fits. */
export function TooltipLayer({
  day,
  pinned,
  point,
  series,
  notes,
  chartWidth,
  chartHeight,
  onEnter,
  onLeave,
  onClose,
  onAddNote,
  onEditNote,
}: {
  day: ShownDay;
  pinned: boolean;
  point: ChartPoint;
  series: ChartSeries[];
  notes: ChartNote[];
  chartWidth: number;
  chartHeight: number;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
  onAddNote?: (at: ScreenPoint) => void;
  onEditNote?: (note: ChartNote, at: ScreenPoint) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setHeight(el.offsetHeight);
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const width = Math.min(CARD_WIDTH, chartWidth);
  let left = Math.max(0, Math.min(day.x - width / 2, chartWidth - width));
  if (day.x + 14 + width <= chartWidth) left = day.x + 14;
  else if (day.x - 14 - width >= 0) left = day.x - 14 - width;
  const top = Math.max(-8, Math.min(day.y - height / 2, chartHeight - height));
  const at = (): ScreenPoint => {
    const rect = ref.current?.getBoundingClientRect();
    return rect
      ? { x: rect.left + rect.width / 2, y: rect.top + 24 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 3 };
  };

  return (
    <div
      ref={ref}
      className="absolute z-20"
      style={{
        left,
        top,
        width,
        // A plain card lets the pointer scrub through; one with marks can be
        // reached.
        pointerEvents: pinned || notes.length ? "auto" : "none",
        visibility: height ? "visible" : "hidden",
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <TooltipCard
        point={point}
        series={series}
        notes={notes}
        pinned={pinned}
        expandAll={Boolean(day.group)}
        onClose={onClose}
        onAddNote={onAddNote ? () => onAddNote(at()) : undefined}
        onEditNote={onEditNote ? (note) => onEditNote(note, at()) : undefined}
      />
    </div>
  );
}
