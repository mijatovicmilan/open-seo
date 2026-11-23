import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  checkPosthogKey,
  connectPosthog,
} from "@/serverFunctions/analyticsSource";
import {
  HOSTS,
  KeyEventPicker,
  KeyOption,
  MutationError,
  useSourceMutation,
  type KeyRef,
  type SourceView,
} from "./posthogUi";

// Fork addition (FORK-CHANGES.md): PostHog connection UI, see
// AnalyticsSourceSection.

export function ConnectPosthog({
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
