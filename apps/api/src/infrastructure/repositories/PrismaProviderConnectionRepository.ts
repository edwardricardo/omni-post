/**
 * @file PrismaProviderConnectionRepository.ts
 * @description Prisma adapter for the bulk-disable port. Single-query
 *              updateMany + select for affected IDs.
 * @layer infrastructure
 */

import type { PrismaClient, Provider as PrismaProvider } from "@infra/prisma";
import type {
  BulkDisableProviderConnectionsResult,
  ProviderConnectionRepository,
} from "../../application/providers/ProviderConnectionRepository.js";

export class PrismaProviderConnectionRepository implements ProviderConnectionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async bulkDisableByProvider(provider: string): Promise<BulkDisableProviderConnectionsResult> {
    const providerEnum = provider as PrismaProvider;
    const targets = await this.prisma.providerConnection.findMany({
      where: { providerId: providerEnum, isActive: true },
      select: { id: true },
    });
    if (targets.length === 0) {
      return { count: 0, connectionIds: [] };
    }
    const connectionIds = targets.map((r) => r.id);
    const result = await this.prisma.providerConnection.updateMany({
      where: { id: { in: connectionIds } },
      data: { isActive: false, updatedAt: new Date() },
    });
    return { count: result.count, connectionIds };
  }
}
