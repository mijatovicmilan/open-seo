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

- **PostHog as an analytics source** (Settings → Integrations): per project,
  Google Analytics or PostHog. An organization's PostHog personal API key is
  stored once, encrypted with `BETTER_AUTH_SECRET` (Better Auth's symmetric
  encryption, as OAuth tokens are), shown only as `phx_…abcd`, and can serve
  several projects; check, connect, replace and disconnect in the UI;
  `POSTHOG_PERSONAL_API_KEY` / `POSTHOG_HOST` in `.env` are a fallback and the
  seed for "Use the key from the server's .env". Key events (signups) are
  picked from the PostHog project's events. Every GA4 report, the organic
  overview, measurement health, search opportunities, the dashboard card and
  the GA4 MCP tools answer from PostHog over HogQL in the GA4 shape (no
  ecommerce or new-vs-returning; users and sessions marked as estimates on
  cookieless sites). Our joins: Search Insights gets Google visits and
  signups (cards, chart lines with the same notes, a sortable "From search to
  signups" table); Outreach gets visits and signups per earned link (Links
  tab and prospect panel). MCP tools: `get_search_signups`,
  `get_outreach_link_traffic` (`src/server/mcp/tools/posthog-join-tools.ts`).

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
- `src/routes/_app/p/$projectId/outreach.tsx`,
  `src/routes/_app/p/$projectId/search-insights.tsx`
