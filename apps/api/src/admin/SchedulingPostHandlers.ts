/**
 * Admin Scheduling Post Handlers
 *
 * Route handler for scheduled post management: listing, cancellation,
 * and rescheduling. Operates on the Post model via Prisma and manages
 * associated PublishLog entries atomically.
 *
 * @module admin/SchedulingPostHandlers
 */
import { FastifyRequest, FastifyReply } from "fastify";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import type { PrismaClient } from "@infra/prisma";
import type { ProviderName } from "@shared/types";
import {
  ScheduledPostsQuerySchema,
  PostIdParamsSchema,
  ReschedulePostBodySchema,
} from "./schedulingSchemas.js";

/**
 * Scheduling Post Route Handler
 * Manages scheduled post lifecycle: list, cancel, and reschedule operations
 */
export class SchedulingPostRouteHandler extends BaseRouteHandler {
  protected routeName = "scheduling-posts";

  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  /**
   * GET /admin/posts/scheduled
   * Fetch scheduled posts with filters and pagination
   */
  async getScheduledPosts(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Fetching scheduled posts");

    // Validate query parameters
    const validated = await this.validateQuery(ctx, ScheduledPostsQuerySchema);
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const { projectId, status, provider, startDate, endDate, page, limit, sortBy, sortOrder } =
      validated.value;

    try {
      // Use defaults for pagination
      const pageNum = page ?? 1;
      const limitNum = limit ?? 20;
      const sortField = sortBy ?? "scheduledAt";
      const sortDir = sortOrder ?? "asc";

      // Build where clause with conditional filtering
      const whereClause: Record<string, unknown> = {};

      // Filter by project if specified
      if (projectId) {
        whereClause.projectId = projectId;
      }

      // Filter by status
      if (status) {
        whereClause.status = status;
      } else {
        // Default to scheduled posts only
        whereClause.status = "SCHEDULED";
      }

      // Filter by date range
      if (startDate || endDate) {
        const scheduledAtFilter: { gte?: Date; lte?: Date } = {};
        if (startDate) {
          scheduledAtFilter.gte = new Date(startDate);
        }
        if (endDate) {
          scheduledAtFilter.lte = new Date(endDate);
        }
        whereClause.scheduledAt = scheduledAtFilter;
      } else {
        // Only scheduled posts must have scheduledAt
        whereClause.scheduledAt = { not: null };
      }

      // Count total matching posts
      const total = await this.prisma.post.count({ where: whereClause });

      // Calculate pagination
      const offset = (pageNum - 1) * limitNum;

      // Build orderBy dynamically
      const orderByClause: Record<string, "asc" | "desc"> = {};
      orderByClause[sortField] = sortDir;

      // Fetch posts with related data
      const posts = await this.prisma.post.findMany({
        where: whereClause,
        include: {
          contents: {
            orderBy: { revision: "desc" },
            take: 1,
          },
          publishLogs: {
            orderBy: { createdAt: "desc" },
            take: 5,
            ...(provider && {
              where: {
                provider: provider as ProviderName,
              },
            }),
          },
          project: {
            select: {
              id: true,
              name: true,
              accountId: true,
            },
          },
        },
        orderBy: orderByClause,
        skip: offset,
        take: limitNum,
      });

      // Format response data - cast to proper type with includes
      type PostWithRelations = (typeof posts)[0];
      const formattedPosts = posts.map((post: PostWithRelations) => {
        const firstContent = (
          post as unknown as {
            contents: Array<{ locale: string; title: string | null; body: string; tags: string[] }>;
          }
        ).contents?.[0];
        const postPublishLogs =
          (
            post as unknown as {
              publishLogs: Array<{
                id: string;
                provider: string;
                status: string;
                createdAt: Date;
                payload: unknown;
              }>;
            }
          ).publishLogs || [];
        const postProject = (post as unknown as { project: { name: string } }).project;

        return {
          id: post.id,
          projectId: post.projectId,
          projectName: postProject?.name ?? "Unknown",
          status: post.status,
          scheduledAt: post.scheduledAt,
          publishedAt: post.publishedAt,
          createdAt: post.createdAt,
          updatedAt: post.updatedAt,
          content: firstContent
            ? {
                locale: firstContent.locale,
                title: firstContent.title,
                body: firstContent.body,
                tags: firstContent.tags,
              }
            : null,
          publishLogs: postPublishLogs.map(
            (log: {
              id: string;
              provider: string;
              status: string;
              createdAt: Date;
              payload: unknown;
            }) => {
              const baseLog = {
                id: log.id,
                provider: log.provider,
                status: log.status,
                createdAt: log.createdAt,
              };
              if (log.payload && typeof log.payload === "object") {
                return { ...baseLog, payload: log.payload };
              }
              return baseLog;
            }
          ),
        };
      });

      this.logInfo(ctx, "Scheduled posts fetched successfully", {
        total,
        page: pageNum,
        limit: limitNum,
        returned: formattedPosts.length,
      });

      // Send paginated response
      return this.sendSuccess(
        ctx,
        this.formatPaginatedResponse(formattedPosts, total, pageNum, limitNum)
      );
    } catch (error) {
      this.logError(ctx, "Failed to fetch scheduled posts", { error });
      return this.sendError(ctx, 500, "Failed to fetch scheduled posts");
    }
  }

