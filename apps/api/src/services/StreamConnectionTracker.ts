/**
 * @file StreamConnectionTracker.ts
 * @description Per-process tracker for active SSE connections, keyed by accountId.
 *   Enforces a per-account cap to prevent authenticated DoS via unbounded stream
 *   opens (one attacker exhausting subscription memory + per-connection heartbeats).
 *
 *   Per-PROCESS state is correct here: each SSE connection is held by exactly one
 *   pod (the one that accepted the request), so the cap is "concurrent streams from
 *   one account to THIS pod". Cross-pod aggregation would require shared state
 *   (Redis), but the threat model is N connections to a single process — the
 *   per-process cap addresses the DoS surface directly.
 *
 *   Used by `/analytics/stream` and `/notifications/stream` handlers. Cap is
 *   configurable via `MAX_STREAMS_PER_ACCOUNT` env var (default 10).
 * @layer infrastructure
 */

/**
 * @class StreamConnectionTracker
 * @description Reservation/release tracker for per-account SSE connection caps.
 *   Atomic-ish via JS single-threaded event loop (no race between check and insert
 *   within `tryReserve`).
 */
export class StreamConnectionTracker {
  private readonly byAccount: Map<string, Set<string>> = new Map();
  private readonly maxPerAccount: number;

  constructor(maxPerAccount: number) {
    if (!Number.isInteger(maxPerAccount) || maxPerAccount < 1) {
      throw new Error(
        `StreamConnectionTracker: maxPerAccount must be a positive integer, got ${maxPerAccount}`
      );
    }
    this.maxPerAccount = maxPerAccount;
  }

  /**
   * @method tryReserve
   * @description Atomically checks the cap and reserves a slot for the connection.
   *   Returns `true` if the slot was reserved; `false` if the account already holds
   *   the maximum allowed concurrent streams.
   * @param accountId - The account opening the connection
   * @param subscriptionId - Unique identifier for the connection (used to release)
   * @returns `true` if reserved, `false` if cap reached
   */
  tryReserve(accountId: string, subscriptionId: string): boolean {
    const existing = this.byAccount.get(accountId);
    if (existing && existing.size >= this.maxPerAccount) {
      return false;
    }
    if (!existing) {
      this.byAccount.set(accountId, new Set([subscriptionId]));
    } else {
      existing.add(subscriptionId);
    }
    return true;
  }

  /**
   * @method release
   * @description Releases the reserved slot. Safe to call repeatedly (idempotent).
   * @param accountId - The account whose slot is being released
   * @param subscriptionId - The connection identifier originally reserved
   */
  release(accountId: string, subscriptionId: string): void {
    const set = this.byAccount.get(accountId);
    if (!set) return;
    set.delete(subscriptionId);
    if (set.size === 0) {
      this.byAccount.delete(accountId);
    }
  }

  /**
   * @method getActiveCount
   * @description Returns the current number of active connections for an account.
   *   Used by tests + ops introspection.
   * @param accountId - The account to query
   * @returns Active connection count (0 if account has no active streams)
   */
  getActiveCount(accountId: string): number {
    return this.byAccount.get(accountId)?.size ?? 0;
  }

  /**
   * @method getMaxPerAccount
   * @description Returns the configured cap (for tests + telemetry).
   */
  getMaxPerAccount(): number {
    return this.maxPerAccount;
  }
}
