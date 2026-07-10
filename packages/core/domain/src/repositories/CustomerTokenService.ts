/**
 * @file CustomerTokenService.ts
 * @description Port for the customer-facing token lifecycle (issue, verify and
 *              decode refresh tokens). Application use cases depend on this
 *              interface; the infrastructure adapter wraps the concrete JWT
 *              implementation. Scoped to customer tokens — admin tokens use a
 *              separate secret and are out of this contract.
 * @layer domain
 */

import { type Result } from "@shared/types";

/** Claims embedded in a customer access token (the signer derives `type`). */
export interface CustomerAccessClaims {
  /** CustomerUser.id */
  sub: string;
  /** Account ID — always present for multi-tenant isolation */
  accountId: string;
  /** CustomerRole.id */
  roleId: string;
  /** CustomerRole.name (denormalised for fast checks) */
  roleName: string;
  /** Permission strings granted by the role at sign time (snapshot) */
  permissions: readonly string[];
}

/** Claims read back from a customer refresh token. */
export interface CustomerRefreshClaims {
  /** CustomerUser.id */
  sub: string;
  /** Opaque session identifier used to gate revocation */
  sessionId: string;
}

/**
 * Lifetime of a customer login MFA challenge, in seconds. One source of truth
 * feeds both the JWT `expiresIn` (via the signer) and the single-use store TTL
 * (via the use case). 180s sits in the middle of the OWASP 2–5 min guidance for
 * short-lived high-value artifacts; a challenge is by design ephemeral and never
 * survives a restart. Promoted to env only if per-environment tuning is ever
 * needed (a small follow-up), keeping SECURITY_CANON env surface minimal today.
 */
export const CUSTOMER_MFA_CHALLENGE_TTL_SECONDS = 180;

/**
 * Claims embedded in a customer login MFA challenge token (the 4th customer
 * token kind). Carries the subject + account for a tenant-explicit step-2
 * lookup, the single-use `jti`, and hash-only IP/UA binding.
 */
export interface CustomerMfaChallengeClaims {
  /** CustomerUser.id */
  sub: string;
  /** Account ID — set at step 1 from the same row `sub` identifies; step 2
   *  cross-checks it against the loaded user's `accountId` and rejects a
   *  mismatch as `INVALID_CHALLENGE` (byte-identical, no oracle), keeping the
   *  lookup tenant-explicit as an enforced invariant, not an assumption. */
  accountId: string;
  /** 128-bit single-use id, consumed from the challenge store at step 2 */
  jti: string;
  /** SHA-256 hex of the trusted client IP (hash-only: token reaches the browser) */
  iph: string;
  /** SHA-256 hex of the raw user-agent (hash-only: token reaches the browser) */
  uah: string;
}

/** Failure modes when verifying a refresh token. */
export type TokenVerifyError = "INVALID_TOKEN";

export interface CustomerTokenService {
  /** Issue a short-lived access token for the given claims. */
  signAccessToken(claims: CustomerAccessClaims): string;
  /** Issue a long-lived refresh token bound to a user + session. */
  signRefreshToken(userId: string, sessionId: string): string;
  /**
   * Verify a refresh token's signature, expiry and type. Returns the claims on
   * success; never throws across the boundary — failure is a typed `Result`.
   */
  verifyRefreshToken(token: string): Result<CustomerRefreshClaims, TokenVerifyError>;
  /**
   * Decode a refresh token WITHOUT verifying its signature or expiry, used to
   * revoke a session even for expired/malformed tokens. Returns null when the
   * token cannot be parsed into refresh claims.
   */
  decodeRefreshToken(token: string): CustomerRefreshClaims | null;

  /**
   * Sign a short-lived customer login MFA challenge token. Pins issuer +
   * a DEDICATED audience so it is cryptographically distinct from access and
   * refresh tokens; expiry is `CUSTOMER_MFA_CHALLENGE_TTL_SECONDS`.
   */
  signMfaChallengeToken(claims: CustomerMfaChallengeClaims): string;

  /**
   * Verify a customer login MFA challenge token's signature, expiry, algorithm,
   * issuer, audience and type. Returns the claims on success; never throws —
   * failure is a typed `Result`. An access/refresh token presented here is
   * rejected (audience + type mismatch), and vice versa.
   */
  verifyMfaChallengeToken(token: string): Result<CustomerMfaChallengeClaims, TokenVerifyError>;
}
