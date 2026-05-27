/**
 * @file PrismaAiTokenUsageRepository.ts
 * @description Prisma adapter implementing `AiTokenUsageReader`. Translates
 *   Prisma errors to `AiTokenUsageReadError` codes.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import type {
  AiTokenUsageReader,
  AiTokenUsageReadError,
} from "@core/domain/repositories/AiTokenUsageReader.js";

export class PrismaAiTokenUsageRepository implements AiTokenUsageReader {
  constructor(private readonly prisma: PrismaClient) {}

  async sumTokensThisMonth(
    accountId: string,
    includeByok: boolean
  ): Promise<Result<number, AiTokenUsageReadError>> {
    try {
      const now = new Date();
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const aggregate = await this.prisma.aiTokenUsage.aggregate({
        where: {
          accountId,
          usedAt: { gte: firstOfMonth },
          ...(includeByok ? {} : { isByok: false }),
        },
        _sum: { tokensUsed: true },
      });

      return ok(aggregate._sum.tokensUsed ?? 0);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async recordUsage(
    accountId: string,
    provider: string,
    tokensUsed: number,
    isByok: boolean
  ): Promise<Result<void, AiTokenUsageReadError>> {
    try {
      await this.prisma.aiTokenUsage.create({
        data: { accountId, provider, tokensUsed, isByok },
      });
      return ok(undefined);
    } catch {
      return err("DATABASE_ERROR");
    }
  }
}
