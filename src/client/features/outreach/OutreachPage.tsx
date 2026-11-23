/* eslint-disable max-lines -- the outreach screen and its tabs (fork feature) */
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { LinkTrafficInline } from "@/client/features/posthog/LinkTraffic";
import { ArrowDown, ArrowUp, Loader2, Search, Settings2 } from "lucide-react";
import { PageHeader } from "@/client/components/PageHeader";
import { Alert } from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/client/components/ui/input-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import {
  type ChartPoint,
  type ChartSeries,
  TimeSeriesChart,
} from "@/client/features/charts/TimeSeriesChart";
import { SegmentGroup } from "@/client/features/charts/ChoiceMenu";
import {
  ScheduledTab,
  ScheduleStrip,
} from "@/client/features/outreach/OutreachSchedule";
import { OutreachProspectPanel } from "@/client/features/outreach/OutreachProspectPanel";
import { OutreachSettingsForm } from "@/client/features/outreach/OutreachSettingsForm";
import {
  ActionPill,
  Favicon,
  formatDateTime,
  formatNumber,
  outreachFaviconsKey,
  outreachQueryKey,
  ScorePill,
  StatusBadge,
} from "@/client/features/outreach/outreachUi";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getOutreachFavicons,
  getOutreachSnapshot,
} from "@/serverFunctions/outreach";
import {
  filterOutreachProspects,
  OUTREACH_ATTENTION_LABELS,
  OUTREACH_FILTERS,
  OUTREACH_TABS,
  outreachAttention,
  type OutreachBreakdownRow,
  type OutreachFilter,
  outreachFilterCounts,
  outreachLinks,
  type OutreachProspect,
  outreachReplyQueue,
  type OutreachSnapshot,
  type OutreachSortKey,
  sortOutreachProspects,
  type OutreachTab,
} from "@/shared/outreach";