  /**
   * POST /admin/posts/:id/cancel
   * Cancel a scheduled post
   */
  async cancelScheduledPost(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Canceling scheduled post");

    // Validate params
    const validation = await this.validateParams(ctx, PostIdParamsSchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid post ID");
    }

    const { id } = validation.value;

    try {
      // Check if post exists and is scheduled
      const post = await this.prisma.post.findUnique({
        where: { id },
        include: {
          publishLogs: {
            where: {
              status: { in: ["QUEUED", "RUNNING"] },
            },
          },
        },
      });

      if (!post) {
        return this.sendError(ctx, 404, "Post not found");
      }

      if (post.status !== "SCHEDULED") {
        return this.sendError(ctx, 400, "Post is not scheduled", {
          currentStatus: post.status,
        });
      }

      // Update post status to DRAFT (cancelled)
      const updatedPost = await this.prisma.$transaction(async (tx) => {
        // Update post status
        const updated = await tx.post.update({
          where: { id },
          data: {
            status: "DRAFT",
            scheduledAt: null,
          },
        });

        // Cancel any queued publish logs
        if (post.publishLogs.length > 0) {
          await tx.publishLog.updateMany({
            where: {
              postId: id,
              status: { in: ["QUEUED", "RUNNING"] },
            },
            data: {
              status: "ERR",
              payload: {
                error: "Post cancelled by user",
                cancelledAt: new Date().toISOString(),
              },
            },
          });
        }

        return updated;
      });

      this.logInfo(ctx, "Post cancelled successfully", {
        postId: id,
        cancelledLogs: post.publishLogs.length,
      });

      this.sendSuccess(ctx, {
        id: updatedPost.id,
        status: updatedPost.status,
        scheduledAt: updatedPost.scheduledAt,
        cancelledAt: new Date(),
        cancelledPublishLogs: post.publishLogs.length,
      });
    } catch (error) {
      this.logError(ctx, "Failed to cancel scheduled post", { error });
      return this.sendError(ctx, 500, "Failed to cancel scheduled post");
    }
  }

  /**
   * POST /admin/posts/:id/reschedule
   * Reschedule a post to a new time
   */
  async reschedulePost(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Rescheduling post");

    // Validate params
    const paramsValidation = await this.validateParams(ctx, PostIdParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid post ID");
    }

    // Validate body
    const bodyValidation = await this.validateBody(ctx, ReschedulePostBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { id } = paramsValidation.value;
    const { scheduledAt, timezone, updateChannels } = bodyValidation.value;

    try {
      // Check if post exists
      const post = await this.prisma.post.findUnique({
        where: { id },
        include: {
          publishLogs: {
            where: {
              status: { in: ["QUEUED", "RUNNING"] },
            },
          },
        },
      });

      if (!post) {
        return this.sendError(ctx, 404, "Post not found");
      }

      // Validate new scheduled time is in the future
      const newScheduledDate = new Date(scheduledAt);
      if (newScheduledDate <= new Date()) {
        return this.sendError(ctx, 400, "Scheduled time must be in the future");
      }

      // Update post and publish logs
      const updatedPost = await this.prisma.$transaction(async (tx) => {
        // Update post
        const updated = await tx.post.update({
          where: { id },
          data: {
            status: "SCHEDULED",
            scheduledAt: newScheduledDate,
          },
        });

        // Update publish logs if requested
        if (updateChannels && post.publishLogs.length > 0) {
          await tx.publishLog.updateMany({
            where: {
              postId: id,
              status: { in: ["QUEUED", "RUNNING"] },
            },
            data: {
              payload: {
                scheduledFor: newScheduledDate.toISOString(),
                timezone,
                rescheduledAt: new Date().toISOString(),
              },
            },
          });
        }

        return updated;
      });

      this.logInfo(ctx, "Post rescheduled successfully", {
        postId: id,
        oldScheduledAt: post.scheduledAt,
        newScheduledAt: newScheduledDate,
        updatedLogs: updateChannels ? post.publishLogs.length : 0,
      });

      this.sendSuccess(ctx, {
        id: updatedPost.id,
        status: updatedPost.status,
        scheduledAt: updatedPost.scheduledAt,
        previousScheduledAt: post.scheduledAt,
        timezone,
        updatedPublishLogs: updateChannels ? post.publishLogs.length : 0,
      });
    } catch (error) {
      this.logError(ctx, "Failed to reschedule post", { error });
      return this.sendError(ctx, 500, "Failed to reschedule post");
    }
  }
}
