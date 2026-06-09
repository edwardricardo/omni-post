/**
 * @file AnalyticsRepository.ts
 * @description Prisma-backed repository for Analytics entities — list, upsert by post/provider/
 *              timestamp, and aggregate metrics across posts.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { Analytics, AnalyticsQuery, AnalyticsInput } from "@ports/core";
import type { PrismaClient } from "@infra/prisma";
import { mapProviderFromDB, mapProviderToDB } from "./mappers.js";
import { createLogger } from "@observability/logger";

const logger = createLogger("adapter:db-prisma:analytics");

export function createAnalyticsRepository(prisma: PrismaClient) {
  return {
    async listAnalytics(query: AnalyticsQuery): Promise<Result<Analytics[], "DATABASE_ERROR">> {
      try {
        const where: Record<string, unknown> = {};

        if (query.postId) where.postId = query.postId;
        if (query.channelId) where.channelId = query.channelId;
        if (query.provider) where.provider = mapProviderToDB(query.provider);

        if (query.since || query.until) {
          const capturedAtFilter: { gte?: Date; lte?: Date } = {};
          if (query.since) capturedAtFilter.gte = query.since;
          if (query.until) capturedAtFilter.lte = query.until;
          where.capturedAt = capturedAtFilter;
        }

        const analytics = await prisma.analytics.findMany({
          where,
          orderBy: { capturedAt: "desc" },
          take: query.limit ?? 50,
          skip: query.offset ?? 0,
        });

        const mapped: Analytics[] = analytics.map((a) => ({
          id: a.id,
          postId: a.postId,
          channelId: a.channelId,
          provider: mapProviderFromDB(a.provider),
          ...(a.views ? { views: a.views } : {}),
          ...(a.likes ? { likes: a.likes } : {}),
          ...(a.comments ? { comments: a.comments } : {}),
          ...(a.shares ? { shares: a.shares } : {}),
          capturedAt: a.capturedAt,
        }));

        return ok(mapped);
      } catch (error) {
        logger.error({ err: error }, "listAnalytics error");
        return err("DATABASE_ERROR");
      }
    },

    async addAnalytics(input: AnalyticsInput): Promise<Result<Analytics, "DATABASE_ERROR">> {
      try {
        const analytics = await prisma.analytics.create({
          data: {
            ...(input.postId ? { postId: input.postId } : {}),
            channelId: input.channelId,
            provider: mapProviderToDB(input.provider),
            ...(input.views ? { views: input.views } : {}),
            ...(input.likes ? { likes: input.likes } : {}),
            ...(input.comments ? { comments: input.comments } : {}),
            ...(input.shares ? { shares: input.shares } : {}),
            capturedAt: new Date(),
          },
        });

        const result: Analytics = {
          id: analytics.id,
          postId: analytics.postId,
          channelId: analytics.channelId,
          provider: mapProviderFromDB(analytics.provider),
          ...(analytics.views ? { views: analytics.views } : {}),
          ...(analytics.likes ? { likes: analytics.likes } : {}),
          ...(analytics.comments ? { comments: analytics.comments } : {}),
          ...(analytics.shares ? { shares: analytics.shares } : {}),
          capturedAt: analytics.capturedAt,
        };

        return ok(result);
      } catch (error) {
        logger.error({ err: error }, "addAnalytics error");
        return err("DATABASE_ERROR");
      }
    },
  };
}
