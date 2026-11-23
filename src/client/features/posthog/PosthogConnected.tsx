import * as React from "react";
import { KeyRound } from "lucide-react";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
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
  const newKeyId = React.useId();
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
      <dl className="grid min-w-0 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">PostHog project</dt>
        <dd className="tabular-nums">
          {posthogProjectId}
          {source.posthogTimeZone ? (
            <span className="text-muted-foreground">
              {" "}
              · days in {source.posthogTimeZone}
            </span>
          ) : null}
        </dd>
        <dt className="text-muted-foreground">API key</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {key ? (
            <>
              <KeyRound className="size-3.5 text-muted-foreground" />
              <span className="font-mono">{key.hint}</span>
              <span className="text-muted-foreground">
                {new URL(key.host).host}
                {key.kind === "env"
                  ? " · from the server's .env"
                  : key.projectCount > 1
                    ? ` · shared by ${key.projectCount} projects`
                    : ""}
              </span>
            </>
          ) : (
            <span className="text-destructive">
              No key: the stored key is gone or can't be decrypted.
            </span>
          )}
        </dd>
      </dl>

      {source.canManage ? (
        <div className="flex flex-wrap items-center gap-1">
          {key?.kind === "env" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              pending={importEnv.isPending}
              onClick={() => importEnv.mutate(undefined)}
            >
              Store this key encrypted
            </Button>
          ) : null}
          {key?.kind === "stored" || !key ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={replacing}
              onClick={() => setReplacing((value) => !value)}
            >
              Replace key
            </Button>
          ) : null}
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={disconnect.isPending}
            onClick={() => setConfirming(true)}
          >
            Disconnect
          </Button>
        </div>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title="Disconnect PostHog?"
          confirmLabel="Disconnect"
          destructive
          pending={disconnect.isPending}
          onClose={() => setConfirming(false)}
          onConfirm={() =>
            disconnect.mutate(undefined, {
              onSettled: () => setConfirming(false),
            })
          }
        >
          This project goes back to Google Analytics. The key is deleted when no
          other project uses it; the PostHog project ID and key events are kept
          for a later reconnect.
        </ConfirmDialog>
      ) : null}
      <MutationError mutation={importEnv} />
      <MutationError mutation={disconnect} />

      {replacing ? (
        <form
          className="space-y-2 rounded-lg border border-border p-3"
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
          <div className="space-y-1.5">
            <Label htmlFor={newKeyId}>New personal API key</Label>
            <Input
              id={newKeyId}
              type="password"
              className="h-9 font-mono"
              autoComplete="off"
              placeholder="phx_…"
              value={newKey}
              onChange={(event) => setNewKey(event.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Checked against project {posthogProjectId} first.
            {key?.kind === "stored" && key.projectCount > 1
              ? ` All ${key.projectCount} projects sharing this key switch to the new one.`
              : ""}
          </p>
          <MutationError mutation={replace} />
          <Button
            type="submit"
            size="sm"
            pending={replace.isPending}
            disabled={newKey.trim().length < 20}
          >
            Replace
          </Button>
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
        <Button
          type="button"
          size="sm"
          pending={saveEvents.isPending}
          disabled={!changed}
          onClick={() => saveEvents.mutate(keyEvents)}
        >
          Save key events
        </Button>
      ) : null}
    </div>
  );
}
