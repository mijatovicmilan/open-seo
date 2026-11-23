import { and, eq, min, or } from "drizzle-orm";
import { db } from "@/db";
import { outreachEvents, outreachProspects } from "@/db/schema";
import { runHogql } from "@/server/lib/posthogClient";
import { GscHistoryRepository } from "@/server/features/gsc-history/repositories/GscHistoryRepository";
import { shiftGa4Date } from "@/server/features/ga4/services/Ga4Dates";
import { getActivePosthogSource, type PosthogSource } from "./posthogSource";
import { mapPosthogError } from "./PosthogReportingService";
import {
  buildGoogleDailyQuery,
  buildGooglePagesQuery,
  buildReferralQuery,
  ratio,
} from "./posthogQueries";

// Fork addition (FORK-CHANGES.md): our joins across sources.
// 1. Search Console page → visits from Google (PostHog) → signups.
// 2. Outreach link → visits from the linking site → signups.
// A signup is a visit (session) with at least one of the project's key
// events. Search Console days are Pacific; PostHog days are in the PostHog
// project's zone, so a day can shift by a few hours between the two.

type Range = { start: string; end: string };
export type JoinMetrics = {
  visits: number;
  signups: number;
  keyEvents: number;
};

const GSC_PAGE_LIMIT = 1_000;
/** How far back outreach link traffic is read. */
const LINK_LOOKBACK_DAYS = 365;

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const emptyMetrics = (): JoinMetrics => ({
  visits: 0,
  signups: 0,
  keyEvents: 0,
});

function addMetrics(sum: JoinMetrics, row: JoinMetrics) {
  sum.visits += row.visits;
  sum.signups += row.signups;
  sum.keyEvents += row.keyEvents;
}

/** "www.Example.com" → "example.com". */
export function bareHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^www\./u, "");
}

