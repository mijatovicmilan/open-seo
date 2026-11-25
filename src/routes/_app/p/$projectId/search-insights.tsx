import { pageHead } from "@/client/lib/pageHead";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  SearchInsightsPage,
  type SearchInsightsPatch,
} from "@/client/features/gsc-history/SearchInsightsPage";
import { parseMetrics } from "@/client/features/gsc-history/searchSeries";
import { searchInsightsSearchSchema } from "@/types/schemas/gsc-history";

// Search Insights (fork feature, see FORK-CHANGES.md). Period, comparison,
// granularity, metric and filters live in the URL so a view can be shared
// and survives a reload.
export const Route = createFileRoute("/_app/p/$projectId/search-insights")({
  head: () => pageHead("Search Insights"),
  validateSearch: searchInsightsSearchSchema,
  component: SearchInsightsRoute,
});

function SearchInsightsRoute() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const onChange = (patch: SearchInsightsPatch) =>
    void navigate({
      search: (current) => {
        const { metrics, ...rest } = patch;
        const next = {
          ...current,
          ...rest,
          ...(metrics ? { metrics: metrics.join(",") } : {}),
        };
        // Defaults stay out of the URL.
        return {
          ...next,
          range: next.range === "28d" ? undefined : next.range,
          compare: next.compare === "previous" ? undefined : next.compare,
          fresh: next.fresh || undefined,
          gran: next.gran === "auto" ? undefined : next.gran,
          metrics:
            next.metrics === "clicks,impressions" ? undefined : next.metrics,
          start: next.range === "custom" ? next.start : undefined,
          end: next.range === "custom" ? next.end : undefined,
          page: next.page || undefined,
          query: next.query || undefined,
          section: next.section || undefined,
          country: next.country || undefined,
          device: next.device,
        };
      },
      replace: true,
    });
  return (
    <SearchInsightsPage
      projectId={projectId}
      state={{
        range: search.range ?? "28d",
        start: search.start,
        end: search.end,
        compare: search.compare ?? "previous",
        fresh: search.fresh ?? false,
        gran: search.gran ?? "auto",
        metrics: parseMetrics(search.metrics),
        page: search.page,
        query: search.query,
        section: search.section,
        country: search.country,
        device: search.device,
      }}
      onChange={onChange}
    />
  );
}
