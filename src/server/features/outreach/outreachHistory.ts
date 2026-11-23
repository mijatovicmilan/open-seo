// Human wording for outreach events (fork feature). Events are stored with
// the agent's or importer's raw detail ("first: <subject>", "Score model 2:
// …", "awaiting approval: Shown to the owner for approval"); the timeline
// shows a short label and, where it helps, a short detail.

type RawEvent = { type: string; detail: string | null };
type Described = { label: string; detail?: string };

const KIND_LABEL: Record<string, string> = {
  first: "Email drafted",
  "follow-up": "Follow-up drafted",
  "reply-out": "Reply drafted",
};

const STATUS_LABEL: Record<string, string> = {
  drafted: "Back to draft",
  "awaiting approval": "Sent for your approval",
  sent: "Marked sent",
  "follow-up sent": "Marked followed up",
  replied: "Marked replied",
  linked: "Marked linked",
  declined: "Marked declined",
  "no reply": "Closed: no reply",
  dropped: "Dropped",
};

function clip(value: string, max = 140) {
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// "Authority 38/100, about 2,212 organic visits a month (…), 1,904 referring
// domains (DataForSEO, …)" becomes "Authority 38 · 2,212 visits/mo".
function metricsSummary(detail: string) {
  const authority = detail.match(/Authority (\d+)\/100/u)?.[1];
  const visits = detail.match(/about ([\d,]+) organic visits/u)?.[1];
  return [
    authority ? `Authority ${authority}` : null,
    visits ? `${visits} visits/mo` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function describeEnriched(detail: string): Described {
  const metrics = metricsSummary(detail);
  const read = /page title|favicon/u.test(detail);
  if (metrics) {
    return { label: "Site measured", detail: metrics };
  }
  if (/page not read/u.test(detail)) {
    return { label: "Their page could not be read" };
  }
  return { label: read ? "Read their page" : "Details updated" };
}

function describeStatus(detail: string): Described {
  const [status = "", ...rest] = detail.split(": ");
  const note = rest.join(": ");
  const label = STATUS_LABEL[status] ?? `Status: ${status}`;
  // The importer's and agent's stock phrases add nothing to the label.
  const stock = /^(shown to the owner for approval|imported)/iu.test(note);
  return note && !stock ? { label, detail: clip(note) } : { label };
}

// Events that read as a fixed label, with or without their stored detail.
const FIXED: Record<string, { label: string; detail: boolean }> = {
  added: { label: "Added as a prospect", detail: false },
  imported: { label: "Imported from the earlier tracker", detail: false },
  rewritten: { label: "Email rewritten", detail: true },
  edited: { label: "You edited the email", detail: false },
  approved: { label: "You approved the email", detail: false },
  "approval undone": { label: "You undid the approval", detail: false },
  "kept below threshold": {
    label: "You kept it despite the score",
    detail: false,
  },
  sent: { label: "Email sent", detail: true },
  "follow-up sent": { label: "Follow-up sent", detail: true },
  "reply sent": { label: "Reply sent", detail: true },
  replied: { label: "They replied", detail: true },
  bounced: { label: "Email bounced", detail: true },
  "details updated": { label: "Details updated", detail: false },
  "link found": { label: "Link found", detail: true },
  "link lost": { label: "Link lost", detail: true },
  "link checked": { label: "Link checked", detail: true },
  declined: { label: "Declined", detail: true },
  dropped: { label: "Dropped", detail: true },
  reopened: { label: "Reopened", detail: false },
};

function describeDrafted(detail: string): Described {
  const [kind = "first", ...subject] = detail.split(": ");
  const known = kind in KIND_LABEL;
  return {
    label: KIND_LABEL[known ? kind : "first"] ?? "Email drafted",
    ...(detail ? { detail: clip(known ? subject.join(": ") : detail) } : {}),
  };
}

function describeScored(detail: string): Described {
  const score = detail.match(/^(\d+)\/10, (.+)$/u);
  return score
    ? { label: `Scored ${score[1]}/10`, detail: score[2] }
    : { label: "Scored" };
}

function describeRescored(detail: string): Described {
  const change = detail.match(/^(\d+)\/10 to (\d+)\/10/u);
  return change
    ? { label: `Score changed ${change[1]} → ${change[2]}` }
    : { label: "Score recalculated" };
}

export function describeOutreachEvent(event: RawEvent): Described {
  const detail = event.detail?.trim() ?? "";
  const fixed = FIXED[event.type];
  if (fixed) {
    return fixed.detail && detail
      ? { label: fixed.label, detail: clip(detail) }
      : { label: fixed.label };
  }
  switch (event.type) {
    case "drafted":
      return describeDrafted(detail);
    case "scored":
      return describeScored(detail);
    case "rescored":
      return describeRescored(detail);
    case "enriched":
      return describeEnriched(detail);
    case "status":
      return describeStatus(detail);
    case "angle set":
      return detail
        ? {
            label: "Angle set",
            detail: clip(detail.replace(/ \+ embed offer/u, "")),
          }
        : { label: "Angle set" };
    default:
      return {
        label: event.type.charAt(0).toUpperCase() + event.type.slice(1),
        ...(detail ? { detail: clip(detail) } : {}),
      };
  }
}
