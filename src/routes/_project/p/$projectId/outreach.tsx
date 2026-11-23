import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { OutreachPage } from "@/client/features/outreach/OutreachPage";
import { OUTREACH_TAB_VALUES } from "@/shared/outreach";

// Link outreach (fork feature, see FORK-CHANGES.md).
const searchSchema = z.object({
  tab: z.enum(OUTREACH_TAB_VALUES).optional(),
  prospect: z.number().int().positive().optional(),
});

export const Route = createFileRoute("/_project/p/$projectId/outreach")({
  validateSearch: searchSchema,
  component: OutreachRoute,
});

function OutreachRoute() {
  const { projectId } = Route.useParams();
  const { tab = "overview", prospect } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <OutreachPage
      projectId={projectId}
      tab={tab}
      prospectNumber={prospect}
      onTab={(next) =>
        void navigate({
          search: (current) => ({
            ...current,
            tab: next === "overview" ? undefined : next,
          }),
        })
      }
      onProspect={(number) =>
        void navigate({
          search: (current) => ({ ...current, prospect: number }),
        })
      }
    />
  );
}
