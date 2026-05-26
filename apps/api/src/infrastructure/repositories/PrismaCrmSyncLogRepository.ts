/**
 * @file PrismaCrmSyncLogRepository.ts
 * @description Prisma implementation of CrmSyncLogRepository. Tracks sync job progress.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type {
  CrmSyncLogRepository,
  CrmSyncLogData,
  CreateCrmSyncLogInput,
  UpdateCrmSyncLogInput,
} from "@core/domain/repositories/CrmSyncLogRepository.js";

export class PrismaCrmSyncLogRepository implements CrmSyncLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateCrmSyncLogInput): Promise<CrmSyncLogData> {
    const status = (data.status ?? "RUNNING") as "RUNNING" | "COMPLETED" | "FAILED" | "PARTIAL";
    const row = await this.prisma.crmSyncLog.create({
      data: {
        connectionId: data.connectionId,
        status,
      },
    });
    return this.toData(row);
  }

  async update(id: string, data: UpdateCrmSyncLogInput): Promise<CrmSyncLogData> {
    const updateData: Record<string, unknown> = {};
    if (data.completedAt !== undefined) updateData.completedAt = data.completedAt;
    if (data.contactsSynced !== undefined) updateData.contactsSynced = data.contactsSynced;
    if (data.activitiesSynced !== undefined) updateData.activitiesSynced = data.activitiesSynced;
    if (data.errors !== undefined) updateData.errors = data.errors;
    if (data.status !== undefined) updateData.status = data.status;

    const row = await this.prisma.crmSyncLog.update({
      where: { id },
      data: updateData,
    });
    return this.toData(row);
  }

  async findByConnectionId(connectionId: string): Promise<CrmSyncLogData[]> {
    const rows = await this.prisma.crmSyncLog.findMany({
      where: { connectionId },
      orderBy: { startedAt: "desc" },
    });
    return rows.map((r) => this.toData(r));
  }

  private toData(row: {
    id: string;
    connectionId: string;
    startedAt: Date;
    completedAt: Date | null;
    contactsSynced: number;
    activitiesSynced: number;
    errors: unknown;
    status: string;
  }): CrmSyncLogData {
    return {
      id: row.id,
      connectionId: row.connectionId,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      contactsSynced: row.contactsSynced,
      activitiesSynced: row.activitiesSynced,
      errors: row.errors,
      status: row.status,
    };
  }
}
