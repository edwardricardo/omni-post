/**
 * @file types.ts
 * @description TypeScript type definitions for admin authentication including user profiles,
 * token pairs, login responses, Server Action state shapes, and the discriminated auth result union,
 * with the error codes of the sign-in and of the required password change and the catalog message
 * each one shows.
 * @layer infrastructure
 */
import type { Messages } from "next-intl";

import type { AdminRole } from "@shared/types";

export interface AdminUserProfile {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  isActive: boolean;
  emailVerified: boolean;
  mfaEnabled: boolean;
  timezone: string | null;
  locale: string | null;
  department: string | null;
  team: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  csrfToken: string;
}

// ============================================================================
// Server Actions Auth Types
// ============================================================================

/**
 * State shape for the admin login Server Action.
 * Compatible with React 19 useActionState.
 */
export interface AdminAuthState {
  error?: string;
  requiresMfa?: boolean;
  mfaSessionToken?: string;
}

/**
 * Discriminated union returned by authenticateAdmin().
 * Preserves the MFA signal that authenticateWithBackend() loses by returning null, and the
 * API's answer that the administrator must change the password before any session exists.
 */
export type AuthenticateAdminResult =
  | { status: "success"; user: AdminUserProfile; tokens: TokenPair }
  | { status: "mfa_required"; mfaSessionToken: string }
  | { status: "password_change_required" }
  | { status: "error"; error: string };

// ============================================================================
// Error codes
// ============================================================================

/**
 * The error codes of the administrators' sign-in and required password change, as the API
 * answers them, and the portal's own three: `VALIDATION_FAILED` for the API's validation failure,
 * read from the issues its envelope carries, since the API words it with a sentence rather than a
 * code; `UNKNOWN_ERROR` for an answer that names no code it can read (a body that is not JSON, an
 * envelope without a code, a request that never reached the API); and `PASSWORD_MISMATCH` for a
 * new password whose confirmation differs.
 */
export const ADMIN_AUTH_ERROR = {
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  MFA_REQUIRED: "MFA_REQUIRED",
  MFA_INVALID: "MFA_INVALID",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  PASSWORD_CHANGE_REQUIRED: "PASSWORD_CHANGE_REQUIRED",
  PASSWORD_CHANGE_NOT_REQUIRED: "PASSWORD_CHANGE_NOT_REQUIRED",
  CONCURRENT_MODIFICATION: "CONCURRENT_MODIFICATION",
  PASSWORD_TOO_WEAK: "PASSWORD_TOO_WEAK",
  PASSWORD_REUSED: "PASSWORD_REUSED",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  IP_NOT_ALLOWED: "IP_NOT_ALLOWED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
  PASSWORD_MISMATCH: "PASSWORD_MISMATCH",
} as const;

/** The catalog key, under `adminAuthErrors`, of a message for an error code. */
type AdminAuthErrorMessageKey = keyof Messages["adminAuthErrors"];

/** The message of each code the forms can show; any other code shows `unknown`. */
const ADMIN_AUTH_ERROR_MESSAGE_KEYS: ReadonlyMap<string, AdminAuthErrorMessageKey> = new Map([
  [ADMIN_AUTH_ERROR.PASSWORD_MISMATCH, "passwordMismatch"],
  [ADMIN_AUTH_ERROR.INVALID_CREDENTIALS, "invalidCredentials"],
  [ADMIN_AUTH_ERROR.MFA_REQUIRED, "mfaRequired"],
  [ADMIN_AUTH_ERROR.MFA_INVALID, "mfaInvalid"],
  [ADMIN_AUTH_ERROR.ACCOUNT_LOCKED, "accountLocked"],
  [ADMIN_AUTH_ERROR.ACCOUNT_INACTIVE, "accountInactive"],
  [ADMIN_AUTH_ERROR.PASSWORD_CHANGE_NOT_REQUIRED, "passwordChangeNotRequired"],
  [ADMIN_AUTH_ERROR.CONCURRENT_MODIFICATION, "concurrentModification"],
  [ADMIN_AUTH_ERROR.PASSWORD_TOO_WEAK, "passwordTooWeak"],
  [ADMIN_AUTH_ERROR.PASSWORD_REUSED, "passwordReused"],
  [ADMIN_AUTH_ERROR.RATE_LIMIT_EXCEEDED, "rateLimitExceeded"],
  [ADMIN_AUTH_ERROR.IP_NOT_ALLOWED, "ipNotAllowed"],
  [ADMIN_AUTH_ERROR.INTERNAL_ERROR, "internalError"],
  [ADMIN_AUTH_ERROR.VALIDATION_FAILED, "validationFailed"],
]);

/**
 * @description Names the message, under the `adminAuthErrors` catalog namespace, that the
 *   sign-in and the required password change show for an error, so neither form renders the
 *   text the action returned.
 * @param code - The error code, or any other text an action returned as its error
 * @returns The message's catalog key; `unknown` for a code no message names
 */
export function adminAuthErrorMessageKey(code: string): AdminAuthErrorMessageKey {
  return ADMIN_AUTH_ERROR_MESSAGE_KEYS.get(code) ?? "unknown";
}

/** One problem the API's validation failure names: the path of the field and the API's text. */
export interface ApiValidationIssue {
  path: string;
  message: string;
}

// ============================================================================
// Required password change
// ============================================================================

/**
 * What the required password change sends: the e-mail, the current password, the new one, and
 * the second factor's code once the API has asked for it.
 */
export interface RequiredPasswordChangeInput {
  email: string;
  currentPassword: string;
  newPassword: string;
  mfaToken?: string;
}

/** The answer of the required password change: changed, or the API's error code. */
export type RequiredPasswordChangeResult =
  { status: "changed" } | { status: "error"; error: string; issues?: ApiValidationIssue[] };

/**
 * State shape for the required password change Server Action, compatible with React 19
 * `useActionState`: the error code to show, the fields a validation failure names, and whether
 * the form asks for the second factor's code.
 */
export interface RequiredPasswordChangeState {
  error?: string;
  invalidFields?: string[];
  requiresMfa?: boolean;
}
