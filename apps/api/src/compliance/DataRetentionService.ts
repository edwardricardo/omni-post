/**
 * @file DataRetentionService.ts
 * @description Automated data retention cleanup. Deletes expired audit logs
 *   and marks overdue DSAR requests as EXPIRED. Only runs when
 *   enableAutoDataDeletion is true.
 * @layer application
 */

import type { PrismaClient } from "@infra/prisma";
import { logger } from "../lib/logger.js";

export class DataRetentionService {
  constructor(private readonly prisma: PrismaClient) {}
  async runRetentionCleanup(): Promise<{
    auditLogsDeleted: number;
    expiredDsarRequests: number;
  }> {
    const settings = await this.prisma.gdprSettings.findFirst();
    if (!settings?.enableAutoDataDeletion) {
      return { auditLogsDeleted: 0, expiredDsarRequests: 0 };
    }

    const now = new Date();

    // Delete audit logs older than retention period
    const auditCutoff = new Date(
      now.getTime() - settings.auditLogRetentionDays * 24 * 60 * 60 * 1000
    );
    const deletedAuditLogs = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: auditCutoff } },
    });

    // Mark overdue DSAR requests as EXPIRED
    const expiredDsars = await this.prisma.dsarRequest.updateMany({
      where: {
        deadlineAt: { lt: now },
        status: { in: ["PENDING", "IN_PROGRESS"] },
      },
      data: { status: "EXPIRED" },
    });

    const result = {
      auditLogsDeleted: deletedAuditLogs.count,
      expiredDsarRequests: expiredDsars.count,
    };

    // Log cleanup summary
    await this.prisma.auditLog.create({
      data: {
        action: "DATA_RETENTION_CLEANUP",
        resource: "system",
        details: result as object,
        success: true,
      },
    });

    logger.info(result, "Data retention cleanup completed");

    return result;
  }
}
