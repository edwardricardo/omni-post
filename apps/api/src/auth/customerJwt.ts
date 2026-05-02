/**
 * @file customerJwt.ts
 * @description JWT signing and verification utilities for customer-facing authentication.
 *   Uses a separate secret from admin JWT to ensure token isolation between
 *   admin and customer auth domains.
 * @layer infrastructure
 */

import jwt from "jsonwebtoken";

import { env } from "../config/env.js";

/**
 * Payload embedded in customer access tokens.
 */
export interface CustomerJwtPayload {
  /** CustomerUser.id */
  sub: string;
  /** Account ID -- always present for multi-tenant isolation */
  accountId: string;
  /** TeamRole value */
  role: string;
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

const CUSTOMER_JWT_SECRET = env.CUSTOMER_JWT_SECRET;
const CUSTOMER_JWT_EXPIRY = 15 * 60; // 15 minutes

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
  const decoded = jwt.verify(token, CUSTOMER_JWT_SECRET) as CustomerRefreshPayload;

  if (decoded.type !== "customer-refresh") {
    throw new Error("Not a customer refresh token");
  }

  return decoded;
}
