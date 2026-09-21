/**
 * @file InMemorySemanticLockStore.ts
 * @description The unit tier's semantic-lock backend. It exists because the only test
 *              implementor of the port was stateless — it answered `ok(true)` to every
 *              acquire and remembered nothing — so no unit test could express "this key is
 *              already held by another saga", which is the whole subject of the publish
 *              admission's contention answer. This one keeps the holders, honours the TTL,
 *              and gates release on the holder exactly as the Redis script does, so a test
 *              that passes here is describing the production semantics rather than a
 *              convenient stub's.
 * @layer infrastructure
 */
import type { Result } from "@shared/types";
import { ok } from "@shared/types";
import type { SemanticLockPort, SemanticLockError } from "@ports/core";

/** One held key: who holds it, and when the hold lapses. */
interface HeldLock {
  readonly sagaId: string;
  readonly expiresAt: number;
}

/**
 * @class InMemorySemanticLockStore
 * @description Map-backed `SemanticLockPort` for the unit tier.
 */
export class InMemorySemanticLockStore implements SemanticLockPort {
  private readonly locks = new Map<string, HeldLock>();

  /**
   * @method acquire
   * @description Takes the key when it is free or its hold has lapsed; otherwise reports
   *              the refusal without disturbing the current holder.
   * @param key - The lock key.
   * @param sagaId - The saga asking for it.
   * @param ttlMs - How long the hold lasts.
   * @returns ok(true) when taken, ok(false) when another saga still holds it.
   */
  async acquire(
    key: string,
    sagaId: string,
    ttlMs: number
  ): Promise<Result<boolean, SemanticLockError>> {
    if (this.live(key) !== undefined) {
      return ok(false);
    }
    this.locks.set(key, { sagaId, expiresAt: Date.now() + ttlMs });
    return ok(true);
  }

  /**
   * @method release
   * @description Drops the key only when `sagaId` is still its holder — the Lua script's
   *              guard, so a saga whose hold lapsed and was retaken cannot clear the new
   *              holder's lock.
   * @param key - The lock key.
   * @param sagaId - The saga claiming to hold it.
   * @returns ok, whether or not anything was dropped.
   */
  async release(key: string, sagaId: string): Promise<Result<void, SemanticLockError>> {
    if (this.live(key)?.sagaId === sagaId) {
      this.locks.delete(key);
    }
    return ok(undefined);
  }

  /**
   * @method releaseAllForSaga
   * @description Drops every key this saga still holds, as terminal-state cleanup does.
   * @param sagaId - The saga reaching a terminal state.
   * @returns ok once the holder set is empty for that saga.
   */
  async releaseAllForSaga(sagaId: string): Promise<Result<void, SemanticLockError>> {
    for (const [key, held] of this.locks) {
      if (held.sagaId === sagaId) {
        this.locks.delete(key);
      }
    }
    return ok(undefined);
  }

  /**
   * @method holder
   * @description The saga holding the key, read without taking it.
   * @param key - The lock key.
   * @returns The holding saga id, or null when the key is free or its hold has lapsed.
   */
  async holder(key: string): Promise<Result<string | null, SemanticLockError>> {
    return ok(this.live(key)?.sagaId ?? null);
  }

  /**
   * @method plantHolder
   * @description Puts a key into the held state without an acquire, so a test can start
   *              from "another saga is already publishing this post" instead of having to
   *              stage the saga that would have taken it.
   * @param key - The lock key.
   * @param sagaId - The saga to record as its holder.
   * @param ttlMs - How long the planted hold lasts; the saga engine's default is 30 minutes.
   */
  plantHolder(key: string, sagaId: string, ttlMs = 30 * 60 * 1000): void {
    this.locks.set(key, { sagaId, expiresAt: Date.now() + ttlMs });
  }

  /**
   * @method live
   * @description The entry for a key when its hold has not lapsed. Expiry is applied on
   *              READ rather than by a timer: a test that advances the clock must see the
   *              same lapse production sees, and a timer would keep the process alive.
   * @param key - The lock key.
   * @returns The live entry, or undefined.
   */
  private live(key: string): HeldLock | undefined {
    const held = this.locks.get(key);
    if (held === undefined) {
      return undefined;
    }
    if (held.expiresAt <= Date.now()) {
      this.locks.delete(key);
      return undefined;
    }
    return held;
  }
}
