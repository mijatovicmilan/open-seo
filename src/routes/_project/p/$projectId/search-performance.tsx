import { createFileRoute, redirect } from "@tanstack/react-router";
import { SearchPerformancePage } from "@/client/features/search-performance/SearchPerformancePage";

export const Route = createFileRoute(
  "/_project/p/$projectId/search-performance",
)({
  // Fork addition (FORK-CHANGES.md): Search Insights replaces this page.
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/p/$projectId/search-insights",
      params: { projectId: params.projectId },
    });
  },
  component: SearchPerformanceRoute,
});

function SearchPerformanceRoute() {
  const { projectId } = Route.useParams();
  return <SearchPerformancePage projectId={projectId} />;
}
