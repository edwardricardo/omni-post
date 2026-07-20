/**
 * @file MfaChallengeStorePort.ts
 * @description Technology-free port for the single-use registry that backs the
 *              customer login MFA challenge. Model is an ALLOWLIST: step 1
 *              registers a challenge `jti` with a TTL; step 2 consumes it
 *              atomically so exactly one caller can complete the login. This is
 *              security state (the source of truth for challenge single-use), not
 *              a cache: errors MUST propagate as a typed failure so the gate can
 *              fail CLOSED — never swallowed the way a cache miss is. The Redis
 *              adapter implements `issue` as `SET NX EX` and `consume` as a
 *              `DEL`-count, so a flush kills pending challenges (users restart
 *              login) rather than reopening a replay window.
 * @layer domain
 */

import type { Result } from "@shared/types";

/**
 * The single failure mode of the challenge store. A store outage is reported as
 * this typed error so the login gate can translate it to a fail-closed 503 with
 * loud telemetry — it is never conflated with a legitimate "not found".
 */
export type MfaChallengeStoreError = "STORE_ERROR";

/**
 * Allowlist store for one-time MFA login challenges. Consumers receive this
 * interface by constructor injection from the composition root; they never
 * import a concrete Redis adapter.
 */
export interface MfaChallengeStorePort {
  /**
   * Register a challenge `jti` as valid for `ttlSeconds`. Idempotent-safe: a
   * `jti` is a 128-bit random value, so a collision is not a concern. Errors
   * MUST propagate (fail-closed gate) — a failed `issue` means the login cannot
   * safely proceed.
   *
   * @param jti - The challenge token's unique id (128-bit hex).
   * @param ttlSeconds - Lifetime of the challenge (matches the JWT expiry).
   * @returns Ok(void) when registered, Err("STORE_ERROR") on any store fault.
   */
  issue(jti: string, ttlSeconds: number): Promise<Result<void, MfaChallengeStoreError>>;

  /**
   * Atomically consume a `jti`. Exactly one caller per `jti` receives
   * `"CONSUMED"`; every other caller (already consumed, expired, or never
   * issued) receives `"NOT_FOUND"`. This atomicity is the single-session
   * serializer under concurrent step-2 requests.
   *
   * @param jti - The challenge token's unique id.
   * @returns Ok("CONSUMED") to the unique winner, Ok("NOT_FOUND") to losers,
   *          Err("STORE_ERROR") on any store fault (fail-closed).
   */
  consume(jti: string): Promise<Result<"CONSUMED" | "NOT_FOUND", MfaChallengeStoreError>>;
}