- `scripts/outreach-import-d1.ts`
- `src/server/features/internal-cron/` (the cron endpoint for local Docker)
- `src/routes/_app/settings/agent.tsx`, `src/client/features/ai-mcp/AgentSetupContent.tsx`
  (upstream's agent setup page body, under Settings)
- `src/server/mcp/tools/outreach-schedule-tools.ts`,
  `src/server/mcp/tools/fork-tools.ts` (registers all our MCP tools)
- PostHog: `src/db/analytics-source.schema.ts` (+ `src/db/pg/` mirror),
  `src/server/features/posthog/`, `src/server/lib/posthogClient.ts`,
  `src/server/lib/posthogErrors.ts`, `src/server/lib/secretBox.ts`,
  `src/serverFunctions/analyticsSource.ts`,
  `src/types/schemas/analytics-source.ts`, `src/client/features/posthog/`,
  `src/server/mcp/tools/posthog-join-tools.ts`
- Migrations `drizzle/sqlite/0048_fork_outreach_gsc.sql`, `0049_fork_gsc_segments.sql`,
  `0050_fork_outreach_schedule.sql`, `0051_fork_analytics_source.sql` and
  `drizzle/pg/0026_fork_outreach_gsc.sql` … `0029_fork_analytics_source.sql`,
  with their snapshots (`drizzle/sqlite/meta/0074–0077_snapshot.json`,
  `drizzle/pg/meta/0052–0055_snapshot.json`)

## Intentional edits to upstream files

| File                                                                                                                        | Change                                                                                                                                                                                                               | Why                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/db/schema.ts`                                                                                                          | Import, type and spread our two schema modules; export our tables                                                                                                                                                    | The provider-aware barrel is how repositories get tables                                                                                             |
| `src/db/d1/schema.ts`, `src/db/pg/schema.ts`                                                                                | `export *` of our schema modules                                                                                                                                                                                     | drizzle-kit and the D1/PG clients read these barrels                                                                                                 |
| `src/db/schema-parity.test.ts`                                                                                              | Include our modules                                                                                                                                                                                                  | Keeps the SQLite/Postgres parity guard covering our tables                                                                                           |
| `src/server/mcp/server.ts`                                                                                                  | Import `registerForkTools` and call it at the end of `registerOpenSeoTools`                                                                                                                                          | MCP tool registration (also reaches the Every App catalog)                                                                                           |
| `src/server/everyapp/tools.test.ts`                                                                                         | Tool count 85 + our 27 = 112                                                                                                                                                                                         | Our tools are in the catalog                                                                                                                         |
| `src/server.ts`                                                                                                             | One try/catch call to `GscHistorySyncService.syncAllConnectedProjects()` in the daily `17 3 * * *` cron branch                                                                                                       | Daily Search Console history                                                                                                                         |
| `src/server.ts`                                                                                                             | `scheduled` body moved into `runScheduled(cron, env)`; `OutreachScheduler.tick()` in the 5-minute branch; the `INTERNAL_CRON_PATH` route calling `runScheduled`                                                      | Scheduled outreach sending; crons for local Docker                                                                                                   |
| `compose.yaml`                                                                                                              | The `scheduler` sidecar service                                                                                                                                                                                      | Calls the internal cron endpoint every 5 minutes                                                                                                     |
| `src/client/navigation/items.ts`                                                                                            | "Search Insights" and "Outreach" items in My Site, "GSC Insights" left out; "Brand Lookup" kept in the AI Visibility group; "Agent setup" out of the AI Tools group (it links to Settings before any project exists) | Navigation (owner's choices)                                                                                                                         |
| `src/routes/_app/ai.tsx`                                                                                                    | Now only a redirect to `/settings/agent` (keeps `?tab=skills`); its page body moved to `src/client/features/ai-mcp/AgentSetupContent.tsx`                                                                            | Agent setup is per instance, so it lives in Settings (owner, 2026-11-23); when upstream changes the page, copy its body into AgentSetupContent again |
| `src/routes/_app/settings.tsx`                                                                                              | "Agent setup" tab                                                                                                                                                                                                    | Agent setup under Settings                                                                                                                           |
| `src/routes/_app/p/$projectId/search-performance.tsx`                                                                       | `beforeLoad` redirect to Search Insights (the page code stays)                                                                                                                                                       | Old links and MCP URLs land on Search Insights                                                                                                       |
| `src/client/features/dashboard/DashboardCards.tsx`                                                                          | The GSC card's link goes to Search Insights with the matching range                                                                                                                                                  | No link to the hidden page                                                                                                                           |
| `src/client/components/Sidebar.tsx`                                                                                         | Help & Community only in hosted mode (upstream hides SAM itself)                                                                                                                                                     | Support is not used here                                                                                                                             |
| `src/server/features/dashboard/services/DashboardService.test.ts`                                                           | `vi.mock` of `posthogSource` returning null                                                                                                                                                                          | Keeps the DB out of the test                                                                                                                         |
| `src/routeTree.gen.ts`                                                                                                      | Regenerated with our two routes                                                                                                                                                                                      | Generated by the router plugin                                                                                                                       |
| `drizzle/sqlite/meta/_journal.json`, `drizzle/pg/meta/_journal.json`                                                        | Our four entries after upstream's (D1 idx 74–77, PG 52–55), file names unchanged                                                                                                                                     | See "Migrations and upstream merges"                                                                                                                 |
| `src/server/features/ga4/services/Ga4ReportingService.ts`, `Ga4OrganicOverviewService.ts`, `Ga4MeasurementHealthService.ts` | First lines of `runReport` / `getOrganicOverview` / `getMeasurementHealth` hand PostHog projects to `PosthogReportingService`; `normalizeLimit`, `normalizeOffset`, `keyEventDiagnostics` exported                   | PostHog answers in the GA4 shape                                                                                                                     |
| `src/server/features/ga4/services/SearchOpportunityService.ts`                                                              | Time zone from the PostHog source when there is no GA4 link; `source.analyticsProvider`                                                                                                                              | Search opportunities for PostHog projects                                                                                                            |
| `src/server/features/ga4/services/*.test.ts` (5 files)                                                                      | `vi.mock` of `posthogSource` returning null                                                                                                                                                                          | Their projects have no PostHog source; keeps the DB out of the tests                                                                                 |
| `src/server/features/dashboard/services/DashboardService.ts`                                                                | A PostHog source counts as connected analytics                                                                                                                                                                       | Dashboard card and setup step                                                                                                                        |
| `src/serverFunctions/ga4.ts`                                                                                                | Dashboard report carries `provider`; a PostHog project's error is thrown, not turned into the GA4 connect card                                                                                                       | Dashboard card                                                                                                                                       |
| `src/client/features/dashboard/Ga4Card.tsx`                                                                                 | Title "PostHog" for PostHog projects, "(est.)" labels, neutral error text                                                                                                                                            | Dashboard card                                                                                                                                       |
| `src/server/mcp/tools/google-analytics-tools.ts`                                                                            | A sentence on PostHog in each description; "Source: PostHog" note in the text; overview lists only metrics the source has; PostHog measurement health as hosts and events                                            | MCP tools explain the source                                                                                                                         |
| `src/routes/_app/p/$projectId/settings/integrations.tsx`                                                                    | `AnalyticsSourceSection` wraps the GA4 `GoogleConnectionCard`                                                                                                                                                        | Source picker                                                                                                                                        |
| `compose.yaml`, `.env.example`                                                                                              | `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_HOST`                                                                                                                                                                           | Env key fallback                                                                                                                                     |

## Hidden upstream features

Hidden from the menu and links, code kept so upstream merges stay easy:
GSC Insights (`search-performance`, redirects to Search Insights) and Help &
Community (`/support`) when self-hosted. Upstream itself hides SAM from the
navigation (`/p/$projectId/sam` opens only by URL). Billing, Subscribe and
the Organization (team) tab are hosted-only upstream. Sign-in, sign-up and
password reset are untouched. Brand Lookup (dropped from upstream's menu) and
Prompt Explorer stay in the AI Visibility group.

## UI

Our screens use upstream's shadcn components (`src/client/components/ui/`)
and theme tokens (`bg-card`, `text-muted-foreground`, `border-border`,
`var(--chart-N)` for series), like every upstream page. Upstream removed
daisyUI in 9c423966; never reintroduce daisyUI class names.

## Migrations and upstream merges

D1 (`wrangler d1 migrations apply`, folder `drizzle/sqlite`) tracks applied
migrations by file name; installs already have ours applied as
`0048_fork_outreach_gsc.sql` … `0051_fork_analytics_source.sql`. So:

1. Never rename our SQL files. Upstream files that share a number (upstream's
   own `0048_…` and later) still apply, because the names differ.
2. In `drizzle/sqlite/meta/_journal.json` and `drizzle/pg/meta/_journal.json`
   keep upstream's entries first and ours last (renumber our `idx`, keep tag
   and `when`). Rename our snapshot files to the matching idx and chain their
   `prevId` from upstream's last snapshot. Then run
   `pnpm exec drizzle-kit generate --config drizzle/sqlite.config.ts` and
   `--config drizzle/pg.config.ts`; both must say "No schema changes". If our
   snapshot content is stale, generate once with a temporary name, keep the
   generated snapshot as our last one and delete the generated SQL.
3. Check `wrangler d1 migrations apply DB --local` on an empty database and on
   a copy of the Docker database (row counts unchanged).
4. Postgres (drizzle migrator) applies by journal order and timestamp; on a
   Postgres install apply newly merged upstream migrations before ours.

Last merge: upstream `af3f995f` on 2026-11-23 (D1 upstream 0048–0073, ours
idx 74–77; PG upstream 0026–0051, ours idx 52–55).

## Running it

- SMTP credentials for sending from the app are environment values, never
  stored: `OUTREACH_<KEY>_SMTP_USER` and `OUTREACH_<KEY>_SMTP_PASSWORD`, where
  `KEY` is the project's mail env key in Outreach → Settings.
- We run upstream's legacy Docker setup (root `compose.yaml`, image built from
  `deploy/docker/Dockerfile`: `docker build -f deploy/docker/Dockerfile -t
open-seo:local .`). Upstream's new standalone setup (`deploy/standalone/`,
  celld) has a one-way import that carries only upstream's tables, not ours;
  moving to it needs its own plan.
- The legacy Docker setup runs `vite preview`, where Cloudflare crons do not fire.
  The `scheduler` service in `compose.yaml` calls `POST /api/internal/cron`
  every 5 minutes (and the daily job once a day) with
  `Authorization: Bearer $OPENSEO_CRON_SECRET`; set that value in `.env` (at
  least 24 characters, e.g. `openssl rand -hex 32`). Without it the endpoint
  answers 404 and the sidecar stays idle.
- `OUTREACH_MAIL_TRANSPORT=log` turns sending into logging only (recipient and
  Message-ID), for checking the scheduler without sending any email.
