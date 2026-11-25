import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { SegmentGroup } from "@/client/features/charts/ChoiceMenu";
import {
  EmptyState,
  formatNumber,
  outreachQueryKey,
  Panel,
} from "@/client/features/outreach/outreachUi";
import { ActivityChart } from "@/client/features/outreach/OutreachActivityChart";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { getOutreachAnalytics } from "@/serverFunctions/outreach";
import type {
  OutreachAnalytics as Analytics,
  OutreachBreakdownRow,
} from "@/shared/outreach";

// Fork feature (FORK-CHANGES.md): what outreach brought in, on the Outreach
// page and (compact) on the dashboard.

type Days = 7 | 28 | 90;

const PERIODS: Array<{ value: `${Days}`; label: string }> = [
  { value: "7", label: "7 days" },
  { value: "28", label: "28 days" },
  { value: "90", label: "90 days" },
];

export function OutreachAnalytics({
  projectId,
  compact = false,
}: {
  projectId: string;
  /** The dashboard card: the numbers and the weekly bars, 28 days. */
  compact?: boolean;
}) {
  const [days, setDays] = useState<Days>(28);
  const query = useQuery({
    // Under the snapshot's key, so every outreach change refreshes it.
    queryKey: [...outreachQueryKey(projectId), "analytics", days],
    queryFn: () => getOutreachAnalytics({ data: { projectId, days } }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  if (query.isPending) {
    return <Skeleton className={compact ? "h-64" : "h-96"} />;
  }
  if (query.isError) {
    return (
      <p className="text-sm text-destructive">
        {getStandardErrorMessage(query.error, "Failed to load outreach")}
      </p>
    );
  }
  const analytics = query.data;

  if (compact) {
    return (
      <Panel
        title="Outreach"
        meta={`Last ${analytics.days} days vs the ${analytics.days} before`}
        actions={
          <Link
            to="/p/$projectId/outreach"
            params={{ projectId }}
            className="text-sm text-primary hover:underline"
          >
            Open outreach
          </Link>
        }
      >
        <div className="space-y-4 p-4">
          <Numbers analytics={analytics} />
          {analytics.everSent ? (
            <ActivityChart buckets={analytics.perWeek} view="week" />
          ) : (
            <NothingSent />
          )}
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Last {analytics.days} days compared with the {analytics.days} before ·{" "}
          {analytics.timeZoneLabel}
        </p>
        <SegmentGroup
          label="Period"
          items={PERIODS}
          value={`${days}`}
          onChange={(value) => setDays(Number(value) as Days)}
        />
      </div>
      <Numbers analytics={analytics} />
      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <ActivityPanel analytics={analytics} />
        <Funnel funnel={analytics.funnel} />
      </div>
      <Results analytics={analytics} />
    </div>
  );
}

function NothingSent() {
  return (
    <p className="text-sm text-muted-foreground">
      No outreach emails sent yet.
    </p>
  );
}

function rate(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function Numbers({ analytics }: { analytics: Analytics }) {
  const { current, previous, days } = analytics;
  const replyHint =
    analytics.medianReplyHours === null
      ? `${current.replies} ${current.replies === 1 ? "reply" : "replies"}`
      : `${current.replies} ${current.replies === 1 ? "reply" : "replies"} · median ${
          analytics.medianReplyHours < 48
            ? `${Math.round(analytics.medianReplyHours)} h`
            : `${Math.round(analytics.medianReplyHours / 24)} d`
        }`;
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      <Stat
        label="Emails sent"
        value={formatNumber(current.sent)}
        hint={`${current.firstEmails} first · ${current.followUps} follow-ups`}
        change={current.sent - previous.sent}
        days={days}
      />
      <Stat
        label="Reply rate"
        title={`Of the ${current.contacted} prospects first emailed in these ${days} days, the share that answered`}
        value={rate(current.replyRate)}
        hint={replyHint}
        change={
          current.replyRate !== null && previous.replyRate !== null
            ? Math.round((current.replyRate - previous.replyRate) * 100)
            : null
        }
        unit=" pts"
        days={days}
      />
      <Stat
        label="Links won"
        title="Links found on their page for the first time in these days"
        value={formatNumber(current.linksWon)}
        hint={`${analytics.funnel.linked} in total`}
        change={current.linksWon - previous.linksWon}
        days={days}
      />
      <Stat
        label="Links still live"
        title="Won links the last check still found"
        value={`${analytics.linksLive} of ${analytics.funnel.linked}`}
        hint={analytics.linksLost ? `${analytics.linksLost} lost` : "None lost"}
      />
    </div>
  );
}

function Stat({
  label,
  title,
  value,
  hint,
  change,
  unit = "",
  days,
}: {
  label: string;
  title?: string;
  value: string;
  hint: string;
  change?: number | null;
  unit?: string;
  days?: number;
}) {
  return (
    <div
      className="min-w-0 rounded-lg border border-border bg-card p-3"
      title={title}
    >
      <div className="truncate text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        {change !== undefined && change !== null && days ? (
          <span
            className={cn(
              "text-xs tabular-nums",
              change > 0
                ? "text-success"
                : change < 0
                  ? "text-destructive"
                  : "text-muted-foreground",
            )}
            title={`Compared with the ${days} days before`}
          >
            {change > 0 ? "+" : ""}
            {change}
            {unit}
          </span>
        ) : null}
      </div>
      <div className="truncate text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function ActivityPanel({ analytics }: { analytics: Analytics }) {
  const [view, setView] = useState<"day" | "week">("week");
  return (
    <Panel
      title="Sent and replies"
      meta={
        view === "day"
          ? `Last 14 days · ${analytics.timeZoneLabel}`
          : "Last 12 weeks, Monday first"
      }
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
      <div className="px-2 pt-4 pb-3 sm:px-4">
        {analytics.everSent ? (
          <ActivityChart
            buckets={view === "day" ? analytics.perDay : analytics.perWeek}
            view={view}
          />
        ) : (
          <NothingSent />
        )}
      </div>
    </Panel>
  );
}

function Funnel({ funnel }: { funnel: Analytics["funnel"] }) {
  const steps = [
    { label: "Prospects", value: funnel.prospects },
    { label: "Contacted", value: funnel.contacted },
    { label: "Replied", value: funnel.replied },
    { label: "Linked", value: funnel.linked },
  ];
  const base = Math.max(1, funnel.prospects);
  return (
    <Panel title="Funnel" meta="Every prospect, all time">
      {funnel.prospects === 0 ? (
        <EmptyState>No prospects yet.</EmptyState>
      ) : (
        <div className="space-y-2.5 p-4">
          {steps.map((step, index) => (
            <div key={step.label} className="flex items-center gap-3 text-sm">
              <span className="w-20 shrink-0 text-muted-foreground">
                {step.label}
              </span>
              <div className="h-4 min-w-0 flex-1 rounded-sm bg-muted">
                <div
                  className="h-4 rounded-sm"
                  style={{
                    width: `${Math.max(step.value ? 2 : 0, (step.value / base) * 100)}%`,
                    background: `color-mix(in oklab, var(--chart-3) ${40 + index * 20}%, transparent)`,
                  }}
                />
              </div>
              <span className="w-10 shrink-0 text-right tabular-nums">
                {formatNumber(step.value)}
              </span>
            </div>
          ))}
          <p className="pt-1 text-xs text-muted-foreground">
            Dropped {funnel.dropped} · declined {funnel.declined} · no reply{" "}
            {funnel.noReply}
          </p>
        </div>
      )}
    </Panel>
  );
}

const RESULT_VIEWS = [
  { value: "angle", label: "Angle" },
  { value: "band", label: "Score band" },
  { value: "page", label: "Our page" },
] as const;

function Results({ analytics }: { analytics: Analytics }) {
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
      title="What works"
      meta="All time, without dropped prospects. Reply rate is replies per prospect emailed."
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
              <TableHead className="px-2 text-right">Reply rate</TableHead>
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
                  {row.sent
                    ? `${Math.round((row.replied / row.sent) * 100)}%`
                    : "—"}
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
