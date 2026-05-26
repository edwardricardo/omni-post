/**
 * @file PrismaRejectVariantAdapter.ts
 * @description Prisma adapter for RejectVariantPort. Loads repurpose variants,
 *              marks them rejected, and cascades rejection to proposals when all
 *              variants are rejected.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { RejectVariantPort } from "@core/application/ai/RejectRepurposeVariantUseCase.js";

export class PrismaRejectVariantAdapter implements RejectVariantPort {
  constructor(private readonly prisma: PrismaClient) {}

  async loadVariant(variantId: string): Promise<{
    id: string;
    proposalId: string;
    status: string;
    proposal: { accountId: string };
  } | null> {
    const row = await this.prisma.repurposeVariant.findUnique({
      where: { id: variantId },
      include: {
        proposal: {
          select: { accountId: true },
        },
      },
    });

    if (!row) return null;

    return {
      id: row.id,
      proposalId: row.proposalId,
      status: row.status,
      proposal: { accountId: row.proposal.accountId },
    };
  }

  async setVariantRejected(variantId: string): Promise<void> {
    await this.prisma.repurposeVariant.update({
      where: { id: variantId },
      data: { status: "REJECTED" },
    });
  }

  async allVariantsRejected(proposalId: string): Promise<boolean> {
    const nonRejectedCount = await this.prisma.repurposeVariant.count({
      where: {
        proposalId,
        status: { not: "REJECTED" },
      },
    });
    return nonRejectedCount === 0;
  }

  async setProposalRejected(proposalId: string): Promise<void> {
    await this.prisma.repurposeProposal.update({
      where: { id: proposalId },
      data: { status: "REJECTED" },
    });
  }
}
