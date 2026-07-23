/**
 * @file providerOAuthFlow.ts
 * @description Route handler implementation for OAuth initiation, callback, connection
 *              management, and disconnection flows.
 * @layer infrastructure
 */
import { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { IdSchema } from "@packages/api-common";
import {
  BaseRouteHandler,
  type RouteContext,
  type OAuthErrorContext,
} from "../lib/route-handler/index.js";
import type { ProviderId } from "../providers/providerAdapter.interface.js";
import type { OAuthFlowStorePort } from "@ports/core";
import { oauthProviders } from "./providerOAuthConfigs.js";
import { AppError } from "../lib/errors/AppError.js";
import { buildAuthorizationUrl, consumeOAuthFlow } from "./oauth/oauthFlow.js";
import { env } from "../config/env.js";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import { Channel } from "@core/domain/entities/Channel.js";
import { ProjectId, ChannelId, AccountId } from "@core/domain/value-objects/EntityId.js";
import { Provider as DomainProvider } from "@core/domain/value-objects/Provider.js";
import { withTenantContext } from "../security/tenantContext.js";

// ===========================
// Validation Schemas
// ===========================

const ProviderIdSchema = z.enum([
  "x",
  "instagram",
  "facebook",
  "youtube",
  "tiktok",
  "linkedin",
  "pinterest",
  "snapchat",
]);

const InitiateOAuthSchema = z.object({
  params: z.object({ provider: ProviderIdSchema }),
  query: z.object({ projectId: IdSchema }),
});

const OAuthCallbackSchema = z.object({
  params: z.object({ provider: ProviderIdSchema }),
  query: z.object({
    code: z.string().min(1),
    state: z.string().min(1),
    error: z.string().optional(),
  }),
});

const GetConnectionsSchema = z.object({
  params: z.object({ projectId: IdSchema }),
});

const DisconnectProviderSchema = z.object({
  params: z.object({ connectionId: IdSchema }),
});

// ===========================
// Route Handler Implementation
// ===========================

export class ProviderOAuthHandler extends BaseRouteHandler {
  protected routeName = "provider-oauth";

  constructor(
    private readonly store: OAuthFlowStorePort,
    private readonly channelRepository: ChannelRepository,
    private readonly projectRepository: ProjectRepositoryPort
  ) {
    super();
  }

  /**
   * @method generateOAuthUrl
   * @description Builds the provider authorization URL. `state` and the PKCE
   *   verifier are persisted cross-pod via the flow store (TTL, single-use).
   *   X/Twitter additionally sends the S256 `code_challenge` (OAuth 2.1
   *   PKCE); the other providers use the same state-bound flow without a
   *   challenge on the wire.
   * @param providerId - Target provider.
   * @param accountId - Initiating account (tenant binding).
   * @param projectId - Project the resulting channel belongs to.
   * @returns The authorization URL to redirect the user to.
   */
  private async generateOAuthUrl(
    providerId: ProviderId,
    accountId: string,
    projectId: string
  ): Promise<string> {
    const provider = oauthProviders[providerId];
    if (!provider || !provider.config.clientId) {
      throw AppError.badRequest(`OAuth not configured for provider: ${providerId}`);
    }

    return buildAuthorizationUrl({
      authUrl: provider.config.authUrl,
      clientId: provider.config.clientId,
      redirectUri: provider.config.redirectUri,
      scopes: provider.config.scopes,
      providerId,
      accountId,
      projectId,
      store: this.store,
      sendChallenge: providerId === "x",
    });
  }

  /**
   * Handle OAuth callback and persist the grant on the `Channel` model.
   * The (projectId, provider, providerAccountId) tuple resolves "existing
   * Channel?" — when found we refresh credentials + display fields +
   * lifecycle stamps; when not, we create a fresh Channel via the domain
   * factory. Tokens persist via the `ChannelCredentialsCrypto` envelope
   * inside the repository — plaintext never touches `prisma.channel.upsert`
   * directly.
   *
   * Tenant-context seam: `Channel` is now tenant-guard enrolled, so the
   * whole persistence body runs inside
   * `withTenantContext({ accountId: record.accountId })` bound from the
   * consumed OAuth state. This lets the guard inject/validate `accountId` on
   * every Channel read/write. The `projectId` carried in the OAuth state is
   * attacker-influenced (see `initiateOAuth`), so before persisting we probe
   * it through the guarded `projectRepository`: a foreign or stale
   * `projectId` resolves nothing under the bound account and we throw
   * `AppError.notFound("Project")` — no Channel is created. Because
   * `handleCallback` is a browser-redirect flow, the NotFound surfaces as the
   * standard error redirect (not a JSON 404).
   */
  private async handleOAuthCallback(
    ctx: RouteContext,
    providerId: ProviderId,
    code: string,
    state: string
  ): Promise<void> {
    const record = await consumeOAuthFlow(this.store, providerId, state);

    const provider = oauthProviders[providerId];
    if (!provider) {
      throw AppError.badRequest(`OAuth provider not found: ${providerId}`);
    }

    const oauthContext: OAuthErrorContext = {
      provider: providerId,
      operation: "oauth_callback",
      accountId: record.accountId,
    };

    await withTenantContext({ accountId: record.accountId }, async () => {
      try {
        const projectIdResult = ProjectId.fromString(record.projectId);
        if (!projectIdResult.ok) {
          throw AppError.internal("Invalid projectId in OAuth state");
        }
        const projectId = projectIdResult.value;

        // Ownership probe: under the bound tenant context the guarded
        // repository filters by `accountId`, so a foreign/stale projectId
        // resolves nothing → NotFound, before any external token exchange or
        // Channel persistence. Closes the create-path IDOR (CWE-639).
        //
        // The `err` branch here is exclusively a genuine not-found:
        // `PrismaProjectRepository.findById` returns `err` ONLY for
        // `EntityNotFoundError` (row is null), while a transient DB/infra
        // failure THROWS out of `findById` and is caught by the outer
        // `catch` below → the generic OAuth error path (distinct log). So
        // mapping `!ok` → `notFound` does NOT collapse infrastructure
        // failures into a misleading NotFound; external behavior stays uniform.
        const ownedProject = await this.projectRepository.findById(projectId);
        if (!ownedProject.ok) {
          throw AppError.notFound("Project");
        }
        const accountId = AccountId.fromStringUnsafe(record.accountId);

        const authResult = await provider.validateCode(code, state, record.codeVerifier);

        const expiresAt = authResult.expiresIn
          ? new Date(Date.now() + authResult.expiresIn * 1000)
          : undefined;

        const providerVoResult = DomainProvider.fromString(providerId.toUpperCase());
        if (!providerVoResult.ok) {
          throw AppError.badRequest(`Unsupported provider: ${providerId}`);
        }
        const providerVo = providerVoResult.value;

        const credentials = {
          accessToken: authResult.accessToken,
          ...(authResult.refreshToken !== undefined && { refreshToken: authResult.refreshToken }),
          ...(expiresAt !== undefined && { expiresAt }),
        };

        const handle = authResult.accountInfo.username || authResult.accountInfo.name || "";
        const accountName = authResult.accountInfo.username || authResult.accountInfo.name;
        const profileImage = authResult.accountInfo.profileImage;
        const providerAccountId = authResult.accountInfo.id;
        const now = new Date();

        const existing = await this.channelRepository.findByProjectProviderAccount(
          projectId,
          providerVo,
          providerAccountId
        );

        let channelId: string;
        if (existing) {
          // Reconnect path: refresh credentials + display fields, transition
          // status back to CONNECTED, clear needsReauth, stamp connectedAt.
          // expiredAt is intentionally NOT cleared (audit history per canon).
          const updateResult = existing.updateCredentials(credentials);
          if (!updateResult.ok) {
            throw AppError.badRequest(updateResult.error.message);
          }
          existing.recordReconnection();
          existing.updateProfile({
            ...(accountName !== undefined && { accountName }),
            ...(profileImage !== undefined && { profileImage }),
          });
          const saveResult = await this.channelRepository.save(existing);
          if (!saveResult.ok) {
            throw AppError.internal("Failed to persist Channel reconnection");
          }
          channelId = existing.id.value;
        } else {
          // Fresh-grant path: create new Channel via domain factory.
          const createResult = Channel.create({
            projectId,
            accountId,
            provider: providerVo,
            handle,
            credentials,
            ...(accountName !== undefined && { accountName }),
            ...(profileImage !== undefined && { profileImage }),
            providerAccountId,
            connectedAt: now,
          });
          if (!createResult.ok) {
            throw AppError.badRequest(createResult.error.message);
          }
          const channel = createResult.value;
          const saveResult = await this.channelRepository.save(channel);
          if (!saveResult.ok) {
            throw AppError.internal("Failed to persist new Channel");
          }
          channelId = channel.id.value;
        }

        this.logInfo(ctx, "OAuth connection successful", {
          provider: providerId,
          accountId: record.accountId,
          channelId,
        });
      } catch (error) {
        const oauthError = this.handleOAuthError(ctx, error, oauthContext);
        throw oauthError;
      }
    });
  }

  /** Route: GET /auth/:provider - Initiate OAuth flow (requires authentication) */
  async initiateOAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      if (!request.customerUser) {
        return this.sendError(ctx, 401, "Authentication required");
      }

      const accountId = request.customerUser.accountId;

      const validated = await this.validateRequest<z.infer<typeof InitiateOAuthSchema>>(ctx, {
        params: InitiateOAuthSchema.shape.params,
        query: InitiateOAuthSchema.shape.query,
      });

      if (!validated.ok) {
        return this.sendError(ctx, 400, "Invalid request parameters");
      }

      const { provider } = validated.value.params;
      const { projectId } = validated.value.query;

      const authUrl = await this.generateOAuthUrl(provider, accountId, projectId);

      this.logInfo(ctx, "OAuth flow initiated", { provider, accountId, projectId });

      return reply.redirect(authUrl);
    } catch (error) {
      const oauthContext: OAuthErrorContext = {
        provider: (request.params as Record<string, string>).provider || "unknown",
        operation: "oauth_initiation",
      };

      const oauthError = this.handleOAuthError(ctx, error, oauthContext);

      return this.sendError(ctx, oauthError.statusCode, oauthError.error, oauthError.details);
    }
  }

  /** Route: GET /auth/callback/:provider - Handle OAuth callback */
  async handleCallback(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const frontendUrl = env.FRONTEND_URL || "http://localhost:3200";

    try {
      const validated = await this.validateRequest<z.infer<typeof OAuthCallbackSchema>>(ctx, {
        params: OAuthCallbackSchema.shape.params,
        query: OAuthCallbackSchema.shape.query,
      });

      if (!validated.ok) {
        return reply.redirect(
          `${frontendUrl}/dashboard/connections?error=${encodeURIComponent("Invalid OAuth callback parameters")}`
        );
      }

      const { provider } = validated.value.params;
      const { code, state, error } = validated.value.query;

      if (error) {
        this.logError(ctx, "OAuth provider returned error", { provider, error });
        return reply.redirect(
          `${frontendUrl}/dashboard/connections?error=${encodeURIComponent(`OAuth error: ${error}`)}`
        );
      }

      await this.handleOAuthCallback(ctx, provider, code, state);

      return reply.redirect(
        `${frontendUrl}/dashboard/connections?provider=${provider}&status=connected`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "OAuth callback failed";

      this.logError(ctx, "OAuth callback failed", { error: errorMessage });

      return reply.redirect(
        `${frontendUrl}/dashboard/connections?error=${encodeURIComponent(errorMessage)}`
      );
    }
  }

  /** Route: GET /auth/connections/:projectId - Get connection status (requires authentication) */
  async getConnections(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      if (!request.customerUser) {
        return this.sendError(ctx, 401, "Authentication required");
      }

      const accountId = request.customerUser.accountId;

      const validated = await this.validateRequest<z.infer<typeof GetConnectionsSchema>>(ctx, {
        params: GetConnectionsSchema.shape.params,
      });

      if (!validated.ok) {
        return this.sendError(ctx, 400, "Invalid parameters");
      }

      const { projectId } = validated.value.params;

      // The output shape preserves the field names the frontend expects
      // (providerId, providerName, accountName, profileImage, status,
      // connectedAt, lastUsedAt). Account scoping happens via
      // Channel.project.accountId — only return channels whose project
      // belongs to the authenticated account (enforced inside the repository).
      const projectIdVo = ProjectId.fromString(projectId);
      const accountIdVo = AccountId.fromString(accountId);
      if (!projectIdVo.ok || !accountIdVo.ok) {
        return this.sendError(ctx, 400, "Invalid parameters");
      }

      const channels = await this.channelRepository.findConnectionViewsByProjectScopedToAccount(
        projectIdVo.value,
        accountIdVo.value
      );

      const connections = channels.map((c) => ({
        id: c.id,
        providerId: c.provider,
        providerName: c.provider.charAt(0) + c.provider.slice(1).toLowerCase(),
        accountName: c.accountName ?? c.handle,
        profileImage: c.profileImage,
        status: c.expiredAt ? "EXPIRED" : c.needsReauth ? "ERROR" : "CONNECTED",
        connectedAt: c.connectedAt ?? null,
        lastUsedAt: c.lastUsedAt,
      }));

      this.logInfo(ctx, "Connections fetched", { accountId, projectId, count: connections.length });

      return this.sendSuccess(ctx, { connections }, 200);
    } catch (error) {
      return this.handleUnexpectedError(ctx, error);
    }
  }

  /** Route: DELETE /auth/connections/:connectionId - Disconnect provider (requires authentication + ownership) */
  async disconnectProvider(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      if (!request.customerUser) {
        return this.sendError(ctx, 401, "Authentication required");
      }

      const accountId = request.customerUser.accountId;

      const validated = await this.validateRequest<z.infer<typeof DisconnectProviderSchema>>(ctx, {
        params: DisconnectProviderSchema.shape.params,
      });

      if (!validated.ok) {
        return this.sendError(ctx, 400, "Invalid connection ID");
      }

      const { connectionId } = validated.value.params;

      // connectionId identifies a Channel. Ownership check climbs
      // Channel.project.accountId so tenants can only disconnect their own.
      // Soft-delete via the deletedAt column — credentials stay encrypted
      // at rest; the tenant just loses visibility / publishing access. The
      // audit trail (`expiredAt`, prior `connectedAt`) survives soft-delete.
      const channelIdVo = ChannelId.fromString(connectionId);
      if (!channelIdVo.ok) {
        return this.sendError(ctx, 404, "Connection not found");
      }

      const ownerResult = await this.channelRepository.findOwnerAccountIdByChannelId(
        channelIdVo.value
      );

      if (!ownerResult.ok) {
        return this.sendError(ctx, 404, "Connection not found");
      }

      if (ownerResult.value !== accountId) {
        this.logInfo(ctx, "Unauthorized disconnect attempt", {
          connectionId,
          connectionAccountId: ownerResult.value,
          requestAccountId: accountId,
        });
        return this.sendError(ctx, 403, "Not authorized to disconnect this connection");
      }

      const deleteResult = await this.channelRepository.delete(channelIdVo.value);
      if (!deleteResult.ok) {
        return this.sendError(ctx, 404, "Connection not found");
      }

      this.logInfo(ctx, "Provider disconnected", { connectionId, accountId });

      return this.sendSuccess(
        ctx,
        { success: true, message: "Provider disconnected successfully" },
        200
      );
    } catch (error) {
      return this.handleUnexpectedError(ctx, error);
    }
  }
}
