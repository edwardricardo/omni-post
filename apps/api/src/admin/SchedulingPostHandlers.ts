/**
 * @file SchedulingPostHandlers.ts
 * @description Route handler for scheduled post management: listing, cancellation,
 *              and rescheduling with atomic PublishLog management.
 * @layer infrastructure
 */
import { FastifyRequest, FastifyReply } from "fastify";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import type { Prisma, PrismaClient } from "@infra/prisma";
import { withGucBoundTransaction } from "@infra/prisma/extensions/tenantGuc.js";
import { ErrorCode, type ProviderName } from "@shared/types";
import { getAmbientGucScope } from "../security/tenantContext.js";
import {
  ScheduledPostsQuerySchema,
  PostIdParamsSchema,
  ReschedulePostBodySchema,
} from "./schedulingSchemas.js";

/**
 * The status words a direct writer is allowed to move, as an ALLOWLIST. A denylist
 * would admit by default, and the set that must never be overwritten here is
 * open-ended: every word the publishing path owns, plus whichever word a later
 * revision of the enum adds. Named once so the two writers below cannot drift.
 */
const DIRECT_WRITABLE_STATUSES = ["SCHEDULED", "DRAFT", "FAILED"] as const;

/** The two columns that decide whether a channel is holding this post's content. */
interface PublicationLivenessRow {
  channelId: string;
  outcome: string;
  pendingRetraction: boolean;
}

/**
 * @function liveChannelsOf
 * @description The row-level mirror of the domain's `ChannelPublication.hasLiveContent()`
 *              — "published, or excluded with fragments still on the provider". It is a
 *              SECOND declaration of that rule and is named as one: the domain predicate
 *              reads hydrated facts (`published !== undefined`) while these handlers hold
 *              a raw client and read database columns, so no single declaration is
 *              available to both. The binding is a case in
 *              `SchedulingPostHandlers.c3.test.ts` that walks every `(outcome,
 *              pendingRetraction)` combination and, for each one, HYDRATES a real
 *              `ChannelPublication` and asks IT for the expected answer. That is what
 *              makes it a binding rather than a third declaration: a hand-written table
 *              of expectations would stay green while the two rules diverged.
 * @param rows - The publication rows of one post.
 * @returns The channels holding live content, in row order.
 */
function liveChannelsOf(rows: readonly PublicationLivenessRow[]): string[] {
  return rows
    .filter((row) => row.outcome === "PUBLISHED" || row.pendingRetraction)
    .map((row) => row.channelId);
}

/**
 * @function isRecordNotFound
 * @description Whether a rejection is Prisma's "no row matched" for a single-row write.
 * @param error - What a statement threw.
 * @returns true for `P2025`.
 */
function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
}

/**
 * Raised at the compare-and-swap, and nowhere else, when THAT statement matched no row.
 *
 * Prisma reports a lost swap as `P2025` — but so does every other single-row write in the
 * same transaction, and a catch around the whole transaction cannot tell which one raised
 * it. Reading the code out there made the answer right only because of a fact about the
 * NEIGHBOURING statement: the log write is an `updateMany`, which reports a miss as a
 * count instead of throwing. The day it becomes an `update`, a genuinely different fault
 * would reach the operator as "the post moved on" and disappear. Converting at the swap
 * makes the property local to the swap; raising rather than returning keeps the rollback
 * the abort already had, so a write added BEFORE the swap cannot commit on this path.
 */
