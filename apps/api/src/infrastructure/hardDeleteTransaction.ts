/**
 * @file hardDeleteTransaction.ts
 * @description Transaction bounds for the irreversible account/project hard delete, in one
 *              place so the repository's own transaction and the dedicated Unit of Work that
 *              wraps it agree byte-for-byte. Two invariants live here:
 *                - Serializable isolation, so the tombstone snapshot cannot miss a row that a
 *                  concurrent insert commits mid-transaction: such a row makes this transaction
 *                  abort (serialization failure) rather than be destroyed without a tombstone.
 *                - An explicit, sized timeout, so a large cascade is bounded by a real budget
 *                  instead of the driver's short default — paired with the use-case pre-flight
 *                  size probe, which refuses a tenant too large to finish inside this budget.
 * @layer infrastructure
 */

import { Prisma } from "@infra/prisma";

/**
 * Maximum wall-clock time (ms) a single hard-delete transaction may run before
 * the database rolls it back. Generous because a full-tenant cascade over an
 * indexed graph still takes real time, but bounded so a runaway can never hold
 * locks indefinitely. The use-case size ceiling is sized to complete within it.
 */
export const HARD_DELETE_TX_TIMEOUT_MS = 120_000;

/**
 * Maximum time (ms) to wait to acquire the transaction from the connection pool
 * before failing fast, so a saturated pool surfaces as a prompt, retryable error
 * rather than a hang.
 */
export const HARD_DELETE_TX_MAX_WAIT_MS = 10_000;

/**
 * The concrete transaction options for a standalone hard-delete transaction.
 * The dedicated hard-delete Unit of Work is constructed with the equivalent
 * bounds so the joined path and the standalone path behave identically.
 */
export const HARD_DELETE_TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  timeout: HARD_DELETE_TX_TIMEOUT_MS,
  maxWait: HARD_DELETE_TX_MAX_WAIT_MS,
} as const;
