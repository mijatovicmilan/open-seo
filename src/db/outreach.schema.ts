import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { projects } from "./app.schema";

// ============================================================================
// Link outreach (fork feature, see FORK-CHANGES.md). Ported from the Weight
// Tracker operations dashboard: one project's earned-link outreach from
// prospect to verified link. Everything is project-scoped; third-party names
// and addresses live only here, never in Git.
// ============================================================================

const isoNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

// Per-project outreach identity and pacing. One row per project, created the
// first time the outreach page or an outreach tool is used.
export const outreachSettings = sqliteTable("outreach_settings", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  // The site we earn links for, e.g. https://example.com.
  siteUrl: text("site_url").notNull(),
  // Hosts that count as a link to us, space separated ("example.com
  // app.example.com"). Subdomains of each host count too.
  linkDomains: text("link_domains").notNull(),
  // "<Pen name> from <Brand>" and the mailbox it sends from. Empty until set;
  // sending stays off without them.
  senderName: text("sender_name").notNull().default(""),
  senderEmail: text("sender_email").notNull().default(""),
  // Appended under every outgoing body ("\n" separated lines).
  signature: text("signature").notNull().default(""),
  // SMTP server for sending from the app (SSL, usually port 465). The user
  // and password never live in the database: they are read from the
  // OUTREACH_<mailEnvKey>_SMTP_USER and _SMTP_PASSWORD environment values.
  smtpHost: text("smtp_host").notNull().default(""),
  smtpPort: integer("smtp_port").notNull().default(465),
  mailEnvKey: text("mail_env_key").notNull().default(""),
  // Days and weeks (from Monday) are counted in this IANA time zone.
  timeZone: text("time_zone").notNull().default("UTC"),
  dailyMin: integer("daily_min").notNull().default(2),
  dailyMax: integer("daily_max").notNull().default(3),
  weeklyMin: integer("weekly_min").notNull().default(10),
  weeklyMax: integer("weekly_max").notNull().default(20),
  followUpDays: integer("follow_up_days").notNull().default(7),
  // Scheduled sending: approved emails go out on these weekdays at this
  // time in the recipients' zone, inside a window after it; a missed window
  // moves to the next sending day. Paused until the owner resumes it.
  schedulePaused: integer("schedule_paused").notNull().default(1),
  scheduleTimeZone: text("schedule_time_zone")
    .notNull()
    .default("America/New_York"),
  // ISO weekdays, Monday = 1 ("1 2 3 4 5").
  scheduleDays: text("schedule_days").notNull().default("1 2 3 4 5"),
  scheduleTime: text("schedule_time").notNull().default("09:00"),
  scheduleWindowMinutes: integer("schedule_window_minutes")
    .notNull()
    .default(120),
  // The scheduler's last run for this project, and a short lock so two
  // runs never work the queue at once.
  schedulerCheckedAt: text("scheduler_checked_at"),
  schedulerLockUntil: text("scheduler_lock_until"),
  createdAt: text("created_at").notNull().default(isoNow),
  updatedAt: text("updated_at").notNull().default(isoNow),
});

// Why we write to a prospect. Seeded per project with the growth kit's
// angles; new ones are added when the same "other" gain keeps coming up.
export const outreachAngles = sqliteTable(
  "outreach_angles",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull(),
    // A tone name: red, amber, lime, green, teal, blue, violet, pink or gray.
    color: text("color").notNull(),
    active: integer("active").notNull().default(1),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    uniqueIndex("outreach_angles_project_key_idx").on(
      table.projectId,
      table.key,
    ),
  ],
);

