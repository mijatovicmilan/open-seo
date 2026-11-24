import { sortBy } from "remeda";
import { fetchUserData } from "@/server/lib/dataforseo/appendix";
import { DataforseoCallRepository } from "../repositories/DataforseoCallRepository";
import { automaticDataforseoCallsOff } from "../automaticCalls";

// The DataForSEO usage page (fork feature, see FORK-CHANGES.md): what the
// last 30 days of calls cost, by feature and by endpoint, the latest calls,
// and the account's balance.

const WINDOW_DAYS = 30;

async function readBalance(): Promise<number | null> {
  // A free call; a missing key or a gateway that hides it just shows no balance.
  try {
    return (await fetchUserData())?.money?.balance ?? null;
  } catch (error) {
    console.warn("[dataforseo-usage] could not read the balance", error);
    return null;
  }
}

async function getUsage(organizationId: string) {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
  const [rows, recent, balanceUsd, automaticCallsOff] = await Promise.all([
    DataforseoCallRepository.summarize(organizationId, since),
    DataforseoCallRepository.listRecent(organizationId, 50),
    readBalance(),
    automaticDataforseoCallsOff(organizationId),
  ]);

  const features = new Map<string, { calls: number; costUsd: number }>();
  for (const row of rows) {
    const total = features.get(row.feature) ?? { calls: 0, costUsd: 0 };
    total.calls += row.calls;
    total.costUsd += row.costUsd;
    features.set(row.feature, total);
  }

  return {
    windowDays: WINDOW_DAYS,
    automaticCallsOff,
    balanceUsd,
    totalCostUsd: rows.reduce((sum, row) => sum + row.costUsd, 0),
    totalCalls: rows.reduce((sum, row) => sum + row.calls, 0),
    byFeature: sortBy(
      [...features].map(([feature, total]) => ({ feature, ...total })),
      [(row) => row.costUsd, "desc"],
    ),
    byEndpoint: sortBy(rows, [(row) => row.costUsd, "desc"]),
    recent,
  };
}

export const DataforseoUsageService = { getUsage };
