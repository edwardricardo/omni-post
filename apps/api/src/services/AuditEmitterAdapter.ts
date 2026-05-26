/**
 * @file AuditEmitterAdapter.ts
 * @description Concrete adapter implementing `AuditEmitterPort` (defined in
 *   `@core/domain`). Wraps `AuditLogRepository.create()` with the swallow-on-
 *   error + logger contract previously provided by the free-function helper
 *   `emitAudit` in this folder. Application-layer services in
 *   `@core/application` depend on the port, not on this adapter — keeping the
 *   core boundary clean.
 * @layer infrastructure
 */
import type {
  AuditEmitterPort,
  AuditEmitterInput,
} from "@core/domain/repositories/AuditEmitterPort.js";
import type { AuditLogRepository } from "@core/domain/repositories/AuditLogRepository.js";
import { emitAudit } from "./audit.js";

export class AuditEmitterAdapter implements AuditEmitterPort {
  constructor(private readonly auditLog: AuditLogRepository) {}

  emit(input: AuditEmitterInput): Promise<void> {
    return emitAudit(this.auditLog, input);
  }
}
