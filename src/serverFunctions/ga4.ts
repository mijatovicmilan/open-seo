import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { waitUntil } from "cloudflare:workers";
import { z } from "zod";
import { Ga4Service } from "@/server/features/ga4/services/Ga4Service";
import { hasGoogleOAuthConfig } from "@/server/features/google/oauth-config";
import { getGoogleAccessMode } from "@/server/features/google/googleAccess";
import { getGatewayGoogleConnectUrl } from "@/server/features/google/gatewayGoogle";
import {
  createGoogleAuthorizationUrl,
  GA4_INTEGRATION,
} from "@/server/features/google/googleOAuth";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { captureServerEvent } from "@/server/lib/posthog";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import {
  requireAuthenticatedContext,
  requireProjectContext,
} from "@/serverFunctions/middleware";

const projectScopedSchema = z.object({ projectId: z.string().min(1) });
const setPropertySchema = projectScopedSchema.extend({
  accountId: z.string().min(1),
  propertyId: z.string().regex(/^properties\/\d+$/),
});
const startLinkSchema = z.object({
  callbackURL: z.string().min(1),
});

export const getGa4Connection = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    const [connection, currentUserHasGrant, googleOAuthConfigured] =
      await Promise.all([
        Ga4Service.getConnection(context.projectId),
        Ga4Service.userHasGrant(context.userId),
        hasGoogleOAuthConfig(),
      ]);
    return {
      connected: Boolean(connection),
      canManage: hasOrgPermission(context.role, { integration: ["manage"] }),
      currentUserHasGrant,
      googleOAuthConfigured,
      propertyId: connection?.propertyId ?? null,
      propertyDisplayName: connection?.propertyDisplayName ?? null,
      propertyTimeZone: connection?.propertyTimeZone ?? null,
      propertyCurrencyCode: connection?.propertyCurrencyCode ?? null,
      connectedByEmail: connection?.connectedAccountEmail ?? null,
      connectedAt: connection?.createdAt ?? null,
    };
  });

export const listGa4Properties = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    const [propertyList, connection] = await Promise.all([
      Ga4Service.listPropertiesForUserWithGrantStatus(context.userId),
      Ga4Service.getConnection(context.projectId),
    ]);
    return {
      accounts: propertyList.accounts.map((grant) => ({
        ...grant,
        properties: grant.properties.map((property) => ({
          ...property,
          isSelected:
            connection?.ga4AccountId === grant.accountId &&
            connection.propertyId === property.propertyId,
        })),
      })),
    };
  });

export const setGa4Property = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(setPropertySchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const connection = await Ga4Service.setProperty({
      projectId: context.projectId,
      organizationId: context.organizationId,
      accountId: data.accountId,
      propertyId: data.propertyId,
      userId: context.userId,
    });
    waitUntil(
      captureServerEvent({
        distinctId: context.userId,
        event: "ga4:property_select",
        organizationId: context.organizationId,
        properties: { project_id: context.projectId },
      }),
    );
    return {
      connected: true as const,
      propertyId: connection.propertyId,
      propertyDisplayName: connection.propertyDisplayName,
      propertyTimeZone: connection.propertyTimeZone,
      propertyCurrencyCode: connection.propertyCurrencyCode,
      connectedByEmail: connection.connectedAccountEmail,
      connectedAt: connection.createdAt,
    };
  });

export const disconnectGa4 = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await Ga4Service.disconnect({ projectId: context.projectId });
    waitUntil(
      captureServerEvent({
        distinctId: context.userId,
        event: "ga4:disconnect",
        organizationId: context.organizationId,
        properties: { project_id: context.projectId },
      }),
    );
    return { connected: false as const };
  });

export const startGa4Link = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(startLinkSchema)
  .handler(async ({ data, context }) => ({
    url:
      (await getGoogleAccessMode()) === "gateway"
        ? await getGatewayGoogleConnectUrl(data.callbackURL)
        : await createGoogleAuthorizationUrl({
            integration: GA4_INTEGRATION,
            userId: context.userId,
            callbackURL: data.callbackURL,
            publicOrigin: getPublicOrigin(getRequest()),
          }),
  }));
