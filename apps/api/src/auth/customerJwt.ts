/**
 * @file customerJwt.ts
 * @description JWT signing and verification utilities for customer-facing authentication.
 *   Uses a separate secret from admin JWT to ensure token isolation between
 *   admin and customer auth domains.
 * @layer infrastructure
 */

import jwt from "jsonwebtoken";

import { env } from "../config/env.js";
import { CUSTOMER_MFA_CHALLENGE_TTL_SECONDS } from "@core/domain/repositories/CustomerTokenService.js";

/**
 * Payload embedded in customer access tokens.
 */
export interface CustomerJwtPayload {
  /** CustomerUser.id */
  sub: string;
  /** Account ID -- always present for multi-tenant isolation */
  accountId: string;
  /** CustomerRole.id (FK on CustomerUser) */
  roleId: string;
  /** CustomerRole.name (denormalised for fast checks: "OWNER", "MANAGER", etc.) */
  roleName: string;
  /** Permission strings granted by the role at sign time. Snapshot — not refetched
   *  per request. A role change invalidates the previous token (rotate via refresh). */
  permissions: readonly string[];
  /** Discriminator to reject admin tokens */
  type: "customer";
}

/**
 * Payload embedded in customer refresh tokens.
 */
export interface CustomerRefreshPayload {
  sub: string;
  sessionId: string;
  type: "customer-refresh";
}

/**
 * Payload embedded in a customer login MFA challenge token — the 4th customer
 * token kind. Carries hash-only IP/UA binding (`iph`/`uah`) and the single-use
 * `jti` consumed server-side at step 2.
 */
export interface CustomerMfaChallengePayload {
  /** CustomerUser.id */
  sub: string;
  /** Account ID — keeps the step-2 lookup tenant-explicit */
  accountId: string;
  /** 128-bit single-use id, consumed from the challenge store at step 2 */
  jti: string;
  /** SHA-256 hex of the trusted client IP (hash-only: token reaches the browser) */
  iph: string;
  /** SHA-256 hex of the raw user-agent (hash-only: token reaches the browser) */
  uah: string;
  /** Discriminator to reject access/refresh tokens */
  type: "customer-mfa-challenge";
}

const CUSTOMER_JWT_SECRET = env.CUSTOMER_JWT_SECRET;
const CUSTOMER_JWT_EXPIRY = 15 * 60; // 15 minutes

/**
 * Dedicated audience for the login MFA challenge. Distinct from the access
 * token's `omnipost-customer-api` so a challenge and an access token are
 * cryptographically non-interchangeable: each verifier's `aud` check rejects
 * the other kind before the payload `type` discriminator is even read.
 */
const CUSTOMER_MFA_CHALLENGE_AUDIENCE = "omnipost-customer-mfa";

/**
 * @function signCustomerAccessToken
 * @description Creates a short-lived access token for a customer user.
 */
export function signCustomerAccessToken(payload: Omit<CustomerJwtPayload, "type">): string {
  return jwt.sign({ ...payload, type: "customer" }, CUSTOMER_JWT_SECRET, {
    expiresIn: CUSTOMER_JWT_EXPIRY,
    issuer: "omnipost-customer",
    audience: "omnipost-customer-api",
  });
}

/**
 * @function verifyCustomerToken
 * @description Verifies and decodes a customer access token. Rejects non-customer tokens.
 */
export function verifyCustomerToken(token: string): CustomerJwtPayload {
  const decoded = jwt.verify(token, CUSTOMER_JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: "omnipost-customer",
    audience: "omnipost-customer-api",
  }) as CustomerJwtPayload;

  if (decoded.type !== "customer") {
    throw new Error("Not a customer token");
  }

  return decoded;
}

/**
 * @function signCustomerRefreshToken
 * @description Creates a long-lived refresh token (7 days) for session renewal.
 */
export function signCustomerRefreshToken(userId: string, sessionId: string): string {
  return jwt.sign({ sub: userId, sessionId, type: "customer-refresh" }, CUSTOMER_JWT_SECRET, {
    expiresIn: "7d",
  });
}

/**
 * @function verifyCustomerRefreshToken
 * @description Verifies and decodes a customer refresh token.
 */
export function verifyCustomerRefreshToken(token: string): CustomerRefreshPayload {
  const decoded = jwt.verify(token, CUSTOMER_JWT_SECRET, {
    algorithms: ["HS256"],
  }) as CustomerRefreshPayload;

  if (decoded.type !== "customer-refresh") {
    throw new Error("Not a customer refresh token");
  }

  return decoded;
}

/**
 * @function decodeCustomerRefreshToken
 * @description Decodes a customer refresh token WITHOUT verifying its signature
 *   or expiry. Used to revoke a session even for expired/malformed tokens.
 *   Returns null when the token cannot be parsed into a refresh payload.
 */
export function decodeCustomerRefreshToken(token: string): CustomerRefreshPayload | null {
  const decoded = jwt.decode(token);
  if (
    decoded === null ||
    typeof decoded === "string" ||
    decoded.type !== "customer-refresh" ||
    typeof decoded.sessionId !== "string" ||
    decoded.sessionId.length === 0 ||
    typeof decoded.sub !== "string"
  ) {
    return null;
  }
  return { sub: decoded.sub, sessionId: decoded.sessionId, type: "customer-refresh" };
}

/**
 * @function signCustomerMfaChallengeToken
 * @description Creates a short-lived (180s) customer login MFA challenge token.
 *   Pins issuer + a DEDICATED audience so it cannot be presented as an access or
 *   refresh token. Same HS256 secret as the other customer kinds — the single
 *   issuer IS the single verifier, so asymmetric keys buy nothing (design
 *   Decision 4).
 */
export function signCustomerMfaChallengeToken(
  payload: Omit<CustomerMfaChallengePayload, "type">
): string {
  return jwt.sign({ ...payload, type: "customer-mfa-challenge" }, CUSTOMER_JWT_SECRET, {
    expiresIn: CUSTOMER_MFA_CHALLENGE_TTL_SECONDS,
    issuer: "omnipost-customer",
    audience: CUSTOMER_MFA_CHALLENGE_AUDIENCE,
  });
}

/**
 * @function verifyCustomerMfaChallengeToken
 * @description Verifies and decodes a customer login MFA challenge token. Pins
 *   the algorithm (HS256), issuer, and the dedicated audience, then re-checks the
 *   payload `type` — an access/refresh token fails the `aud` check first, a
 *   token of any other `type` is rejected explicitly.
 */
export function verifyCustomerMfaChallengeToken(token: string): CustomerMfaChallengePayload {
  const decoded = jwt.verify(token, CUSTOMER_JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: "omnipost-customer",
    audience: CUSTOMER_MFA_CHALLENGE_AUDIENCE,
  }) as CustomerMfaChallengePayload;

  if (decoded.type !== "customer-mfa-challenge") {
    throw new Error("Not a customer MFA challenge token");
  }

  return decoded;
}
