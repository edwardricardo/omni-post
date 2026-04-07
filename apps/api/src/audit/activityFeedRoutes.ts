/**
 * @file activityFeedRoutes.ts
 * @description Activity Feed endpoint — transforms audit logs into a user-friendly
 *              feed with cursor-based pagination.
 * @layer infrastructure
 */
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { ActivityFeedService } from "./activityFeedService.js";

const ActivityFeedQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  resource: z.string().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
});

/**
 * @class ActivityFeedHandler
 * @description Route handler for the activity feed endpoint
 */
class ActivityFeedHandler extends BaseRouteHandler {
  protected routeName = "activity-feed";

  constructor(private readonly feedService: ActivityFeedService) {
    super();
  }

  /**
   * @method getFeed
   * @description Returns a paginated activity feed from audit logs
   * @param request - Fastify request with optional query filters
   * @param reply - Fastify reply
   */
  async getFeed(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateRequest<{
      query: z.infer<typeof ActivityFeedQuerySchema>;
    }>(ctx, { query: ActivityFeedQuerySchema });

    if (!validation.ok) return this.sendError(ctx, 400, "Invalid query parameters");

    const { query } = validation.value;
    this.logInfo(ctx, "Fetching activity feed", {
      ...(query.projectId && { projectId: query.projectId }),
      ...(query.resource && { resource: query.resource }),
      limit: query.limit,
    });

    const result = await this.feedService.getFeed({
      ...(query.projectId && { projectId: query.projectId }),
      ...(query.accountId && { accountId: query.accountId }),
      ...(query.userId && { userId: query.userId }),
      ...(query.resource && { resource: query.resource }),
      ...(query.cursor && { cursor: query.cursor }),
      limit: query.limit,
    });

    if (!result.ok) return this.sendError(ctx, 500, result.error);
    this.sendSuccess(ctx, result.value);
  }
}

/**
 * Fastify plugin that registers the /activity-feed route
 */
export const activityFeedRoutes: FastifyPluginAsync = async (app) => {
  const feedService = app.container.resolve<ActivityFeedService>(TOKENS.ActivityFeedService);
  const handler = new ActivityFeedHandler(feedService);

  app.get(
    "/activity-feed",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Audit"], summary: "Get activity feed" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.getFeed(request, reply)
  );
};
