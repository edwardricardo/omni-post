/**
 * @file PrismaTrendRadarResultAdapter.ts
 * @description Persists scored trends as `TrendRadarResult` rows. Idempotent
 *              by day-bucketed key `(accountId, topic, day(fetchedAt))`:
 *              re-running detection for the same account on the same day
 *              updates the existing row rather than inserting a duplicate.
 *              `source` (provenance) is preserved per row. The application
 *              port carries string literal unions; this adapter narrows them
 *              to Prisma enums at the persistence boundary.
 * @layer infrastructure
 */

import type { PrismaClient, $Enums } from "@infra/prisma";
import type {
  TrendRadarResultPort,
  TrendRadarUpsertInput,
  TrendRadarUpsertOutput,
} from "@core/application/trends/TrendRadarResultPort.js";

const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

export class PrismaTrendRadarResultAdapter implements TrendRadarResultPort {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(input: TrendRadarUpsertInput): Promise<TrendRadarUpsertOutput> {
    const dayStart = new Date(input.fetchedAt);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const expiresAt = new Date(input.fetchedAt.getTime() + RETENTION_MS);

    let persisted = 0;
    let updated = 0;

    for (const trend of input.trends) {
      const platform = trend.platform as $Enums.Provider;
      const source = trend.source as $Enums.TrendSource;
      const urgency = trend.urgency as $Enums.TrendUrgency;
      const bestPlatform = (trend.bestPlatform ?? null) as $Enums.Provider | null;

      const existing = await this.prisma.trendRadarResult.findFirst({
        where: {
          accountId: input.accountId,
          topic: trend.topic,
          fetchedAt: { gte: dayStart, lt: dayEnd },
        },
        select: { id: true },
      });

      if (existing) {
        await this.prisma.trendRadarResult.update({
          where: { id: existing.id },
          data: {
            platform,
            source,
            sourceUrl: trend.sourceUrl,
            relevanceScore: trend.relevanceScore,
            postIdea: trend.postIdea,
            bestPlatform,
            urgency,
            volume: trend.volume,
            fetchedAt: input.fetchedAt,
            expiresAt,
          },
        });
        updated++;
      } else {
        await this.prisma.trendRadarResult.create({
          data: {
            accountId: input.accountId,
            topic: trend.topic,
            platform,
            source,
            sourceUrl: trend.sourceUrl,
            relevanceScore: trend.relevanceScore,
            postIdea: trend.postIdea,
            bestPlatform,
            urgency,
            volume: trend.volume,
            fetchedAt: input.fetchedAt,
            expiresAt,
          },
        });
        persisted++;
      }
    }

    return { persisted, updated };
  }
}
