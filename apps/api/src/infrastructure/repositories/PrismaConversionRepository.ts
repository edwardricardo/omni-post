/**
 * @file PrismaConversionRepository.ts
 * @description Prisma adapter implementing ConversionRepositoryPort. Receives
 *              PrismaClient via constructor injection, resolves the active
 *              Unit-of-Work transaction client for writes, and coerces the
 *              Decimal `value` to a number at the read boundary (money canon).
 * @layer infrastructure
 */

import type { PrismaClient, Prisma } from "@infra/prisma";
import { Prisma as PrismaNamespace } from "@infra/prisma";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";
import type {
  ConversionRepositoryPort,
  ConversionRecordInput,
  ConversionFindOptions,
} from "../../domain/repositories/ConversionRepository.js";
import type { ConversionDto } from "../../domain/repositories/ReadModelDtos.js";

/**
 * Prisma implementation of ConversionRepositoryPort.
 *
 * Register as a singleton in the DI container via TOKENS.ConversionRepository.
 */
export class PrismaConversionRepository implements ConversionRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Resolve the active transaction client when the write happens inside a
   * Unit-of-Work transaction, falling back to the base client otherwise.
   */
  private getClient(): PrismaClient | Prisma.TransactionClient {
    return PrismaUnitOfWork.getTransactionClient() ?? this.prisma;
  }

  /**
   * Persist a single conversion event idempotently. A re-report of the same
   * logical event trips the `conversion_idempotency` unique constraint (P2002)
   * and is silently ignored — preserving the original `ON CONFLICT DO NOTHING`.
   */
  async record(input: ConversionRecordInput): Promise<void> {
    try {
      await this.getClient().conversion.create({
        data: {
          accountId: input.accountId,
          source: input.source,
          contentId: input.contentId,
          conversionType: input.conversionType,
          value: new PrismaNamespace.Decimal(input.value),
          attribution: input.attribution,
          occurredAt: input.occurredAt,
        },
      });
    } catch (error: unknown) {
      if (
        error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return;
      }
      throw error;
    }
  }

  /**
   * Return an account's conversions within [start, end], optionally filtered by
   * source provider, ordered by `occurredAt` ascending. Decimal `value` is
   * coerced to a number at this boundary.
   */
  async findByAccount(accountId: string, options: ConversionFindOptions): Promise<ConversionDto[]> {
    const rows = await this.prisma.conversion.findMany({
      where: {
        accountId,
        occurredAt: { gte: options.start, lte: options.end },
        ...(options.source !== undefined && { source: options.source }),
      },
      orderBy: { occurredAt: "asc" },
    });

    return rows.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      source: row.source,
      contentId: row.contentId,
      conversionType: row.conversionType,
      value: Number(row.value),
      attribution: row.attribution,
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
    }));
  }
}
