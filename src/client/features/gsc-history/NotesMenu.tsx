import { useRef, useState } from "react";
import { ChevronDown, NotebookPen, Plus } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import {
  type NoteAnchor,
  type NoteDraft,
  NotesList,
} from "@/client/features/gsc-history/AnnotationsPanel";
import type { Insights } from "@/client/features/gsc-history/types";

// Fork feature (FORK-CHANGES.md): the chart's notes behind one button: the
// list and "Add note" in a menu.

export function NotesMenu({
  projectId,
  insights,
  count,
  onEdit,
}: {
  projectId: string;
  insights: Insights;
  count: number;
  onEdit: (draft: NoteDraft, anchor: NoteAnchor) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // The editor opens under the button once the menu has closed.
  const anchor = (): NoteAnchor => {
    const rect = trigger.current?.getBoundingClientRect();
    return { x: rect?.left ?? 0, y: rect?.bottom ?? 0 };
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            ref={trigger}
            variant="ghost"
            size="xs"
            className="shrink-0 text-muted-foreground"
          />
        }
      >
        <NotebookPen data-icon="inline-start" />
        Notes
        {count > 0 ? (
          <span className="rounded-full bg-muted px-1.5 text-[11px] leading-4 tabular-nums text-foreground">
            {count}
          </span>
        ) : null}
        <ChevronDown data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(34rem,calc(100vw-2rem))]">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">Notes</span>
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              setOpen(false);
              onEdit(
                {
                  date: insights.period.settledEnd,
                  kind: "deploy",
                  label: "",
                  url: "",
                },
                anchor(),
              );
            }}
          >
            <Plus data-icon="inline-start" /> Add note
          </Button>
        </div>
        {count > 0 ? (
          <div className="max-h-72 overflow-y-auto">
            <NotesList
              projectId={projectId}
              annotations={insights.annotations}
              onEdit={(draft) => {
                setOpen(false);
                onEdit(draft, anchor());
              }}
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Mark a deploy, a new page or a link earned elsewhere. You can also
            click a day on the chart.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
