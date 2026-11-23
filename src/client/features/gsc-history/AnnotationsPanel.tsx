import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Trash2, X } from "lucide-react";
import { reverse } from "remeda";
import { toast } from "sonner";
import { SegmentGroup } from "@/client/features/charts/ChoiceMenu";
import {
  ANNOTATION_STYLES,
  formatDay,
} from "@/client/features/gsc-history/annotationStyles";
import type { Insights } from "@/client/features/gsc-history/types";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  addSearchAnnotation,
  deleteSearchAnnotation,
  updateSearchAnnotation,
} from "@/serverFunctions/gscHistory";
import {
  GSC_ANNOTATION_KINDS,
  type GscAnnotationKind,
} from "@/types/schemas/gsc-history";

// Chart notes (fork feature): added from the chart itself (click a day, or
// "+ Note"), edited and deleted in a compact list. The editor is a small
// popover in fixed position, so no card clips it.

export type NoteDraft = {
  id?: string;
  date: string;
  kind: GscAnnotationKind;
  label: string;
  url: string;
};

export type NoteAnchor = { x: number; y: number };

const KIND_ITEMS = GSC_ANNOTATION_KINDS.map((kind) => ({
  value: kind,
  label: ANNOTATION_STYLES[kind].label,
}));

const POPOVER_WIDTH = 320;

/** Notes people add; outreach links and first-seen pages are derived. */
export function isManual(kind: string): kind is GscAnnotationKind {
  return GSC_ANNOTATION_KINDS.some((item) => item === kind);
}

export function NoteEditor({
  projectId,
  draft,
  anchor,
  onClose,
}: {
  projectId: string;
  draft: NoteDraft;
  anchor: NoteAnchor;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(draft);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) {
        return;
      }
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // Deferred so the click that opened the editor does not close it.
    const timer = window.setTimeout(
      () => document.addEventListener("mousedown", outside),
      0,
    );
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const save = useMutation({
    mutationFn: async (note: NoteDraft) => {
      const fields = {
        projectId,
        date: note.date,
        kind: note.kind,
        label: note.label.trim(),
        url: note.url.trim() || undefined,
      };
      if (note.id) {
        await updateSearchAnnotation({
          data: { ...fields, annotationId: note.id },
        });
      } else {
        await addSearchAnnotation({ data: fields });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["searchInsights", projectId],
      });
      onClose();
    },
    onError: (cause) =>
      toast.error(getStandardErrorMessage(cause, "Could not save the note")),
  });

  const left = Math.max(
    8,
    Math.min(
      anchor.x - POPOVER_WIDTH / 2,
      window.innerWidth - POPOVER_WIDTH - 8,
    ),
  );
  const top = Math.max(8, Math.min(anchor.y + 8, window.innerHeight - 300));

  return createPortal(
    <form
      ref={ref}
      className="fixed z-[1000] max-w-[calc(100vw-16px)] space-y-3 rounded-lg border border-base-300 bg-base-100 p-3 shadow-2xl"
      style={{ left, top, width: POPOVER_WIDTH }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!value.label.trim()) {
          setError("Say what happened.");
          return;
        }
        if (value.url.trim() && !URL.canParse(value.url.trim())) {
          setError("Use a full link, starting with https://");
          return;
        }
        save.mutate(value);
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {value.id ? "Edit note" : "Add a note"}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-square"
          aria-label="Close"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <input
        type="date"
        aria-label="Date"
        className="input input-bordered h-9 w-full text-sm"
        value={value.date}
        onChange={(event) =>
          setValue((current) => ({ ...current, date: event.target.value }))
        }
      />
      <SegmentGroup
        label="Kind"
        items={KIND_ITEMS}
        value={value.kind}
        onChange={(kind) => setValue((current) => ({ ...current, kind }))}
      />
      <input
        autoFocus
        type="text"
        aria-label="What happened"
        placeholder="What happened"
        maxLength={200}
        className="input input-bordered h-9 w-full text-sm"
        value={value.label}
        onChange={(event) => {
          setError(null);
          setValue((current) => ({ ...current, label: event.target.value }));
        }}
      />
      <input
        type="url"
        aria-label="Link (optional)"
        placeholder="Link (optional)"
        className="input input-bordered h-9 w-full text-sm"
        value={value.url}
        onChange={(event) => {
          setError(null);
          setValue((current) => ({ ...current, url: event.target.value }));
        }}
      />
      {error ? <p className="text-xs text-error">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={save.isPending}
        >
          {save.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          Save
        </button>
      </div>
    </form>,
    document.body,
  );
}

/** Notes people added and links Outreach found, newest first. */
export function NotesList({
  projectId,
  annotations,
  onEdit,
}: {
  projectId: string;
  annotations: Insights["annotations"];
  onEdit: (draft: NoteDraft, anchor: NoteAnchor) => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (annotationId: string) =>
      deleteSearchAnnotation({ data: { projectId, annotationId } }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["searchInsights", projectId],
      }),
    onError: (cause) =>
      toast.error(getStandardErrorMessage(cause, "Could not delete the note")),
  });
  // First-seen pages are listed under New pages already.
  const listed = reverse(annotations.filter((a) => a.kind !== "first_seen"));
  if (listed.length === 0) return null;
  return (
    <ul className="divide-y divide-base-300">
      {listed.map((note, index) => {
        const kind = note.kind;
        return (
          <li
            key={note.id ?? `${kind}-${note.date}-${index}`}
            className="flex items-center gap-3 py-1.5 text-sm"
          >
            <span className="w-24 shrink-0 text-xs tabular-nums text-base-content/50">
              {formatDay(note.date)}
            </span>
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: ANNOTATION_STYLES[kind].color }}
              aria-hidden
            />
            <span className="hidden w-24 shrink-0 text-xs text-base-content/60 sm:inline">
              {ANNOTATION_STYLES[kind].label}
            </span>
            <span
              className="min-w-0 flex-1 truncate"
              title={note.url ?? undefined}
            >
              {note.url ? (
                <a
                  href={note.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link link-hover"
                >
                  {note.label}
                </a>
              ) : (
                note.label
              )}
            </span>
            {note.id && isManual(kind) ? (
              <span className="flex shrink-0 items-center">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-square text-base-content/50"
                  aria-label="Edit note"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    onEdit(
                      {
                        id: note.id ?? undefined,
                        date: note.date,
                        kind,
                        label: note.label,
                        url: note.url ?? "",
                      },
                      { x: rect.left, y: rect.bottom },
                    );
                  }}
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-square text-base-content/50 hover:text-error"
                  aria-label="Delete note"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (note.id) remove.mutate(note.id);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </span>
            ) : (
              <span className="w-16 shrink-0 text-right text-xs text-base-content/40">
                Outreach
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
