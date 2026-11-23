import { describe, expect, it } from "vitest";
import {
  buildOutgoingBody,
  buildOutreachProspect,
  type EventRow,
  findLinkToUs,
  type MessageRow,
  type OutreachConfig,
  outreachHash,
  outreachSendingLimits,
  type ProspectRow,
} from "./outreachDomain";

const config: OutreachConfig = {
  siteUrl: "https://example.com",
  linkDomains: ["example.com"],
  senderName: "Alex from Example",
  senderEmail: "outreach@example.com",
  signature: "Alex\nExample\nhttps://example.com",
  smtpHost: "smtp.example.com",
  smtpPort: 465,
  mailEnvKey: "EXAMPLE",
  timeZone: "Asia/Bangkok",
  dailyMin: 2,
  dailyMax: 3,
  weeklyMin: 10,
  weeklyMax: 20,
  followUpDays: 7,
};

const row = (overrides: Partial<ProspectRow> = {}): ProspectRow => ({
  id: "p1",
  number: 1,
  site: "Blog",
  person: null,
  contact: "author@blog.test",
  contactKind: "email",
  contactNote: null,
  theirPage: "https://blog.test/post",
  theirPageTitle: null,
  ourPage: "Calculator",
  gain: null,
  status: "awaiting approval",
  notes: "",
  droppedReason: null,
  linkUrl: null,
  linkRel: null,
  angleKey: null,
  angleNote: null,
  scoreGain: null,
  scoreGainReason: null,
  scoreActivity: null,
  scoreActivityReason: null,
  scoreReach: null,
  scoreReachReason: null,
  scoreLink: null,
  scoreLinkReason: null,
  scoredAt: null,
  faviconFetchedAt: null,
  metricAuthority: null,
  metricTraffic: null,
  metricTrafficLocation: null,
  metricReferringDomains: null,
  metricsMeasuredAt: null,
  metricsSource: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...overrides,
});

const message = (overrides: Partial<MessageRow> = {}): MessageRow => ({
  id: 1,
  prospectId: "p1",
  kind: "first",
  subject: "The chart in your post",
  body: "Hi,\n\nhttps://example.com/tool\n\nThanks,\nAlex\nExample\nhttps://example.com",
  approvedHash: null,
  approvedAt: null,
  sentAt: null,
  messageId: null,
  receivedAt: null,
  inReplyToId: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  ...overrides,
});

const build = (input: {
  row?: Partial<ProspectRow>;
  messages?: MessageRow[];
  events?: EventRow[];
  now?: string;
}) =>
  buildOutreachProspect({
    row: row(input.row),
    messages: input.messages ?? [message()],
    events: input.events ?? [],
    linkChecks: [],
    config,
    now: input.now ?? "2026-11-02T00:00:00.000Z",
  });

describe("outreach approval", () => {
  it("stays valid only while recipient, subject and body match the approved hash", () => {
    const pending = message();
    const hash = outreachHash({
      to: "author@blog.test",
      subject: pending.subject,
      body: pending.body,
    });
    const approved = { row: { status: "approved" as const } };

    expect(
      build({ ...approved, messages: [{ ...pending, approvedHash: hash }] })
        .approval?.state,
    ).toBe("valid");
    expect(
      build({
        ...approved,
        messages: [
          { ...pending, approvedHash: hash, body: `${pending.body} ` },
        ],
      }).approval?.state,
    ).toBe("stale");
    expect(
      build({
        row: { status: "approved", contact: "other@blog.test" },
        messages: [{ ...pending, approvedHash: hash }],
      }).approval?.state,
    ).toBe("stale");
  });

  it("holds a low score for the owner's decision until a keep after the score change", () => {
    const scored = {
      scoreGain: 1,
      scoreActivity: 0,
      scoreReach: 1,
      scoreLink: 1,
      scoredAt: "2026-11-01T01:00:00.000Z",
      scoreGainReason: "r",
      scoreActivityReason: "r",
      scoreReachReason: "r",
      scoreLinkReason: "r",
    };
    const scoredEvent: EventRow = {
      id: 1,
      prospectId: "p1",
      type: "scored",
      detail: null,
      actor: "agent",
      at: "2026-11-01T01:00:00.000Z",
    };
    expect(build({ row: scored, events: [scoredEvent] }).attention).toBe(
      "low-score",
    );
    const kept: EventRow = {
      ...scoredEvent,
      id: 2,
      type: "kept below threshold",
      actor: "owner",
      at: "2026-11-01T02:00:00.000Z",
    };
    expect(build({ row: scored, events: [scoredEvent, kept] }).attention).toBe(
      "approval",
    );
  });

  it("asks for the follow-up only after the configured wait", () => {
    const sent = [message({ sentAt: "2026-11-01T03:00:00.000Z" })];
    expect(
      build({
        row: { status: "sent" },
        messages: sent,
        now: "2026-11-07T12:00:00.000Z",
      }).attention,
    ).toBeNull();
    expect(
      build({
        row: { status: "sent" },
        messages: sent,
        now: "2026-11-08T12:00:00.000Z",
      }).attention,
    ).toBe("follow-up");
  });
});

describe("outgoing body", () => {
  it("drops a typed signature or placeholder and appends the signature under the sign-off", () => {
    const body = buildOutgoingBody(
      "Hi Sam,\n\nYour post does the sum\nby hand.\n\nThanks,\n[Your name]\nexample.com",
      config,
    );
    expect(body).toBe(
      "Hi Sam,\n\nYour post does the sum by hand.\n\nThanks,\nAlex\nExample\nhttps://example.com",
    );
    expect(buildOutgoingBody(body, config)).toBe(body);
  });
});

describe("link check", () => {
  it("finds a link to our host or subdomain and reports the most restrictive rel", () => {
    const html = `<!-- <a href="https://example.com/old">old</a> -->
      <a href="https://other.test/example.com">no</a>
      <a rel="nofollow noopener" href="https://app.example.com/tool?a=1&amp;b=2">tool</a>`;
    expect(
      findLinkToUs(html, "https://blog.test/post", ["example.com"]),
    ).toEqual({
      found: true,
      href: "https://app.example.com/tool?a=1&b=2",
      rel: "nofollow",
    });
    expect(
      findLinkToUs(
        '<a href="https://notexample.com/">x</a>',
        "https://blog.test/",
        ["example.com"],
      ).found,
    ).toBe(false);
  });
});

describe("sending limits", () => {
  it("counts days and weeks in the configured time zone", () => {
    // 17:30 UTC on Sunday is already Monday 00:30 in Bangkok: a new day and week.
    const messages = [message({ sentAt: "2026-11-01T10:00:00.000Z" })];
    const limits = outreachSendingLimits(
      messages,
      config,
      "2026-11-01T17:30:00.000Z",
    );
    expect(limits.today).toBe("2026-11-02");
    expect(limits.sentToday).toBe(0);
    expect(limits.sentWeek).toBe(0);
    expect(limits.allowedNow).toBe(3);
  });
});
