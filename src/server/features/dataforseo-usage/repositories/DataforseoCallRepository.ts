import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { dataforseoCalls, projects } from "@/db/schema";

// The DataForSEO spend log (fork feature, see FORK-CHANGES.md). Every read
// filters on organization_id.

async function insert(row: {
  organizationId: string;
  projectId: string | null;
  endpoint: string;
  feature: string;
  costUsd: number;
}) {
  await db.insert(dataforseoCalls).values({ id: crypto.randomUUID(), ...row });
}

const costSum = sql<number>`coalesce(sum(${dataforseoCalls.costUsd}), 0)`;
const callCount = sql<number>`count(*)`;

/** Calls and cost since `since` (ISO), grouped by feature, project and endpoint. */
async function summarize(organizationId: string, since: string) {
  const rows = await db
    .select({
      feature: dataforseoCalls.feature,
      endpoint: dataforseoCalls.endpoint,
      projectId: dataforseoCalls.projectId,
      projectName: projects.name,
      calls: callCount,
      costUsd: costSum,
    })
    .from(dataforseoCalls)
    .leftJoin(projects, eq(projects.id, dataforseoCalls.projectId))
    .where(
      and(
        eq(dataforseoCalls.organizationId, organizationId),
        gte(dataforseoCalls.createdAt, since),
      ),
    )
    .groupBy(
      dataforseoCalls.feature,
      dataforseoCalls.endpoint,
      dataforseoCalls.projectId,
      projects.name,
    );
  // Postgres returns sums and counts as strings.
  return rows.map((row) => ({
    ...row,
    calls: Number(row.calls),
    costUsd: Number(row.costUsd),
  }));
}

async function listRecent(organizationId: string, limit: number) {
  const rows = await db
    .select({
      id: dataforseoCalls.id,
      createdAt: dataforseoCalls.createdAt,
      feature: dataforseoCalls.feature,
      endpoint: dataforseoCalls.endpoint,
      projectName: projects.name,
      costUsd: dataforseoCalls.costUsd,
    })
    .from(dataforseoCalls)
    .leftJoin(projects, eq(projects.id, dataforseoCalls.projectId))
    .where(eq(dataforseoCalls.organizationId, organizationId))
    .orderBy(desc(dataforseoCalls.createdAt))
    .limit(limit);
  return rows.map((row) => ({ ...row, costUsd: Number(row.costUsd) }));
}

export const DataforseoCallRepository = { insert, summarize, listRecent };
