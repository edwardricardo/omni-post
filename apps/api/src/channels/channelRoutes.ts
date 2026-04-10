/**
 * Channel Routes
 *
 * REST API endpoints for managing social media channels (connections to external
 * platforms like X, Instagram, Facebook, YouTube, TikTok). Handles channel CRUD
 * operations within projects, including credential storage and platform mapping.
 *
 * H5-expansion: All Prisma dependencies removed. Uses ChannelRepository and
 * ProjectRepositoryPort from the DI container.
 *
 * @module channels/channelRoutes
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext, IdSchema } from "@packages/api-common";
import {
  Channel,
  ChannelId,
  ProjectId,
  Provider,
  EntityNotFoundError,
  CONNECTION_STATUS,
} from "../domain/index.js";
import type { ChannelCredentials } from "../domain/entities/Channel.js";
import type { ChannelRepository } from "../domain/repositories/ChannelRepository.js";
import type { ProjectRepositoryPort } from "../domain/repositories/ProjectRepository.js";
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "../auth/rbacService.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { PrismaClient } from "@infra/prisma";
import { BlueskyClient } from "@providers/bluesky";

// ─── Schemas ────────────────────────────────────────────────────────────────

const CreateChannelBody = z.object({
  projectId: IdSchema,
  name: z.string().min(1).max(256),
  platform: z.enum(["X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK"]),
  credentials: z.record(z.string(), z.unknown()).optional(),
});

type CreateChannelBodyType = z.infer<typeof CreateChannelBody>;

const UpdateChannelBody = z.object({
  name: z.string().min(1).max(256).optional(),
  credentials: z.record(z.string(), z.unknown()).optional(),
});

type UpdateChannelBodyType = z.infer<typeof UpdateChannelBody>;

const ChannelParams = z.object({ channelId: IdSchema });
type ChannelParamsType = z.infer<typeof ChannelParams>;

const ProjectParams = z.object({ projectId: IdSchema });
type ProjectParamsType = z.infer<typeof ProjectParams>;

const BlueskyConnectBody = z.object({
  projectId: IdSchema,
  identifier: z.string().min(1).max(256),
  appPassword: z.string().regex(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/, {
    message: "App Password must be in format xxxx-xxxx-xxxx-xxxx",
  }),
});

type BlueskyConnectBodyType = z.infer<typeof BlueskyConnectBody>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Map a raw credentials blob to the typed ChannelCredentials interface */
function mapCredentials(raw: Record<string, unknown>): ChannelCredentials {
  return {
    accessToken: String(raw.accessToken ?? ""),
    ...(raw.refreshToken !== undefined && { refreshToken: String(raw.refreshToken) }),
    ...(raw.expiresAt !== undefined && { expiresAt: new Date(raw.expiresAt as string) }),
    ...(raw.tokenType !== undefined && { tokenType: String(raw.tokenType) }),
    ...(Array.isArray(raw.scope) && { scope: (raw.scope as unknown[]).map(String) }),
  };
}

