/**
 * One-time import of an earlier outreach database (the Weight Tracker ops
 * dashboard's Cloudflare D1 "weightracker-outreach") into one OpenSEO
 * project's outreach tables. Fork feature, see FORK-CHANGES.md.
 *
 * Reads the source only (SELECT over the D1 HTTP API) and writes a SQL file
 * that is applied to the local OpenSEO D1 with wrangler, either in this
 * checkout or inside the self-host Docker container. Refuses when the target
 * project already has outreach prospects. The SQL file holds third-party
 * names and addresses: it is written to a temporary folder and deleted after
 * it is applied, and it never goes into Git.
 *
 * Usage:
 *   pnpm exec tsx scripts/outreach-import-d1.ts \
 *     --project <openseo project id> \
 *     --source-env ~/.config/healthjourney/outreach-d1.env \
 *     --settings <settings.json> \
 *     [--container open-seo-open-seo-1] [--dry-run]
 *
 * settings.json holds the project's outreach settings (siteUrl, linkDomains,
 * senderName, senderEmail, signature, smtpHost, smtpPort, smtpUser,
 * timeZone, dailyMin, dailyMax, weeklyMin, weeklyMax, followUpDays). No
 * password: the owner enters it in Outreach → Settings, where it is stored
 * encrypted.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

type Row = Record<string, unknown>;

const { values: args } = parseArgs({
  options: {
    project: { type: "string" },
    "source-env": { type: "string" },
    settings: { type: "string" },
    container: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const projectId = args.project ?? fail("--project is required.");
if (!/^[0-9a-f-]{36}$/u.test(projectId))
  fail("--project must be a project id.");
const sourceEnvPath = (
  args["source-env"] ?? fail("--source-env is required.")
).replace(/^~(?=\/)/u, homedir());
const settingsPath = args.settings ?? fail("--settings is required.");

function readEnvFile(file: string) {
  const values: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/u)) {
    const index = line.indexOf("=");
    if (index > 0 && !line.trimStart().startsWith("#")) {
      values[line.slice(0, index).trim()] = line
        .slice(index + 1)
        .trim()
        .replace(/^(["'])(.*)\1$/u, "$2");
    }
  }
  return values;
}

const sourceEnv = readEnvFile(sourceEnvPath);
const accountId =
  sourceEnv.OUTREACH_D1_ACCOUNT_ID ?? sourceEnv.CLOUDFLARE_ACCOUNT_ID;
const databaseId = sourceEnv.OUTREACH_D1_DATABASE_ID;
const token = sourceEnv.OUTREACH_D1_TOKEN;
if (!accountId || !databaseId || !token)
  fail("The source env file is incomplete.");

async function sourceQuery(sql: string): Promise<Row[]> {
  if (!/^\s*select\b/iu.test(sql)) fail("Only SELECT runs against the source.");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql }),
    },
  );
  const body = (await response.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: Array<{ results?: Row[] }>;
  };
  if (!response.ok || !body.success) {
    fail(
      `Source query failed: ${body.errors?.map((e) => e.message).join("; ") ?? response.status}`,
    );
  }
  return body.result?.[0]?.results ?? [];
}

function q(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''")}'`;
}

const str = (value: unknown) =>
  value === null || value === undefined ? null : String(value);
const num = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : Number(value);

function wrangler(argsList: string[]) {
  if (args.container) {
    return execFileSync(
      "docker",
      ["exec", args.container, "pnpm", "exec", "wrangler", ...argsList],
      { encoding: "utf8" },
    );
  }
  return execFileSync("pnpm", ["exec", "wrangler", ...argsList], {
    encoding: "utf8",
  });
}

function targetCount() {
  const output = wrangler([
    "d1",
    "execute",
    "DB",
    "--local",
    "--json",
    "--command",
    `SELECT count(*) AS n FROM outreach_prospects WHERE project_id = ${q(projectId)}`,
  ]);
  const parsed = JSON.parse(output.slice(output.indexOf("["))) as Array<{
    results: Array<{ n: number }>;
  }>;
  return Number(parsed[0]?.results[0]?.n ?? 0);
}

const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<
  string,
  unknown
>;
const SETTINGS_COLUMNS: Record<string, string> = {
  siteUrl: "site_url",
  linkDomains: "link_domains",
  senderName: "sender_name",
  senderEmail: "sender_email",
  signature: "signature",
  smtpHost: "smtp_host",
  smtpPort: "smtp_port",
  smtpUser: "smtp_user",
  timeZone: "time_zone",
  dailyMin: "daily_min",
  dailyMax: "daily_max",
  weeklyMin: "weekly_min",
  weeklyMax: "weekly_max",
  followUpDays: "follow_up_days",
};
for (const key of Object.keys(settings)) {
  if (!(key in SETTINGS_COLUMNS)) fail(`Unknown settings key ${key}.`);
}
if (!settings.siteUrl || !settings.linkDomains)
  fail("settings need siteUrl and linkDomains.");

const now = new Date().toISOString();

async function main() {
  const existing = targetCount();
  if (existing > 0) {
    fail(
      `The project already has ${existing} outreach prospects; import refused.`,
    );
  }

  const [angles, prospects, messages, events, linkChecks] = await Promise.all([
    sourceQuery("SELECT * FROM outreach_angles ORDER BY sort_order, key"),
    sourceQuery("SELECT * FROM prospects ORDER BY number"),
    sourceQuery("SELECT * FROM messages ORDER BY id"),
    sourceQuery("SELECT * FROM events ORDER BY at, id"),
    sourceQuery("SELECT * FROM link_checks ORDER BY checked_at, id"),
  ]);

  const statements: string[] = [];
  const columns = Object.keys(settings).map((key) => SETTINGS_COLUMNS[key]);
  statements.push(
    `INSERT INTO outreach_settings (project_id, ${columns.join(", ")}) VALUES (${q(projectId)}, ${Object.values(settings).map(q).join(", ")}) ON CONFLICT(project_id) DO UPDATE SET ${columns.map((column) => `${column} = excluded.${column}`).join(", ")}, updated_at = ${q(now)};`,
  );
  for (const angle of angles) {
    statements.push(
      `INSERT OR IGNORE INTO outreach_angles (id, project_id, key, label, description, color, active, sort_order) VALUES (${q(randomUUID())}, ${q(projectId)}, ${q(angle.key)}, ${q(angle.label)}, ${q(angle.description)}, ${q(angle.color)}, ${q(num(angle.active) ?? 1)}, ${q(num(angle.sort_order) ?? 100)});`,
    );
  }

  const prospectIds = new Map<number, string>();
  for (const p of prospects) {
    const id = randomUUID();
    const number = Number(p.number);
    prospectIds.set(number, id);
    const angleId = p.angle
      ? `(SELECT id FROM outreach_angles WHERE project_id = ${q(projectId)} AND key = ${q(p.angle)})`
      : "NULL";
    const notes = [
      str(p.notes) ?? "",
      num(p.embed_offer) ? "(Imported: an embed offer was planned.)" : "",
    ]
      .filter(Boolean)
      .join("\n");
    statements.push(
      `INSERT INTO outreach_prospects (id, project_id, number, site, person, contact, contact_kind, contact_note, their_page, their_page_title, our_page, gain, status, notes, dropped_reason, link_url, link_rel, angle_id, angle_note, score_gain, score_gain_reason, score_activity, score_activity_reason, score_reach, score_reach_reason, score_link, score_link_reason, scored_at, favicon, favicon_fetched_at, metric_authority, metric_traffic, metric_traffic_location, metric_referring_domains, metrics_measured_at, metrics_source, created_at, updated_at) VALUES (${[
        q(id),
        q(projectId),
        q(number),
        q(str(p.site)),
        q(str(p.person)),
        q(str(p.contact) ?? ""),
        q(str(p.contact_kind) ?? "email"),
        q(str(p.contact_note)),
        q(str(p.their_page)),
        q(str(p.their_page_title)),
        q(str(p.our_page)),
        q(str(p.gain)),
        q(str(p.status)),
        q(notes),
        q(str(p.dropped_reason)),
        q(str(p.link_url)),
        q(str(p.link_rel)),
        angleId,
        q(str(p.angle_note)),
        q(num(p.score_gain)),
        q(str(p.score_gain_reason)),
        q(num(p.score_activity)),
        q(str(p.score_activity_reason)),
        q(num(p.score_reach)),
        q(str(p.score_reach_reason)),
        q(num(p.score_link)),
        q(str(p.score_link_reason)),
        q(str(p.scored_at)),
        q(str(p.favicon)),
        q(str(p.favicon_fetched_at)),
        q(num(p.metric_authority)),
        q(num(p.metric_traffic)),
        q(str(p.metric_traffic_location)),
        q(num(p.metric_referring_domains)),
        q(str(p.metrics_measured_at)),
        q(str(p.metrics_source)),
        q(str(p.created_at) ?? now),
        q(str(p.updated_at) ?? now),
      ].join(", ")});`,
    );
  }

  const sourceMessageIds = new Map(
    messages.map((m) => [Number(m.id), str(m.message_id)]),
  );
  for (const m of messages) {
    const prospectId = prospectIds.get(Number(m.prospect));
    if (!prospectId)
      fail(`Message ${String(m.id)} points to a missing prospect.`);
    const repliedTo = m.in_reply_to
      ? sourceMessageIds.get(Number(m.in_reply_to))
      : null;
    const inReplyTo = repliedTo
      ? `(SELECT id FROM outreach_messages WHERE project_id = ${q(projectId)} AND message_id = ${q(repliedTo)} ORDER BY id DESC LIMIT 1)`
      : "NULL";
    statements.push(
      `INSERT INTO outreach_messages (project_id, prospect_id, kind, subject, body, approved_hash, approved_at, sent_at, message_id, received_at, in_reply_to_id, created_at) VALUES (${[
        q(projectId),
        q(prospectId),
        q(str(m.kind)),
        q(str(m.subject) ?? ""),
        q(str(m.body) ?? ""),
        q(str(m.approved_hash)),
        q(str(m.approved_at)),
        q(str(m.sent_at)),
        q(str(m.message_id)),
        q(str(m.received_at)),
        inReplyTo,
        q(str(m.created_at) ?? now),
      ].join(", ")});`,
    );
  }

  for (const e of events) {
    const prospectId = prospectIds.get(Number(e.prospect));
    if (!prospectId)
      fail(`Event ${String(e.id)} points to a missing prospect.`);
    statements.push(
      `INSERT INTO outreach_events (project_id, prospect_id, type, detail, actor, at) VALUES (${[
        q(projectId),
        q(prospectId),
        q(str(e.type)),
        q(str(e.detail)),
        q(str(e.actor) === "owner" ? "owner" : "agent"),
        q(str(e.at)),
      ].join(", ")});`,
    );
  }

  for (const c of linkChecks) {
    const prospectId = prospectIds.get(Number(c.prospect));
    if (!prospectId)
      fail(`Link check ${String(c.id)} points to a missing prospect.`);
    statements.push(
      `INSERT INTO outreach_link_checks (project_id, prospect_id, checked_at, found, url, href, rel, actor, detail) VALUES (${[
        q(projectId),
        q(prospectId),
        q(str(c.checked_at)),
        q(num(c.found) ?? 0),
        q(str(c.url)),
        q(str(c.href)),
        q(str(c.rel)),
        q(str(c.actor) === "owner" ? "owner" : "agent"),
        q(str(c.detail)),
      ].join(", ")});`,
    );
  }

  for (const [number, id] of prospectIds) {
    statements.push(
      `INSERT INTO outreach_events (project_id, prospect_id, type, detail, actor, at) VALUES (${q(projectId)}, ${q(id)}, 'imported', ${q(`from the Weight Tracker ops outreach database, #${number}`)}, 'agent', ${q(now)});`,
    );
  }

  console.log(
    `Source: ${angles.length} angles, ${prospects.length} prospects, ${messages.length} messages, ${events.length} events, ${linkChecks.length} link checks.`,
  );
  if (args["dry-run"]) {
    console.log(
      `Dry run: ${statements.length} statements prepared, nothing written.`,
    );
    return;
  }

  const dir = mkdtempSync(path.join(tmpdir(), "openseo-outreach-import-"));
  const file = path.join(dir, "import.sql");
  try {
    writeFileSync(file, `${statements.join("\n")}\n`, { mode: 0o600 });
    if (args.container) {
      execFileSync("docker", [
        "cp",
        file,
        `${args.container}:/tmp/openseo-outreach-import.sql`,
      ]);
      try {
        wrangler([
          "d1",
          "execute",
          "DB",
          "--local",
          "--file",
          "/tmp/openseo-outreach-import.sql",
        ]);
      } finally {
        execFileSync("docker", [
          "exec",
          args.container,
          "rm",
          "-f",
          "/tmp/openseo-outreach-import.sql",
        ]);
      }
    } else {
      wrangler(["d1", "execute", "DB", "--local", "--file", file]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(
    `Imported into project ${projectId}: now ${targetCount()} prospects.`,
  );
}

await main();
