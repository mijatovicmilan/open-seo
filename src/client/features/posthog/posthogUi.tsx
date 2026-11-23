import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import type { getAnalyticsSource } from "@/serverFunctions/analyticsSource";
import { listPosthogEvents } from "@/serverFunctions/analyticsSource";
import { MAX_KEY_EVENTS } from "@/types/schemas/analytics-source";

// Fork addition (FORK-CHANGES.md): PostHog connection UI, see
// AnalyticsSourceSection.

export type SourceView = Awaited<ReturnType<typeof getAnalyticsSource>>;
export type KeyRef =
  | { kind: "new"; host: string; apiKey: string }
  | { kind: "existing"; id: string }
  | { kind: "env" }
  | { kind: "project" };
type Result<T> = { ok: true; value: T } | { ok: false; message: string };

export const HOSTS = [
  { label: "EU cloud", value: "https://eu.posthog.com" },
  { label: "US cloud", value: "https://us.posthog.com" },
] as const;

/** Run a server call that answers ok/message; refresh every analytics
 *  screen on success (they all read the source). */
export function useSourceMutation<TInput, TValue>(
  call: (input: TInput) => Promise<Result<TValue>>,
  success: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: call,
    onSuccess: (result) => {
      if (!result.ok) return;
      void queryClient.invalidateQueries();
      toast.success(success);
    },
  });
}

export function MutationError({
  mutation,
}: {
  mutation: {
    data?: Result<unknown>;
    isError: boolean;
    error: unknown;
  };
}) {
  const message =
    mutation.data && !mutation.data.ok
      ? mutation.data.message
      : mutation.isError
        ? getStandardErrorMessage(mutation.error)
        : null;
  return message ? (
    <p role="alert" className="text-sm text-error">
      {message}
    </p>
  ) : null;
}

export function KeyEventPicker({
  projectId,
  keyRef,
  posthogProjectId,
  selected,
  onChange,
  disabled,
}: {
  projectId: string;
  keyRef: KeyRef;
  posthogProjectId: string;
  selected: string[];
  onChange: (events: string[]) => void;
  disabled?: boolean;
}) {
  // Wait for the ID to settle: each change is a PostHog query.
  const [settledId, setSettledId] = React.useState(posthogProjectId);
  React.useEffect(() => {
    const timer = setTimeout(() => setSettledId(posthogProjectId), 600);
    return () => clearTimeout(timer);
  }, [posthogProjectId]);
  const eventsQuery = useQuery({
    queryKey: ["posthogEvents", projectId, settledId, keyRef],
    queryFn: () =>
      listPosthogEvents({
        data: { projectId, key: keyRef, posthogProjectId: settledId },
      }),
    enabled: settledId === posthogProjectId,
    staleTime: 5 * 60_000,
  });
  const seen = eventsQuery.data?.ok ? eventsQuery.data.value : [];
  const options = [
    ...seen,
    ...selected
      .filter((name) => !seen.some((event) => event.eventName === name))
      .map((eventName) => ({ eventName, countLast90Days: 0 })),
  ];
  const toggle = (name: string) =>
    onChange(
      selected.includes(name)
        ? selected.filter((item) => item !== name)
        : [...selected, name].slice(0, MAX_KEY_EVENTS),
    );
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">Key events (signups)</legend>
      <p className="text-xs text-base-content/60">
        Events PostHog saw in the last 90 days. A visit with any checked event
        counts as a signup in Search Insights, Outreach and the reports.
      </p>
      {eventsQuery.isPending || settledId !== posthogProjectId ? (
        <p className="flex items-center gap-2 text-sm text-base-content/60">
          <Loader2 className="size-4 animate-spin" /> Reading events from
          PostHog…
        </p>
      ) : eventsQuery.data && !eventsQuery.data.ok ? (
        <p role="alert" className="text-sm text-error">
          {eventsQuery.data.message}
        </p>
      ) : options.length === 0 ? (
        <p className="text-sm text-base-content/60">
          No custom events in the last 90 days. Signups stay at zero until the
          site sends one.
        </p>
      ) : (
        <ul className="grid gap-1 sm:grid-cols-2">
          {options.map((event) => (
            <li key={event.eventName}>
              <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-base-200">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={selected.includes(event.eventName)}
                  onChange={() => toggle(event.eventName)}
                />
                <span className="min-w-0 truncate font-mono text-sm">
                  {event.eventName}
                </span>
                <span className="ml-auto shrink-0 text-xs tabular-nums text-base-content/50">
                  {event.countLast90Days > 0
                    ? event.countLast90Days.toLocaleString("en-US")
                    : "not seen"}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

export function KeyOption({
  value,
  choice,
  onChoose,
  children,
}: {
  value: string;
  choice: string;
  onChoose: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 cursor-pointer items-start gap-2 text-sm">
      <input
        type="radio"
        className="radio radio-sm mt-0.5"
        name="posthog-key"
        checked={choice === value}
        onChange={() => onChoose(value)}
      />
      <span className="min-w-0 break-words">{children}</span>
    </label>
  );
}
