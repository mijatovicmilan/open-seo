/* eslint-disable max-lines -- the outreach screen and its tabs (fork feature) */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Settings2 } from "lucide-react";
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
      <div className="flex justify-center py-16">
        <span className="loading loading-spinner loading-md" />
      </div>
    );
  }
  if (snapshotQuery.isError) {
    return (
      <div className="px-4 py-6 md:px-6">
        <div className="alert alert-error text-sm">
          {getStandardErrorMessage(
            snapshotQuery.error,
            "Failed to load outreach",
          )}
        </div>
      </div>
    );
  }

  const data = snapshotQuery.data;
  const selected = data.prospects.find((p) => p.number === prospectNumber);
  const { limits, settings } = data;

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Outreach</h1>
            <p className="text-sm text-base-content/70">
              Earned links for {settings.siteUrl || "this project"}: prospects,
              emails you approve, replies and verified links.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span
              className="badge badge-ghost gap-1 tabular-nums"
              title={limits.timeZoneLabel}
            >
              Today {limits.sentToday}/{limits.dailyMax}
            </span>
            <span
              className="badge badge-ghost gap-1 tabular-nums"
              title={`Week from ${limits.weekStart}`}
            >
              Week {limits.sentWeek}/{limits.weeklyMax}
            </span>
            <span className="text-base-content/60">{limits.timeZoneLabel}</span>
          </div>
        </div>

        <div role="tablist" className="tabs tabs-border">
          {OUTREACH_TABS.map((item) => (
            <button
              key={item.value}
              role="tab"
              className={`tab ${tab === item.value ? "tab-active" : ""}`}
              onClick={() => onTab(item.value)}
            >
              {item.label}
              {item.value === "replies" &&
              outreachReplyQueue(data.prospects).length ? (
                <span className="badge badge-xs badge-info ml-1.5">
                  {outreachReplyQueue(data.prospects).length}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {tab === "overview" ? (
          <Overview
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
        ) : tab === "replies" ? (
          <ProspectList
            prospects={outreachReplyQueue(data.prospects)}
            favicons={favicons}
            empty="No replies waiting for an answer."
            detail={(p) => (
              <>
                <span className="text-base-content/60">{p.replyAt}: </span>
                {p.replySummary}
              </>
            )}
            onProspect={onProspect}
          />
        ) : tab === "links" ? (
          <ProspectList
            prospects={[
              ...outreachLinks(data.prospects),
              ...data.prospects.filter(
                (p) => p.linkLost && p.status !== "linked",
              ),
            ]}
            favicons={favicons}
            empty="No links yet."
            detail={(p) => (
              <>
                <a
                  className="link break-all"
                  href={p.linkUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {p.linkUrl || p.theirPage}
                </a>
                {p.rel ? (
                  <span className="badge badge-sm ml-2">{p.rel}</span>
                ) : null}
                {p.linkLost ? (
                  <span className="badge badge-sm badge-error ml-2">Lost</span>
                ) : null}
                <span className="ml-2 text-base-content/60">
                  checked {p.linkCheckedAt || "never"}
                </span>
              </>
            )}
            onProspect={onProspect}
          />
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

function Overview({
  data,
  favicons,
  onProspect,
  onTab,
}: {
  data: OutreachSnapshot;
  favicons: Record<number, string>;
  onProspect: (number: number) => void;
  onTab: (tab: OutreachTab) => void;
}) {
  const attention = outreachAttention(data.prospects);
  const { analytics, settings } = data;
  const setupMissing = !settings.siteUrl || settings.linkDomains.length === 0;
  const replyRate = analytics.contacted
    ? Math.round((analytics.replied / analytics.contacted) * 100)
    : null;
  const linkRate = analytics.contacted
    ? Math.round((analytics.linksWon / analytics.contacted) * 100)
    : null;
  const maxDay = Math.max(1, ...analytics.sentPerDay.map((d) => d.value));

  return (
    <div className="space-y-6">
      {setupMissing || !settings.mailReady ? (
        <div className="alert alert-info flex flex-wrap justify-between py-2 text-sm">
          <span>
            {setupMissing
              ? "Set the site and link domains so link checks know what to look for."
              : `Sending from the app is off: ${settings.mailProblem}`}
          </span>
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => onTab("settings")}
          >
            <Settings2 className="size-3" /> Settings
          </button>
        </div>
      ) : null}

      <section className="space-y-2">
        <h2 className="font-semibold">Needs you</h2>
        {attention.length === 0 ? (
          <p className="rounded-box border border-base-300 p-4 text-sm text-base-content/70">
            Nothing waits on you right now.
          </p>
        ) : (
          <ul className="divide-y divide-base-300 rounded-box border border-base-300">
            {attention.map((p) => (
              <li key={p.number}>
                <button
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-base-200"
                  onClick={() => onProspect(p.number)}
                >
                  <Favicon src={favicons[p.number]} domain={p.domain} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-base-content/50">#{p.number}</span>{" "}
                    {p.prospect}
                    <span className="ml-2 text-base-content/60">
                      {p.subject}
                    </span>
                  </span>
                  <span className="badge badge-sm badge-warning badge-outline hidden whitespace-nowrap sm:inline-flex">
                    {p.attention ? OUTREACH_ATTENTION_LABELS[p.attention] : ""}
                  </span>
                  <ActionPill prospect={p} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Contacted" value={formatNumber(analytics.contacted)} />
        <Stat
          label="Replied"
          value={formatNumber(analytics.replied)}
          hint={replyRate === null ? undefined : `${replyRate}% of contacted`}
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
          hint={linkRate === null ? undefined : `${linkRate}% of contacted`}
        />
        <Stat label="Links lost" value={formatNumber(analytics.linksLost)} />
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">
          Sent per day (14 days, {analytics.timeZoneLabel})
        </h2>
        <div className="flex h-24 items-end gap-1 rounded-box border border-base-300 p-3">
          {analytics.sentPerDay.map((day) => (
            <div
              key={day.date}
              className="flex flex-1 flex-col items-center gap-1"
              title={`${day.date}: ${day.value}`}
            >
              <div
                className="w-full rounded-sm bg-primary/70"
                style={{ height: `${(day.value / maxDay) * 56}px` }}
              />
              <span className="text-[10px] text-base-content/50">
                {day.date.slice(8)}
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-base-content/60">
          Reply rates for link outreach average 1 to 5 percent. Compare angles
          after 50 to 100 sends, not one batch.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Breakdown title="By angle" rows={analytics.byAngle} />
        <Breakdown title="By score band" rows={analytics.byBand} />
        <Breakdown title="By our page" rows={analytics.byOurPage} />
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
    <div className="rounded-box border border-base-300 p-3">
      <div className="text-xs uppercase tracking-wide text-base-content/60">
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-xs text-base-content/60">{hint}</div> : null}
    </div>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: OutreachBreakdownRow[];
}) {
  return (
    <section className="rounded-box border border-base-300">
      <h3 className="border-b border-base-300 px-3 py-2 text-sm font-semibold">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-sm text-base-content/60">No data yet.</p>
      ) : (
        <table className="table table-sm">
          <thead>
            <tr>
              <th />
              <th className="text-right">Prospects</th>
              <th className="text-right">Sent</th>
              <th className="text-right">Replied</th>
              <th className="text-right">Linked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="max-w-40 truncate" title={row.label}>
                  {row.label}
                </td>
                <td className="text-right tabular-nums">{row.prospects}</td>
                <td className="text-right tabular-nums">{row.sent}</td>
                <td className="text-right tabular-nums">{row.replied}</td>
                <td className="text-right tabular-nums">{row.linked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const SORTABLE: Array<{
  key: OutreachSortKey;
  label: string;
  className?: string;
}> = [
  { key: "number", label: "#" },
  { key: "site", label: "Prospect" },
  { key: "theirPage", label: "Their page" },
  { key: "ourPage", label: "Our page" },
  { key: "angle", label: "Angle" },
  { key: "score", label: "Score", className: "text-right" },
  { key: "authority", label: "Auth.", className: "text-right" },
  { key: "traffic", label: "Traffic", className: "text-right" },
  { key: "status", label: "Status" },
  { key: "lastAction", label: "Last action" },
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
  }>({
    key: "default",
    direction: "desc",
  });
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="join">
          {OUTREACH_FILTERS.map((item) => (
            <button
              key={item.value}
              className={`btn join-item btn-sm ${filter === item.value ? "btn-active" : ""}`}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
              <span className="text-base-content/60">{counts[item.value]}</span>
            </button>
          ))}
        </div>
        <input
          className="input input-sm input-bordered w-64"
          placeholder="Search site, page, contact, subject"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {rows.length === 0 ? (
        <p className="rounded-box border border-base-300 p-6 text-center text-sm text-base-content/70">
          {prospects.length === 0
            ? "No prospects yet. Ask your agent to find some with the link-outreach skill (add_outreach_prospect)."
            : "No prospects match."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-box border border-base-300">
          <table className="table table-sm">
            <thead>
              <tr>
                {SORTABLE.map((column) => (
                  <th key={column.key} className={column.className}>
                    <button
                      className="inline-flex items-center gap-1"
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
                  </th>
                ))}
                <th>Next</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.number}
                  className="cursor-pointer hover:bg-base-200"
                  onClick={() => onProspect(p.number)}
                >
                  <td className="tabular-nums text-base-content/60">
                    {p.number}
                  </td>
                  <td className="max-w-56">
                    <div className="flex items-center gap-2">
                      <Favicon src={favicons[p.number]} domain={p.domain} />
                      <span className="truncate" title={p.prospect}>
                        {p.prospect}
                      </span>
                    </div>
                  </td>
                  <td className="max-w-64 truncate" title={p.theirPage}>
                    {p.theirPageTitle}
                  </td>
                  <td className="max-w-48 truncate" title={p.ourPage}>
                    {p.ourPage}
                  </td>
                  <td className="whitespace-nowrap">
                    {p.angle ? (angleLabel.get(p.angle) ?? p.angle) : "—"}
                  </td>
                  <td className="text-right">
                    <ScorePill prospect={p} />
                  </td>
                  <td className="text-right tabular-nums">
                    {formatNumber(p.metrics?.authority)}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatNumber(p.metrics?.traffic)}
                  </td>
                  <td>
                    <StatusBadge prospect={p} />
                  </td>
                  <td className="whitespace-nowrap text-base-content/70">
                    {p.lastAction
                      ? `${p.lastAction.label}, ${formatDateTime(p.lastAction.at)}`
                      : "—"}
                  </td>
                  <td>
                    <ActionPill prospect={p} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
  detail: (prospect: OutreachProspect) => React.ReactNode;
  onProspect: (number: number) => void;
}) {
  if (prospects.length === 0) {
    return (
      <p className="rounded-box border border-base-300 p-6 text-center text-sm text-base-content/70">
        {empty}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-base-300 rounded-box border border-base-300">
      {prospects.map((p) => (
        <li key={p.number} className="flex items-start gap-3 px-4 py-3 text-sm">
          <Favicon src={favicons[p.number]} domain={p.domain} />
          <div className="min-w-0 flex-1 space-y-1">
            <button
              className="font-medium hover:underline"
              onClick={() => onProspect(p.number)}
            >
              <span className="text-base-content/50">#{p.number}</span>{" "}
              {p.prospect}
            </button>
            <div className="break-words text-base-content/80">{detail(p)}</div>
          </div>
          <StatusBadge prospect={p} />
        </li>
      ))}
    </ul>
  );
}
