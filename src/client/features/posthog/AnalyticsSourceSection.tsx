import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { IntegrationConnectionCard } from "@/client/features/integrations/IntegrationConnectionCard";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  checkPosthogKey,
  connectPosthog,
  disconnectPosthog,
  getAnalyticsSource,
  listPosthogEvents,
  replacePosthogKey,
  setPosthogKeyEvents,
} from "@/serverFunctions/analyticsSource";
import { MAX_KEY_EVENTS } from "@/types/schemas/analytics-source";

// Fork addition (FORK-CHANGES.md): choose the project's analytics source,
// Google Analytics or PostHog. The GA4 card (children) shows for GA4.

type Provider = "ga4" | "posthog";
type SourceView = Awaited<ReturnType<typeof getAnalyticsSource>>;
type KeyRef =
  | { kind: "new"; host: string; apiKey: string }
  | { kind: "existing"; id: string }
  | { kind: "env" }
  | { kind: "project" };
type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const HOSTS = [
  { label: "EU cloud", value: "https://eu.posthog.com" },
  { label: "US cloud", value: "https://us.posthog.com" },
] as const;

export const analyticsSourceQueryKey = (projectId: string) => [
  "analyticsSource",
  projectId,
];

export function useAnalyticsSource(projectId: string) {
  return useQuery({
    queryKey: analyticsSourceQueryKey(projectId),
    queryFn: () => getAnalyticsSource({ data: { projectId } }),
    staleTime: 60_000,
  });
}

/** Run a server call that answers ok/message; refresh every analytics
 *  screen on success (they all read the source). */
