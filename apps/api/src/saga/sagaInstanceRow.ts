/**
 * @file sagaInstanceRow.ts
 * @description Single conversion from a persisted `SagaInstance` row to the
 *              domain type, shared by the by-id load and the boot scan. It lives
 *              in its own module so the lifecycle and the execution engine can
 *              both use it without importing each other.
 *
 *              The tenant column is load-bearing here: it is the AUTHORITATIVE
 *              source of the account that owns a detached saga, so a
 *              deserializer that drops it hands back an instance no scope can
 *              ever address — the exact class of row a data repair fixes in the
 *              column and nowhere else. One implementation makes it impossible
 *              to carry the column in only one of the two paths.
 * @layer infrastructure
 */
import type { SagaInstance } from "@shared/types/saga.js";

/** The persisted columns the deserializer reads. */
export interface SagaInstanceRow {
  id: string;
  definitionId: string;
  status: string;
  currentStep: number;
  accountId?: string | null;
  context: unknown;
  stepResults: unknown;
  compensationResults: unknown;
  retryCount: number;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
  nextRetryAt?: Date | null;
  /**
   * Last write to the row, applied by the database on every persist. It is the
   * LIVENESS anchor for a compensating saga: the walk writes at its transition
   * and after every step, so a horizon measured from here separates a walk that
   * is running from one that stopped — which `startedAt` cannot do.
   */
  updatedAt?: Date | null;
}

/**
 * @function deserializeSagaInstanceRow
 * @description Converts a persisted row into the domain saga instance, carrying
 *   the tenant column onto it.
 * @param row - The persisted row.
 * @returns The domain saga instance.
 */
export function deserializeSagaInstanceRow(row: SagaInstanceRow): SagaInstance {
  return {
    id: row.id,
    definitionId: row.definitionId,
    status: row.status as SagaInstance["status"],
    currentStep: row.currentStep,
    ...(typeof row.accountId === "string" && { accountId: row.accountId }),
    context: row.context as SagaInstance["context"],
    stepResults: row.stepResults as SagaInstance["stepResults"],
    compensationResults: row.compensationResults as SagaInstance["compensationResults"],
    retryCount: row.retryCount,
    startedAt: row.startedAt,
    ...(row.error !== null && { error: row.error }),
    ...(row.completedAt !== null && { completedAt: row.completedAt }),
    ...(row.nextRetryAt && { nextRetryAt: row.nextRetryAt }),
    ...(row.updatedAt && { updatedAt: row.updatedAt }),
  };
}
