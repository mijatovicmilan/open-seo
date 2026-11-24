import { afterAll, expect, it, vi } from "vitest";
import { KeywordPositionsService } from "./KeywordPositionsService";

// Real SQL: the position is an impression-weighted average across pages.
const state = await vi.hoisted(async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const client = createClient({ url: "file::memory:" });
  await client.executeMultiple(`
    CREATE TABLE gsc_daily_totals (project_id TEXT, date TEXT, clicks INTEGER,
      impressions INTEGER, position REAL, synced_at TEXT, segments_synced_at TEXT);
    CREATE TABLE gsc_daily_query_pages (project_id TEXT, date TEXT, query TEXT,
      page TEXT, clicks INTEGER, impressions INTEGER, position REAL);
  `);
  return { client, db: drizzle(client) };
});
vi.mock("@/db", () => ({ db: state.db }));
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
afterAll(() => state.client.close());

it("weights the position by impressions over the last 28 settled days and compares the 28 before", async () => {
  // Today is Nov 24, so the settled 28 days are Oct 25 – Nov 21.
  await state.client.executeMultiple(`
    INSERT INTO gsc_daily_totals VALUES ('p', '2026-11-23', 0, 0, 0, '', NULL);
    INSERT INTO gsc_daily_query_pages VALUES
      ('p', '2026-11-20', 'baby age calculator', '/a', 2, 30, 4),
      ('p', '2026-11-01', 'baby age calculator', '/b', 0, 10, 12),
      ('p', '2026-11-23', 'baby age calculator', '/a', 9, 90, 1),
      ('p', '2026-10-10', 'baby age calculator', '/a', 0, 20, 15),
      ('p', '2026-11-10', 'other query', '/a', 1, 5, 3),
      ('q', '2026-11-10', 'baby age calculator', '/a', 5, 50, 1);
  `);

  const result = await KeywordPositionsService.getPositions(
    "p",
    ["Baby  Age Calculator", "never shown"],
    new Date("2026-11-24T12:00:00Z"),
  );

  expect(result).toEqual({
    start: "2026-10-25",
    end: "2026-11-21",
    rows: [
      {
        keyword: "Baby  Age Calculator",
        clicks: 2,
        impressions: 40,
        position: 6,
        previousPosition: 15,
      },
    ],
  });
});