function useSourceMutation<TInput, TValue>(
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

function MutationError({
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

export function AnalyticsSourceSection({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const sourceQuery = useAnalyticsSource(projectId);
  const source = sourceQuery.data;
  const [view, setView] = React.useState<Provider | null>(null);
  const shown: Provider = view ?? source?.provider ?? "ga4";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-base-content/50">Analytics</h2>
        <div className="join" role="radiogroup" aria-label="Analytics source">
          {(
            [
              ["ga4", "Google Analytics"],
              ["posthog", "PostHog"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={shown === value}
              className={`btn btn-sm join-item ${shown === value ? "btn-active" : "btn-ghost border-base-300"}`}
              onClick={() => setView(value)}
            >
              {label}
              {source?.provider === value ? (
                <span className="badge badge-xs badge-success">in use</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
      {sourceQuery.isError ? (
        <p role="alert" className="text-sm text-error">
          {getStandardErrorMessage(sourceQuery.error)}
        </p>
      ) : null}
      {shown === "ga4" ? (
        <>
          {source?.provider === "posthog" ? (
            <p className="rounded-lg border border-base-300 bg-base-200/50 p-3 text-sm text-base-content/70">
              This project reads its analytics from PostHog. Disconnect PostHog
              to use Google Analytics again.
            </p>
          ) : null}
          {children}
        </>
      ) : source ? (
        <PosthogCard projectId={projectId} source={source} />
      ) : (
        <div className="skeleton h-40" />
      )}
    </div>
  );
}

function PosthogCard({
  projectId,
  source,
}: {
  projectId: string;
  source: SourceView;
}) {
  const connected =
    source.provider === "posthog" && Boolean(source.posthogProjectId);
  return (
    <IntegrationConnectionCard
      title="PostHog"
      status={
        connected
          ? source.key
            ? "connected"
            : "setup_required"
          : "disconnected"
      }
    >
      {!source.canManage ? (
        <p className="mb-4 text-sm text-base-content/60">
          Ask an organization owner or admin to change this project's analytics
          source.
        </p>
      ) : null}
      {connected ? (
        <ConnectedPosthog projectId={projectId} source={source} />
      ) : (
        <ConnectPosthog projectId={projectId} source={source} />
      )}
      <p className="mt-5 text-xs text-base-content/60">
        Read with a read-only personal API key (scope Query: read) over
        PostHog's query API; the key is stored encrypted and shown only as its
        first and last characters. Page views and events are exact; on sites
        that count visitors without cookies, users and sessions are estimates.
        PostHog has no ecommerce data.
      </p>
    </IntegrationConnectionCard>
  );
}

function KeyEventPicker({
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

function ConnectedPosthog({
  projectId,
  source,
}: {
  projectId: string;
  source: SourceView;
}) {
  const [keyEvents, setKeyEvents] = React.useState(source.keyEvents);
  const [replacing, setReplacing] = React.useState(false);
  const [newKey, setNewKey] = React.useState("");
  const posthogProjectId = source.posthogProjectId ?? "";
  const saveEvents = useSourceMutation(
    (events: string[]) =>
      setPosthogKeyEvents({ data: { projectId, keyEvents: events } }),
    "Key events saved.",
  );
  const replace = useSourceMutation(
    (apiKey: string) => replacePosthogKey({ data: { projectId, apiKey } }),
    "PostHog key replaced.",
  );
  const importEnv = useSourceMutation(
    () =>
      connectPosthog({
        data: {
          projectId,
          key: { kind: "env" },
          posthogProjectId,
          keyEvents: source.keyEvents,
        },
      }),
    "Key stored encrypted for this project.",
  );
  const disconnect = useSourceMutation(
    () => disconnectPosthog({ data: { projectId } }),
    "PostHog disconnected. This project reads Google Analytics again.",
  );
  const changed =
    [...keyEvents].sort().join("\0") !==
    [...source.keyEvents].sort().join("\0");
  const key = source.key;

  return (
    <div className="space-y-5">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-base-content/60">PostHog project</dt>
        <dd className="tabular-nums">
          {posthogProjectId}
          {source.posthogTimeZone ? (
            <span className="text-base-content/60">
              {" "}
              · days in {source.posthogTimeZone}
            </span>
          ) : null}
        </dd>
        <dt className="text-base-content/60">API key</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {key ? (
            <>
              <KeyRound className="size-3.5 text-base-content/50" />
              <span className="font-mono">{key.hint}</span>
              <span className="text-base-content/60">
                {new URL(key.host).host}
                {key.kind === "env"
                  ? " · from the server's .env"
                  : key.projectCount > 1
                    ? ` · shared by ${key.projectCount} projects`
                    : ""}
              </span>
            </>
          ) : (
            <span className="text-error">
              No key: the stored key is gone or can't be decrypted.
            </span>
          )}
        </dd>
      </dl>

      {source.canManage ? (
        <div className="flex flex-wrap gap-2">
          {key?.kind === "env" ? (
            <button
              type="button"
              className="btn btn-sm"
              disabled={importEnv.isPending}
              onClick={() => importEnv.mutate(undefined)}
            >
              {importEnv.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Store this key encrypted
            </button>
          ) : null}
          {key?.kind === "stored" || !key ? (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setReplacing((value) => !value)}
            >
              Replace key
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm text-error"
            disabled={disconnect.isPending}
            onClick={() => {
              if (
                window.confirm(
                  "Disconnect PostHog? This project goes back to Google Analytics. The key is deleted when no other project uses it.",
                )
              ) {
                disconnect.mutate(undefined);
              }
            }}
          >
            {disconnect.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            Disconnect
          </button>
        </div>
      ) : null}
      <MutationError mutation={importEnv} />
      <MutationError mutation={disconnect} />

      {replacing ? (
        <form
          className="space-y-2 rounded-lg border border-base-300 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            replace.mutate(newKey, {
              onSuccess: (result) => {
                if (result.ok) {
                  setReplacing(false);
                  setNewKey("");
                }
              },
            });
          }}
        >
          <label className="block space-y-1">
            <span className="text-sm font-medium">New personal API key</span>
            <input
              type="password"
              className="input input-bordered w-full font-mono"
              autoComplete="off"
              placeholder="phx_…"
              value={newKey}
              onChange={(event) => setNewKey(event.target.value)}
            />
          </label>
          <p className="text-xs text-base-content/60">
            Checked against project {posthogProjectId} first.
            {key?.kind === "stored" && key.projectCount > 1
              ? ` All ${key.projectCount} projects sharing this key switch to the new one.`
              : ""}
          </p>
          <MutationError mutation={replace} />
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={newKey.trim().length < 20 || replace.isPending}
          >
            {replace.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            Replace
          </button>
        </form>
      ) : null}

      <KeyEventPicker
        projectId={projectId}
        keyRef={{ kind: "project" }}
        posthogProjectId={posthogProjectId}
        selected={keyEvents}
        onChange={setKeyEvents}
        disabled={!source.canManage}
      />
      <MutationError mutation={saveEvents} />
      {source.canManage ? (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!changed || saveEvents.isPending}
          onClick={() => saveEvents.mutate(keyEvents)}
        >
          {saveEvents.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          Save key events
        </button>
      ) : null}
    </div>
  );
}

function ConnectPosthog({
  projectId,
  source,
}: {
  projectId: string;
  source: SourceView;
}) {
  const firstChoice = source.savedKeys[0]
    ? `existing:${source.savedKeys[0].id}`
    : source.envKey
      ? "env"
      : "new";
  const [choice, setChoice] = React.useState(firstChoice);
  const [host, setHost] = React.useState<string>(source.defaultHost);
  const [customHost, setCustomHost] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [checkedRef, setCheckedRef] = React.useState<KeyRef | null>(null);
  const [posthogProjectId, setPosthogProjectId] = React.useState(
    source.posthogProjectId ?? "",
  );
  const [keyEvents, setKeyEvents] = React.useState(source.keyEvents);

  const keyRef: KeyRef =
    choice === "new"
      ? {
          kind: "new",
          host: host === "custom" ? customHost.trim() : host,
          apiKey: apiKey.trim(),
        }
      : choice === "env"
        ? { kind: "env" }
        : { kind: "existing", id: choice.slice("existing:".length) };
  const check = useMutation({
    mutationFn: (ref: KeyRef) =>
      checkPosthogKey({ data: { projectId, key: ref } }),
    onSuccess: (result, ref) => setCheckedRef(result.ok ? ref : null),
  });
  const connect = useSourceMutation(
    () =>
      connectPosthog({
        data: {
          projectId,
          key: checkedRef ?? keyRef,
          posthogProjectId: posthogProjectId.trim(),
          keyEvents,
        },
      }),
    "This project now reads PostHog.",
  );
  const listed = check.data?.ok ? check.data.value.projects : null;
  const validId = /^\d{1,12}$/.test(posthogProjectId.trim());
  const pickChoice = (value: string) => {
    setChoice(value);
    setCheckedRef(null);
    check.reset();
  };
  const usedIds = source.usedPosthogProjects.filter(
    (used) =>
      checkedRef?.kind !== "existing" || used.credentialId === checkedRef.id,
  );

  return (
    <div className="space-y-5">
      <fieldset className="space-y-2" disabled={!source.canManage}>
        <legend className="text-sm font-medium">1. API key</legend>
        {source.savedKeys.map((saved) => (
          <KeyOption
            key={saved.id}
            value={`existing:${saved.id}`}
            choice={choice}
            onChoose={pickChoice}
          >
            Use existing key <span className="font-mono">{saved.hint}</span>
            <span className="text-base-content/60">
              {" "}
              · {new URL(saved.host).host}
              {saved.projectCount > 0
                ? ` · used by ${saved.projectCount} project${saved.projectCount === 1 ? "" : "s"}`
                : ""}
            </span>
          </KeyOption>
        ))}
        {source.envKey ? (
          <KeyOption value="env" choice={choice} onChoose={pickChoice}>
            Use the key from the server's .env{" "}
            <span className="font-mono">{source.envKey.hint}</span>
            <span className="text-base-content/60">
              {" "}
              · {new URL(source.envKey.host).host} · stored encrypted on connect
            </span>
          </KeyOption>
        ) : null}
        <KeyOption value="new" choice={choice} onChoose={pickChoice}>
          Paste a new personal API key
        </KeyOption>
        {choice === "new" ? (
          <div className="grid gap-2 pl-7 sm:grid-cols-[10rem_1fr]">
            <select
              className="select select-bordered select-sm w-full"
              aria-label="PostHog region"
              value={host}
              onChange={(event) => {
                setHost(event.target.value);
                setCheckedRef(null);
              }}
            >
              {HOSTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value="custom">Self-hosted…</option>
            </select>
            <input
              type="password"
              className="input input-bordered input-sm w-full font-mono"
              autoComplete="off"
              placeholder="phx_…"
              aria-label="Personal API key"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setCheckedRef(null);
              }}
            />
            {host === "custom" ? (
              <input
                className="input input-bordered input-sm w-full sm:col-span-2"
                placeholder="https://posthog.example.com"
                aria-label="PostHog host"
                value={customHost}
                onChange={(event) => setCustomHost(event.target.value)}
              />
            ) : null}
            <p className="text-xs text-base-content/60 sm:col-span-2">
              PostHog → Settings → Personal API keys: scope Query: read, for
              this project or the organization.
            </p>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-sm"
            disabled={
              check.isPending ||
              (keyRef.kind === "new" && keyRef.apiKey.length < 20)
            }
            onClick={() => check.mutate(keyRef)}
          >
            {check.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            Check key
          </button>
          {checkedRef ? (
            <span className="text-sm text-success">Key works.</span>
          ) : null}
        </div>
        <MutationError mutation={check} />
      </fieldset>

      {checkedRef ? (
        <fieldset className="space-y-2" disabled={!source.canManage}>
          <legend className="text-sm font-medium">2. PostHog project</legend>
          {listed && listed.length > 0 ? (
            <select
              className="select select-bordered select-sm w-full max-w-md"
              aria-label="PostHog project"
              value={posthogProjectId}
              onChange={(event) => setPosthogProjectId(event.target.value)}
            >
              <option value="">Choose a project…</option>
              {listed.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} ({project.id})
                </option>
              ))}
            </select>
          ) : (
            <>
              <input
                className="input input-bordered input-sm w-full max-w-xs tabular-nums"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Project ID, e.g. 352215"
                aria-label="PostHog project ID"
                value={posthogProjectId}
                onChange={(event) => setPosthogProjectId(event.target.value)}
              />
              <p className="text-xs text-base-content/60">
                This key is limited to chosen projects, so PostHog won't list
                them. Enter the number from PostHog's address bar (/project/
                <b>352215</b>/…).
              </p>
              {usedIds.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {usedIds.map((used) => (
                    <button
                      key={`${used.posthogProjectId}-${used.projectName}`}
                      type="button"
                      className="btn btn-xs"
                      onClick={() => setPosthogProjectId(used.posthogProjectId)}
                    >
                      {used.posthogProjectId} · {used.projectName}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </fieldset>
      ) : null}

      {checkedRef && validId ? (
        <KeyEventPicker
          projectId={projectId}
          keyRef={checkedRef}
          posthogProjectId={posthogProjectId.trim()}
          selected={keyEvents}
          onChange={setKeyEvents}
          disabled={!source.canManage}
        />
      ) : null}

      {checkedRef ? (
        <>
          <MutationError mutation={connect} />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!validId || connect.isPending || !source.canManage}
            onClick={() => connect.mutate(undefined)}
          >
            {connect.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            Connect PostHog
          </button>
        </>
      ) : null}
    </div>
  );
}

function KeyOption({
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
