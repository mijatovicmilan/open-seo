/* eslint-disable max-lines -- the prospect slide-over and its sections (fork feature) */
import { LinkTrafficSection } from "@/client/features/posthog/LinkTraffic";
import { useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Link2,
  Pencil,
  CalendarClock,
  Send,
  Undo2,
  X,
} from "lucide-react";
import { Alert } from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { Textarea } from "@/client/components/ui/textarea";
import {
  Favicon,
  formatNumber,
  ScorePill,
  StatusBadge,
  useProspectMutation,
} from "@/client/features/outreach/outreachUi";
import { OutreachTimeline } from "@/client/features/outreach/OutreachTimeline";
import { bothTimes } from "@/client/features/outreach/scheduleTime";
import {
  approveOutreach,
  checkOutreachLink,
  editOutreachEmail,
  moveOutreachStatus,
  sendOutreach,
  undoOutreachApproval,
} from "@/serverFunctions/outreach";
import {
  OUTREACH_STATUS_MOVE_LABELS,
  type OutreachAngle,
  type OutreachLimits,
  type OutreachProspect,
  type OutreachSettingsView,
  outreachSendBlocker,
  type OutreachStatusMove,
} from "@/shared/outreach";

// The slide-over for one prospect: the email exactly as it goes out, the
// owner's actions on it, and everything known about the prospect.

