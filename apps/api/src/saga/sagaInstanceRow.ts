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
import type { SagaInstance, SagaStepResult } from "@shared/types/saga.js";

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
 * One persisted step outcome, in whichever shape the row was written with.
 *
 * @param entry - The recorded outcome, as JSON holds it.
 * @returns The three-state outcome, or `undefined` for a hole — an index no
 *   step ever wrote, which is NOT the same as a step that failed.
 */
function normalizeStepResult(entry: unknown): SagaStepResult | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const record = entry as Record<string, unknown>;
  const data = record.data;
  const compensationData = record.compensationData;

  // THE DISCRIMINATOR WINS, always and first. The precedence IS the guarantee
  // here: this function is documented as read-side forever over "whichever
  // shape the row was written with", so a row carrying BOTH keys — a partial
  // rollout, a repair script, a hand-edited row — must resolve by the field
  // that has three states, never by the boolean that has two. Resolving
  // `success: true` ahead of `outcome: "waiting"` would turn a step that never
  // finished into one that succeeded, and a succeeded step is exactly what the
  // compensation walk undoes.
  if (record.outcome === "succeeded") {
    return {
      outcome: "succeeded",
      ...(data !== undefined && { data }),
      ...(compensationData !== undefined && { compensationData }),
    };
  }
  if (record.outcome === "failed") {
    return {
      outcome: "failed",
      // A recorded failure with no message is still a failure; inventing a
      // neutral one keeps the case's promise that a cause is always present.
      error: typeof record.error === "string" ? record.error : "Step failed",
      ...(compensationData !== undefined && { compensationData }),
    };
  }
  if (record.outcome === "waiting") {
    return {
      outcome: "waiting",
      reason: typeof record.reason === "string" ? record.reason : "Step has not finished",
    };
  }

  // Only then the pre-change boolean shape.
  if (record.success === true) {
    return {
      outcome: "succeeded",
      ...(data !== undefined && { data }),
      ...(compensationData !== undefined && { compensationData }),
    };
  }
  if (record.success === false) {
    return {
      outcome: "failed",
      error: typeof record.error === "string" ? record.error : "Step failed",
      ...(compensationData !== undefined && { compensationData }),
    };
  }

  // Neither key: a HOLE. Note the consequence, because it is a deliberate
  // change of meaning — the pre-change tally counted a keyless entry as a
  // FAILED step (`r && !r.success`), which is an assertion the entry does not
  // support. A row that says nothing about a step is a row that says nothing:
  // it is not counted as completed, not counted as failed, and never treated
  // as an effect to undo.
  return undefined;
}

/**
 * @function normalizeLegacyStepResults
 * @description Reads a persisted step-outcome array in EITHER shape: the
 *   three-state outcome this engine writes, or the boolean `{ success }` shape
 *   rows written before it carry. Read-side forever — there is no data
 *   migration, so a pre-change saga keeps replaying under the contract its
 *   consumers now branch on, and a row whose outcome nobody can read is a hole
 *   rather than a failure the engine would act on.
 *
 *   Both deserialization seams use it: the durable row and the Redis hot copy,
 *   because a normalization present at only one of them hands the engine a
 *   shape it cannot branch on through the other.
 * @param value - The persisted array, as JSON holds it.
 * @returns The outcomes, with holes preserved at their own indices.
 */
export function normalizeLegacyStepResults(value: unknown): SagaStepResult[] {
  if (!Array.isArray(value)) return [];
  const results: SagaStepResult[] = [];
  results.length = value.length;
  for (let index = 0; index < value.length; index++) {
    const normalized = normalizeStepResult(value[index]);
    if (normalized !== undefined) results[index] = normalized;
  }
  return results;
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
    stepResults: normalizeLegacyStepResults(row.stepResults),
    compensationResults: normalizeLegacyStepResults(row.compensationResults),
    retryCount: row.retryCount,
    startedAt: row.startedAt,
    ...(row.error !== null && { error: row.error }),
    ...(row.completedAt !== null && { completedAt: row.completedAt }),
    ...(row.nextRetryAt && { nextRetryAt: row.nextRetryAt }),
    ...(row.updatedAt && { updatedAt: row.updatedAt }),
  };
}
