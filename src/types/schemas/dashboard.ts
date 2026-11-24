import { z } from "zod";

export const dashboardProjectInputSchema = z.object({
  projectId: z.string().min(1),
});

export const dashboardSetupStepSchema = z.enum([
  "competitor",
  "keywords",
  "audit",
  "mcp",
  "skills",
  "team",
  "project",
]);
export type DashboardSetupStep = z.infer<typeof dashboardSetupStepSchema>;
// Steps that complete when the workspace first runs that research, from the
// app or an agent.
export type DashboardResearchStep = Extract<
  DashboardSetupStep,
  "competitor" | "keywords"
>;
export const dashboardStepDismissalSchema = dashboardProjectInputSchema.extend({
  step: dashboardSetupStepSchema,
  dismissed: z.boolean(),
});

export const dashboardSiteTabSchema = z.enum([
  "overview",
  "keywords",
  "backlinks",
]);
export const dashboardSearchSchema = z.object({
  tab: dashboardSiteTabSchema.optional().catch(undefined),
});
// Fork addition (FORK-CHANGES.md): `load` is a click on "Load" while
// automatic DataForSEO calls are off.
export const dashboardBacklinksInputSchema = dashboardProjectInputSchema.extend(
  {
    kind: z.enum(["new", "lost", "all"]).default("new"),
    load: z.boolean().optional(),
  },
);
export const dashboardLinkActivityInputSchema =
  dashboardProjectInputSchema.extend({ load: z.boolean().optional() });
