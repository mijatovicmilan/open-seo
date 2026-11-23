import { useState } from "react";
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
      <span className="whitespace-nowrap pt-0.5 text-xs tabular-nums text-base-content/40">
        {timeLabel(item.at)}
      </span>
      <div className="relative min-w-0 border-l border-base-300 pl-4">
        <span
          className={`absolute -left-[3.5px] top-2 size-1.5 rounded-full ${
            owner
              ? "bg-primary"
              : item.background
                ? "bg-base-content/20"
                : "bg-base-content/50"
          }`}
          aria-hidden
        />
        <div
          className={`text-sm ${item.background ? "text-base-content/60" : "text-base-content"}`}
        >
          {item.label}
          {repeat ? (
            <span className="text-base-content/40"> · {repeat}</span>
          ) : null}
          {owner ? <span className="text-primary"> · you</span> : null}
        </div>
        {item.detail ? (
          <div
            className="truncate text-xs text-base-content/50"
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
    return <p className="text-sm text-base-content/50">No activity yet.</p>;
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
          <div className="mb-1 text-xs font-medium text-base-content/50">
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
        <button
          type="button"
          className="btn btn-ghost btn-xs -ml-2 text-base-content/60"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? "Show less" : `Show all (${items.length})`}
        </button>
      ) : null}
    </div>
  );
}
