import { createServerFn } from "@tanstack/react-start";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import {
  AnalyticsSourceError,
  AnalyticsSourceService,
} from "@/server/features/posthog/services/AnalyticsSourceService";
import { PosthogJoinService } from "@/server/features/posthog/services/PosthogJoinService";
import { Ga4ReportError } from "@/server/lib/ga4Errors";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  analyticsSourceProjectSchema,
  checkPosthogKeySchema,
  connectPosthogSchema,
  listPosthogEventsSchema,
  replacePosthogKeySchema,
  searchSignupsInputSchema,
  setKeyEventsSchema,
} from "@/types/schemas/analytics-source";

// Analytics source and our joins (fork feature, FORK-CHANGES.md). The
// `projectId` in each validator triggers project authorization in the
// middleware. Setup and PostHog refusals come back as data: the app's error
// path strips thrown messages, and the owner needs the reason. API keys
// arrive here only to be checked or stored; nothing returns or logs them.

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

async function asResult<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (
      error instanceof AnalyticsSourceError ||
      error instanceof Ga4ReportError
    ) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

const MANAGE: { integration: "manage"[] } = { integration: ["manage"] };

export const getAnalyticsSource = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(analyticsSourceProjectSchema)
  .handler(async ({ context }) => ({
    ...(await AnalyticsSourceService.getView(
      context.projectId,
      context.organizationId,
    )),
    canManage: hasOrgPermission(context.role, MANAGE),
  }));

export const checkPosthogKey = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(checkPosthogKeySchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, MANAGE);
    return asResult(() =>
      AnalyticsSourceService.checkKey(
        context.organizationId,
        context.projectId,
        data.key,
      ),
    );
  });

export const listPosthogEvents = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listPosthogEventsSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, MANAGE);
    return asResult(() =>
      AnalyticsSourceService.listEvents(
        context.organizationId,
        context.projectId,
        data.key,
        data.posthogProjectId,
      ),
    );
  });

export const connectPosthog = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(connectPosthogSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, MANAGE);
    return asResult(() =>
      AnalyticsSourceService.connect({
        organizationId: context.organizationId,
        projectId: context.projectId,
        key: data.key,
        posthogProjectId: data.posthogProjectId,
        keyEvents: data.keyEvents,
      }),
    );
  });

export const setPosthogKeyEvents = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(setKeyEventsSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, MANAGE);
    return asResult(() =>
      AnalyticsSourceService.setKeyEvents({
        organizationId: context.organizationId,
        projectId: context.projectId,
        keyEvents: data.keyEvents,
      }),
    );
  });

export const replacePosthogKey = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(replacePosthogKeySchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, MANAGE);
    return asResult(() =>
      AnalyticsSourceService.replaceKey({
        organizationId: context.organizationId,
        projectId: context.projectId,
        apiKey: data.apiKey,
      }),
    );
  });

export const disconnectPosthog = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(analyticsSourceProjectSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, MANAGE);
    return asResult(() =>
      AnalyticsSourceService.disconnect({
        organizationId: context.organizationId,
        projectId: context.projectId,
      }),
    );
  });

export const getSearchSignups = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(searchSignupsInputSchema)
  .handler(async ({ data, context }) =>
    asResult(() =>
      PosthogJoinService.getSearchSignups({
        ...data,
        projectId: context.projectId,
      }),
    ),
  );

export const getOutreachLinkTraffic = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(analyticsSourceProjectSchema)
  .handler(async ({ context }) =>
    asResult(() =>
      PosthogJoinService.getOutreachLinkTraffic(context.projectId),
    ),
  );
