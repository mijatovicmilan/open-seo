# Fork changes

This fork (`mijatovicmilan/open-seo`) tracks `every-app/open-seo` closely. Our
features live in our own files; upstream files are touched only to register
them. Merge upstream often. When a merge conflicts in a file below, keep
upstream's version and re-apply the marked lines (each carries a
`Fork addition (FORK-CHANGES.md)` comment).

## Our features

- **Link outreach** (`p/$projectId/outreach`): prospects, scores, angles, the
  owner's approval of each exact email (hash of recipient, subject and body),
  sending from the app over SMTP, replies, follow-ups and link checks. Ported
  from the Weight Tracker operations dashboard. MCP tools:
  `src/server/mcp/tools/outreach-tools.ts` (there is deliberately no send
  tool). One-time import from the old D1: `scripts/outreach-import-d1.ts`.
  **Scheduled sending**: approved first emails and follow-ups go out by
  themselves on the project's sending days and time (recipients' zone, e.g.
  weekdays 09:00 New York), inside a window, within the daily and weekly
  limits, re-checked before each send; paused until the owner resumes it
  (`OutreachScheduler.ts`, `src/shared/outreachSchedule.ts`, MCP tools in
  `outreach-schedule-tools.ts`, which can arrange and pause the queue but
  never send or resume).
- **Search Insights** (`p/$projectId/search-insights`): daily stored Search
  Console history and the decisions it supports (what changed, near page one,
  CTR below expected, cannibalization, new pages, chart annotations). MCP
  tools: `src/server/mcp/tools/search-history-tools.ts`.

Our own files:

- `src/db/outreach.schema.ts`, `src/db/gsc-history.schema.ts` and their
  Postgres mirrors in `src/db/pg/`
- `src/server/features/outreach/`, `src/server/features/gsc-history/`
- `src/serverFunctions/outreach.ts`, `src/serverFunctions/gscHistory.ts`
- `src/shared/outreach.ts`, `src/shared/outreachSchedule.ts`,
  `src/types/schemas/outreach.ts`,
  `src/types/schemas/gsc-history.ts`
- `src/client/features/outreach/`, `src/client/features/gsc-history/`,
  `src/client/features/charts/` (the shared time-series chart)
- `src/routes/_project/p/$projectId/outreach.tsx`,
  `src/routes/_project/p/$projectId/search-insights.tsx`
- `scripts/outreach-import-d1.ts`
- `src/server/features/internal-cron/` (the cron endpoint for local Docker)
- `src/server/mcp/tools/outreach-schedule-tools.ts`
- Migrations `drizzle/0048_fork_outreach_gsc.sql`, `drizzle/0049_fork_gsc_segments.sql`,
  `drizzle/0050_fork_outreach_schedule.sql` and `drizzle-pg/0026_fork_outreach_gsc.sql`,
  `drizzle-pg/0027_fork_gsc_segments.sql`, `drizzle-pg/0028_fork_outreach_schedule.sql`
  (with their snapshots)

## Intentional edits to upstream files

| File                                                          | Change                                                                                                                                                          | Why                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `src/db/schema.ts`                                            | Import, type and spread our two schema modules; export our tables                                                                                               | The provider-aware barrel is how repositories get tables   |
| `src/db/d1/schema.ts`, `src/db/pg/schema.ts`                  | `export *` of our schema modules                                                                                                                                | drizzle-kit and the D1/PG clients read these barrels       |
| `src/db/schema-parity.test.ts`                                | Include our modules                                                                                                                                             | Keeps the SQLite/Postgres parity guard covering our tables |
| `src/server/mcp/server.ts`                                    | Import and `register(...)` our tools                                                                                                                            | MCP tool registration                                      |
| `src/server.ts`                                               | One try/catch call to `GscHistorySyncService.syncAllConnectedProjects()` in the daily `17 3 * * *` cron branch                                                  | Daily Search Console history                               |
| `src/server.ts`                                               | `scheduled` body moved into `runScheduled(cron, env)`; `OutreachScheduler.tick()` in the 5-minute branch; the `INTERNAL_CRON_PATH` route calling `runScheduled` | Scheduled outreach sending; crons for local Docker         |
| `compose.yaml`                                                | The `scheduler` sidecar service                                                                                                                                 | Calls the internal cron endpoint every 5 minutes           |
| `src/client/navigation/items.ts`                              | "Search Insights" and "Outreach" items in My Site                                                                                                               | Navigation                                                 |
| `src/routeTree.gen.ts`                                        | Regenerated with our two routes                                                                                                                                 | Generated by the router plugin                             |
| `drizzle/meta/_journal.json`, `drizzle-pg/meta/_journal.json` | Our migration entries                                                                                                                                           | Generated by drizzle-kit                                   |

## Migrations and upstream merges

Our migrations are numbered after upstream's last one at fork time (D1 0048
to 0050, Postgres 0026 to 0028). D1 (`wrangler d1 migrations apply`) tracks applied files by
name, so a later upstream file with the same number but a different name
still applies. If upstream adds 0048/0026:

1. Keep both SQL files; merge the `_journal.json` entries so upstream's come
   first and ours last (renumber our `idx`, keep our file name and tag).
2. Make our snapshot's `prevId` point at upstream's last snapshot, or run
   `pnpm db:generate` afterwards and confirm it reports no changes.
3. Postgres (drizzle migrator) applies by journal order and timestamp, so on a
   Postgres install apply any newly merged upstream migration before ours.

Never rename a migration that has already been applied to a database.

## Running it

- SMTP credentials for sending from the app are environment values, never
  stored: `OUTREACH_<KEY>_SMTP_USER` and `OUTREACH_<KEY>_SMTP_PASSWORD`, where
  `KEY` is the project's mail env key in Outreach → Settings.
- Self-host Docker runs `vite preview`, where Cloudflare crons do not fire.
  The `scheduler` service in `compose.yaml` calls `POST /api/internal/cron`
  every 5 minutes (and the daily job once a day) with
  `Authorization: Bearer $OPENSEO_CRON_SECRET`; set that value in `.env` (at
  least 24 characters, e.g. `openssl rand -hex 32`). Without it the endpoint
  answers 404 and the sidecar stays idle.
- `OUTREACH_MAIL_TRANSPORT=log` turns sending into logging only (recipient and
  Message-ID), for checking the scheduler without sending any email.
