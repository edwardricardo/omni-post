/**
 * @file PostCommandHandlers.ts
 * @description CQRS command handlers for Post aggregate operations (create, update, publish) that delegate to application use cases and handle schema validation, cache invalidation, and integration events.
 * @layer application
 */

import {
  type Command,
  type CommandHandler,
  type CommandResult,
  type CreatePostCommand,
  type UpdatePostCommand,
  type PublishPostCommand,
  POST_COMMANDS,
  validateCommand,
  CreatePostCommandSchema,
  UpdatePostCommandSchema,
  PublishPostCommandSchema,
} from "@shared/cqrs";
import { createPostEvent, createUserActionEvent, EVENT_TYPES } from "@shared/events";
import type { CreatePostUseCase } from "@core/application/posts/CreatePostUseCase.js";
import type { UpdatePostUseCase } from "@core/application/posts/UpdatePostUseCase.js";
import type { DeletePostUseCase } from "@core/application/posts/DeletePostUseCase.js";
import {
  PostId,
  ChannelId,
  type PostRepository,
  type ChannelRepository,
} from "../../domain/index.js";
import { invalidateQueryCache } from "../CQRSBus";
import type Redis from "ioredis";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("cqrs:post-commands");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PostCommandHandlersConfig {
  createPostUseCase: CreatePostUseCase;
  updatePostUseCase: UpdatePostUseCase;
  deletePostUseCase: DeletePostUseCase;
  postRepository: PostRepository;
  channelRepository: ChannelRepository;
  redis: Redis;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate a list of channel IDs by looking each one up through the
 * ChannelRepository port. Returns an error message when any ID is invalid
 * or not found, or `null` when all channels are valid.
 */
async function validateChannels(
  channelIds: string[],
  channelRepository: ChannelRepository
): Promise<string | null> {
  for (const rawId of channelIds) {
    const channelIdResult = ChannelId.fromString(rawId);
    if (!channelIdResult.ok) {
      return `Invalid channel ID format: ${rawId}`;
    }

    const findResult = await channelRepository.findById(channelIdResult.value);
    if (!findResult.ok) {
      return `Channel not found: ${rawId}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// CreatePostCommandHandler
// ---------------------------------------------------------------------------

export class CreatePostCommandHandler implements CommandHandler<
  Command<unknown>,
  { postId: string; version: number }
> {
  readonly commandType = POST_COMMANDS.CREATE_POST;

  constructor(private config: PostCommandHandlersConfig) {}

  async handle(
    command: Command<unknown>
  ): Promise<CommandResult<{ postId: string; version: number }>> {
    try {
      // 1. Validate CQRS command schema
      const validation = validateCommand(command, CreatePostCommandSchema);
      if (!validation.success) {
        return {
          success: false,
          ...(validation.error && { error: validation.error }),
          ...(validation.validationErrors && { validationErrors: validation.validationErrors }),
        };
      }

      const validatedCommand = validation.data as CreatePostCommand;
      const { data, metadata } = validatedCommand;

      // Delegate to use case. Post is platform-agnostic: no channels, no
      // media, no schedule. Those are owned by downstream saga steps.
      const result = await this.config.createPostUseCase.execute({
        projectId: data.projectId,
        body: data.body,
        ...(data.title && { title: data.title }),
        ...(data.tags && { tags: data.tags }),
        ...(data.locale && {
          locale: data.locale as import("../../domain/value-objects/Content.js").ContentLocale,
        }),
      });

      if (!result.ok) {
        return { success: false, error: result.error.message };
      }

      const postId = result.value.id;

      const events = [
        createPostEvent(
          EVENT_TYPES.POST_CREATED,
          postId,
          data.projectId,
          {
            title: data.title,
            body: data.body,
            locale: data.locale,
            tags: data.tags,
            status: result.value.status,
          },
          {
            ...(metadata.userId && { userId: metadata.userId }),
            source: metadata.source,
          }
        ),
        createUserActionEvent(
          metadata.userId || "system",
          "CREATE_POST",
          "Post",
          postId,
          {
            source: metadata.source || "API",
            ...(metadata.userId && { userId: metadata.userId }),
            ...(metadata.sessionId && { sessionId: metadata.sessionId }),
          },
          {
            projectId: data.projectId,
          }
        ),
      ];

      // 5. Invalidate caches
      await this.invalidateCaches(data.projectId);

      return {
        success: true,
        // version: 0 — every freshly-created Post starts at version 0 (the
        // schema default + AggregateRoot default). The saga step propagates
        // this as expectedVersion to UpdateStatusStep so OCC matches the
        // persisted row instead of fabricating a phantom version.
        data: { postId, version: 0 },
        events,
      };
    } catch (error) {
      log.error({ err: error }, "CreatePostCommand failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  private async invalidateCaches(projectId: string): Promise<void> {
    await invalidateQueryCache(this.config.redis, [
      `post.list:${projectId}`,
      `post.search:${projectId}`,
      "dashboard:stats",
    ]);
  }
}

// ---------------------------------------------------------------------------
// UpdatePostCommandHandler
// ---------------------------------------------------------------------------

export class UpdatePostCommandHandler implements CommandHandler<
  Command<unknown>,
  { version: number }
> {
  readonly commandType = POST_COMMANDS.UPDATE_POST;

  constructor(private config: PostCommandHandlersConfig) {}

  async handle(command: Command<unknown>): Promise<CommandResult<{ version: number }>> {
    try {
      // 1. Validate CQRS command schema
      const validation = validateCommand(command, UpdatePostCommandSchema);
      if (!validation.success) {
        return {
          success: false,
          ...(validation.error && { error: validation.error }),
          ...(validation.validationErrors && { validationErrors: validation.validationErrors }),
        };
      }

      const validatedCommand = validation.data as UpdatePostCommand;
      const { data, metadata, aggregateId } = validatedCommand;

      // Warn about unsupported fields
      if (data.mediaIds) {
        log.warn(
          { postId: aggregateId, mediaIds: data.mediaIds },
          "UpdatePostCommand contains mediaIds which are not supported by the use case — ignored"
        );
      }
      if (data.status) {
        log.warn(
          { postId: aggregateId, status: data.status },
          "UpdatePostCommand contains status which is not supported by the use case — ignored"
        );
      }

      // 2. Delegate to use case (propagating OCC token if caller supplied one)
      const result = await this.config.updatePostUseCase.execute({
        postId: aggregateId,
        ...(data.body && { body: data.body }),
        ...(data.title && { title: data.title }),
        ...(data.tags && { tags: data.tags }),
        ...(data.expectedVersion !== undefined && { expectedVersion: data.expectedVersion }),
      });

      if (!result.ok) {
        return { success: false, error: result.error.message };
      }

      const updatedPost = result.value;

      // 3. Build change tracking for events
      const changes: Record<string, unknown> = {};
      if (data.body) {
        changes.body = data.body;
      }
      if (data.title) {
        changes.title = data.title;
      }
      if (data.tags) {
        changes.tags = data.tags;
      }

      // 4. Create CQRS integration events (only if there were actual fields to update)
      const events = [];

      if (Object.keys(changes).length > 0) {
        const postUpdatedEvent = createPostEvent(
          EVENT_TYPES.POST_UPDATED,
          aggregateId,
          updatedPost.projectId,
          {
            changes,
            previousVersion: 1,
            newVersion: 2,
          },
          {
            source: metadata.source,
            ...(metadata.userId && { userId: metadata.userId }),
            ...(metadata.correlationId && { correlationId: metadata.correlationId }),
          }
        );
        events.push(postUpdatedEvent);

        const userActionEvent = createUserActionEvent(
          metadata.userId || "system",
          "UPDATE_POST",
          "Post",
          aggregateId,
          {
            source: metadata.source || "API",
            ...(metadata.userId && { userId: metadata.userId }),
            ...(metadata.sessionId && { sessionId: metadata.sessionId }),
          },
          {
            changes: Object.keys(changes),
            changeCount: Object.keys(changes).length,
          }
        );
        events.push(userActionEvent);

        // Invalidate caches
        await this.invalidateCaches(updatedPost.projectId, aggregateId);
      }

      return {
        success: true,
        data: { version: 2 },
        events,
      };
    } catch (error) {
      log.error({ err: error }, "UpdatePostCommand failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  private async invalidateCaches(projectId: string, postId: string): Promise<void> {
    await invalidateQueryCache(this.config.redis, [
      `post.get:${postId}`,
      `post.list:${projectId}`,
      `post.search:${projectId}`,
      `post.analytics:${postId}`,
      "dashboard:stats",
    ]);
  }
}

// ---------------------------------------------------------------------------
// PublishPostCommandHandler
// ---------------------------------------------------------------------------

export class PublishPostCommandHandler implements CommandHandler<
  Command<unknown>,
  { jobIds: string[] }
> {
  readonly commandType = POST_COMMANDS.PUBLISH_POST;

  constructor(private config: PostCommandHandlersConfig) {}

  async handle(command: Command<unknown>): Promise<CommandResult<{ jobIds: string[] }>> {
    try {
      // 1. Validate CQRS command schema
      const validation = validateCommand(command, PublishPostCommandSchema);
      if (!validation.success) {
        return {
          success: false,
          ...(validation.error && { error: validation.error }),
          ...(validation.validationErrors && { validationErrors: validation.validationErrors }),
        };
      }

      const validatedCommand = validation.data as PublishPostCommand;
      const { data, metadata, aggregateId } = validatedCommand;

      // 2. Load post via repository
      const postIdResult = PostId.fromString(aggregateId);
      if (!postIdResult.ok) {
        return { success: false, error: `Invalid post ID: ${aggregateId}` };
      }

      const postResult = await this.config.postRepository.findById(postIdResult.value);
      if (!postResult.ok) {
        return { success: false, error: "Post not found" };
      }

      const post = postResult.value;

      // 3. Validate status
      if (post.status.value === "PUBLISHED") {
        return { success: false, error: "Post is already published" };
      }

      // 4. Validate channels
      const channelError = await validateChannels(data.channelIds, this.config.channelRepository);
      if (channelError) {
        return { success: false, error: channelError };
      }

      // 5. Build resolved channel data for events
      const resolvedChannels: Array<{ id: string; provider: string }> = [];
      for (const rawId of data.channelIds) {
        const chIdResult = ChannelId.fromString(rawId);
        if (chIdResult.ok) {
          const chResult = await this.config.channelRepository.findById(chIdResult.value);
          if (chResult.ok) {
            resolvedChannels.push({
              id: chResult.value.id.value,
              provider: chResult.value.provider.type,
            });
          }
        }
      }

      // 6. Create job metadata
      const jobIds: string[] = [];
      const events = [];

      for (const channel of resolvedChannels) {
        const jobId = `publish-${aggregateId}-${channel.id}-${Date.now()}`;
        jobIds.push(jobId);

        const publishJobEvent = createPostEvent(
          EVENT_TYPES.POST_SCHEDULED,
          aggregateId,
          post.projectId.value,
          {
            channelId: channel.id,
            provider: channel.provider,
            jobId,
            priority: data.priority,
            publishAt: data.publishAt || new Date(),
            estimatedDuration: this.estimatePublishDuration(channel.provider),
          },
          {
            source: metadata.source,
            ...(metadata.userId && { userId: metadata.userId }),
            ...(metadata.correlationId && { correlationId: metadata.correlationId }),
          }
        );
        events.push(publishJobEvent);
      }

      // 7. User action event
      const userActionEvent = createUserActionEvent(
        metadata.userId || "system",
        "PUBLISH_POST",
        "Post",
        aggregateId,
        {
          source: metadata.source || "API",
          ...(metadata.userId && { userId: metadata.userId }),
          ...(metadata.sessionId && { sessionId: metadata.sessionId }),
        },
        {
          channelCount: data.channelIds.length,
          priority: data.priority,
          scheduledPublish: !!data.publishAt,
        }
      );
      events.push(userActionEvent);

      // 8. Invalidate caches
      await this.invalidateCaches(post.projectId.value, aggregateId);

      return {
        success: true,
        data: { jobIds },
        events,
      };
    } catch (error) {
      log.error({ err: error }, "PublishPostCommand failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  private estimatePublishDuration(provider: string): number {
    const durations: Record<string, number> = {
      X: 5000,
      INSTAGRAM: 15000,
      FACEBOOK: 10000,
      LINKEDIN: 8000,
      YOUTUBE: 20000,
      TIKTOK: 12000,
    };
    return durations[provider] || 10000;
  }

  private async invalidateCaches(projectId: string, postId: string): Promise<void> {
    await invalidateQueryCache(this.config.redis, [
      `post.get:${postId}`,
      `post.list:${projectId}`,
      `post.search:${projectId}`,
      "dashboard:stats",
    ]);
  }
}

// ---------------------------------------------------------------------------
// DeletePostCommandHandler
// ---------------------------------------------------------------------------

export class DeletePostCommandHandler implements CommandHandler<Command, { deleted: boolean }> {
  readonly commandType = POST_COMMANDS.DELETE_POST;

  constructor(private config: PostCommandHandlersConfig) {}

  async handle(command: Command): Promise<CommandResult<{ deleted: boolean }>> {
    try {
      const { aggregateId, metadata } = command;

      // 1. Load post via repository (needed for event data)
      const postIdResult = PostId.fromString(aggregateId);
      if (!postIdResult.ok) {
        return { success: false, error: `Invalid post ID: ${aggregateId}` };
      }

      const postResult = await this.config.postRepository.findById(postIdResult.value);
      if (!postResult.ok) {
        return { success: false, error: "Post not found" };
      }

      const post = postResult.value;
      const projectId = post.projectId.value;
      const previousStatus = post.status.value;
      const mediaCount = post.media.length;
      const hadSchedule = !!post.scheduledAt;

      // 2. Delegate to use case
      const result = await this.config.deletePostUseCase.execute({ postId: aggregateId });

      if (!result.ok) {
        return { success: false, error: result.error.message };
      }

      // 3. Create CQRS integration events
      const events = [];

      const postDeletedEvent = createPostEvent(
        EVENT_TYPES.POST_DELETED,
        aggregateId,
        projectId,
        {
          previousStatus,
          hadSchedule,
          mediaCount,
        },
        {
          ...(metadata.userId && { userId: metadata.userId }),
          source: metadata.source,
        }
      );
      events.push(postDeletedEvent);

      const userActionEvent = createUserActionEvent(
        metadata.userId || "system",
        "DELETE_POST",
        "Post",
        aggregateId,
        {
          source: metadata.source || "API",
          ...(metadata.userId && { userId: metadata.userId }),
          ...(metadata.sessionId && { sessionId: metadata.sessionId }),
        },
        {
          previousStatus,
        }
      );
      events.push(userActionEvent);

      // 4. Invalidate caches
      await this.invalidateCaches(projectId, aggregateId);

      return {
        success: true,
        data: { deleted: true },
        events,
      };
    } catch (error) {
      log.error({ err: error }, "DeletePostCommand failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  private async invalidateCaches(projectId: string, postId: string): Promise<void> {
    await invalidateQueryCache(this.config.redis, [
      `post.get:${postId}`,
      `post.list:${projectId}`,
      `post.search:${projectId}`,
      "dashboard:stats",
    ]);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Factory function to create all post command handlers
 */
export function createPostCommandHandlers(
  config: PostCommandHandlersConfig
): CommandHandler<Command, unknown>[] {
  return [
    new CreatePostCommandHandler(config),
    new UpdatePostCommandHandler(config),
    new PublishPostCommandHandler(config),
    new DeletePostCommandHandler(config),
  ];
}
