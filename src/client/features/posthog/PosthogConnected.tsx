import * as React from "react";
import { KeyRound, Loader2 } from "lucide-react";
import {
  connectPosthog,
  disconnectPosthog,
  replacePosthogKey,
  setPosthogKeyEvents,
} from "@/serverFunctions/analyticsSource";
import {
  KeyEventPicker,
  MutationError,
  useSourceMutation,
  type SourceView,
} from "./posthogUi";

// Fork addition (FORK-CHANGES.md): PostHog connection UI, see
// AnalyticsSourceSection.

export function ConnectedPosthog({
  projectId,
  source,
}: {
  projectId: string;
  source: SourceView;
}) {
  const [keyEvents, setKeyEvents] = React.useState(source.keyEvents);
  const [replacing, setReplacing] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
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
    keyEvents.length !== source.keyEvents.length ||
    keyEvents.some((name) => !source.keyEvents.includes(name));
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
            onClick={() =>
              confirming ? disconnect.mutate(undefined) : setConfirming(true)
            }
          >
            {disconnect.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            {confirming ? "Confirm disconnect" : "Disconnect"}
          </button>
          {confirming ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}
      {confirming ? (
        <p className="text-sm text-base-content/70">
          This project goes back to Google Analytics. The key is deleted when no
          other project uses it; the PostHog project ID and key events are kept
          for a later reconnect.
        </p>
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
