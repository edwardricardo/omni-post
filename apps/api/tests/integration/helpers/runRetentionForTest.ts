/**
 * @file runRetentionForTest.ts
 * @description Helper para integration tests de §4.3 (GDPR + retention). Construye
 *   un `DataRetentionService` con los 4 adapters Prisma reales + un `AuditEmitter`
 *   stub (no necesitamos persistir el audit log del retention cleanup mismo durante
 *   tests). Llama `runRetentionCleanup()` y retorna el resultado.
 *
 *   Aisla la dependencia para que los tests no necesiten construir el
 *   container DI completo de apps/api (con SagaManager, BullMQ, Redis, etc.).
 *
 *   Workstream: §4.3 Normalization Roadmap Phase A1.
 *
 * @layer infrastructure
 */
import { prisma } from "@infra/prisma";
import { DataRetentionService } from "@core/application/compliance/DataRetentionService.js";
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
