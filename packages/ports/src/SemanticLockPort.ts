/**
 * @file SemanticLockPort.ts
 * @description Saga semantic lock port (Azure > 15-20). Provides keyed,
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
}
