import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  SearchInsightsPage,
  type SearchInsightsPatch,
} from "@/client/features/gsc-history/SearchInsightsPage";
import { searchInsightsSearchSchema } from "@/types/schemas/gsc-history";

// Search Insights (fork feature, see FORK-CHANGES.md). Period, comparison,
// granularity, metric and filters live in the URL so a view can be shared
// and survives a reload.
export const Route = createFileRoute("/_project/p/$projectId/search-insights")({
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
        const next = { ...current, ...patch };
        // Defaults stay out of the URL.
        return {
          ...next,
          range: next.range === "28d" ? undefined : next.range,
          compare: next.compare === "previous" ? undefined : next.compare,
          gran: next.gran === "auto" ? undefined : next.gran,
          metric: next.metric === "clicks" ? undefined : next.metric,
          start: next.range === "custom" ? next.start : undefined,
          end: next.range === "custom" ? next.end : undefined,
          page: next.page || undefined,
          query: next.query || undefined,
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
        gran: search.gran ?? "auto",
        metric: search.metric ?? "clicks",
        page: search.page,
        query: search.query,
      }}
      onChange={onChange}
    />
  );
}
