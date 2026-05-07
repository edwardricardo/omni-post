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
    // updateManyAndReturn (Prisma 6.2.0+) — single SQL roundtrip via Postgres
    // RETURNING. Replaces legacy findMany+updateMany 2-query pattern.
    const updated = await this.prisma.providerConnection.updateManyAndReturn({
      where: { providerId: providerEnum, isActive: true },
      data: { isActive: false, updatedAt: new Date() },
      select: { id: true },
    });
    return { count: updated.length, connectionIds: updated.map((r) => r.id) };
  }
}
