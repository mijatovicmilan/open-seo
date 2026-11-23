import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { RadioGroup } from "@/client/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
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

const HOST_ITEMS = [
  ...HOSTS.map((option) => ({ value: option.value, label: option.label })),
  { value: "custom", label: "Self-hosted…" },
];

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
  const projectItems = (listed ?? []).map((project) => ({
    value: project.id,
    label: `${project.name} (${project.id})`,
  }));
  const usedIds = source.usedPosthogProjects.filter(
    (used) =>
      checkedRef?.kind !== "existing" || used.credentialId === checkedRef.id,
  );

  return (
    <div className="space-y-5">
      <fieldset className="min-w-0 space-y-2" disabled={!source.canManage}>
        <legend className="text-sm font-medium">1. API key</legend>
        <RadioGroup
          aria-label="PostHog API key"
          value={choice}
          onValueChange={(value) => {
            if (typeof value === "string") pickChoice(value);
          }}
          disabled={!source.canManage}
        >
          {source.savedKeys.map((saved) => (
            <KeyOption key={saved.id} value={`existing:${saved.id}`}>
              Use existing key <span className="font-mono">{saved.hint}</span>
              <span className="text-muted-foreground">
                {" "}
                · {new URL(saved.host).host}
                {saved.projectCount > 0
                  ? ` · used by ${saved.projectCount} project${saved.projectCount === 1 ? "" : "s"}`
                  : ""}
              </span>
            </KeyOption>
          ))}
          {source.envKey ? (
            <KeyOption value="env">
              Use the key from the server's .env{" "}
              <span className="font-mono">{source.envKey.hint}</span>
              <span className="text-muted-foreground">
                {" "}
                · {new URL(source.envKey.host).host} · stored encrypted on
                connect
              </span>
            </KeyOption>
          ) : null}
          <KeyOption value="new">Paste a new personal API key</KeyOption>
        </RadioGroup>
        {choice === "new" ? (
          <div className="grid gap-2 pl-6 sm:grid-cols-[10rem_1fr]">
            <Select
              items={HOST_ITEMS}
              value={host}
              onValueChange={(value) => {
                if (value == null) return;
                setHost(value);
                setCheckedRef(null);
              }}
            >
              <SelectTrigger className="h-9 w-full" aria-label="PostHog region">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOST_ITEMS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="password"
              className="h-9 font-mono"
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
              <Input
                className="h-9 sm:col-span-2"
                placeholder="https://posthog.example.com"
                aria-label="PostHog host"
                value={customHost}
                onChange={(event) => setCustomHost(event.target.value)}
              />
            ) : null}
            <p className="text-xs text-muted-foreground sm:col-span-2">
              PostHog → Settings → Personal API keys: scope Query: read, for
              this project or the organization.
            </p>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            pending={check.isPending}
            disabled={keyRef.kind === "new" && keyRef.apiKey.length < 20}
            onClick={() => check.mutate(keyRef)}
          >
            Check key
          </Button>
          {checkedRef ? (
            <span className="text-sm text-success">Key works.</span>
          ) : null}
        </div>
        <MutationError mutation={check} />
      </fieldset>

      {checkedRef ? (
        <fieldset className="min-w-0 space-y-2" disabled={!source.canManage}>
          <legend className="text-sm font-medium">2. PostHog project</legend>
          {listed && listed.length > 0 ? (
            <Select
              items={projectItems}
              value={posthogProjectId === "" ? null : posthogProjectId}
              onValueChange={(value) => setPosthogProjectId(value ?? "")}
              disabled={!source.canManage}
            >
              <SelectTrigger
                className="h-9 w-full max-w-md"
                aria-label="PostHog project"
              >
                <SelectValue placeholder="Choose a project…" />
              </SelectTrigger>
              <SelectContent>
                {projectItems.map((project) => (
                  <SelectItem key={project.value} value={project.value}>
                    {project.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <>
              <Input
                className="h-9 max-w-xs tabular-nums"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Project ID, e.g. 352215"
                aria-label="PostHog project ID"
                value={posthogProjectId}
                onChange={(event) => setPosthogProjectId(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                This key is limited to chosen projects, so PostHog won't list
                them. Enter the number from PostHog's address bar (/project/
                <b>352215</b>/…).
              </p>
              {usedIds.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {usedIds.map((used) => (
                    <Button
                      key={`${used.posthogProjectId}-${used.projectName}`}
                      type="button"
                      variant="outline"
                      size="xs"
                      className="max-w-full"
                      onClick={() => setPosthogProjectId(used.posthogProjectId)}
                    >
                      <span className="truncate">
                        {used.posthogProjectId} · {used.projectName}
                      </span>
                    </Button>
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
          <Button
            type="button"
            size="sm"
            pending={connect.isPending}
            disabled={!validId || !source.canManage}
            onClick={() => connect.mutate(undefined)}
          >
            Connect PostHog
          </Button>
        </>
      ) : null}
    </div>
  );
}