export function OutreachProspectPanel({
  projectId,
  prospect,
  favicon,
  angles,
  limits,
  settings,
  onClose,
}: {
  projectId: string;
  prospect: OutreachProspect;
  favicon: string | undefined;
  angles: OutreachAngle[];
  limits: OutreachLimits;
  settings: OutreachSettingsView;
  onClose: () => void;
}) {
  const angle = angles.find((item) => item.key === prospect.angle);
  // A modal sheet over the page: Escape and a click on the backdrop close it,
  // and focus stays inside while it is open.
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="gap-0 overflow-hidden bg-card p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
      >
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <Favicon src={favicon} domain={prospect.domain} />
              <SheetTitle className="truncate text-lg font-semibold">
                <span className="text-muted-foreground">
                  #{prospect.number}
                </span>{" "}
                {prospect.prospect}
              </SheetTitle>
            </div>
            <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <StatusBadge prospect={prospect} />
              <span className="text-muted-foreground/70">·</span>
              <span
                className={
                  prospect.action.who === "owner"
                    ? "font-medium text-primary"
                    : "text-muted-foreground"
                }
              >
                {prospect.nextStep}
              </span>
            </SheetDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close"
          >
            <X />
          </Button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          <EmailSection
            projectId={projectId}
            prospect={prospect}
            limits={limits}
            settings={settings}
          />

          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Prospect
            </h3>
            <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[8rem_1fr]">
              <dt className="text-muted-foreground">Their page</dt>
              <dd className="min-w-0">
                <a
                  className="inline-flex max-w-full items-center gap-1 text-primary underline-offset-4 hover:underline"
                  href={prospect.theirPage}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <span className="truncate">{prospect.theirPageTitle}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              </dd>
              <dt className="text-muted-foreground">Our page</dt>
              <dd className="break-words">
                {prospect.ourPageUrl ? (
                  <a
                    className="text-primary underline-offset-4 hover:underline"
                    href={prospect.ourPageUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {prospect.ourPage}
                  </a>
                ) : (
                  prospect.ourPage
                )}
              </dd>
              <dt className="text-muted-foreground">Contact</dt>
              <dd className="min-w-0">
                {prospect.contact.kind === "none" ? (
                  "None found"
                ) : prospect.contact.kind === "form" ? (
                  <a
                    className="block truncate text-primary underline-offset-4 hover:underline"
                    href={prospect.contact.value}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={prospect.contact.value}
                  >
                    Contact form ·{" "}
                    {prospect.contact.value.replace(
                      /^https?:\/\/(www\.)?/u,
                      "",
                    )}
                  </a>
                ) : (
                  <span
                    className="block truncate"
                    title={prospect.contact.value}
                  >
                    {prospect.contact.value}
                  </span>
                )}
                {"note" in prospect.contact && prospect.contact.note ? (
                  <span className="block text-muted-foreground">
                    {prospect.contact.note}
                  </span>
                ) : null}
              </dd>
              <dt className="text-muted-foreground">Angle</dt>
              <dd>
                {angle ? angle.label : (prospect.angle ?? "Not set")}
                {prospect.angleNote ? (
                  <span className="text-muted-foreground">
                    {" "}
                    — {prospect.angleNote}
                  </span>
                ) : null}
              </dd>
              {prospect.gain ? (
                <>
                  <dt className="text-muted-foreground">Gain</dt>
                  <dd>{prospect.gain}</dd>
                </>
              ) : null}
              {prospect.notes ? (
                <>
                  <dt className="text-muted-foreground">Notes</dt>
                  <dd className="whitespace-pre-wrap">{prospect.notes}</dd>
                </>
              ) : null}
              {prospect.replySummary ? (
                <>
                  <dt className="text-muted-foreground">Latest reply</dt>
                  <dd>
                    <span className="text-muted-foreground">
                      {prospect.replyAt}:{" "}
                    </span>
                    {prospect.replySummary}
                  </dd>
                </>
              ) : null}
              {prospect.closedReason ? (
                <>
                  <dt className="text-muted-foreground">Closed</dt>
                  <dd>{prospect.closedReason}</dd>
                </>
              ) : null}
            </dl>
          </section>

          <ScoreSection prospect={prospect} />
          <LinkSection projectId={projectId} prospect={prospect} />
          <MovesSection projectId={projectId} prospect={prospect} />

          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              History
            </h3>
            <OutreachTimeline history={prospect.history} />
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EmailSection({
  projectId,
  prospect,
  limits,
  settings,
}: {
  projectId: string;
  prospect: OutreachProspect;
  limits: OutreachLimits;
  settings: OutreachSettingsView;
}) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(prospect.subject);
  const [body, setBody] = useState(prospect.body);
  const approve = useProspectMutation(
    projectId,
    () =>
      approveOutreach({
        data: {
          projectId,
          number: prospect.number,
          expectedHash: prospect.hash,
        },
      }),
    "Approved",
  );
  const undo = useProspectMutation(
    projectId,
    () =>
      undoOutreachApproval({ data: { projectId, number: prospect.number } }),
    "Approval undone",
  );
  const edit = useProspectMutation(
    projectId,
    () =>
      editOutreachEmail({
        data: {
          projectId,
          number: prospect.number,
          subject,
          body,
          expectedHash: prospect.hash,
        },
      }),
    "Email saved",
  );
  const send = useProspectMutation(
    projectId,
    (channel: "email" | "form") =>
      sendOutreach({ data: { projectId, number: prospect.number, channel } }),
    "Sent",
  );

  if (!prospect.subject && !prospect.body) {
    return (
      <section className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        No email drafted yet. The agent drafts it with draft_outreach_email.
      </section>
    );
  }

  const pending = !prospect.messageSentAt;
  const channel = prospect.contact.kind === "form" ? "form" : "email";
  const blocker = pending
    ? outreachSendBlocker(prospect, limits, channel)
    : null;
  const mailOff = channel === "email" && !settings.mailReady;
  const busy =
    approve.isPending || undo.isPending || edit.isPending || send.isPending;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {!pending
            ? `Last sent (${prospect.messageSentAt})`
            : prospect.approval?.state === "valid"
              ? `Approved ${prospect.messageKind ?? "first"} email`
              : `${prospect.messageKind ?? "first"} email to approve`}
        </h3>
        {pending && !editing ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              setSubject(prospect.subject);
              setBody(prospect.body);
              setEditing(true);
            }}
          >
            <Pencil data-icon="inline-start" /> Edit
          </Button>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-muted p-4 text-sm">
        <div className="mb-2 space-y-0.5 text-muted-foreground">
          <div>
            <span className="text-muted-foreground/80">From:</span>{" "}
            {settings.senderName || "—"} &lt;{settings.senderEmail || "not set"}
            &gt;
          </div>
          <div className="break-all">
            <span className="text-muted-foreground/80">
              {prospect.contact.kind === "form" ? "Form:" : "To:"}
            </span>{" "}
            {prospect.contact.value || "—"}
          </div>
        </div>
        {editing ? (
          <div className="space-y-2">
            <Input
              className="h-9"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              aria-label="Subject"
            />
            <Textarea
              className="h-72 field-sizing-fixed font-mono text-sm"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              aria-label="Body"
            />
            <p className="text-xs text-muted-foreground">
              The signature is added automatically. An approved email stays
              approved with your edit.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() =>
                  edit.mutate(undefined, {
                    onSuccess: (r) => r.ok && setEditing(false),
                  })
                }
              >
                Save
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-3 font-semibold">{prospect.subject}</div>
            <pre className="font-sans leading-relaxed break-words whitespace-pre-wrap">
              {prospect.body}
            </pre>
          </>
        )}
      </div>

      {prospect.problems.length ? (
        <Alert variant="warning">{prospect.problems.join(" ")}</Alert>
      ) : null}
      {prospect.approval && prospect.approval.state !== "valid" ? (
        <Alert variant="warning">
          The email changed after approval. Approve it again.
        </Alert>
      ) : null}

      {pending && !editing ? (
        <div className="flex flex-wrap items-center gap-2">
          {prospect.canApprove ? (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => approve.mutate(undefined)}
            >
              <CheckCircle2 data-icon="inline-start" /> Approve this exact email
            </Button>
          ) : null}
          {prospect.status === "approved" ? (
            channel === "form" ? (
              <Button
                type="button"
                size="sm"
                disabled={busy || Boolean(blocker)}
                onClick={() => {
                  if (
                    window.confirm(
                      "Did you submit exactly this text through their contact form?",
                    )
                  ) {
                    send.mutate("form");
                  }
                }}
              >
                <Send data-icon="inline-start" /> Mark sent via form
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={busy || Boolean(blocker) || mailOff}
                pending={send.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Send this email to ${prospect.contact.value} now?`,
                    )
                  ) {
                    send.mutate("email");
                  }
                }}
              >
                {send.isPending ? null : <Send data-icon="inline-start" />}
                Send now
              </Button>
            )
          ) : null}
          {prospect.canUndo ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => undo.mutate(undefined)}
            >
              <Undo2 data-icon="inline-start" /> Undo approval
            </Button>
          ) : null}
          {prospect.status === "approved" && (blocker || mailOff) ? (
            <span className="text-sm text-muted-foreground">
              {blocker ??
                `Sending from the app is off: ${settings.mailProblem}`}
            </span>
          ) : null}
        </div>
      ) : null}
      {pending && !editing ? (
        <ScheduleLine prospect={prospect} settings={settings} />
      ) : null}
    </section>
  );
}

/** Where an approved email stands in the send schedule. */
function ScheduleLine({
  prospect,
  settings,
}: {
  prospect: OutreachProspect;
  settings: OutreachSettingsView;
}) {
  const schedule = prospect.schedule;
  if (prospect.status !== "approved" || !schedule) return null;
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <CalendarClock className="mt-0.5 size-4 shrink-0" />
      <span>
        {schedule.at
          ? `Scheduled: ${bothTimes(schedule.at, settings.scheduleTimeZone)}${settings.schedulePaused ? " (sending is paused)" : ""}.`
          : `Not in the send queue${schedule.note ? `: ${schedule.note}` : "."}`}
      </span>
    </p>
  );
}

function ScoreSection({ prospect }: { prospect: OutreachProspect }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Score
        </h3>
        <ScorePill prospect={prospect} />
        {prospect.score?.band ? (
          <span className="text-sm text-muted-foreground">
            {prospect.score.band}
          </span>
        ) : null}
      </div>
      {prospect.score ? (
        <ul className="space-y-1 text-sm">
          {prospect.score.parts.map((part) => (
            <li
              key={part.key}
              className="grid grid-cols-[1fr_auto] gap-x-2 sm:grid-cols-[9rem_3rem_1fr]"
            >
              <span className="text-muted-foreground">{part.label}</span>
              <span className="tabular-nums">
                {part.value ?? "?"}/{part.max}
              </span>
              <span className="col-span-2 text-xs text-muted-foreground sm:col-span-1 sm:text-sm">
                {part.reason}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Not scored yet.</p>
      )}
      {prospect.metrics && !prospect.score ? (
        <p className="text-sm text-muted-foreground">
          Authority {formatNumber(prospect.metrics.authority)} · traffic{" "}
          {formatNumber(prospect.metrics.traffic)}
          {prospect.metrics.trafficLocation
            ? ` (${prospect.metrics.trafficLocation})`
            : ""}{" "}
          · referring domains {formatNumber(prospect.metrics.referringDomains)}{" "}
          · {prospect.metrics.source},{" "}
          {prospect.metrics.measuredAt.slice(0, 10)}
        </p>
      ) : null}
    </section>
  );
}

function LinkSection({
  projectId,
  prospect,
}: {
  projectId: string;
  prospect: OutreachProspect;
}) {
  const check = useProspectMutation(projectId, () =>
    checkOutreachLink({ data: { projectId, number: prospect.number } }),
  );
  const contacted =
    ["sent", "follow-up sent", "replied", "linked"].includes(prospect.status) ||
    prospect.linkUrl;
  if (!contacted) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Link
      </h3>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {prospect.linkUrl ? (
          <a
            className="break-all text-primary underline-offset-4 hover:underline"
            href={prospect.linkUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {prospect.linkUrl}
          </a>
        ) : (
          <span className="text-muted-foreground">No link found yet.</span>
        )}
        {prospect.rel ? (
          <Badge variant="secondary" size="sm">
            {prospect.rel}
          </Badge>
        ) : null}
        {prospect.linkLost ? (
          <span className="text-xs text-destructive">Lost</span>
        ) : null}
        <span className="text-muted-foreground">
          Checked {prospect.linkCheckedAt || "never"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          pending={check.isPending}
          onClick={() => check.mutate(undefined)}
        >
          {check.isPending ? null : <Link2 data-icon="inline-start" />}
          Check now
        </Button>
      </div>
      {/* PostHog visits and signups from this link. */}
      <LinkTrafficSection projectId={projectId} number={prospect.number} />
    </section>
  );
}

function MovesSection({
  projectId,
  prospect,
}: {
  projectId: string;
  prospect: OutreachProspect;
}) {
  const move = useProspectMutation(
    projectId,
    (vars: { move: OutreachStatusMove; reason?: string }) =>
      moveOutreachStatus({
        data: { projectId, number: prospect.number, ...vars },
      }),
  );
  if (!prospect.statusMoves.length) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Status
      </h3>
      <div className="flex flex-wrap gap-2">
        {prospect.statusMoves.map((item) => (
          <Button
            key={item}
            type="button"
            variant="ghost"
            size="sm"
            disabled={move.isPending}
            onClick={() => {
              if (item === "drop") {
                const reason = window.prompt("Why drop this prospect?");
                if (reason?.trim()) move.mutate({ move: item, reason });
                return;
              }
              if (
                item === "decline" &&
                !window.confirm(
                  "Mark declined? They will never be emailed again.",
                )
              ) {
                return;
              }
              move.mutate({ move: item });
            }}
          >
            {OUTREACH_STATUS_MOVE_LABELS[item]}
          </Button>
        ))}
      </div>
    </section>
  );
}
