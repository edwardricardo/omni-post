/**
 * @file adminAuthConfig.ts
 * @description Centralized configuration for admin authentication system including
 *              JWT tokens, password policies, MFA, security policies, and rate limiting.
 * @layer infrastructure
 */

import type { AdminAuthConfig } from "./adminAuthTypes.js";
import { env } from "../../config/env.js";

/**
 * Admin authentication configuration. JWT secrets are validated at boot via
 * the Zod schema in `apps/api/src/config/env.ts` (fail-fast, no fallback).
 */
export const adminAuthConfig: AdminAuthConfig = {
  jwt: {
    accessTokenSecret: env.ADMIN_JWT_ACCESS_SECRET,
    refreshTokenSecret: env.ADMIN_JWT_REFRESH_SECRET,
    accessTokenExpiration: "15m",
    refreshTokenExpiration: "7d",
    refreshTokenExpirationRememberMe: "30d",
    issuer: "omnipost-admin",
    audience: "omnipost-admin-api",
  },
  passwordPolicy: {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    preventPasswordReuse: 5,
    maxPasswordAge: 90, // days
    minPasswordAge: 1, // days
  },
  mfa: {
    issuer: "OmniPost Admin",
    backupCodesCount: 10,
  },
  security: {
    maxLoginAttempts: 5,
    lockoutDurationMinutes: 30,
    sessionInactivityTimeout: 30, // minutes
    maxConcurrentSessions: 3,
    requireMfaForRole: ["SUPER_ADMIN"], // Require MFA for super admins
  },
  rateLimit: {
    loginAttemptsPerMinute: 5,
    loginAttemptsPerHour: 20,
  },
};
