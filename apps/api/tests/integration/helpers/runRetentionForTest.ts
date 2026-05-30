/**
 * @file runRetentionForTest.ts
 * @description Helper for GDPR + retention integration tests. Builds a
 *   `DataRetentionService` with the four real Prisma adapters plus a stub
 *   `AuditEmitter` (we don't need to persist the retention cleanup's own audit
 *   log during tests). Calls `runRetentionCleanup()` and returns the result.
 *
 *   Isolates the dependency so tests don't need to construct the full apps/api
 *   DI container (with SagaManager, BullMQ, Redis, etc.).
 *
 * @layer infrastructure
 */
import { prisma } from "@infra/prisma";
import { DataRetentionService } from "@core/compliance/DataRetentionService.js";
import { PrismaGdprSettingsRepository } from "../../../src/infrastructure/repositories/PrismaGdprSettingsRepository.js";
import { PrismaAuditLogRetentionRepository } from "../../../src/infrastructure/repositories/PrismaAuditLogRetentionRepository.js";
import { PrismaDsarRequestRepository } from "../../../src/infrastructure/repositories/PrismaDsarRequestRepository.js";
import type {
  AuditEmitterPort,
  AuditEmitterInput,
} from "@core/domain/repositories/AuditEmitterPort.js";

class NoopAuditEmitter implements AuditEmitterPort {
  async emit(_input: AuditEmitterInput): Promise<void> {
    // Tests no necesitan persistir el audit log del cleanup mismo —
    // verificamos solo los efectos sobre AuditLog + DsarRequest.
  }
}

export async function runRetentionForTest(): Promise<{
  auditLogsDeleted: number;
  expiredDsarRequests: number;
}> {
  const gdprRepo = new PrismaGdprSettingsRepository(prisma);
  const auditLogRetention = new PrismaAuditLogRetentionRepository(prisma);
  const dsarRepo = new PrismaDsarRequestRepository(prisma);
  const auditEmitter = new NoopAuditEmitter();

  const service = new DataRetentionService(gdprRepo, auditLogRetention, dsarRepo, auditEmitter);
  return service.runRetentionCleanup();
}
