/**
 * Admin Authentication Configuration
 *
 * Centralized configuration for admin authentication system including:
 * - JWT token settings
 * - Password policies
 * - MFA settings
 * - Security policies
 * - Rate limiting
 */

import type { AdminAuthConfig } from "./adminAuthTypes";
import { getRequiredSecret } from "../../lib/envValidation.js";

/**
 * Admin authentication configuration
 * JWT secrets are required in production (will throw if missing).
 */
export const adminAuthConfig: AdminAuthConfig = {
  jwt: {
    accessTokenSecret: getRequiredSecret("ADMIN_JWT_ACCESS_SECRET", "admin-jwt-access-dev-only"),
    refreshTokenSecret: getRequiredSecret("ADMIN_JWT_REFRESH_SECRET", "admin-jwt-refresh-dev-only"),
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
