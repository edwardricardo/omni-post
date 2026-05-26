/**
 * @file PrismaTrackedTermQuery.ts
 * @description Read-only query adapter that finds active brand-listening terms
 *              across projects for the mention-search dispatch coordinator.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type {
  TrackedTermQuery,
  TrackedTermForSearch,
} from "@core/domain/repositories/TrackedTermQuery.js";

export class PrismaTrackedTermQuery implements TrackedTermQuery {
  constructor(private readonly prisma: PrismaClient) {}

  async findActiveTerms(accountId?: string): Promise<TrackedTermForSearch[]> {
    const terms = await this.prisma.trackedTerm.findMany({
      where: {
        isActive: true,
        project: {
          deletedAt: null,
          ...(accountId ? { accountId } : {}),
        },
      },
      select: {
        id: true,
        accountId: true,
        projectId: true,
        term: true,
        kind: true,
      },
    });

    return terms.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      projectId: t.projectId,
      term: t.term,
      kind: t.kind,
    }));
  }
}
