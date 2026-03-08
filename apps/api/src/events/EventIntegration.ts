/**
 * Phase 2: Week 3-4 - Event Integration Example
 *
 * Demonstrates how to integrate Event-Driven Architecture with existing API routes.
 * This shows practical patterns for event publishing in business operations.
 *
 * Usage Examples:
 * - Post creation/update/publishing workflows
 * - User action tracking
 * - Analytics collection
 * - System monitoring
 */

import { randomUUID } from "node:crypto";
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { EventService, createPostEvent, createUserActionEvent } from "./EventService";
import { EVENT_TYPES } from "@shared/events";
import { logger } from "../lib/logger.js";

interface PostCreateRequest {
  title?: string;
  body: string;
  scheduledAt?: string;
  tags?: string[];
  channelIds: string[];
}

interface PostUpdateRequest {
  title?: string;
  body?: string;
  scheduledAt?: string;
  tags?: string[];
  status?: "DRAFT" | "SCHEDULED" | "PUBLISHED";
}

/**
 * Integration helper class
 */
export class EventIntegration {
  constructor(
    private eventService: EventService,
    private fastify: FastifyInstance
  ) {}

  /**
   * Register event-aware API routes
   */
  async registerRoutes(): Promise<void> {
    // Enhanced post creation with events
    this.fastify.post<{ Body: PostCreateRequest }>(
      "/api/posts/events",
      async (request: FastifyRequest<{ Body: PostCreateRequest }>, _reply: FastifyReply) => {
        try {
          const { title, body, scheduledAt, tags, channelIds } = request.body;
          const userId = request.user?.id; // Assuming auth middleware
          const projectId = request.user?.projectId || "default-project";

          // Create post in database (existing logic)
          const post = await this.fastify.prisma!.post.create({
            data: {
              projectId,
              status: scheduledAt ? "SCHEDULED" : "DRAFT",
              scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
              contents: {
                create: {
                  locale: "en",
                  title,
                  body,
                  tags: tags || [],
                },
              },
            },
            include: {
              contents: true,
            },
          });

          // Emit post created event
          const postCreatedEvent = createPostEvent(
            EVENT_TYPES.POST_CREATED,
            post.id,
            projectId,
            {
              title,
              status: post.status,
              scheduledAt: post.scheduledAt,
              channelIds,
              content: {
                body,
                tags,
              },
            },
            {
              ...(userId && { userId }),
              source: "PostAPI",
            }
          );

          await this.eventService.publishEvent(postCreatedEvent);

          // Track user action
          if (userId) {
            const userActionEvent = createUserActionEvent(
              userId,
              "CREATE_POST",
              "Post",
              post.id,
              {
                title,
                scheduledAt,
                channelCount: channelIds.length,
              },
              request.session?.id
            );

            await this.eventService.publishEvent(userActionEvent);
          }

          // If scheduled, emit scheduling event
          if (scheduledAt) {
            const scheduledEvent = createPostEvent(
              EVENT_TYPES.POST_SCHEDULED,
              post.id,
              projectId,
              {
                scheduledAt: new Date(scheduledAt),
                channelIds,
                retryCount: 0,
              },
              {
                ...(userId && { userId }),
                source: "PostAPI",
              }
            );

            await this.eventService.publishEvent(scheduledEvent);
          }

          return {
            success: true,
            data: post,
            events: {
              created: true,
              scheduled: !!scheduledAt,
              userAction: true,
            },
          };
        } catch (error) {
          logger.error({ err: error }, "Failed to create post with events");
          throw error;
        }
      }
    );

    // Enhanced post update with events
    this.fastify.put<{
      Params: { postId: string };
      Body: PostUpdateRequest;
    }>("/api/posts/:postId/events", async (request, reply) => {
      try {
        const { postId } = request.params;
        const updateData = request.body;
        const userId = request.user?.id;
        const projectId = request.user?.projectId || "default-project";

        // Get current post for change tracking
        const currentPost = await this.fastify.prisma!.post.findUnique({
          where: { id: postId },
          include: { contents: true },
        });

        if (!currentPost) {
          return reply.status(404).send({ error: "Post not found" });
        }

        // Update post in database
        const updatedPost = await this.fastify.prisma!.post.update({
          where: { id: postId },
          data: {
            status: updateData.status || currentPost.status,
            scheduledAt: updateData.scheduledAt
              ? new Date(updateData.scheduledAt)
              : currentPost.scheduledAt,
          },
          include: { contents: true },
        });

        // Calculate changes for event
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        if (updateData.status && updateData.status !== currentPost.status) {
          changes.status = { from: currentPost.status, to: updateData.status };
        }
        if (updateData.scheduledAt) {
          changes.scheduledAt = {
            from: currentPost.scheduledAt,
            to: new Date(updateData.scheduledAt),
          };
        }

        // Emit post updated event
        const postUpdatedEvent = createPostEvent(
          EVENT_TYPES.POST_UPDATED,
          postId,
          projectId,
          {
            changes,
            previousVersion: 1, // You'd track this in your schema
            newVersion: 2,
          },
          {
            ...(userId && { userId }),
            source: "PostAPI",
          }
        );

        await this.eventService.publishEvent(postUpdatedEvent);

        // Track user action
        if (userId) {
          const userActionEvent = createUserActionEvent(
            userId,
            "UPDATE_POST",
            "Post",
            postId,
            {
              changes: Object.keys(changes),
            },
            request.session?.id
          );

          await this.eventService.publishEvent(userActionEvent);
        }

        return {
          success: true,
          data: updatedPost,
          changes: Object.keys(changes),
        };
      } catch (error) {
        logger.error({ err: error }, "Failed to update post with events");
        throw error;
      }
    });

    // Simulate post publishing with events
    this.fastify.post<{ Params: { postId: string } }>(
      "/api/posts/:postId/publish",
      async (request, reply) => {
        try {
          const { postId } = request.params;
          const userId = request.user?.id;
          const projectId = request.user?.projectId || "default-project";

          // Get post details
          const post = await this.fastify.prisma!.post.findUnique({
            where: { id: postId },
            include: { contents: true },
          });

          if (!post) {
            return reply.status(404).send({ error: "Post not found" });
          }

          // Publish to channels associated with the post
          const channelIds = ["channel-1", "channel-2"]; // In reality, from post data
          const publishEvents = [];

          for (const channelId of channelIds) {
            const publishedEvent = createPostEvent(
              EVENT_TYPES.POST_PUBLISHED,
              postId,
              projectId,
              {
                channelId,
                provider: "X", // Would be dynamic
                externalId: `x-${Date.now()}`,
                publishedAt: new Date(),
                metrics: {
                  views: 0,
                  likes: 0,
                  comments: 0,
                  shares: 0,
                },
              },
              {
                ...(userId && { userId }),
                source: "PublishWorker",
              }
            );

            publishEvents.push(publishedEvent);

            // Future: Analytics Collection
            // After publishing, collect real analytics from the provider API
            // and emit ANALYTICS_COLLECTED events with actual metrics.
            // Requires: Provider analytics API integration per platform
          }

          // Publish all events
          await this.eventService.publishEvents(publishEvents);

          // Track user action
          if (userId) {
            const userActionEvent = createUserActionEvent(
              userId,
              "PUBLISH_POST",
              "Post",
              postId,
              {
                channelCount: channelIds.length,
              },
              request.session?.id
            );

            await this.eventService.publishEvent(userActionEvent);
          }

          // Update post status
          await this.fastify.prisma!.post.update({
            where: { id: postId },
            data: { status: "PUBLISHED" },
          });

          return {
            success: true,
            publishedTo: channelIds.length,
            events: publishEvents.length,
          };
        } catch (error) {
          logger.error({ err: error }, "Failed to publish post with events");
          throw error;
        }
      }
    );

    // Get event history for a post
    this.fastify.get<{ Params: { postId: string } }>(
      "/api/posts/:postId/events",
      async (request, _reply) => {
        try {
          const { postId } = request.params;

          const eventsResult = await this.eventService.getAggregateEvents("Post", postId);
          if (!eventsResult.ok) {
            throw new Error(`Failed to get events: ${eventsResult.error}`);
          }

          const events = eventsResult.value;

          return {
            success: true,
            postId,
            eventCount: events.length,
            events: events.map((event) => ({
              id: event.id,
              type: event.type,
              timestamp: event.timestamp,
              data: event.data,
              metadata: event.metadata,
            })),
          };
        } catch (error) {
          logger.error({ err: error }, "Failed to get post events");
          throw error;
        }
      }
    );

    // Get analytics events
    this.fastify.get("/api/events/analytics", async (request, _reply) => {
      try {
        const query = request.query as { from?: string };
        const fromDate = query?.from
          ? new Date(query.from)
          : new Date(Date.now() - 24 * 60 * 60 * 1000);

        const analyticsEventsResult = await this.eventService.getEventsByType(
          EVENT_TYPES.ANALYTICS_COLLECTED,
          fromDate
        );
        if (!analyticsEventsResult.ok) {
          throw new Error(`Failed to get analytics events: ${analyticsEventsResult.error}`);
        }

        const analyticsEvents = analyticsEventsResult.value;

        return {
          success: true,
          period: { from: fromDate, to: new Date() },
          eventCount: analyticsEvents.length,
          events: analyticsEvents.map((event) => {
            const data = event.data as {
              postId: string;
              channelId: string;
              provider: string;
              metrics: Record<string, number>;
              collectedAt: Date;
            };
            return {
              postId: data.postId,
              channelId: data.channelId,
              provider: data.provider,
              metrics: data.metrics,
              collectedAt: data.collectedAt,
            };
          }),
        };
      } catch (error) {
        logger.error({ err: error }, "Failed to get analytics events");
        throw error;
      }
    });

    // Event Service health endpoint
    this.fastify.get("/api/events/health", async (_request, _reply) => {
      try {
        const health = await this.eventService.healthCheck();
        const stats = await this.eventService.getStatistics();

        return {
          ...health,
          statistics: stats,
          timestamp: new Date(),
        };
      } catch (error) {
        logger.error({ err: error }, "Failed to get event service health");
        throw error;
      }
    });

    logger.info("Event-aware API routes registered");
  }

