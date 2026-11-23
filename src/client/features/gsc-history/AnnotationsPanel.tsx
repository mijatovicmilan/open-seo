import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { reverse } from "remeda";
import { toast } from "sonner";
import { z } from "zod";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { getFieldError } from "@/client/lib/forms";
import {
  ANNOTATION_STYLES,
  formatDay,
} from "@/client/features/gsc-history/SearchInsightsChart";
import type { Insights } from "@/client/features/gsc-history/types";
import {
  addSearchAnnotation,
  deleteSearchAnnotation,
} from "@/serverFunctions/gscHistory";
import { GSC_ANNOTATION_KINDS } from "@/types/schemas/gsc-history";

const formSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  kind: z.enum(GSC_ANNOTATION_KINDS),
  label: z.string().trim().min(1, "Say what happened.").max(200),
  url: z
    .string()
    .trim()
    .refine((value) => value === "" || URL.canParse(value), "Use a full URL."),
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AnnotationsPanel({
  projectId,
  annotations,
}: {
  projectId: string;
  annotations: Insights["annotations"];
}) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["searchInsights", projectId] });

  const addMutation = useMutation({
    mutationFn: (values: z.infer<typeof formSchema>) =>
      addSearchAnnotation({
        data: {
          projectId,
          date: values.date,
          kind: values.kind,
          label: values.label,
          url: values.url === "" ? undefined : values.url,
        },
      }),
    onSuccess: () => {
      form.reset();
      void invalidate();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not add the note")),
  });

  const deleteMutation = useMutation({
    mutationFn: (annotationId: string) =>
      deleteSearchAnnotation({ data: { projectId, annotationId } }),
    onSuccess: () => void invalidate(),
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not delete the note")),
  });

  const form = useForm({
    defaultValues: {
      date: today(),
      kind: "deploy" as (typeof GSC_ANNOTATION_KINDS)[number],
      label: "",
      url: "",
    },
    validators: { onSubmit: formSchema },
    onSubmit: ({ value }) => addMutation.mutate(value),
  });

  // Newest first; derived first-seen pages are already listed under New pages.
  const listed = reverse(annotations.filter((a) => a.kind !== "first_seen"));

  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-start gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="date">
          {(field) => (
            <input
              type="date"
              aria-label="Date"
              className="input input-bordered input-sm w-36"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </form.Field>
        <form.Field name="kind">
          {(field) => (
            <select
              aria-label="Kind"
              className="select select-bordered select-sm w-28"
              value={field.state.value}
              onChange={(event) => {
                const kind = GSC_ANNOTATION_KINDS.find(
                  (k) => k === event.target.value,
                );
                if (kind) field.handleChange(kind);
              }}
            >
              {GSC_ANNOTATION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {ANNOTATION_STYLES[kind].label}
                </option>
              ))}
            </select>
          )}
        </form.Field>
        <form.Field name="label">
          {(field) => (
            <div className="min-w-48 flex-1">
              <input
                type="text"
                aria-label="What happened"
                placeholder="What happened, e.g. New pricing page live"
                className="input input-bordered input-sm w-full"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field name="url">
          {(field) => (
            <div className="min-w-40 flex-1">
              <input
                type="url"
                aria-label="URL (optional)"
                placeholder="URL (optional)"
                className="input input-bordered input-sm w-full"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <button
          type="submit"
          className="btn btn-sm btn-primary gap-1"
          disabled={addMutation.isPending}
        >
          {addMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Plus className="size-3.5" />
          )}
          Add note
        </button>
      </form>

      {listed.length === 0 ? (
        <p className="text-sm text-base-content/50">
          No notes yet. Add deploys, new pages and links you earned so changes
          in the chart can be traced to a cause.
        </p>
      ) : (
        <ol>
          {listed.map((annotation, index) => (
            <li
              key={
                annotation.id ??
                `${annotation.kind}-${annotation.date}-${index}`
              }
              className="grid grid-cols-[5.5rem_1fr_auto] items-start gap-x-3 py-1"
            >
              <span className="whitespace-nowrap pt-0.5 text-xs tabular-nums text-base-content/40">
                {formatDay(annotation.date)}
              </span>
              <div className="relative min-w-0 border-l border-base-300 pl-4">
                <span
                  className="absolute -left-[3.5px] top-2 size-1.5 rounded-full"
                  style={{
                    backgroundColor: ANNOTATION_STYLES[annotation.kind].color,
                  }}
                  aria-hidden
                />
                <div className="truncate text-sm">
                  {annotation.url ? (
                    <a
                      href={annotation.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link link-hover"
                      title={annotation.url}
                    >
                      {annotation.label}
                    </a>
                  ) : (
                    annotation.label
                  )}
                </div>
                <div className="text-xs text-base-content/50">
                  {ANNOTATION_STYLES[annotation.kind].label}
                </div>
              </div>
              {annotation.id ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-square text-base-content/40 hover:text-error"
                  aria-label="Delete note"
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    if (annotation.id) deleteMutation.mutate(annotation.id);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              ) : (
                <span className="w-6" />
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function FieldError({ errors }: { errors: unknown[] }) {
  const message = getFieldError(errors);
  return message ? (
    <p className="mt-0.5 text-xs text-error">{message}</p>
  ) : null;
}
