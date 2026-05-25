/**
 * @file PrismaAnalyticsQueryRepository.ts
 * @description Prisma adapter implementing AnalyticsQueryRepository (CQRS read-side).
 *              Receives PrismaClient via constructor injection. Returns DomainAnalytics DTOs.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type { DomainAnalytics, ProviderName } from "@shared/types";
import type {
  AnalyticsQueryRepository,
  DateRange,
} from "@core/domain/repositories/AnalyticsQueryRepository.js";

/**
 * Maps a Prisma Analytics row to the DomainAnalytics DTO
 */
function toDomain(row: {
  id: string;
  postId: string | null;
  channelId: string;
  provider: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  capturedAt: Date;
}): DomainAnalytics {
  return {
    id: row.id,
    postId: row.postId,
    channelId: row.channelId,
    provider: row.provider as ProviderName,
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    capturedAt: row.capturedAt,
  };
}

/**
 * PrismaAnalyticsQueryRepository - Implements AnalyticsQueryRepository using Prisma
 *
 * This is an ADAPTER in the hexagonal architecture — it implements
 * the read-side PORT defined in the domain layer. Maps Prisma rows
 * directly to the shared DomainAnalytics DTO (no aggregate reconstitution).
 *
 * @example
 * const repo = new PrismaAnalyticsQueryRepository(prisma);
 * const records = await repo.findByPostId("post-id");
 */
export class PrismaAnalyticsQueryRepository implements AnalyticsQueryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Find all analytics records for a specific post
   */
  async findByPostId(postId: string): Promise<DomainAnalytics[]> {
    const rows = await this.prisma.analytics.findMany({
      where: { postId },
      orderBy: { capturedAt: "desc" },
    });

    return rows.map(toDomain);
  }

  /**
   * Find analytics records for a channel, optionally filtered by date range
   */
  async findByChannelId(channelId: string, period?: DateRange): Promise<DomainAnalytics[]> {
    const rows = await this.prisma.analytics.findMany({
      where: {
        channelId,
        ...(period !== undefined && {
          capturedAt: {
            gte: period.start,
            lte: period.end,
          },
        }),
      },
      orderBy: { capturedAt: "desc" },
    });

    return rows.map(toDomain);
  }

  /**
   * Find analytics records for all channels in a project, optionally filtered by date range
   */
  async findByProjectId(projectId: string, period?: DateRange): Promise<DomainAnalytics[]> {
    const rows = await this.prisma.analytics.findMany({
      where: {
        channel: { projectId },
        ...(period !== undefined && {
          capturedAt: {
            gte: period.start,
            lte: period.end,
          },
        }),
      },
      orderBy: { capturedAt: "desc" },
    });

    return rows.map(toDomain);
  }

  /**
   * Persist an analytics snapshot
   */
  async save(analytics: DomainAnalytics): Promise<Result<void, Error>> {
    try {
      await this.prisma.analytics.upsert({
        where: { id: analytics.id },
        create: {
          id: analytics.id,
          postId: analytics.postId,
          channelId: analytics.channelId,
          provider: analytics.provider as "X" | "INSTAGRAM" | "FACEBOOK" | "YOUTUBE" | "TIKTOK",
          views: analytics.views,
          likes: analytics.likes,
          comments: analytics.comments,
          shares: analytics.shares,
          capturedAt: analytics.capturedAt,
        },
        update: {
          views: analytics.views,
          likes: analytics.likes,
          comments: analytics.comments,
          shares: analytics.shares,
          capturedAt: analytics.capturedAt,
        },
      });
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