  /**
   * Register custom event handlers
   */
  registerCustomHandlers(): void {
    // Handle post published events for notifications
    this.eventService.registerHandler(EVENT_TYPES.POST_PUBLISHED, {
      eventType: EVENT_TYPES.POST_PUBLISHED,
      async handle(event) {
        const data = event.data as { postId: string; provider: string };
        logger.info({ postId: data.postId, provider: data.provider }, "Post published to provider");

        // Could trigger:
        // - Push notifications
        // - Email notifications
        // - Slack/Discord webhooks
        // - Analytics tracking
      },
    });

    // Handle failed publishing for retry logic
    this.eventService.registerHandler(EVENT_TYPES.POST_PUBLISH_FAILED, {
      eventType: EVENT_TYPES.POST_PUBLISH_FAILED,
      async handle(event) {
        const data = event.data as {
          postId: string;
          error: string;
          retryCount: number;
          maxRetries: number;
          channelId: string;
        };
        logger.error({ postId: data.postId, error: data.error }, "Post failed to publish");

        if (data.retryCount < data.maxRetries) {
          logger.info(
            { postId: data.postId, retryCount: data.retryCount + 1, maxRetries: data.maxRetries },
            "Scheduling publish retry"
          );

          // Schedule retry (would integrate with your job queue)
          // await schedulePostPublishRetry(data.postId, data.channelId);
        } else {
          logger.warn(
            { postId: data.postId, maxRetries: data.maxRetries },
            "Max retries reached for post"
          );

          // Could trigger:
          // - Admin notification
          // - User notification
          // - Error logging
        }
      },
    });

    // Handle analytics collection for insights
    this.eventService.registerHandler(EVENT_TYPES.ANALYTICS_COLLECTED, {
      eventType: EVENT_TYPES.ANALYTICS_COLLECTED,
      async handle(event) {
        const data = event.data as { postId: string; metrics: Record<string, number> };
        const { postId, metrics } = data;
        logger.info({ postId, metrics }, "Analytics collected for post");

        // Could trigger:
        // - Dashboard updates
        // - Performance alerts
        // - Trending detection
        // - ROI calculations
      },
    });

    logger.info("Custom event handlers registered");
  }
}

/**
 * Example middleware to add event context to requests
 */
export async function eventContextMiddleware(request: FastifyRequest, _reply: FastifyReply) {
  // Add correlation ID for tracing events across requests
  request.correlationId = (request.headers["x-correlation-id"] as string) || `req-${randomUUID()}`;

  // Add event metadata
  const metadata: NonNullable<typeof request.eventMetadata> = {
    source: "API",
    traceId: request.correlationId!,
  };

  if (request.headers["user-agent"] !== undefined) {
    metadata.userAgent = request.headers["user-agent"] as string;
  }

  if (request.ip) {
    metadata.ipAddress = request.ip;
  }

  const userId = request.user?.id;
  if (userId !== undefined) {
    metadata.userId = userId;
  }

  const sessionId = request.session?.id;
  if (sessionId !== undefined) {
    metadata.sessionId = sessionId;
  }

  request.eventMetadata = metadata;
}
