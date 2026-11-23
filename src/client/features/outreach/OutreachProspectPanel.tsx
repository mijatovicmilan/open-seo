/* eslint-disable max-lines -- the prospect slide-over and its sections (fork feature) */
import { useState } from "react";
import { reverse } from "remeda";
import {
  CheckCircle2,
  ExternalLink,
  Link2,
  Pencil,
  Send,
  Undo2,
  X,
} from "lucide-react";
import {
  ActionPill,
  Favicon,
  formatDateTime,
  formatNumber,
  ScorePill,
  StatusBadge,
  useProspectMutation,
} from "@/client/features/outreach/outreachUi";
import {
  approveOutreach,
  checkOutreachLink,
  editOutreachEmail,
  moveOutreachStatus,
  sendOutreach,
  undoOutreachApproval,
} from "@/serverFunctions/outreach";
import {
  OUTREACH_ATTENTION_LABELS,
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
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/30"
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
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge prospect={prospect} />
              <ActionPill prospect={prospect} />
              <span className="text-base-content/70">{prospect.nextStep}</span>
              {prospect.attention ? (
                <span className="badge badge-sm badge-warning badge-outline">
                  {OUTREACH_ATTENTION_LABELS[prospect.attention]}
                </span>
              ) : null}
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
            <h3 className="text-sm font-semibold uppercase tracking-wide text-base-content/60">
              Prospect
            </h3>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
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
              <dd className="break-all">
                {prospect.contact.kind === "none"
                  ? "None found"
                  : `${prospect.contact.kind === "form" ? "Form: " : ""}${prospect.contact.value}`}
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
              <dt className="text-base-content/60">Gain</dt>
              <dd>{prospect.gain || "—"}</dd>
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
            <h3 className="text-sm font-semibold uppercase tracking-wide text-base-content/60">
              History
            </h3>
            <ol className="space-y-1.5 text-sm">
              {reverse(prospect.history).map((entry, index) => (
                <li
                  key={`${entry.at ?? entry.date}-${index}`}
                  className={
                    entry.background ? "text-base-content/50" : undefined
                  }
                >
                  <span className="tabular-nums text-base-content/60">
                    {entry.at ? formatDateTime(entry.at) : entry.date}
                  </span>{" "}
                  <span className="font-medium">{entry.label}</span>
                  {entry.actor ? (
                    <span className="text-base-content/50">
                      {" "}
                      · {entry.actor}
                    </span>
                  ) : null}
                  {entry.detail ? (
                    <span className="block whitespace-pre-wrap break-words text-base-content/70">
                      {entry.detail.length > 400
                        ? `${entry.detail.slice(0, 400)}…`
                        : entry.detail}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
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
        <h3 className="text-sm font-semibold uppercase tracking-wide text-base-content/60">
          {pending
            ? `Email to approve (${prospect.messageKind ?? "first"})`
            : `Last sent (${prospect.messageSentAt})`}
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
          {prospect.canUndo ? (
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => undo.mutate(undefined)}
            >
              <Undo2 className="size-4" /> Undo approval
            </button>
          ) : null}
          {prospect.status === "approved" ? (
            channel === "form" ? (
              <button
                className="btn btn-success btn-sm"
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
                className="btn btn-success btn-sm"
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
          {prospect.status === "approved" && (blocker || mailOff) ? (
            <span className="text-sm text-base-content/70">
              {blocker ??
                `Sending from the app is off: ${settings.mailProblem}`}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ScoreSection({ prospect }: { prospect: OutreachProspect }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-base-content/60">
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
            <li key={part.key} className="grid grid-cols-[9rem_3rem_1fr] gap-2">
              <span className="text-base-content/70">{part.label}</span>
              <span className="tabular-nums">
                {part.value ?? "?"}/{part.max}
              </span>
              <span className="text-base-content/70">{part.reason}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-base-content/60">Not scored yet.</p>
      )}
      {prospect.metrics ? (
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
      <h3 className="text-sm font-semibold uppercase tracking-wide text-base-content/60">
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
          <span className="badge badge-sm">{prospect.rel}</span>
        ) : null}
        {prospect.linkLost ? (
          <span className="badge badge-sm badge-error">Lost</span>
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
      <h3 className="text-sm font-semibold uppercase tracking-wide text-base-content/60">
        Status
      </h3>
      <div className="flex flex-wrap gap-2">
        {prospect.statusMoves.map((item) => (
          <button
            key={item}
            className={`btn btn-sm ${item === "keep" ? "btn-warning" : "btn-ghost"}`}
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
