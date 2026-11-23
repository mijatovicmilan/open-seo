/* eslint-disable max-lines -- the prospect slide-over and its sections (fork feature) */
import { LinkTrafficSection } from "@/client/features/posthog/LinkTraffic";
import { useEffect, useState } from "react";
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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      onClick={onClose}
    >
      <aside
        className="flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-base-300 bg-base-100 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        aria-label={`Prospect ${prospect.number}`}
      >
        <header className="flex items-start gap-3 border-b border-base-300 px-5 py-4">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <Favicon src={favicon} domain={prospect.domain} />
              <h2 className="truncate text-lg font-semibold">
                <span className="text-base-content/50">#{prospect.number}</span>{" "}
                {prospect.prospect}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <StatusBadge prospect={prospect} />
              <span className="text-base-content/40">·</span>
              <span
                className={
                  prospect.action.who === "owner"
                    ? "font-medium text-primary"
                    : "text-base-content/70"
                }
              >
                {prospect.nextStep}
              </span>
            </div>
          </div>
          <button
            className="btn btn-ghost btn-sm btn-square"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          <EmailSection
            projectId={projectId}
            prospect={prospect}
            limits={limits}
            settings={settings}
          />

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">
              Prospect
            </h3>
            <dl className="grid grid-cols-[6rem_1fr] sm:grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-base-content/60">Their page</dt>
              <dd className="min-w-0">
                <a
                  className="link inline-flex max-w-full items-center gap-1"
                  href={prospect.theirPage}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <span className="truncate">{prospect.theirPageTitle}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              </dd>
              <dt className="text-base-content/60">Our page</dt>
              <dd className="break-words">
                {prospect.ourPageUrl ? (
                  <a
                    className="link"
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
              <dt className="text-base-content/60">Contact</dt>
              <dd className="min-w-0">
                {prospect.contact.kind === "none" ? (
                  "None found"
                ) : prospect.contact.kind === "form" ? (
                  <a
                    className="link link-hover block truncate"
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
                  <span className="block text-base-content/60">
                    {prospect.contact.note}
                  </span>
                ) : null}
              </dd>
              <dt className="text-base-content/60">Angle</dt>
              <dd>
                {angle ? angle.label : (prospect.angle ?? "Not set")}
                {prospect.angleNote ? (
                  <span className="text-base-content/60">
                    {" "}
                    — {prospect.angleNote}
                  </span>
                ) : null}
              </dd>
              {prospect.gain ? (
                <>
                  <dt className="text-base-content/60">Gain</dt>
                  <dd>{prospect.gain}</dd>
                </>
              ) : null}
              {prospect.notes ? (
                <>
                  <dt className="text-base-content/60">Notes</dt>
                  <dd className="whitespace-pre-wrap">{prospect.notes}</dd>
                </>
              ) : null}
              {prospect.replySummary ? (
                <>
                  <dt className="text-base-content/60">Latest reply</dt>
                  <dd>
                    <span className="text-base-content/60">
                      {prospect.replyAt}:{" "}
                    </span>
                    {prospect.replySummary}
                  </dd>
                </>
              ) : null}
              {prospect.closedReason ? (
                <>
                  <dt className="text-base-content/60">Closed</dt>
                  <dd>{prospect.closedReason}</dd>
                </>
              ) : null}
            </dl>
          </section>

          <ScoreSection prospect={prospect} />
          <LinkSection projectId={projectId} prospect={prospect} />
          <MovesSection projectId={projectId} prospect={prospect} />

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">
              History
            </h3>
            <OutreachTimeline history={prospect.history} />
          </section>
        </div>
      </aside>
    </div>
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
      <section className="rounded-box border border-dashed border-base-300 p-4 text-sm text-base-content/70">
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
        <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">
          {!pending
            ? `Last sent (${prospect.messageSentAt})`
            : prospect.approval?.state === "valid"
              ? `Approved ${prospect.messageKind ?? "first"} email`
              : `${prospect.messageKind ?? "first"} email to approve`}
        </h3>
        {pending && !editing ? (
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => {
              setSubject(prospect.subject);
              setBody(prospect.body);
              setEditing(true);
            }}
          >
            <Pencil className="size-3" /> Edit
          </button>
        ) : null}
      </div>

      <div className="rounded-box border border-base-300 bg-base-200/40 p-4 text-sm">
        <div className="mb-2 space-y-0.5 text-base-content/70">
          <div>
            <span className="text-base-content/50">From:</span>{" "}
            {settings.senderName || "—"} &lt;{settings.senderEmail || "not set"}
            &gt;
          </div>
          <div className="break-all">
            <span className="text-base-content/50">
              {prospect.contact.kind === "form" ? "Form:" : "To:"}
            </span>{" "}
            {prospect.contact.value || "—"}
          </div>
        </div>
        {editing ? (
          <div className="space-y-2">
            <input
              className="input input-sm input-bordered w-full"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              aria-label="Subject"
            />
            <textarea
              className="textarea textarea-bordered h-72 w-full font-mono text-sm"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              aria-label="Body"
            />
            <p className="text-xs text-base-content/60">
              The signature is added automatically. An approved email stays
              approved with your edit.
            </p>
            <div className="flex gap-2">
              <button
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() =>
                  edit.mutate(undefined, {
                    onSuccess: (r) => r.ok && setEditing(false),
                  })
                }
              >
                Save
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-3 font-semibold">{prospect.subject}</div>
            <pre className="whitespace-pre-wrap break-words font-sans leading-relaxed">
              {prospect.body}
            </pre>
          </>
        )}
      </div>

      {prospect.problems.length ? (
        <div className="alert alert-warning py-2 text-sm">
          {prospect.problems.join(" ")}
        </div>
      ) : null}
      {prospect.approval && prospect.approval.state !== "valid" ? (
        <div className="alert alert-warning py-2 text-sm">
          The email changed after approval. Approve it again.
        </div>
      ) : null}

      {pending && !editing ? (
        <div className="flex flex-wrap items-center gap-2">
          {prospect.canApprove ? (
            <button
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => approve.mutate(undefined)}
            >
              <CheckCircle2 className="size-4" /> Approve this exact email
            </button>
          ) : null}
          {prospect.status === "approved" ? (
            channel === "form" ? (
              <button
                className="btn btn-primary btn-sm"
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
                <Send className="size-4" /> Mark sent via form
              </button>
            ) : (
              <button
                className="btn btn-primary btn-sm"
                disabled={busy || Boolean(blocker) || mailOff}
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
                {send.isPending ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <Send className="size-4" />
                )}
                Send now
              </button>
            )
          ) : null}
          {prospect.canUndo ? (
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => undo.mutate(undefined)}
            >
              <Undo2 className="size-4" /> Undo approval
            </button>
          ) : null}
          {prospect.status === "approved" && (blocker || mailOff) ? (
            <span className="text-sm text-base-content/70">
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
    <p className="flex items-start gap-2 text-sm text-base-content/70">
      <CalendarClock className="mt-0.5 size-4 shrink-0 text-base-content/50" />
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
        <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">
          Score
        </h3>
        <ScorePill prospect={prospect} />
        {prospect.score?.band ? (
          <span className="text-sm text-base-content/70">
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
              <span className="text-base-content/70">{part.label}</span>
              <span className="tabular-nums">
                {part.value ?? "?"}/{part.max}
              </span>
              <span className="col-span-2 text-xs text-base-content/60 sm:col-span-1 sm:text-sm">
                {part.reason}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-base-content/60">Not scored yet.</p>
      )}
      {prospect.metrics && !prospect.score ? (
        <p className="text-sm text-base-content/70">
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
      <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">
        Link
      </h3>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {prospect.linkUrl ? (
          <a
            className="link break-all"
            href={prospect.linkUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {prospect.linkUrl}
          </a>
        ) : (
          <span className="text-base-content/60">No link found yet.</span>
        )}
        {prospect.rel ? (
          <span className="badge badge-xs border-0 bg-base-300 text-base-content/70">
            {prospect.rel}
          </span>
        ) : null}
        {prospect.linkLost ? (
          <span className="text-xs text-error">Lost</span>
        ) : null}
        <span className="text-base-content/60">
          Checked {prospect.linkCheckedAt || "never"}
        </span>
        <button
          className="btn btn-ghost btn-xs"
          disabled={check.isPending}
          onClick={() => check.mutate(undefined)}
        >
          {check.isPending ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            <Link2 className="size-3" />
          )}
          Check now
        </button>
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
      <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">
        Status
      </h3>
      <div className="flex flex-wrap gap-2">
        {prospect.statusMoves.map((item) => (
          <button
            key={item}
            className="btn btn-ghost btn-sm"
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
          </button>
        ))}
      </div>
    </section>
  );
}