// Panels follow the Search Performance page: a bordered card with a header
// row, tables inside their own horizontal scroll so the page never scrolls
// sideways.
function Panel({
  title,
  meta,
  actions,
  children,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {title ? <h2 className="font-semibold">{title}</h2> : null}
            {meta ? (
              <p className="text-xs text-muted-foreground">{meta}</p>
            ) : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function OutreachPage({
  projectId,
  tab,
  prospectNumber,
  onTab,
  onProspect,
}: {
  projectId: string;
  tab: OutreachTab;
  prospectNumber: number | undefined;
  onTab: (tab: OutreachTab) => void;
  onProspect: (number: number | undefined) => void;
}) {
  const snapshotQuery = useQuery({
    queryKey: outreachQueryKey(projectId),
    queryFn: () => getOutreachSnapshot({ data: { projectId } }),
    // Approvals and sends must act on the current text.
    staleTime: 0,
  });
  const faviconsQuery = useQuery({
    queryKey: outreachFaviconsKey(projectId),
    queryFn: () => getOutreachFavicons({ data: { projectId } }),
    staleTime: 10 * 60_000,
  });
  const favicons = faviconsQuery.data ?? {};

  if (snapshotQuery.isPending) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading outreach…
      </div>
    );
  }
  if (snapshotQuery.isError) {
    return (
      <div className="px-4 py-6 md:px-6">
        <Alert variant="destructive">
          {getStandardErrorMessage(
            snapshotQuery.error,
            "Failed to load outreach",
          )}
        </Alert>
      </div>
    );
  }

  const data = snapshotQuery.data;
  const selected = data.prospects.find((p) => p.number === prospectNumber);
  const { limits, settings } = data;
  const replies = outreachReplyQueue(data.prospects);

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title="Outreach"
          description={
            <>
              Earned links for {settings.siteUrl || "this project"}: prospects,
              emails you approve, replies and verified links.
            </>
          }
          actions={
            <p
              className="text-sm text-muted-foreground sm:mt-1 sm:text-right"
              title={`Days and weeks in ${limits.timeZoneLabel}`}
            >
              Sent today{" "}
              <span className="font-medium text-foreground tabular-nums">
                {limits.sentToday}/{limits.dailyMax}
              </span>{" "}
              · this week{" "}
              <span className="font-medium text-foreground tabular-nums">
                {limits.sentWeek}/{limits.weeklyMax}
              </span>
            </p>
          }
        />

        <div className="overflow-x-auto pb-1.5">
          <Tabs
            value={tab}
            onValueChange={(value) => {
              const next = OUTREACH_TABS.find((item) => item.value === value);
              if (next) onTab(next.value);
            }}
          >
            <TabsList variant="line" className="w-max *:flex-none">
              {OUTREACH_TABS.map((item) => (
                <TabsTrigger key={item.value} value={item.value}>
                  {item.label}
                  {item.value === "replies" && replies.length ? (
                    <Badge size="sm">{replies.length}</Badge>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {tab === "overview" ? (
          <Overview
            projectId={projectId}
            data={data}
            favicons={favicons}
            onProspect={onProspect}
            onTab={onTab}
          />
        ) : tab === "prospects" ? (
          <ProspectsTable
            prospects={data.prospects}
            favicons={favicons}
            angles={data}
            onProspect={onProspect}
          />
        ) : tab === "scheduled" ? (
          <ScheduledTab
            projectId={projectId}
            favicons={favicons}
            onProspect={onProspect}
            onSettings={() => onTab("settings")}
          />
        ) : tab === "replies" ? (
          <Panel
            title="Replies to answer"
            meta="The agent drafts each answer; you approve it like any other email."
          >
            <ProspectList
              prospects={replies}
              favicons={favicons}
              empty="No replies waiting for an answer."
              detail={(p) => (
                <>
                  <span className="text-muted-foreground">{p.replyAt} · </span>
                  {p.replySummary}
                </>
              )}
              onProspect={onProspect}
            />
          </Panel>
        ) : tab === "links" ? (
          <Panel
            title="Links"
            meta="Links found on prospects' pages, and any that disappeared since."
          >
            <ProspectList
              prospects={[
                ...outreachLinks(data.prospects),
                ...data.prospects.filter(
                  (p) => p.linkLost && p.status !== "linked",
                ),
              ]}
              favicons={favicons}
              empty="No links yet. A link check marks a prospect linked when it finds one."
              detail={(p) => (
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <a
                    className="min-w-0 truncate text-primary underline-offset-4 hover:underline"
                    href={p.linkUrl || p.theirPage}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {p.linkUrl || p.theirPage}
                  </a>
                  {p.rel ? (
                    <Badge variant="secondary" size="sm">
                      {p.rel}
                    </Badge>
                  ) : null}
                  {p.linkLost ? (
                    <span className="text-xs text-destructive">Lost</span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    checked {p.linkCheckedAt || "never"}
                  </span>
                  {/* Fork addition: PostHog visits and signups. */}
                  <LinkTrafficInline projectId={projectId} number={p.number} />
                </span>
              )}
              onProspect={onProspect}
            />
          </Panel>
        ) : (
          <OutreachSettingsForm
            key={data.readAt}
            projectId={projectId}
            settings={settings}
          />
        )}
      </div>

      {selected ? (
        <OutreachProspectPanel
          key={selected.number}
          projectId={projectId}
          prospect={selected}
          favicon={favicons[selected.number]}
          angles={data.angles}
          limits={limits}
          settings={settings}
          onClose={() => onProspect(undefined)}
        />
      ) : null}
    </div>
  );
}

const OWNER_BUTTON: Partial<
  Record<NonNullable<OutreachProspect["attention"]>, string>
> = {
  approval: "Review",
  reapprove: "Review",
  "low-score": "Decide",
};

function Overview({
  projectId,
  data,
  favicons,
  onProspect,
  onTab,
}: {
  projectId: string;
  data: OutreachSnapshot;
  favicons: Record<number, string>;
  onProspect: (number: number) => void;
  onTab: (tab: OutreachTab) => void;
}) {
  const attention = outreachAttention(data.prospects);
  const yours = attention.filter((p) => p.action.who === "owner").length;
  const { analytics, settings } = data;
  const setupMissing = !settings.siteUrl || settings.linkDomains.length === 0;
  const rate = (value: number) =>
    analytics.contacted
      ? `${Math.round((value / analytics.contacted) * 100)}% of contacted`
      : undefined;

  return (
    <div className="space-y-4">
      {setupMissing || !settings.mailReady ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="text-foreground/80">
            {setupMissing
              ? "Set the site and link domains so link checks know what to look for."
              : `Sending from the app is off. ${settings.mailProblem ?? ""} Drafts and approvals still work.`}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start sm:self-auto"
            onClick={() => onTab("settings")}
          >
            <Settings2 data-icon="inline-start" /> Settings
          </Button>
        </div>
      ) : null}

      <ScheduleStrip projectId={projectId} onOpen={() => onTab("scheduled")} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
        <Stat label="Contacted" value={formatNumber(analytics.contacted)} />
        <Stat
          label="Replied"
          value={formatNumber(analytics.replied)}
          hint={rate(analytics.replied)}
        />
        <Stat
          label="Median reply"
          value={
            analytics.medianReplyHours === null
              ? "—"
              : analytics.medianReplyHours < 48
                ? `${Math.round(analytics.medianReplyHours)} h`
                : `${Math.round(analytics.medianReplyHours / 24)} d`
          }
        />
        <Stat
          label="Links won"
          value={formatNumber(analytics.linksWon)}
          hint={rate(analytics.linksWon)}
        />
        <Stat label="Links lost" value={formatNumber(analytics.linksLost)} />
      </div>

      <Panel
        title="Needs attention"
        meta={
          attention.length
            ? `${yours} waiting on you, ${attention.length - yours} on the agent`
            : undefined
        }
      >
        {attention.length === 0 ? (
          <EmptyState>Nothing waits on you or the agent right now.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {attention.map((p) => {
              const button = p.attention ? OWNER_BUTTON[p.attention] : null;
              return (
                <li
                  key={p.number}
                  className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-foreground/[0.03]"
                  onClick={() => onProspect(p.number)}
                >
                  <Favicon src={favicons[p.number]} domain={p.domain} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">
                      <span className="text-muted-foreground">#{p.number}</span>{" "}
                      {p.prospect}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.attention
                        ? OUTREACH_ATTENTION_LABELS[p.attention]
                        : ""}
                      {p.subject ? ` · ${p.subject}` : ""}
                    </div>
                  </div>
                  {button && p.action.who === "owner" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="shrink-0 text-primary hover:text-primary"
                      onClick={(event) => {
                        event.stopPropagation();
                        onProspect(p.number);
                      }}
                    >
                      {button}
                    </Button>
                  ) : (
                    <span className="shrink-0">
                      <ActionPill prospect={p} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[2fr_3fr]">
        <SentChart
          perDay={analytics.sentPerDay}
          perWeek={analytics.sentPerWeek}
          timeZone={analytics.timeZoneLabel}
        />
        <Results analytics={analytics} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4">
      <div className="truncate text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">
        {value}
      </div>
      {hint ? (
        <div className="truncate text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

const SENT_SERIES: ChartSeries[] = [
  {
    key: "sent",
    color: "var(--chart-1)",
    metric: {
      name: "Sent",
      integer: true,
      minTop: 4,
      format: (value) => `${value}`,
    },
  },
];

function sentTick(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function SentChart({
  perDay,
  perWeek,
  timeZone,
}: {
  perDay: Array<{ date: string; value: number }>;
  perWeek: Array<{ date: string; value: number }>;
  timeZone: string;
}) {
  const [view, setView] = useState<"day" | "week">("day");
  const data = view === "day" ? perDay : perWeek;
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const points: ChartPoint[] = data.map((item) => ({
    key: item.date,
    tick: sentTick(item.date),
    label:
      view === "day"
        ? new Date(`${item.date}T00:00:00Z`).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          })
        : `Week of ${sentTick(item.date)}`,
    values: { sent: item.value },
  }));
  return (
    <Panel
      title="Emails sent"
      meta={`${total} ${view === "day" ? "in the last 14 days" : "in the last 8 weeks"} · first emails and follow-ups · ${timeZone}`}
      actions={
        <SegmentGroup
          label="Granularity"
          items={[
            { value: "day", label: "Days" },
            { value: "week", label: "Weeks" },
          ]}
          value={view}
          onChange={setView}
        />
      }
    >
      <div className="px-2 pb-3 pt-4 sm:px-4">
        <TimeSeriesChart
          points={points}
          series={SENT_SERIES}
          kind="bar"
          height={180}
        />
      </div>
    </Panel>
  );
}

const RESULT_VIEWS = [
  { value: "angle", label: "Angle" },
  { value: "band", label: "Score band" },
  { value: "page", label: "Our page" },
] as const;

function Results({ analytics }: { analytics: OutreachSnapshot["analytics"] }) {
  const [view, setView] =
    useState<(typeof RESULT_VIEWS)[number]["value"]>("angle");
  const rows: OutreachBreakdownRow[] =
    view === "angle"
      ? analytics.byAngle
      : view === "band"
        ? analytics.byBand
        : analytics.byOurPage;
  return (
    <Panel
      title="Results"
      actions={
        <Tabs
          value={view}
          onValueChange={(value) => {
            const next = RESULT_VIEWS.find((item) => item.value === value);
            if (next) setView(next.value);
          }}
        >
          <TabsList variant="line" className="*:flex-none">
            {RESULT_VIEWS.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
    >
      {rows.length === 0 ? (
        <EmptyState>No prospects yet.</EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-full">
                {RESULT_VIEWS.find((item) => item.value === view)?.label}
              </TableHead>
              <TableHead className="px-2 text-right" title="Prospects">
                Total
              </TableHead>
              <TableHead className="px-2 text-right">Sent</TableHead>
              <TableHead className="px-2 text-right">Replied</TableHead>
              <TableHead className="px-2 text-right">Linked</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell
                  className="max-w-0 min-w-28 truncate"
                  title={row.label}
                >
                  {row.label}
                </TableCell>
                <TableCell className="px-2 text-right tabular-nums">
                  {row.prospects}
                </TableCell>
                <TableCell className="px-2 text-right tabular-nums">
                  {row.sent}
                </TableCell>
                <TableCell className="px-2 text-right tabular-nums">
                  {row.replied}
                </TableCell>
                <TableCell className="px-2 text-right tabular-nums">
                  {row.linked}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

const SORTABLE: Array<{
  key: OutreachSortKey;
  label: string;
  className?: string;
}> = [
  { key: "number", label: "#", className: "hidden w-10 sm:table-cell" },
  { key: "site", label: "Prospect" },
  { key: "theirPage", label: "Their page", className: "hidden xl:table-cell" },
  { key: "ourPage", label: "Our page", className: "hidden 2xl:table-cell" },
  { key: "angle", label: "Angle", className: "hidden lg:table-cell" },
  { key: "score", label: "Score", className: "text-right" },
  {
    key: "authority",
    label: "Auth.",
    className: "hidden text-right 2xl:table-cell",
  },
  {
    key: "traffic",
    label: "Traffic",
    className: "hidden text-right 2xl:table-cell",
  },
  { key: "status", label: "Status" },
  {
    key: "lastAction",
    label: "Last action",
    className: "hidden 2xl:table-cell",
  },
];

function ProspectsTable({
  prospects,
  favicons,
  angles,
  onProspect,
}: {
  prospects: OutreachProspect[];
  favicons: Record<number, string>;
  angles: Pick<OutreachSnapshot, "angles">;
  onProspect: (number: number) => void;
}) {
  const [filter, setFilter] = useState<OutreachFilter>("active");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{
    key: OutreachSortKey;
    direction: "asc" | "desc";
  }>({ key: "default", direction: "desc" });
  const counts = outreachFilterCounts(prospects);
  const angleLabel = new Map(
    angles.angles.map((angle) => [angle.key, angle.label]),
  );
  const rows = useMemo(
    () =>
      sortOutreachProspects(
        filterOutreachProspects(prospects, filter, query),
        sort.key,
        sort.direction,
      ),
    [prospects, filter, query, sort],
  );

  return (
    <Panel
      title={
        <Tabs
          value={filter}
          onValueChange={(value) => {
            const next = OUTREACH_FILTERS.find((item) => item.value === value);
            if (next) setFilter(next.value);
          }}
        >
          <TabsList
            variant="line"
            className="h-auto! flex-wrap justify-start *:flex-none"
          >
            {OUTREACH_FILTERS.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
                <span className="text-xs font-normal text-muted-foreground tabular-nums">
                  {counts[item.value]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
      actions={
        <InputGroup className="h-9 w-full sm:w-64">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search site, page, contact"
            aria-label="Search prospects"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
      }
    >
      {rows.length === 0 ? (
        <EmptyState>
          {prospects.length === 0
            ? "No prospects yet. Ask your agent to find some with the link-outreach skill (add_outreach_prospect)."
            : "No prospects match."}
        </EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {SORTABLE.map((column) => (
                <TableHead key={column.key} className={column.className}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-sm whitespace-nowrap outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                    onClick={() =>
                      setSort((current) => ({
                        key: column.key,
                        direction:
                          current.key === column.key &&
                          current.direction === "desc"
                            ? "asc"
                            : "desc",
                      }))
                    }
                  >
                    {column.label}
                    {sort.key === column.key ? (
                      sort.direction === "asc" ? (
                        <ArrowUp className="size-3" />
                      ) : (
                        <ArrowDown className="size-3" />
                      )
                    ) : null}
                  </button>
                </TableHead>
              ))}
              <TableHead className="hidden sm:table-cell">Next</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow
                key={p.number}
                className="cursor-pointer"
                onClick={() => onProspect(p.number)}
              >
                <TableCell className="hidden tabular-nums text-muted-foreground sm:table-cell">
                  {p.number}
                </TableCell>
                <TableCell className="max-w-44 sm:max-w-72">
                  <div className="flex items-center gap-2">
                    <Favicon src={favicons[p.number]} domain={p.domain} />
                    <span className="truncate" title={p.prospect}>
                      {p.prospect}
                    </span>
                  </div>
                </TableCell>
                <TableCell
                  className="hidden max-w-64 truncate xl:table-cell"
                  title={p.theirPage}
                >
                  {p.theirPageTitle}
                </TableCell>
                <TableCell
                  className="hidden max-w-48 truncate 2xl:table-cell"
                  title={p.ourPage}
                >
                  {p.ourPage}
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                  {p.angle ? (angleLabel.get(p.angle) ?? p.angle) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <ScorePill prospect={p} />
                </TableCell>
                <TableCell className="hidden text-right tabular-nums 2xl:table-cell">
                  {formatNumber(p.metrics?.authority)}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums 2xl:table-cell">
                  {formatNumber(p.metrics?.traffic)}
                </TableCell>
                <TableCell>
                  <StatusBadge prospect={p} />
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground 2xl:table-cell">
                  {p.lastAction
                    ? `${p.lastAction.label}, ${formatDateTime(p.lastAction.at)}`
                    : "—"}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <ActionPill prospect={p} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

function ProspectList({
  prospects,
  favicons,
  empty,
  detail,
  onProspect,
}: {
  prospects: OutreachProspect[];
  favicons: Record<number, string>;
  empty: string;
  detail: (prospect: OutreachProspect) => ReactNode;
  onProspect: (number: number) => void;
}) {
  if (prospects.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className="divide-y divide-border">
      {prospects.map((p) => (
        <li
          key={p.number}
          className="flex cursor-pointer items-start gap-3 px-4 py-3 text-sm transition-colors hover:bg-foreground/[0.03]"
          onClick={() => onProspect(p.number)}
        >
          <span className="mt-0.5">
            <Favicon src={favicons[p.number]} domain={p.domain} />
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="truncate font-medium">
              <span className="font-normal text-muted-foreground">
                #{p.number}
              </span>{" "}
              {p.prospect}
            </div>
            <div className="min-w-0 break-words text-foreground/80">
              {detail(p)}
            </div>
          </div>
          <span className="shrink-0">
            <StatusBadge prospect={p} />
          </span>
        </li>
      ))}
    </ul>
  );
}
