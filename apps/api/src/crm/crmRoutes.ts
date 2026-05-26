/**
 * @file crmRoutes.ts
 * @description REST API routes for CRM integration management.
 *
 *   GET    /api/crm/connections            -> GetCrmConnectionsQuery
 *   POST   /api/crm/:platform/connect      -> ConnectCrmUseCase
 *   POST   /api/crm/:platform/sync         -> SyncCrmContactsUseCase
 *   DELETE /api/crm/:platform/disconnect    -> DisconnectCrmUseCase
 *   GET    /api/crm/:platform/sync-logs    -> GetCrmSyncLogsQuery
 *
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { TOKENS } from "../infrastructure/container/types.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import type { ConnectCrmUseCase } from "@core/application/crm/ConnectCrmUseCase.js";
import type { DisconnectCrmUseCase } from "@core/application/crm/DisconnectCrmUseCase.js";
import type { GetCrmConnectionsQuery } from "@core/application/crm/GetCrmConnectionsQuery.js";
import type { SyncCrmContactsUseCase } from "@core/application/crm/SyncCrmContactsUseCase.js";
import type { GetCrmSyncLogsQuery } from "@core/application/crm/GetCrmSyncLogsQuery.js";
import { env } from "../config/env.js";

// ============================================================================
// Schemas
// ============================================================================

const PlatformParamSchema = z.object({
  platform: z.enum(["HUBSPOT", "SALESFORCE"]),
});

const ConnectBodySchema = z.object({
  accessToken: z.string().min(1, "accessToken is required"),
  refreshToken: z.string().optional(),
  tokenExpiresAt: z.string().datetime().optional(),
  portalId: z.string().optional(),
  instanceUrl: z.string().url().optional(),
  sandboxMode: z.boolean().optional(),
});

// ============================================================================
// Handler
// ============================================================================

class CrmRouteHandler extends BaseRouteHandler {
  protected routeName = "crm";

  constructor(
    private readonly connectUseCase: ConnectCrmUseCase,
    private readonly disconnectUseCase: DisconnectCrmUseCase,
    private readonly getConnectionsQuery: GetCrmConnectionsQuery,
    private readonly syncContactsUseCase: SyncCrmContactsUseCase,
    private readonly getSyncLogsQuery: GetCrmSyncLogsQuery
  ) {
    super();
  }

  async listConnections(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = (request as FastifyRequest & { accountId?: string }).accountId;
    if (!accountId) {
      return this.sendError(ctx, 401, "Unauthorized");
    }

    const result = await this.getConnectionsQuery.execute({ accountId });
    if (!result.ok) {
      return this.sendError(ctx, 400, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  async connect(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = (request as FastifyRequest & { accountId?: string }).accountId;
    if (!accountId) {
      return this.sendError(ctx, 401, "Unauthorized");
    }

    const paramsValidation = await this.validateParams(ctx, PlatformParamSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid platform");
    }

    const bodyValidation = await this.validateBody(ctx, ConnectBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = bodyValidation.value;
    const result = await this.connectUseCase.execute({
      accountId,
      platform: paramsValidation.value.platform,
      accessToken: body.accessToken,
      ...(body.refreshToken !== undefined && { refreshToken: body.refreshToken }),
      ...(body.tokenExpiresAt !== undefined && {
        tokenExpiresAt: new Date(body.tokenExpiresAt),
      }),
      ...(body.portalId !== undefined && { portalId: body.portalId }),
      ...(body.instanceUrl !== undefined && { instanceUrl: body.instanceUrl }),
      ...(body.sandboxMode !== undefined && { sandboxMode: body.sandboxMode }),
    });
    if (!result.ok) {
      return this.sendError(ctx, 400, result.error.message);
    }

    this.sendSuccess(ctx, result.value, 201);
  }

  async triggerSync(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = (request as FastifyRequest & { accountId?: string }).accountId;
    if (!accountId) {
      return this.sendError(ctx, 401, "Unauthorized");
    }

    const paramsValidation = await this.validateParams(ctx, PlatformParamSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid platform");
    }

    // Note: In production, the adapter would be resolved via DI based on platform.
    // For now, sync requires an adapter to be injected — the route returns a placeholder.
    return this.sendError(
      ctx,
      501,
      "CRM adapter not configured. Provide adapter via DI when platform adapters are implemented."
    );
  }

  async disconnect(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = (request as FastifyRequest & { accountId?: string }).accountId;
    if (!accountId) {
      return this.sendError(ctx, 401, "Unauthorized");
    }

    const paramsValidation = await this.validateParams(ctx, PlatformParamSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid platform");
    }

    const result = await this.disconnectUseCase.execute({
      accountId,
      platform: paramsValidation.value.platform,
    });
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 400;
      return this.sendError(ctx, status, result.error.message);
    }

    this.sendSuccess(ctx, { disconnected: true });
  }

  async syncLogs(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = (request as FastifyRequest & { accountId?: string }).accountId;
    if (!accountId) {
      return this.sendError(ctx, 401, "Unauthorized");
    }

    const paramsValidation = await this.validateParams(ctx, PlatformParamSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid platform");
    }

    const result = await this.getSyncLogsQuery.execute({
      accountId,
      platform: paramsValidation.value.platform,
    });
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 400;
      return this.sendError(ctx, status, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }
}

// ============================================================================
// Plugin
// ============================================================================

export const crmRoutes: FastifyPluginAsync = async (app) => {
  const handler = new CrmRouteHandler(
    app.container.resolve<ConnectCrmUseCase>(TOKENS.ConnectCrmUseCase),
    app.container.resolve<DisconnectCrmUseCase>(TOKENS.DisconnectCrmUseCase),
    app.container.resolve<GetCrmConnectionsQuery>(TOKENS.GetCrmConnectionsQuery),
    app.container.resolve<SyncCrmContactsUseCase>(TOKENS.SyncCrmContactsUseCase),
    app.container.resolve<GetCrmSyncLogsQuery>(TOKENS.GetCrmSyncLogsQuery)
  );

  app.get(
    "/crm/connections",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["CRM"], summary: "List CRM connections for account" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.listConnections(request, reply)
  );

  app.post(
    "/crm/:platform/connect",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["CRM"], summary: "Connect a CRM platform" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.connect(request, reply)
  );

  app.post(
    "/crm/:platform/sync",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["CRM"], summary: "Trigger CRM contact sync" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.triggerSync(request, reply)
  );

  app.delete(
    "/crm/:platform/disconnect",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["CRM"], summary: "Disconnect a CRM platform" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.disconnect(request, reply)
  );

  app.get(
    "/crm/:platform/sync-logs",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["CRM"], summary: "Get CRM sync logs for platform" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.syncLogs(request, reply)
  );

  // ── HubSpot OAuth Flow ──────────────────────────────────────────────
  app.get(
    "/crm/hubspot/authorize",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["CRM"], summary: "Get HubSpot OAuth authorization URL" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const clientId = env.HUBSPOT_CLIENT_ID ?? "";
      const redirectUri = env.HUBSPOT_REDIRECT_URI ?? "";
      const state = crypto.randomUUID();
      const scopes = "crm.objects.contacts.read crm.objects.contacts.write timeline";
      const url =
        `https://app.hubspot.com/oauth/authorize?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&state=${encodeURIComponent(state)}`;
      reply.send({ ok: true, value: { authorizationUrl: url, state } });
    }
  );

  // ── Salesforce OAuth Flow ───────────────────────────────────────────
  app.get(
    "/crm/salesforce/authorize",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["CRM"], summary: "Get Salesforce OAuth authorization URL" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const clientId = env.SALESFORCE_CLIENT_ID ?? "";
      const redirectUri = env.SALESFORCE_REDIRECT_URI ?? "";
      const sandbox = env.SALESFORCE_SANDBOX ?? false;
      const loginUrl = sandbox ? "https://test.salesforce.com" : "https://login.salesforce.com";
      const state = crypto.randomUUID();
      const url =
        `${loginUrl}/services/oauth2/authorize?` +
        `response_type=code` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&state=${encodeURIComponent(state)}` +
        `&scope=api+refresh_token`;
      reply.send({ ok: true, value: { authorizationUrl: url, state } });
    }
  );
};