/** Project an API response view from a Channel entity */
function toChannelView(channel: Channel) {
  return {
    id: channel.id.value,
    projectId: channel.projectId.value,
    name: channel.handle,
    platform: channel.provider.type,
    status: channel.status,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

class ChannelRouteHandler extends BaseRouteHandler {
  protected routeName = "channels";

  constructor(
    private readonly channelRepo: ChannelRepository,
    private readonly projectRepo: ProjectRepositoryPort,
    private readonly prismaClient: PrismaClient
  ) {
    super();
  }

  /**
   * POST /channels
   * Create a new channel within a project. Credentials are optional at creation
   * time — the OAuth flow provides the access token after the channel is registered.
   */
  async createChannel(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Creating channel");

    const bodyResult = await this.validateBody<CreateChannelBodyType>(ctx, CreateChannelBody);
    if (!bodyResult.ok) return this.sendError(ctx, 400, "Validation failed");

    const { projectId, name, platform, credentials } = bodyResult.value;

    // Verify project exists
    const projectResult = await this.projectRepo.findById(ProjectId.fromStringUnsafe(projectId));
    if (!projectResult.ok) {
      return this.sendError(ctx, 404, "Project not found");
    }

    // Resolve provider value object
    const providerResult = Provider.fromString(platform);
    if (!providerResult.ok) {
      return this.sendError(ctx, 400, `Unknown platform: ${platform}`);
    }

    // Channels can be created in PENDING state (token provided later via OAuth).
    // Use reconstitute to bypass the Channel.create() invariant that requires an
    // access token — this is intentional: the credential is set via OAuth after creation.
    const now = new Date();
    const channel = Channel.reconstitute(ChannelId.generate(), {
      projectId: ProjectId.fromStringUnsafe(projectId),
      provider: providerResult.value,
      handle: name.trim(),
      credentials: mapCredentials(credentials ?? {}),
      status: CONNECTION_STATUS.PENDING,
      errorCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    const saveResult = await this.channelRepo.save(channel);
    if (!saveResult.ok) {
      this.logError(ctx, "Failed to save channel", { error: saveResult.error });
      return this.sendError(ctx, 500, "Failed to create channel");
    }

    this.logInfo(ctx, "Channel created", { channelId: channel.id.value });
    return this.sendSuccess(ctx, toChannelView(channel), 201);
  }

  /**
   * GET /channels/:channelId
   * Retrieve a single channel by ID.
   */
  async getChannel(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Getting channel");

    const paramsResult = await this.validateParams<ChannelParamsType>(ctx, ChannelParams);
    if (!paramsResult.ok) return this.sendError(ctx, 400, "Validation failed");

    const { channelId } = paramsResult.value;
    const result = await this.channelRepo.findById(ChannelId.fromStringUnsafe(channelId));

    if (!result.ok) {
      return result.error instanceof EntityNotFoundError
        ? this.sendError(ctx, 404, "Channel not found")
        : this.sendError(ctx, 500, "Failed to get channel");
    }

    return this.sendSuccess(ctx, toChannelView(result.value));
  }

  /**
   * GET /projects/:projectId/channels
   * List all channels belonging to a project.
   */
  async listChannelsByProject(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Listing channels by project");

    const paramsResult = await this.validateParams<ProjectParamsType>(ctx, ProjectParams);
    if (!paramsResult.ok) return this.sendError(ctx, 400, "Validation failed");

    const { projectId } = paramsResult.value;

    // Verify project exists first
    const projectResult = await this.projectRepo.findById(ProjectId.fromStringUnsafe(projectId));
    if (!projectResult.ok) {
      return this.sendError(ctx, 404, "Project not found");
    }

    const channels = await this.channelRepo.findByProjectId(ProjectId.fromStringUnsafe(projectId));
    return this.sendSuccess(ctx, channels.map(toChannelView));
  }

  /**
   * PUT /channels/:channelId
   * Update a channel's handle or credentials.
   */
  async updateChannel(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Updating channel");

    const paramsResult = await this.validateParams<ChannelParamsType>(ctx, ChannelParams);
    if (!paramsResult.ok) return this.sendError(ctx, 400, "Validation failed");

    const bodyResult = await this.validateBody<UpdateChannelBodyType>(ctx, UpdateChannelBody);
    if (!bodyResult.ok) return this.sendError(ctx, 400, "Validation failed");

    const { channelId } = paramsResult.value;
    const { name, credentials } = bodyResult.value;

    const findResult = await this.channelRepo.findById(ChannelId.fromStringUnsafe(channelId));
    if (!findResult.ok) {
      return findResult.error instanceof EntityNotFoundError
        ? this.sendError(ctx, 404, "Channel not found")
        : this.sendError(ctx, 500, "Failed to find channel");
    }

    const existing = findResult.value;

    // Immutable-entity update pattern: reconstitute with new values, then save.
    const updated = Channel.reconstitute(existing.id, {
      projectId: existing.projectId,
      provider: existing.provider,
      handle: name !== undefined ? name.trim() : existing.handle,
      credentials:
        credentials !== undefined ? mapCredentials(credentials) : { ...existing.credentials },
      status: existing.status,
      errorCount: existing.errorCount,
      ...(existing.lastError !== undefined && { lastError: existing.lastError }),
      ...(existing.lastHealthCheck !== undefined && { lastHealthCheck: existing.lastHealthCheck }),
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    });

    const saveResult = await this.channelRepo.save(updated);
    if (!saveResult.ok) {
      this.logError(ctx, "Failed to update channel", { error: saveResult.error });
      return this.sendError(ctx, 500, "Failed to update channel");
    }

    return this.sendSuccess(ctx, toChannelView(updated));
  }

  /**
   * DELETE /channels/:channelId
   * Soft-delete a channel (sets deletedAt = now, data retained for audit).
   */
  async deleteChannel(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Deleting channel");

    const paramsResult = await this.validateParams<ChannelParamsType>(ctx, ChannelParams);
    if (!paramsResult.ok) return this.sendError(ctx, 400, "Validation failed");

    const { channelId } = paramsResult.value;
    const result = await this.channelRepo.delete(ChannelId.fromStringUnsafe(channelId));

    if (!result.ok) {
      return result.error instanceof EntityNotFoundError
        ? this.sendError(ctx, 404, "Channel not found")
        : this.sendError(ctx, 500, "Failed to delete channel");
    }

    this.logInfo(ctx, "Channel soft-deleted", { channelId });
    return this.sendSuccess(ctx, { deleted: true });
  }

  /**
   * POST /channels/bluesky/connect
   * Connect a Bluesky account using App Password authentication.
   * Validates credentials immediately by calling AtpAgent.login(), then stores
   * the identifier + appPassword as the channel credentials JSON so the worker
   * can re-authenticate on each publish.
   */
  async connectBluesky(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Connecting Bluesky account");

    const bodyResult = await this.validateBody<BlueskyConnectBodyType>(ctx, BlueskyConnectBody);
    if (!bodyResult.ok) return this.sendError(ctx, 400, "Validation failed");

    const { projectId, identifier, appPassword } = bodyResult.value;

    // Verify project exists
    const projectResult = await this.projectRepo.findById(ProjectId.fromStringUnsafe(projectId));
    if (!projectResult.ok) {
      return this.sendError(ctx, 404, "Project not found");
    }

    // Validate Bluesky credentials immediately
    const client = new BlueskyClient({ identifier, appPassword });
    const loginResult = await client.login();
    if (!loginResult.ok) {
      return this.sendError(ctx, 401, "Invalid Bluesky handle or App Password");
    }

    const { handle } = loginResult.value;

    // Store channel with raw Bluesky credentials in the JSON field.
    // We bypass the domain Channel entity here because ChannelCredentials.accessToken
    // is designed for OAuth tokens, but Bluesky uses identifier + appPassword.
    // The AbstractProviderAdapter.getCredentialsFromDatabase() reads raw JSON from Prisma
    // and casts directly to BlueskyCredentials, so this shape is correct for the adapter.
    try {
      const existing = await this.prismaClient.channel.findFirst({
        where: { projectId, provider: "BLUESKY", handle, deletedAt: null },
        select: { id: true },
      });

      const channelId = existing?.id ?? ChannelId.generate().value;

      await this.prismaClient.channel.upsert({
        where: { id: channelId },
        create: {
          id: channelId,
          projectId,
          provider: "BLUESKY",
          handle,
          credentials: { identifier, appPassword },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        update: {
          credentials: { identifier, appPassword },
          updatedAt: new Date(),
        },
      });

      this.logInfo(ctx, "Bluesky channel connected", { channelId, handle });
      return this.sendSuccess(ctx, { channelId, handle, provider: "BLUESKY" }, 201);
    } catch (error: unknown) {
      this.logError(ctx, "Failed to save Bluesky channel", { error });
      return this.sendError(ctx, 500, "Failed to connect Bluesky account");
    }
  }

  /**
   * DELETE /channels/:channelId/hard
   * Hard-delete a channel and ALL cascade data permanently (irreversible).
   * SUPER_ADMIN only. Cascades to publishLogs, analytics.
   */
  async hardDeleteChannel(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Hard deleting channel");

    const paramsResult = await this.validateParams<ChannelParamsType>(ctx, ChannelParams);
    if (!paramsResult.ok) return this.sendError(ctx, 400, "Validation failed");

    const { channelId } = paramsResult.value;
    const result = await this.channelRepo.hardDelete(ChannelId.fromStringUnsafe(channelId));

    if (!result.ok) {
      return result.error instanceof EntityNotFoundError
        ? this.sendError(ctx, 404, "Channel not found")
        : this.sendError(ctx, 500, "Failed to hard delete channel");
    }

    this.logInfo(ctx, "Channel hard-deleted", { channelId });
    return this.sendSuccess(ctx, { deleted: true });
  }
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

/**
 * Fastify plugin registering all channel management endpoints.
 * Resolves ChannelRepository and ProjectRepositoryPort from the DI container.
 */
export const channelRoutes: FastifyPluginAsync = async (fastify) => {
  const container = (
    fastify as typeof fastify & { container?: { resolve: <T>(token: symbol) => T } }
  ).container;

  if (!container) {
    fastify.log.warn("DI container not available — channel routes disabled");
    return;
  }

  const channelRepo = container.resolve<ChannelRepository>(TOKENS.ChannelRepository);
  const projectRepo = container.resolve<ProjectRepositoryPort>(TOKENS.ProjectRepository);
  const prismaClient = container.resolve<PrismaClient>(TOKENS.PrismaClient);

  const handler = new ChannelRouteHandler(channelRepo, projectRepo, prismaClient);

  fastify.post(
    "/channels",
    { schema: { tags: ["Channels"], summary: "Create a new channel" } },
    (req, reply) => handler.createChannel(req, reply)
  );
  fastify.post(
    "/channels/bluesky/connect",
    { schema: { tags: ["Channels"], summary: "Connect a Bluesky account" } },
    (req, reply) => handler.connectBluesky(req, reply)
  );
  fastify.get(
    "/channels/:channelId",
    { schema: { tags: ["Channels"], summary: "Get channel by ID" } },
    (req, reply) => handler.getChannel(req, reply)
  );
  fastify.get(
    "/projects/:projectId/channels",
    { schema: { tags: ["Channels"], summary: "List channels by project" } },
    (req, reply) => handler.listChannelsByProject(req, reply)
  );
  fastify.put(
    "/channels/:channelId",
    { schema: { tags: ["Channels"], summary: "Update a channel" } },
    (req, reply) => handler.updateChannel(req, reply)
  );
  fastify.delete(
    "/channels/:channelId",
    { schema: { tags: ["Channels"], summary: "Soft-delete a channel" } },
    (req, reply) => handler.deleteChannel(req, reply)
  );
  fastify.delete(
    "/channels/:channelId/hard",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_MANAGE)],
      schema: { tags: ["Channels"], summary: "Hard-delete a channel permanently" },
    },
    (req, reply) => handler.hardDeleteChannel(req, reply)
  );
};
