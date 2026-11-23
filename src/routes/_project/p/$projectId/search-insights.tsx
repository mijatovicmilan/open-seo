import { createFileRoute } from "@tanstack/react-router";
import { SearchInsightsPage } from "@/client/features/gsc-history/SearchInsightsPage";

export const Route = createFileRoute("/_project/p/$projectId/search-insights")({
  component: SearchInsightsRoute,
});

function SearchInsightsRoute() {
  const { projectId } = Route.useParams();
  return <SearchInsightsPage projectId={projectId} />;
}
