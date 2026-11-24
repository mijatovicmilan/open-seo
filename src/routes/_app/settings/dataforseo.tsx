import { createFileRoute } from "@tanstack/react-router";
import { DataforseoUsagePage } from "@/client/features/dataforseo-usage/DataforseoUsagePage";
import { pageHead } from "@/client/lib/pageHead";

// Fork addition (FORK-CHANGES.md): DataForSEO spend for self-hosted installs.
export const Route = createFileRoute("/_app/settings/dataforseo")({
  head: () => pageHead("DataForSEO usage"),
  component: DataforseoUsagePage,
});
