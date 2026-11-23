import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The scheduler against a real SQLite database with the outreach migrations,
// and a fake mail transport: nothing is sent anywhere.

const state = vi.hoisted(() => ({
  database: null as DatabaseSync | null,
  sends: [] as Array<{ to: string }>,
  claims: 0,
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({
  db: drizzle(async (query, params, method) => {
    if (!state.database) throw new Error("Database not initialized");
    const statement = state.database.prepare(query);
    const values = params.map((value: unknown): SQLInputValue => {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "bigint"
      )
        return value;
      throw new Error("Unexpected SQL parameter");
    });
    if (method === "run") {
      statement.run(...values);
      return { rows: [] };
    }
    if (method === "get") {
      const row = statement.get(...values);
      return { rows: row ? Object.values(row) : [] };
    }
    return { rows: statement.all(...values).map((row) => Object.values(row)) };
  }),
}));
vi.mock("@/db/runBatch", () => ({
  runBatch: async (build: (tx: unknown) => readonly Promise<unknown>[]) => {
    const { db } = await import("@/db");
    for (const statement of build(db)) await statement;
  },
}));
vi.mock("@/server/features/outreach/mail", () => ({
  mailProblem: () => null,
  outreachMessageId: () => {
    state.claims += 1;
    return `<claim-${state.claims}@test.invalid>`;
  },
  buildOutreachMail: () => "raw",
  sendOutreachMail: async (input: { to: string }) => {
    state.sends.push({ to: input.to });
  },
  testMailConnection: async () => undefined,
}));

const { OutreachService } = await import("./OutreachService");
const { OutreachScheduler } = await import("./OutreachScheduler");
const { OutreachRepository } =
  await import("@/server/features/outreach/repositories/OutreachRepository");

const project = { id: "p1", domain: "example.com" };
// Mon 23 Nov 2026: 05:00 UTC is before the 09:00 New York window
// (14:00–16:00 UTC).
const BEFORE = "2026-11-23T05:00:00.000Z";
const INSIDE = "2026-11-23T14:30:00.000Z";
const AFTER = "2026-11-23T16:30:00.000Z";

function at(iso: string) {
  vi.setSystemTime(new Date(iso));
  return iso;
}

async function approvedProspect(contact: string, host = contact.split("@")[1]) {
  const added = await OutreachService.addProspect(project, {
    site: `Site for ${contact}`,
    contact,
    contactKind: "email",
    theirPage: `https://${host}/post`,
    ourPage: "https://example.com/guide",
  });
  const drafted = await OutreachService.draftMessage(project, {
    number: added.number,
    kind: "first",
    subject: "Your post",
    body: "Hi,\n\nA note about your post.\n\nhttps://example.com/guide",
  });
  await OutreachService.approve(project, {
    number: drafted.number,
    expectedHash: drafted.hash,
  });
  return drafted.number;
}

function text(value: unknown) {
  return typeof value === "string" ? value : null;
}

function messageRow(number: number) {
  const row = state.database
    ?.prepare(
      `SELECT m.scheduled_for, m.sent_at, m.schedule_note
       FROM outreach_messages m JOIN outreach_prospects p ON p.id = m.prospect_id
       WHERE p.number = ? AND m.kind = 'first'`,
    )
    .get(number);
  return {
    scheduled_for: text(row?.scheduled_for),
    sent_at: text(row?.sent_at),
    schedule_note: text(row?.schedule_note),
  };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(BEFORE);
  state.sends = [];
  state.claims = 0;
  state.database?.close();
  state.database = new DatabaseSync(":memory:");
  state.database.exec(`
    CREATE TABLE projects (id text PRIMARY KEY, domain text);
    INSERT INTO projects VALUES ('p1', 'example.com');
  `);
  for (const file of [
    "drizzle/0048_fork_outreach_gsc.sql",
    "drizzle/0050_fork_outreach_schedule.sql",
  ]) {
    state.database.exec(
      readFileSync(file, "utf8").replaceAll("--> statement-breakpoint", ""),
    );
  }
  await OutreachService.updateSettings(project, {
    senderName: "Alex from Example",
    senderEmail: "outreach@example.com",
    signature: "Alex\nExample",
    smtpHost: "smtp.example.com",
    mailEnvKey: "EXAMPLE",
    timeZone: "Asia/Bangkok",
  });
  await OutreachScheduler.setPaused(project, false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("scheduled sending", () => {
  it("places an approved email in the next window and sends it there exactly once", async () => {
    const number = await approvedProspect("editor@blog.test");
    await OutreachScheduler.tick(at(BEFORE));
    expect(
      messageRow(number)?.scheduled_for?.startsWith("2026-11-23T14:"),
    ).toBe(true);
    expect(state.sends).toHaveLength(0);

    await OutreachScheduler.tick(at(INSIDE));
    expect(state.sends).toEqual([{ to: "editor@blog.test" }]);
    expect(messageRow(number)?.sent_at).toBeTruthy();

    // Later runs, and two runs at once, never send it again.
    await Promise.all([
      OutreachScheduler.tick(at("2026-11-23T14:35:00.000Z")),
      OutreachScheduler.tick(at("2026-11-23T14:35:00.000Z")),
    ]);
    await OutreachScheduler.tick(at("2026-11-24T14:30:00.000Z"));
    expect(state.sends).toHaveLength(1);
    const history = await OutreachService.getProspect(project, number);
    expect(history.status).toBe("sent");
    expect(
      history.history.some((item) => item.detail?.includes("by the schedule")),
    ).toBe(true);
  });

  it("drops an email from the queue when its text changes after approval", async () => {
    const number = await approvedProspect("editor@blog.test");
    await OutreachScheduler.tick(at(BEFORE));
    state.database
      ?.prepare(
        "UPDATE outreach_messages SET body = body || ' edited' WHERE kind = 'first'",
      )
      .run();
    await OutreachScheduler.tick(at(INSIDE));
    expect(state.sends).toHaveLength(0);
    expect(messageRow(number)?.scheduled_for).toBeNull();
    expect(messageRow(number)?.schedule_note).toMatch(/approve it again/u);
  });

  it("never emails a declined prospect", async () => {
    const number = await approvedProspect("editor@blog.test");
    await OutreachScheduler.tick(at(BEFORE));
    state.database
      ?.prepare(
        "UPDATE outreach_prospects SET status = 'declined' WHERE number = ?",
      )
      .run(number);
    await OutreachScheduler.tick(at(INSIDE));
    expect(state.sends).toHaveLength(0);
    expect(messageRow(number)?.scheduled_for).toBeNull();
  });

  it("sends nothing while paused", async () => {
    await approvedProspect("editor@blog.test");
    await OutreachScheduler.setPaused(project, true);
    await OutreachScheduler.tick(at(INSIDE));
    expect(state.sends).toHaveLength(0);
  });

  it("moves an email that missed its window to the next sending day", async () => {
    const number = await approvedProspect("editor@blog.test");
    await OutreachScheduler.tick(at(BEFORE));
    // The machine slept through the whole window.
    await OutreachScheduler.tick(at(AFTER));
    expect(state.sends).toHaveLength(0);
    expect(
      messageRow(number)?.scheduled_for?.startsWith("2026-11-24T14:"),
    ).toBe(true);
  });

  it("does not resend an email whose earlier send was interrupted", async () => {
    const number = await approvedProspect("editor@blog.test");
    await OutreachScheduler.tick(at(BEFORE));
    state.database
      ?.prepare(
        "UPDATE outreach_messages SET message_id = '<x@test.invalid>' WHERE kind = 'first'",
      )
      .run();
    await OutreachScheduler.tick(at(INSIDE));
    expect(state.sends).toHaveLength(0);
    expect(messageRow(number)?.schedule_note).toMatch(/interrupted/u);
  });

  it("does not email an address another prospect already got", async () => {
    // Adding a prospect refuses a known address; this covers an address
    // changed later on a prospect that was already emailed.
    const first = await approvedProspect("editor@blog.test");
    await OutreachScheduler.tick(at(BEFORE));
    await OutreachScheduler.tick(at(INSIDE));
    const second = await approvedProspect("desk@other-blog.test");
    state.database
      ?.prepare("UPDATE outreach_prospects SET contact = ? WHERE number = ?")
      .run("desk@other-blog.test", first);
    await OutreachScheduler.tick(at("2026-11-23T14:50:00.000Z"));
    expect(state.sends).toHaveLength(1);
    expect(messageRow(second)?.schedule_note).toMatch(/already emailed/u);
  });

  it("keeps to the daily limit and spaces emails of one window", async () => {
    for (const name of ["a", "b", "c", "d"])
      await approvedProspect(`${name}@site-${name}.test`);
    await OutreachScheduler.tick(at(BEFORE));
    const view = await OutreachScheduler.view(project, BEFORE);
    expect(
      view.queue.filter((item) => item.at.startsWith("2026-11-23")).length,
    ).toBe(3);
    expect(view.nextSend?.count).toBe(3);
    // Every five minutes through the window: at most one per run, three in all.
    for (let minute = 0; minute < 120; minute += 5) {
      await OutreachScheduler.tick(
        at(
          new Date(
            Date.parse("2026-11-23T14:00:00.000Z") + minute * 60_000,
          ).toISOString(),
        ),
      );
    }
    expect(state.sends).toHaveLength(3);
  });

  it("lets one run hold the project lock at a time", async () => {
    const until = "2026-11-23T05:04:00.000Z";
    expect(
      await OutreachRepository.takeSchedulerLock("p1", BEFORE, until),
    ).toBe(true);
    expect(
      await OutreachRepository.takeSchedulerLock("p1", BEFORE, until),
    ).toBe(false);
    await OutreachRepository.releaseSchedulerLock("p1", until);
    expect(
      await OutreachRepository.takeSchedulerLock("p1", BEFORE, until),
    ).toBe(true);
  });
});
