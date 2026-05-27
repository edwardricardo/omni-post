/**
 * @file PrismaAuditLogRetentionRepository.ts
 * @description Prisma adapter implementing `AuditLogRetentionPort`: recent
 *   audit-activity count + bulk deletion of old rows.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import type {
  AuditLogRetentionError,
  AuditLogRetentionPort,
} from "@core/domain/repositories/AuditLogRetentionPort.js";

export class PrismaAuditLogRetentionRepository implements AuditLogRetentionPort {
  constructor(private readonly prisma: PrismaClient) {}

  async countSince(since: Date): Promise<Result<number, AuditLogRetentionError>> {
    try {
      const count = await this.prisma.auditLog.count({
        where: { createdAt: { gte: since } },
      });
      return ok(count);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async deleteOlderThan(before: Date): Promise<Result<number, AuditLogRetentionError>> {
    try {
      const result = await this.prisma.auditLog.deleteMany({
        where: { createdAt: { lt: before } },
      });
      return ok(result.count);
    } catch {
      return err("DATABASE_ERROR");
    }
  }
}
