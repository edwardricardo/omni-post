/**
 * @file PrismaTrendRadarQueryAdapter.ts
 * @description Prisma-backed read adapter for `TrendRadarResult`. Returns
 *              flat DTOs (Decimal → number for relevanceScore, Date → ISO
 *              for fetchedAt). Filters out expired rows (`expiresAt > now`)
 *              and orders by relevanceScore desc, then fetchedAt desc so
 *              the most relevant / freshest trends surface first.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type {
  TrendRadarQueryRepository,
  TrendRadarQueryOptions,
  TrendRadarListResult,
  ScoredTrendDTO,
} from "../../domain/repositories/TrendRadarQueryRepository.js";

export class PrismaTrendRadarQueryAdapter implements TrendRadarQueryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByAccountId(
    accountId: string,
    options: TrendRadarQueryOptions
  ): Promise<TrendRadarListResult> {
    const now = new Date();
    const where = { accountId, expiresAt: { gt: now } };

    const [rows, total] = await Promise.all([
      this.prisma.trendRadarResult.findMany({
        where,
        orderBy: [{ relevanceScore: "desc" }, { fetchedAt: "desc" }],
        take: options.limit,
      }),
      this.prisma.trendRadarResult.count({ where }),
    ]);

    const scored: ScoredTrendDTO[] = rows.map((r) => ({
      topic: r.topic,
      platform: r.platform,
      source: r.source,
      sourceUrl: r.sourceUrl,
      relevanceScore: Number(r.relevanceScore),
      postIdea: r.postIdea,
      bestPlatform: r.bestPlatform,
      urgency: r.urgency,
      volume: r.volume,
      fetchedAt: r.fetchedAt.toISOString(),
    }));

    return { scored, total };
  }
}
