import { useState } from "react";
import { cn } from "cn";
import { Button } from "@/client/components/ui/button";
import {
  type OutreachHistoryEntry,
  type OutreachTimelineItem,
  outreachTimeline,
} from "@/shared/outreach";

// A compact activity timeline (fork feature): newest first, grouped by day,
// repeats merged, the owner's own steps marked "you". Background events
// (measurements, scores, imports) are muted so the outreach steps stand out.

const COLLAPSED_ROWS = 6;

function dayLabel(iso: string) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso.slice(0, 10);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (at.toDateString() === today.toDateString()) return "Today";
  if (at.toDateString() === yesterday.toDateString()) return "Yesterday";
  return at.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(at.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

function timeLabel(iso: string) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ""
    : at.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
}

function repeatLabel(item: OutreachTimelineItem) {
  if (item.count < 2) return null;
  return item.type === "drafted" || item.type === "rewritten"
    ? `${item.count} versions`
    : `×${item.count}`;
}

function TimelineRow({ item }: { item: OutreachTimelineItem }) {
  const repeat = repeatLabel(item);
  const owner = item.actor === "owner";
  return (
    <li className="relative grid grid-cols-[2.75rem_1fr] gap-x-3 py-1">
      <span className="pt-0.5 text-xs whitespace-nowrap text-muted-foreground/70 tabular-nums">
        {timeLabel(item.at)}
      </span>
      <div className="relative min-w-0 border-l border-border pl-4">
        <span
          className={cn(
            "absolute top-2 -left-[3.5px] size-1.5 rounded-full",
            owner
              ? "bg-primary"
              : item.background
                ? "bg-muted-foreground/30"
                : "bg-muted-foreground",
          )}
          aria-hidden
        />
        <div
          className={cn(
            "text-sm",
            item.background ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {item.label}
          {repeat ? (
            <span className="text-muted-foreground/70"> · {repeat}</span>
          ) : null}
          {owner ? <span className="text-primary"> · you</span> : null}
        </div>
        {item.detail ? (
          <div
            className="truncate text-xs text-muted-foreground"
            title={item.detail}
          >
            {item.detail}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function OutreachTimeline({
  history,
}: {
  history: OutreachHistoryEntry[];
}) {
  const [showAll, setShowAll] = useState(false);
  const items = outreachTimeline(history);
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }
  const visible = showAll ? items : items.slice(0, COLLAPSED_ROWS);
  const days: Array<{ day: string; items: OutreachTimelineItem[] }> = [];
  for (const item of visible) {
    const day = dayLabel(item.at);
    const last = days.at(-1);
    if (last?.day === day) last.items.push(item);
    else days.push({ day, items: [item] });
  }
  return (
    <div className="space-y-3">
      {days.map((group) => (
        <div key={`${group.day}-${group.items[0]?.at}`}>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            {group.day}
          </div>
          <ol>
            {group.items.map((item) => (
              <TimelineRow key={`${item.at}-${item.type}`} item={item} />
            ))}
          </ol>
        </div>
      ))}
      {items.length > COLLAPSED_ROWS ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="-ml-2 text-muted-foreground"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? "Show less" : `Show all (${items.length})`}
        </Button>
      ) : null}
    </div>
  );
}
