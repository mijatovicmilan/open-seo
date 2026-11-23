import type { getSearchInsights } from "@/serverFunctions/gscHistory";

type InsightsResponse = Awaited<ReturnType<typeof getSearchInsights>>;
export type Insights = NonNullable<InsightsResponse["data"]>;
export type HistoryStatus = InsightsResponse["status"];
