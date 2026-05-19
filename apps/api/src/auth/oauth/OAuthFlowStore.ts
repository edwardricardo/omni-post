/**
 * @file OAuthFlowStore.ts
 * @description `OAuthFlowStorePort` adapter backed by the shared `CachePort`
 *              (Redis L1+L2 in prod, in-memory in tests). Replaces the former
 *              per-instance `Map` of OAuth states (lost on restart, invisible
 *              cross-pod) and the ad-hoc `pkce:{state}` Redis key with one
 *              TTL'd, cross-pod, single-use record per `state`.
 * @layer infrastructure
 */
import type { CachePort, OAuthFlowRecord, OAuthFlowStorePort } from "@ports/core";

/** Wire key namespace (CachePort applies its own `api:` prefix on top). */
const KEY_PREFIX = "oauth:flow:";

/**
 * @class OAuthFlowStore
 * @description Cross-pod store for the in-flight OAuth authorization record.
 */
export class OAuthFlowStore implements OAuthFlowStorePort {
  constructor(private readonly cache: CachePort) {}

  /**
   * @method put
   * @description Persists the flow record under `state` for `ttlSeconds`.
   * @param state - Opaque CSRF/lookup value.
   * @param record - Tenant-bound flow record (incl. PKCE verifier).
   * @param ttlSeconds - Lifetime; the store relies on the cache TTL to expire.
   */
  async put(state: string, record: OAuthFlowRecord, ttlSeconds: number): Promise<void> {
    await this.cache.set(`${KEY_PREFIX}${state}`, record, { ttlSeconds });
  }

  /**
   * @method consume
   * @description Reads and removes the record (single-use). A replayed or
   *   expired `state` resolves to null. Read-then-delete is not atomic;
   *   the consequence of a rare double-consume is a benign idempotent
   *   reconnect downstream, never a cross-tenant grant (the record carries
   *   its own account/project binding).
   * @param state - The value returned on the provider callback.
   * @returns The record, or null if unknown/consumed/expired.
   */
  async consume(state: string): Promise<OAuthFlowRecord | null> {
    const key = `${KEY_PREFIX}${state}`;
    const record = await this.cache.get<OAuthFlowRecord>(key);
    if (record === null) {
      return null;
    }
    await this.cache.delete(key);
    return record;
  }
}
