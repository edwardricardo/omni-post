/**
 * @file channelRoutes.ts
 * @description REST API endpoints for managing social media channels including CRUD
 *              operations, credential storage, and platform mapping within projects.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { IdSchema } from "@packages/api-common";
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
import type { ChannelCredentialsCrypto } from "../security/ChannelCredentialsCrypto.js";
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "../auth/rbacService.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { PrismaClient } from "@infra/prisma";
import { BlueskyClient } from "@providers/bluesky";
import { SetPrimaryChannelUseCase } from "../application/channels/index.js";
import { USE_CASE_ERRORS } from "../application/UseCase.js";

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
    isPrimary: channel.isPrimary,
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
    private readonly prismaClient: PrismaClient,
    private readonly setPrimaryUseCase: SetPrimaryChannelUseCase,
    private readonly credentialsCrypto: ChannelCredentialsCrypto
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
    // The domain Channel entity expects an OAuth-style accessToken; Bluesky
    // instead authenticates with identifier + appPassword, so we persist the
    // raw shape directly. CredentialResolver returns this JSON blob unchanged
    // and BlueskyAdapter validates the shape at runtime via the helper.
    try {
      const existing = await this.prismaClient.channel.findFirst({
        where: { projectId, provider: "BLUESKY", handle, deletedAt: null },
        select: { id: true },
      });

      const channelId = existing?.id ?? ChannelId.generate().value;

      const enc = this.credentialsCrypto.encrypt(
        { identifier, appPassword },
        { recordId: channelId, caller: "channelRoutes.connectBluesky" }
      );
      await this.prismaClient.channel.upsert({
        where: { id: channelId },
        create: {
          id: channelId,
          projectId,
          provider: "BLUESKY",
          handle,
          providerAccountId: identifier,
          credentialsCiphertext: enc.credentialsCiphertext,
          credentialsIv: enc.credentialsIv,
          credentialsAuthTag: enc.credentialsAuthTag,
          credentialsKeyVersion: enc.credentialsKeyVersion,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        update: {
          providerAccountId: identifier,
          credentialsCiphertext: enc.credentialsCiphertext,
          credentialsIv: enc.credentialsIv,
          credentialsAuthTag: enc.credentialsAuthTag,
          credentialsKeyVersion: enc.credentialsKeyVersion,
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
   * PATCH /channels/:channelId/set-primary
   * Promotes a channel to primary for its (project, provider) pair. Atomically
   * unmarks any sibling that was previously primary, so the partial unique index
   * is never violated. Idempotent — re-marking a primary channel is a no-op.
   */
  async setPrimaryChannel(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Setting primary channel");

    const paramsResult = await this.validateParams<ChannelParamsType>(ctx, ChannelParams);
    if (!paramsResult.ok) return this.sendError(ctx, 400, "Validation failed");

    const { channelId } = paramsResult.value;
    const result = await this.setPrimaryUseCase.execute({ channelId });

    if (!result.ok) {
      const code = result.error.code;
      if (code === USE_CASE_ERRORS.NOT_FOUND) {
        return this.sendError(ctx, 404, "Channel not found");
      }
      if (code === USE_CASE_ERRORS.VALIDATION_FAILED) {
        return this.sendError(ctx, 400, result.error.message);
      }
      this.logError(ctx, "Failed to set primary channel", { error: result.error });
      return this.sendError(ctx, 500, "Failed to set primary channel");
    }

    const findResult = await this.channelRepo.findById(ChannelId.fromStringUnsafe(channelId));
    if (!findResult.ok) {
      return this.sendError(ctx, 500, "Failed to read updated channel");
    }

    return this.sendSuccess(ctx, toChannelView(findResult.value));
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
  const setPrimaryUseCase = container.resolve<SetPrimaryChannelUseCase>(
    TOKENS.SetPrimaryChannelUseCase
  );
  const credentialsCrypto = container.resolve<ChannelCredentialsCrypto>(
    TOKENS.ChannelCredentialsCrypto
  );

  const handler = new ChannelRouteHandler(
    channelRepo,
    projectRepo,
    prismaClient,
    setPrimaryUseCase,
    credentialsCrypto
  );

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
  fastify.patch(
    "/channels/:channelId/set-primary",
    {
      schema: {
        tags: ["Channels"],
        summary: "Mark a channel as the primary one for its (project, provider) pair",
      },
    },
    (req, reply) => handler.setPrimaryChannel(req, reply)
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
