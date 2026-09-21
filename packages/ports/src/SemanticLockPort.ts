/**
 * @file SemanticLockPort.ts
 * @description Saga semantic lock port (Azure §15-20). Provides keyed,
 *              holder-aware mutual exclusion so two concurrent sagas cannot
 *              progress past the locked step on the same aggregate. The
 *              lock has a TTL so a crashed holder cannot deadlock the
 *              aggregate forever; release is idempotent and gated by the
 *              saga id that acquired it (a different saga cannot release
 *              another's lock).
 * @layer domain
 */
import type { Result } from "@shared/types";

export type SemanticLockError = "CONNECTION_ERROR";

export interface SemanticLockPort {
  /**
   * Try to acquire the lock atomically. Returns ok(true) on success,
   * ok(false) when the lock is already held by a different sagaId.
   * The TTL guards against deadlock if the holder process dies before
   * release.
   */
  acquire(key: string, sagaId: string, ttlMs: number): Promise<Result<boolean, SemanticLockError>>;

  /**
   * Release a single lock keyed by `key`. Only releases if the current
   * holder matches `sagaId` — protects against accidentally clearing a
   * lock held by another saga (e.g., expired-and-reacquired-by-other).
   */
  release(key: string, sagaId: string): Promise<Result<void, SemanticLockError>>;

  /**
   * Release every lock currently held by `sagaId`. Called from saga
   * terminal-state transitions (COMPLETED / FAILED / COMPENSATED) so the
   * holder set never leaks.
   */
  releaseAllForSaga(sagaId: string): Promise<Result<void, SemanticLockError>>;

  /**
   * Read WHO holds `key` without taking it: the saga id when the lock is
   * held, `null` when it is free or its hold has lapsed.
   *
   * A caller that only needs to know whether work is already in flight has
   * no other way to ask. Probing with `acquire` would either take the lock
   * — leaving a key nobody releases, because the prober never becomes a
   * saga — or report `false` without saying who is holding it, and the
   * answer that matters to a customer is the running saga's id.
   *
   * The failure stays a failure rather than collapsing into `null`: a read
   * that could not reach the store has not observed an empty key, and
   * reporting it as one is what would let a second publish through while
   * the first is still running.
   */
  holder(key: string): Promise<Result<string | null, SemanticLockError>>;
}
