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
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import type { ProviderId } from "../providers/providerAdapter.interface.js";
import { prisma } from "@infra/prisma";
import { randomBytes, createHash } from "crypto";
import { oauthProviders } from "./providerOAuthConfigs.js";
import { AppError } from "../lib/errors/AppError.js";
import { getRedisInstance } from "./redisSessionHelpers.js";
import { env } from "../config/env.js";
import type { ChannelRepository } from "../domain/repositories/ChannelRepository.js";
import { Channel } from "../domain/entities/Channel.js";
import { ProjectId } from "../domain/value-objects/EntityId.js";
import { Provider as DomainProvider } from "../domain/value-objects/Provider.js";

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
// OAuth State Management
// ===========================

interface OAuthStateData {
  providerId: ProviderId;
  accountId: string;
  projectId: string;
  createdAt: Date;
}

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

// ===========================
// Route Handler Implementation
// ===========================

export class ProviderOAuthHandler extends BaseRouteHandler {
  protected routeName = "provider-oauth";

  private readonly oauthStates = new Map<string, OAuthStateData>();

  constructor(
    scheduler: BackgroundTaskScheduler,
    private readonly channelRepository: ChannelRepository
  ) {
    super();
    // Clean up expired OAuth states every 10 minutes. TTL equals cadence;
    // an entry older than its TTL on the sweep is discarded.
    scheduler.register(
      "provider-oauth-state-cleanup",
      () => {
        const now = Date.now();
        for (const [state, data] of this.oauthStates.entries()) {
          if (now - data.createdAt.getTime() > OAUTH_STATE_TTL_MS) {
            this.oauthStates.delete(state);
          }
        }
      },
      OAUTH_STATE_TTL_MS
    );
  }

  /**
   * Generate OAuth authorization URL for the given provider.
   *
   * For X/Twitter, implements PKCE (Proof Key for Code Exchange) with S256 method:
   * 1. Generates a cryptographically random `code_verifier` (32 bytes, base64url-encoded)
   * 2. Derives a `code_challenge` by SHA-256 hashing the verifier and base64url-encoding the digest
   * 3. Stores the `code_verifier` in Redis with key `pkce:{state}` and 600s TTL (10 minutes)
   * 4. Sends only the `code_challenge` to the authorization server
   *
   * The verifier is stored in Redis (not in-memory) because it must survive across two
   * separate HTTP requests (authorization redirect and callback) in a stateless server
   * environment. The 10-minute TTL matches the typical OAuth authorization timeout window.
   *
   * During the callback phase, the verifier is retrieved from Redis and sent to the token
   * endpoint, where the authorization server verifies it against the original challenge.
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

    const state = randomBytes(32).toString("hex");
    this.oauthStates.set(state, {
      providerId,
      accountId,
      projectId,
      createdAt: new Date(),
    });

    const params = new URLSearchParams({
      client_id: provider.config.clientId,
      redirect_uri: provider.config.redirectUri,
      scope: provider.config.scopes.join(" "),
      state,
      response_type: "code",
    });

    if (providerId === "x") {
      const codeVerifier = randomBytes(32).toString("base64url");
      const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

      params.set("code_challenge", codeChallenge);
      params.set("code_challenge_method", "S256");

      const redis = getRedisInstance();
      if (redis) {
        await redis.setex(`pkce:${state}`, 600, codeVerifier);
      }
    }

    return `${provider.config.authUrl}?${params.toString()}`;
  }

  /**
   * Handle OAuth callback and persist the grant on the `Channel` model.
   * The (projectId, provider, providerAccountId) tuple resolves "existing
   * Channel?" — when found we refresh credentials + display fields +
   * lifecycle stamps; when not, we create a fresh Channel via the domain
   * factory. Tokens persist via the `ChannelCredentialsCrypto` envelope
   * inside the repository — plaintext never touches `prisma.channel.upsert`
   * directly.
   */
  private async handleOAuthCallback(
    ctx: RouteContext,
    providerId: ProviderId,
    code: string,
    state: string
  ): Promise<void> {
    const stateData = this.oauthStates.get(state);
    if (!stateData || stateData.providerId !== providerId) {
      throw AppError.unauthorized("OAuth state validation failed");
    }

    this.oauthStates.delete(state);

    const provider = oauthProviders[providerId];
    if (!provider) {
      throw AppError.badRequest(`OAuth provider not found: ${providerId}`);
    }

    const oauthContext: OAuthErrorContext = {
      provider: providerId,
      operation: "oauth_callback",
      accountId: stateData.accountId,
    };

    try {
      const authResult = await provider.validateCode(code, state);

      const expiresAt = authResult.expiresIn
        ? new Date(Date.now() + authResult.expiresIn * 1000)
        : undefined;

      const projectIdResult = ProjectId.fromString(stateData.projectId);
      if (!projectIdResult.ok) {
        throw AppError.internal("Invalid projectId in OAuth state");
      }
      const projectId = projectIdResult.value;

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
        accountId: stateData.accountId,
        channelId,
      });
    } catch (error) {
      const oauthError = this.handleOAuthError(ctx, error, oauthContext);
      throw oauthError;
    }
  }

  /** Route: GET /auth/:provider - Initiate OAuth flow (requires authentication) */
  async initiateOAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      if (!request.user) {
        return this.sendError(ctx, 401, "Authentication required");
      }

      const accountId = request.user.accountId ?? request.user.id;

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
      if (!request.user) {
        return this.sendError(ctx, 401, "Authentication required");
      }

      const accountId = request.user.accountId ?? request.user.id;

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
      // belongs to the authenticated account.
      const channels = await prisma.channel.findMany({
        where: {
          projectId,
          deletedAt: null,
          project: { accountId },
        },
        select: {
          id: true,
          provider: true,
          handle: true,
          accountName: true,
          profileImage: true,
          connectedAt: true,
          lastUsedAt: true,
          expiredAt: true,
          needsReauth: true,
        },
      });

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
      if (!request.user) {
        return this.sendError(ctx, 401, "Authentication required");
      }

      const accountId = request.user.accountId ?? request.user.id;

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
      const channel = await prisma.channel.findFirst({
        where: { id: connectionId, deletedAt: null },
        select: { id: true, project: { select: { accountId: true } } },
      });

      if (!channel) {
        return this.sendError(ctx, 404, "Connection not found");
      }

      if (channel.project.accountId !== accountId) {
        this.logInfo(ctx, "Unauthorized disconnect attempt", {
          connectionId,
          connectionAccountId: channel.project.accountId,
          requestAccountId: accountId,
        });
        return this.sendError(ctx, 403, "Not authorized to disconnect this connection");
      }

      await prisma.channel.update({
        where: { id: connectionId },
        data: { deletedAt: new Date() },
      });

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
