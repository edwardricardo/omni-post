/**
 * @file InMemoryAuditEmitter.ts
 * @description In-memory implementation of AuditEmitterPort for unit tests.
 *              Tests can assert on `emitted` to verify the cluster emitted the
 *              expected audit entries. Mirrors the swallow-on-error contract by
 *              storing every entry in insert order and never throwing.
 * @layer infrastructure
 */

import type {
  AuditEmitterPort,
  AuditEmitterInput,
} from "@core/domain/repositories/AuditEmitterPort.js";

export class InMemoryAuditEmitter implements AuditEmitterPort {
  readonly emitted: AuditEmitterInput[] = [];

  async emit(input: AuditEmitterInput): Promise<void> {
    this.emitted.push(input);
  }
}