// One site or person we may email.
export const outreachProspects = sqliteTable(
  "outreach_prospects",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Human reference within the project (#12), kept on import.
    number: integer("number").notNull(),
    site: text("site").notNull(),
    person: text("person"),
    // Email address or contact form URL; empty when none was found yet.
    contact: text("contact").notNull().default(""),
    contactKind: text("contact_kind", { enum: ["email", "form"] }).notNull(),
    contactNote: text("contact_note"),
    theirPage: text("their_page").notNull(),
    theirPageTitle: text("their_page_title"),
    // The page of ours the email promotes (name or URL).
    ourPage: text("our_page").notNull(),
    gain: text("gain"),
    status: text("status", {
      enum: [
        "drafted",
        "awaiting approval",
        "approved",
        "sent",
        "follow-up sent",
        "replied",
        "linked",
        "declined",
        "no reply",
        "dropped",
      ],
    }).notNull(),
    notes: text("notes").notNull().default(""),
    droppedReason: text("dropped_reason"),
    linkUrl: text("link_url"),
    linkRel: text("link_rel", {
      enum: ["follow", "nofollow", "ugc", "sponsored"],
    }),
    angleId: text("angle_id").references(() => outreachAngles.id, {
      onDelete: "set null",
    }),
    angleNote: text("angle_note"),
    // Score parts set by the agent, each with a one-line reason. Site
    // strength is derived from the metrics below, never stored.
    scoreGain: integer("score_gain"),
    scoreGainReason: text("score_gain_reason"),
    scoreActivity: integer("score_activity"),
    scoreActivityReason: text("score_activity_reason"),
    scoreReach: integer("score_reach"),
    scoreReachReason: text("score_reach_reason"),
    scoreLink: integer("score_link"),
    scoreLinkReason: text("score_link_reason"),
    scoredAt: text("scored_at"),
    // A small data URI fetched once from their site; served by its own read.
    favicon: text("favicon"),
    faviconFetchedAt: text("favicon_fetched_at"),
    metricAuthority: integer("metric_authority"),
    metricTraffic: integer("metric_traffic"),
    metricTrafficLocation: text("metric_traffic_location"),
    metricReferringDomains: integer("metric_referring_domains"),
    metricsMeasuredAt: text("metrics_measured_at"),
    metricsSource: text("metrics_source"),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("outreach_prospects_project_number_idx").on(
      table.projectId,
      table.number,
    ),
    index("outreach_prospects_angle_idx").on(table.angleId),
  ],
);

// Outgoing drafts and sends, and summaries of incoming replies. An outgoing
// message is pending until sent_at is set. approved_hash is the SHA-256 of
// the recipient, subject and body the owner approved: any edit voids it.
export const outreachMessages = sqliteTable(
  "outreach_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    prospectId: text("prospect_id")
      .notNull()
      .references(() => outreachProspects.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["first", "follow-up", "reply-in", "reply-out"],
    }).notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    approvedHash: text("approved_hash"),
    approvedAt: text("approved_at"),
    sentAt: text("sent_at"),
    // Our Message-ID for a send (written first, as the send claim), or
    // theirs for an incoming reply.
    messageId: text("message_id"),
    // reply-in: their Date header, and which of our sends it answers.
    receivedAt: text("received_at"),
    inReplyToId: integer("in_reply_to_id"),
    // Scheduled sending: when this approved email is due (UTC), whether the
    // owner picked the day (the planner then leaves it), and why the last
    // scheduled attempt did not send.
    scheduledFor: text("scheduled_for"),
    scheduleManual: integer("schedule_manual").notNull().default(0),
    scheduleNote: text("schedule_note"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("outreach_messages_prospect_idx").on(table.prospectId, table.id),
    index("outreach_messages_project_sent_idx").on(
      table.projectId,
      table.sentAt,
    ),
  ],
);

// Status history: who did what and when.
export const outreachEvents = sqliteTable(
  "outreach_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    prospectId: text("prospect_id")
      .notNull()
      .references(() => outreachProspects.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    detail: text("detail"),
    // owner = an action in the app; agent = an MCP tool or import.
    actor: text("actor", { enum: ["owner", "agent"] }).notNull(),
    at: text("at").notNull(),
  },
  (table) => [
    index("outreach_events_prospect_idx").on(table.prospectId, table.at),
    index("outreach_events_project_type_idx").on(
      table.projectId,
      table.type,
      table.at,
    ),
  ],
);

// Every check of their page for a link to us.
export const outreachLinkChecks = sqliteTable(
  "outreach_link_checks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    prospectId: text("prospect_id")
      .notNull()
      .references(() => outreachProspects.id, { onDelete: "cascade" }),
    checkedAt: text("checked_at").notNull(),
    found: integer("found").notNull(),
    url: text("url").notNull(),
    href: text("href"),
    rel: text("rel", { enum: ["follow", "nofollow", "ugc", "sponsored"] }),
    actor: text("actor", { enum: ["owner", "agent"] }).notNull(),
    detail: text("detail"),
  },
  (table) => [
    index("outreach_link_checks_prospect_idx").on(
      table.prospectId,
      table.checkedAt,
    ),
  ],
);
