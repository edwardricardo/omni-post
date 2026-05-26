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
}
