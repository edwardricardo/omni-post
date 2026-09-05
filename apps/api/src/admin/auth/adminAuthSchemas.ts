/**
 * @file adminAuthSchemas.ts
 * @description Zod runtime validation schemas for all admin auth endpoints
 *              with compile-time type inference.
 * @layer infrastructure
 *   return { errors: result.error.flatten() };
 * }
 * const validatedData = result.data; // Type-safe!
 * ```
 */

import { z } from "zod";
import { normalizeEmail } from "@core/domain/value-objects/EmailAddress.js";

// ============================================================================
// Reusable Schema Components
// ============================================================================

/**
 * Email validation schema.
 *
 * Validation runs first, then the address is reduced to its canonical identity
 * form through the same helper every write and read path uses — so the admin
 * login surface cannot drift from the rows it authenticates against.
 */
const emailSchema = z.string().email({ message: "Invalid email format" }).transform(normalizeEmail);

/**
 * Password validation schema with strength requirements
 */
const passwordSchema = z
  .string()
  .min(12, { message: "Password must be at least 12 characters long" })
  .max(128, { message: "Password must not exceed 128 characters" })
  .regex(/[a-z]/, { message: "Password must contain at least one lowercase letter" })
  .regex(/[A-Z]/, { message: "Password must contain at least one uppercase letter" })
  .regex(/[0-9]/, { message: "Password must contain at least one number" })
  .regex(/[^a-zA-Z0-9]/, { message: "Password must contain at least one special character" });

/**
 * MFA token validation (6-digit TOTP code)
 */
const mfaTokenSchema = z
  .string()
  .length(6, { message: "MFA token must be exactly 6 digits" })
  .regex(/^\d{6}$/, { message: "MFA token must contain only numbers" });

/**
 * Device ID validation (SHA-256 hash)
 */
const deviceIdSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, { message: "Invalid device ID format" })
  .optional();

/**
 * CSRF token validation (UUID)
 */
const csrfTokenSchema = z.string().uuid({ message: "Invalid CSRF token format" });

// ============================================================================
// Authentication Schemas
// ============================================================================

/**
 * Login request schema
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { message: "Password is required" }),
  mfaToken: mfaTokenSchema.optional(),
  rememberMe: z.boolean().optional().default(false),
  deviceId: deviceIdSchema,
  deviceName: z.string().max(255).optional(),
});

/**
 * Refresh token request schema
 */
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, { message: "Refresh token is required" }),
  csrfToken: csrfTokenSchema,
});

/**
 * Logout request schema
 */
export const logoutSchema = z.object({
  refreshToken: z.string().optional(),
  allSessions: z.boolean().optional().default(false),
});

// ============================================================================
// Password Management Schemas
// ============================================================================

/**
 * Change password request schema
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, { message: "Current password is required" }),
  newPassword: passwordSchema,
  mfaToken: mfaTokenSchema.optional(),
});

/**
 * Reset password request schema (forgot password)
 */
export const resetPasswordRequestSchema = z.object({
  email: emailSchema,
});

/**
 * Reset password confirmation schema
 */
export const resetPasswordConfirmSchema = z.object({
  token: z.string().uuid({ message: "Invalid reset token" }),
  newPassword: passwordSchema,
  turnstileToken: z.string().min(1).optional(),
});

/**
 * Validate password strength schema
 */
export const validatePasswordSchema = z.object({
  password: z.string().min(1),
});

// ============================================================================
// MFA (Multi-Factor Authentication) Schemas
// ============================================================================

/**
 * MFA setup request schema
 */
export const mfaSetupSchema = z.object({
  password: z.string().min(1, { message: "Password confirmation required for MFA setup" }),
});

/**
 * MFA verification schema
 */
export const mfaVerifySchema = z.object({
  token: mfaTokenSchema,
  sessionToken: z.string().optional(), // Temporary session token from login
});

/**
 * MFA disable schema
 */
export const mfaDisableSchema = z.object({
  password: z.string().min(1, { message: "Password confirmation required to disable MFA" }),
  mfaToken: mfaTokenSchema,
});

// ============================================================================
// Session Management Schemas
// ============================================================================

/**
 * Revoke session schema
 */
export const revokeSessionSchema = z.object({
  sessionId: z.string().uuid({ message: "Invalid session ID" }),
  reason: z.string().max(500).optional(),
});

// ============================================================================
// Validation Helper Functions
// ============================================================================

/**
 * Custom password strength validator
 * Returns detailed feedback on password strength
 */
export function validatePasswordStrength(password: string): {
  valid: boolean;
  strength: "WEAK" | "FAIR" | "GOOD" | "STRONG" | "VERY_STRONG";
  errors: string[];
  suggestions: string[];
} {
  const errors: string[] = [];
  const suggestions: string[] = [];
  let score = 0;

  // Length checks
  if (password.length < 12) {
    errors.push("Password must be at least 12 characters long");
  } else if (password.length >= 16) {
    score += 2;
  } else {
    score += 1;
  }

  // Character variety checks
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain lowercase letters");
  } else {
    score += 1;
  }

  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain uppercase letters");
  } else {
    score += 1;
  }

  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain numbers");
  } else {
    score += 1;
  }

  if (!/[^a-zA-Z0-9]/.test(password)) {
    errors.push("Password must contain special characters");
  } else {
    score += 1;
  }

  // Bonus points for extra variety
  const uniqueChars = new Set(password.split("")).size;
  if (uniqueChars >= 15) {
    score += 2;
  } else if (uniqueChars >= 10) {
    score += 1;
  }

  // Common patterns to avoid
  const commonPatterns = [
    /(.)\1{2,}/, // Repeated characters (aaa, 111)
    /^(?:password|admin|user|root|qwerty|12345)/i, // Common passwords
    /(?:abc|123|xyz|qwe|asd|zxc)/i, // Sequential patterns
  ];

  for (const pattern of commonPatterns) {
    if (pattern.test(password)) {
      suggestions.push("Avoid common patterns and repeated characters");
      score = Math.max(0, score - 1);
      break;
    }
  }

  // Determine strength
  let strength: "WEAK" | "FAIR" | "GOOD" | "STRONG" | "VERY_STRONG";
  if (score >= 8) {
    strength = "VERY_STRONG";
  } else if (score >= 6) {
    strength = "STRONG";
  } else if (score >= 4) {
    strength = "GOOD";
  } else if (score >= 2) {
    strength = "FAIR";
  } else {
    strength = "WEAK";
  }

  // Add suggestions based on strength
  if (strength === "WEAK" || strength === "FAIR") {
    if (password.length < 16) {
      suggestions.push("Consider using a longer password (16+ characters)");
    }
    suggestions.push("Mix uppercase, lowercase, numbers, and special characters");
    suggestions.push("Consider using a passphrase (multiple words)");
  }

  return {
    valid: errors.length === 0 && strength !== "WEAK",
    strength,
    errors,
    suggestions,
  };
}
