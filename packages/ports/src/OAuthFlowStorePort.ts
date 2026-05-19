/**
 * @file OAuthFlowStorePort.ts
 * @description Technology-free port for the short-lived OAuth authorization
 *              flow record (CSRF `state` binding + PKCE `code_verifier`).
 *              The record outlives a single HTTP request (it spans the
 *              authorization redirect and the provider callback) so it must
 *              live in shared, cross-pod storage with a TTL — never in
 *              process memory. The concrete adapter lives in infrastructure;
 *              application/domain depend only on this interface.
 * @layer domain
 */

/**
 * One in-flight OAuth authorization, keyed by the opaque `state` value.
 * Bound to the initiating account/project so the callback cannot be
 * replayed against a different tenant.
 */
export interface OAuthFlowRecord {
  /** Provider the flow was started for (must match on callback). */
  readonly providerId: string;
  /** Account that initiated the connect (tenant binding). */
  readonly accountId: string;
  /** Project the resulting channel belongs to. */
  readonly projectId: string;
  /** PKCE code_verifier (RFC 7636) to send at token exchange. */
  readonly codeVerifier: string;
  /** ISO-8601 creation timestamp (diagnostics; TTL is enforced by the store). */
  readonly createdAt: string;
}

/**
 * Stores and single-use-consumes the authorization flow record.
 * Implementations MUST enforce the TTL and MUST make `consume`
 * idempotently single-use (a replayed `state` resolves to null).
 */
export interface OAuthFlowStorePort {
  /**
   * Persist a flow record under `state` for at most `ttlSeconds`.
   */
  put(state: string, record: OAuthFlowRecord, ttlSeconds: number): Promise<void>;

  /**
   * Fetch and atomically remove the record for `state`. Returns null when
   * the state is unknown, already consumed, or expired (single-use).
   */
  consume(state: string): Promise<OAuthFlowRecord | null>;
}