class LostStatusSwapError extends Error {
  constructor(cause: unknown) {
    super("The post status compare-and-swap matched no row", { cause });
    this.name = "LostStatusSwapError";
  }
}

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
   * @method readLiveChannels
   * @description The C3 guard's deciding read, issued INSIDE the caller's transaction.
   *              Both writers below take their first look at the post outside the
   *              transaction they then write in, so that look can be stale by the time
   *              it lands; this one cannot, and it rolls back with the write it guards.
   * @param tx - The transaction client the write will run on.
   * @param id - The post being written.
   * @returns The channels holding live content, or `null` when the post is no longer there.
   */
  private async readLiveChannels(
    tx: Prisma.TransactionClient,
    id: string
  ): Promise<string[] | null> {
    const current = await tx.post.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        channelPublications: {
          select: { channelId: true, outcome: true, pendingRetraction: true },
        },
      },
    });
    if (!current) {
      return null;
    }
    return liveChannelsOf(current.channelPublications);
  }

  /**
   * @method swapStatus
   * @description The compare-and-swap both writers perform on the post's word: the
   *              publishing path may have promoted the post since the read outside this
   *              transaction, and {@link DIRECT_WRITABLE_STATUSES} is the only family a
   *              direct writer owns. Its OWN lost race — and only its own — leaves as
   *              {@link LostStatusSwapError}; every other rejection travels on untouched.
   * @param tx - The transaction client the write runs on.
   * @param id - The post being written.
   * @param data - The word to write and the schedule that goes with it.
   * @returns The updated row.
   */
  private async swapStatus(
    tx: Prisma.TransactionClient,
    id: string,
    data: { status: "DRAFT" | "SCHEDULED"; scheduledAt: Date | null }
  ) {
    try {
      return await tx.post.update({
        where: { id, status: { in: [...DIRECT_WRITABLE_STATUSES] } },
        data,
      });
    } catch (error: unknown) {
      if (isRecordNotFound(error)) {
        throw new LostStatusSwapError(error);
      }
      throw error;
    }
  }

  /**
   * @method sendLiveContentRefusal
   * @description The 409 both writers answer when the post's content is already on a
   *              provider. The discriminator travels in `details` because this handler's
   *              responses are serialized by `sendError`, which ships `details` in every
   *              environment — unlike the global handler, which withholds them outside
   *              development. The channels are named because the operator's next move is
   *              to have them cleared, and that act is channel-scoped.
   * @param ctx - The route context.
   * @param channelIds - The channels holding live content.
   * @param action - What was refused, for the message.
   */
  private sendLiveContentRefusal(ctx: RouteContext, channelIds: string[], action: string): void {
    this.sendError(
      ctx,
      409,
      `Post has live content on ${channelIds.length} channel(s) and cannot be ${action}`,
      { code: ErrorCode.CHANNEL_HAS_LIVE_FRAGMENTS, channelIds }
    );
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

      // Build where clause with conditional filtering.
      // deletedAt: null so soft-deleted posts never surface in the scheduling view.
      const whereClause: Record<string, unknown> = { deletedAt: null };

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
      const post = await this.prisma.post.findFirst({
        where: { id, deletedAt: null },
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

      // Update post status to DRAFT (cancelled). Independent of any enclosing transaction by
      // position: an admin route handler is the outermost frame of its own request.
      const outcome = await withGucBoundTransaction(
        this.prisma,
        getAmbientGucScope(),
        async (tx) => {
          // C3 guard. Cancelling returns the word to DRAFT, which reads as "nothing of
          // this post is out there" — so it must not be written over a post whose
          // content a provider already accepted, or whose interrupted fragments the
          // customer has not removed yet.
          const live = await this.readLiveChannels(tx, id);
          if (live === null) {
            return { kind: "missing" as const };
          }
          if (live.length > 0) {
            return { kind: "live" as const, channelIds: live };
          }

          const updated = await this.swapStatus(tx, id, { status: "DRAFT", scheduledAt: null });

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

          return { kind: "updated" as const, post: updated };
        }
      ).catch((error: unknown) => {
        if (error instanceof LostStatusSwapError) {
          return { kind: "raced" as const };
        }
        throw error;
      });

      if (outcome.kind === "missing") {
        return this.sendError(ctx, 404, "Post not found");
      }
      if (outcome.kind === "live") {
        return this.sendLiveContentRefusal(ctx, outcome.channelIds, "cancelled");
      }
      if (outcome.kind === "raced") {
        return this.sendError(ctx, 409, "Post status changed before the cancellation landed", {
          code: ErrorCode.RESOURCE_CONFLICT,
        });
      }
      const updatedPost = outcome.post;

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
      const post = await this.prisma.post.findFirst({
        where: { id, deletedAt: null },
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
      const outcome = await withGucBoundTransaction(
        this.prisma,
        getAmbientGucScope(),
        async (tx) => {
          // C3 guard. Rescheduling asserts the post has NOT gone out yet — it moves the
          // word back to SCHEDULED — so a post whose content is already on a provider,
          // or whose interrupted fragments are still live, is refused rather than
          // re-armed. This handler has no status pre-check at all, so before the guard
          // a PUBLISHED post could be dragged back to SCHEDULED.
          const live = await this.readLiveChannels(tx, id);
          if (live === null) {
            return { kind: "missing" as const };
          }
          if (live.length > 0) {
            return { kind: "live" as const, channelIds: live };
          }

          const updated = await this.swapStatus(tx, id, {
            status: "SCHEDULED",
            scheduledAt: newScheduledDate,
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

          return { kind: "updated" as const, post: updated };
        }
      ).catch((error: unknown) => {
        if (error instanceof LostStatusSwapError) {
          return { kind: "raced" as const };
        }
        throw error;
      });

      if (outcome.kind === "missing") {
        return this.sendError(ctx, 404, "Post not found");
      }
      if (outcome.kind === "live") {
        return this.sendLiveContentRefusal(ctx, outcome.channelIds, "rescheduled");
      }
      if (outcome.kind === "raced") {
        return this.sendError(ctx, 409, "Post status changed before the reschedule landed", {
          code: ErrorCode.RESOURCE_CONFLICT,
        });
      }
      const updatedPost = outcome.post;

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
