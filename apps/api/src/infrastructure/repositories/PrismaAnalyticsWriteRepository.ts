/**
 * @file PrismaAnalyticsWriteRepository.ts
 * @description Prisma adapter for writing analytics data. Implements
 *              the AnalyticsWriteRepository port with upsert support
 *              on the AnalyticsDailySummary unique constraint.
 * @layer infrastructure
 */

import type { PrismaClient, Provider as PrismaProvider } from "@infra/prisma";
import { ok, err, type Result } from "@shared/types";
import { withTenantTransaction } from "../unitofwork/tenantTransaction.js";
import type {
  AnalyticsWriteRepository,
  AnalyticsDailySummaryInput,
} from "@core/domain/repositories/AnalyticsWriteRepository.js";

export class PrismaAnalyticsWriteRepository implements AnalyticsWriteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertDailySummary(input: AnalyticsDailySummaryInput): Promise<Result<void, Error>> {
    try {
      await this.prisma.analyticsDailySummary.upsert({
        where: {
          postId_channelId_provider_date: {
            postId: input.postId ?? "",
            channelId: input.channelId,
            provider: input.provider as PrismaProvider,
            date: input.date,
          },
        },
        update: {
          views: input.views,
          likes: input.likes,
          comments: input.comments,
          shares: input.shares,
          records: { increment: 1 },
        },
        create: {
          postId: input.postId,
          channelId: input.channelId,
          provider: input.provider as PrismaProvider,
          date: input.date,
          views: input.views,
          likes: input.likes,
          comments: input.comments,
          shares: input.shares,
          records: 1,
        },
      });
      return ok(undefined);
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async upsertDailySummaries(inputs: AnalyticsDailySummaryInput[]): Promise<Result<void, Error>> {
    try {
      // Sequential awaits inside one interactive transaction rather than an array of
      // promises built before the transaction exists: same atomicity, and every upsert
      // demonstrably runs on this transaction's own connection.
      // Joins the caller's unit of work when one is open: `IngestChannelAnalyticsUseCase`
      // writes the summaries as one step of its transaction, and a partially-ingested day
      // that survived the rollback would read as real data on the next run.
      await withTenantTransaction(this.prisma, async (tx) => {
        for (const input of inputs) {
          await tx.analyticsDailySummary.upsert({
            where: {
              postId_channelId_provider_date: {
                postId: input.postId ?? "",
                channelId: input.channelId,
                provider: input.provider as PrismaProvider,
                date: input.date,
              },
            },
            update: {
              views: input.views,
              likes: input.likes,
              comments: input.comments,
              shares: input.shares,
              records: { increment: 1 },
            },
            create: {
              postId: input.postId,
              channelId: input.channelId,
              provider: input.provider as PrismaProvider,
              date: input.date,
              views: input.views,
              likes: input.likes,
              comments: input.comments,
              shares: input.shares,
              records: 1,
            },
          });
        }
      });
      return ok(undefined);
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
