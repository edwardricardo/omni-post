/**
 * @file PrismaRepurposeProposalQueryAdapter.ts
 * @description Prisma adapter for RepurposeProposalQueryRepository. Reads
 *              account-scoped proposals (with variant counts) newest-first
 *              and maps Decimal engagement fields to plain numbers and
 *              timestamps to ISO strings for the DTO.
 * @layer infrastructure
 */

import type { PrismaClient, Prisma, $Enums } from "@infra/prisma";
import type {
  RepurposeProposalQueryRepository,
  RepurposeProposalQueryOptions,
  RepurposeProposalListResult,
} from "../../domain/repositories/RepurposeProposalQueryRepository.js";

export class PrismaRepurposeProposalQueryAdapter implements RepurposeProposalQueryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findByAccountId
   * @description Lists proposals for an account, optionally filtered by
   *   status, paginated newest-first, alongside the unpaginated total.
   */
  async findByAccountId(
    accountId: string,
    options: RepurposeProposalQueryOptions
  ): Promise<RepurposeProposalListResult> {
    const where: Prisma.RepurposeProposalWhereInput = {
      accountId,
      ...(options.status !== undefined && {
        status: options.status as $Enums.RepurposeStatus,
      }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.repurposeProposal.findMany({
        where,
        orderBy: { detectedAt: "desc" },
        take: options.limit,
        skip: options.offset,
        include: { _count: { select: { variants: true } } },
      }),
      this.prisma.repurposeProposal.count({ where }),
    ]);

    return {
      proposals: rows.map((row) => ({
        id: row.id,
        sourcePostId: row.sourcePostId,
        sourcePlatform: row.sourcePlatform,
        status: row.status,
        engagementRate: Number(row.engagementRate),
        engagementMultiplier: Number(row.engagementMultiplier),
        detectedAt: row.detectedAt.toISOString(),
        reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
        variantCount: row._count.variants,
      })),
      total,
    };
  }
}