/** "/guides/x/" → "/guides/x"; "/" stays. */
export function barePath(path: string): string {
  const clean = path.split(/[?#]/u)[0] || "/";
  return clean.length > 1 ? clean.replace(/\/+$/u, "") || "/" : clean;
}

/** A page URL's host and path in the form both sources are matched on. */
export function pageParts(url: string): { host: string; path: string } | null {
  try {
    const parsed = new URL(url.includes("://") ? url : `https://${url}`);
    return { host: bareHost(parsed.hostname), path: barePath(parsed.pathname) };
  } catch {
    return null;
  }
}

const pageKey = (parts: { host: string; path: string }) =>
  `${parts.host}${parts.path}`;

async function hogql(
  source: PosthogSource,
  spec: { query: string; values: Record<string, unknown> },
) {
  try {
    return await runHogql({
      credential: source.credential,
      projectId: source.posthogProjectId,
      query: spec.query,
      values: spec.values,
    });
  } catch (error) {
    mapPosthogError(error, source.posthogProjectId);
  }
}

function metricsOf(row: unknown[], from: number): JoinMetrics {
  return {
    visits: num(row[from]),
    signups: num(row[from + 1]),
    keyEvents: num(row[from + 2]),
  };
}

const sourceInfo = (source: PosthogSource) => ({
  provider: "posthog" as const,
  posthogProjectId: source.posthogProjectId,
  timeZone: source.timeZone,
  keyEvents: source.keyEvents,
});

export type SearchSignupsInput = {
  projectId: string;
  current: Range;
  previous?: Range | null;
  /** Days the chart draws (may run past `current` into fresh days). */
  chart?: Range;
  page?: string;
  query?: string;
  country?: string;
  device?: "desktop" | "mobile" | "tablet";
};

/** Search Console pages joined with Google visits and signups, plus the
 *  daily Google visits and signups for the chart and the period totals. */
async function getSearchSignups(input: SearchSignupsInput) {
  const source = await getActivePosthogSource(input.projectId);
  if (!source) return { available: false as const };
  // PostHog visits know their landing page and device, not the query or
  // (in Search Console's country codes) the country.
  const unsupportedFilter = input.query
    ? ("query" as const)
    : input.country
      ? ("country" as const)
      : null;
  const page = input.page ? pageParts(input.page) : null;
  const ranges = [input.current, input.previous, input.chart].filter(
    (range): range is Range => Boolean(range),
  );
  const loadStart = ranges.map((range) => range.start).sort()[0];
  const loadEnd = ranges
    .map((range) => range.end)
    .sort()
    .at(-1);
  const keyEvents = source.keyEvents;

  const [daily, pages, gscPages] = await Promise.all([
    unsupportedFilter || !loadStart || !loadEnd
      ? null
      : hogql(
          source,
          buildGoogleDailyQuery({
            startDate: loadStart,
            endDate: loadEnd,
            keyEvents,
            page: page ?? undefined,
            device: input.device,
          }),
        ),
    unsupportedFilter
      ? null
      : hogql(
          source,
          buildGooglePagesQuery({
            startDate: input.current.start,
            endDate: input.current.end,
            keyEvents,
            device: input.device,
          }),
        ),
    unsupportedFilter
      ? null
      : GscHistoryRepository.aggregatePages(
          input.projectId,
          input.current,
          GSC_PAGE_LIMIT,
        ),
  ]);

  const days = (daily?.rows ?? []).map((row) => ({
    date: String(row[0]),
    ...metricsOf(row, 1),
  }));
  const sumRange = (range: Range | null | undefined) => {
    if (!range || !daily) return null;
    const sum = emptyMetrics();
    for (const day of days) {
      if (day.date >= range.start && day.date <= range.end)
        addMetrics(sum, day);
    }
    return sum;
  };

  type PageRow = {
    page: string;
    clicks: number;
    impressions: number;
    position: number | null;
  } & JoinMetrics;
  const byKey = new Map<string, PageRow>();
  for (const row of gscPages ?? []) {
    const parts = pageParts(row.page);
    if (!parts) continue;
    byKey.set(pageKey(parts), {
      page: row.page,
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.impressions > 0 ? row.position : null,
      ...emptyMetrics(),
    });
  }
  for (const row of pages?.rows ?? []) {
    const parts = { host: String(row[0]), path: String(row[1]) };
    const key = pageKey(parts);
    const existing = byKey.get(key);
    const metrics = metricsOf(row, 2);
    if (existing) {
      addMetrics(existing, metrics);
    } else {
      byKey.set(key, {
        page: `https://${parts.host}${parts.path}`,
        clicks: 0,
        impressions: 0,
        position: null,
        ...metrics,
      });
    }
  }
  const pageRows = [...byKey.entries()]
    .filter(([key]) => !page || key === pageKey(page))
    .map(([, row]) => ({
      ...row,
      // Google visits per Search Console click: well under 1 means the
      // page loses visitors before analytics loads (or blocks it).
      visitsPerClick: row.clicks > 0 ? row.visits / row.clicks : null,
      signupRate: row.visits > 0 ? ratio(row.signups, row.visits) : null,
    }))
    .filter((row) => row.clicks > 0 || row.visits > 0)
    .sort(
      (a, b) =>
        b.clicks - a.clicks ||
        b.visits - a.visits ||
        a.page.localeCompare(b.page),
    );

  return {
    available: true as const,
    source: sourceInfo(source),
    unsupportedFilter,
    days,
    totals: sumRange(input.current),
    prevTotals: sumRange(input.previous),
    pages: pageRows,
  };
}

export type SearchSignups = Awaited<ReturnType<typeof getSearchSignups>>;

/** Prospects with a link to us: linked now, or a link was found once. */
async function listOutreachLinks(projectId: string) {
  return db
    .select({
      number: outreachProspects.number,
      site: outreachProspects.site,
      theirPage: outreachProspects.theirPage,
      status: outreachProspects.status,
      updatedAt: outreachProspects.updatedAt,
      linkFoundAt: min(outreachEvents.at),
    })
    .from(outreachProspects)
    .leftJoin(
      outreachEvents,
      and(
        eq(outreachEvents.prospectId, outreachProspects.id),
        eq(outreachEvents.projectId, projectId),
        eq(outreachEvents.type, "link found"),
      ),
    )
    .where(
      and(
        eq(outreachProspects.projectId, projectId),
        or(
          eq(outreachProspects.status, "linked"),
          eq(outreachEvents.type, "link found"),
        ),
      ),
    )
    .groupBy(
      outreachProspects.id,
      outreachProspects.number,
      outreachProspects.site,
      outreachProspects.theirPage,
      outreachProspects.status,
      outreachProspects.updatedAt,
    );
}

type ReferralRow = JoinMetrics & {
  domain: string;
  date: string;
  referrer: string;
};

/** Traffic one link brought: visits from the linking site on or after the
 *  day the link was found (or the prospect was marked linked). */
export function linkTraffic(
  link: { theirPage: string; since: string },
  rows: ReferralRow[],
) {
  const parts = pageParts(link.theirPage);
  const total = emptyMetrics();
  const fromPage = emptyMetrics();
  let lastVisitAt: string | null = null;
  if (!parts) return { ...total, fromPage, lastVisitAt };
  for (const row of rows) {
    if (row.domain !== parts.host || row.date < link.since) continue;
    addMetrics(total, row);
    const referrer = pageParts(row.referrer);
    // Sites that send only their origin as referrer leave this at zero.
    if (referrer && pageKey(referrer) === pageKey(parts)) {
      addMetrics(fromPage, row);
    }
    if (!lastVisitAt || row.date > lastVisitAt) lastVisitAt = row.date;
  }
  return { ...total, fromPage, lastVisitAt };
}

/** Visits and signups each earned link brought, newest link first. */
async function getOutreachLinkTraffic(projectId: string, now = new Date()) {
  const source = await getActivePosthogSource(projectId);
  if (!source) return { available: false as const };
  const today = now.toISOString().slice(0, 10);
  const earliest = shiftGa4Date(today, -LINK_LOOKBACK_DAYS);
  const links = (await listOutreachLinks(projectId)).map((link) => {
    const found = (link.linkFoundAt ?? link.updatedAt).slice(0, 10);
    return { ...link, since: found < earliest ? earliest : found };
  });
  const domains = [
    ...new Set(
      links
        .map((link) => pageParts(link.theirPage)?.host)
        .filter((host): host is string => Boolean(host)),
    ),
  ];
  const since = links.map((link) => link.since).sort()[0];
  const result =
    domains.length > 0 && since
      ? await hogql(
          source,
          buildReferralQuery({
            startDate: since,
            endDate: today,
            keyEvents: source.keyEvents,
            domains,
          }),
        )
      : null;
  const rows: ReferralRow[] = (result?.rows ?? []).map((row) => ({
    domain: String(row[0]),
    date: String(row[1]),
    referrer: String(row[2] ?? ""),
    ...metricsOf(row, 3),
  }));
  return {
    available: true as const,
    source: sourceInfo(source),
    links: links
      .map((link) => ({
        number: link.number,
        site: link.site,
        theirPage: link.theirPage,
        status: link.status,
        linkFoundAt: link.linkFoundAt?.slice(0, 10) ?? null,
        since: link.since,
        ...linkTraffic(link, rows),
      }))
      .sort((a, b) => b.since.localeCompare(a.since) || a.number - b.number),
  };
}

export type OutreachLinkTraffic = Awaited<
  ReturnType<typeof getOutreachLinkTraffic>
>;

export const PosthogJoinService = {
  getSearchSignups,
  getOutreachLinkTraffic,
};
