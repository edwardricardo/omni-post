/**
 * @file backend-client.ts
 * @description Server-side API client for proxying authenticated requests from the admin
 * dashboard to the Fastify backend via httpOnly session cookies. Provides the sign-in, the
 * required password change, token verification and logout, and one reader of the API's error
 * envelope that the sign-in and the change share.
 * @layer infrastructure
 */

import { cache } from "react";
import { headers } from "next/headers";

import { ConsoleLoggerAdapter } from "@observability/browser-logger";

import {
  ADMIN_AUTH_ERROR,
  type AdminUserProfile,
  type ApiValidationIssue,
  type AuthenticateAdminResult,
  type RequiredPasswordChangeInput,
  type RequiredPasswordChangeResult,
  type TokenPair,
} from "./types";
import { env } from "../../lib/env";
import { forwardedForHeaders } from "../http/forwardedFor";

const log = new ConsoleLoggerAdapter("admin.backend-client", { alwaysEmit: true });

// ============================================================================
// Constants & Configuration
// ============================================================================

// Prefer API_URL (server-side only) over NEXT_PUBLIC_API_URL for Server Actions/RSC
const API_URL = env.API_URL || env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Credentials for authentication
 */
export interface LoginCredentials {
  email: string;
  password: string;
  mfaToken?: string;
  deviceId?: string;
  deviceName?: string;
}

/**
 * Backend API response wrapper
 * The API uses `data` field (from BaseRouteHandler.sendSuccess). `error` and `details` are read
 * only through `readApiError`: a route handler's error is a code, while the route limiter and the
 * IP allowlist answer an object with a code.
 */
interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: unknown;
  details?: unknown;
}

/** What `readApiError` reads from an error envelope. */
interface ApiErrorReading {
  code: string;
  issues?: ApiValidationIssue[];
}

/**
 * Login response data structure from backend
 */
interface LoginResponseData {
  user: AdminUserProfile;
  tokens: TokenPair;
  requiresMfa?: boolean;
  mfaSessionToken?: string;
}

/**
 * User response data structure from backend
 */
interface UserResponseData {
  user: AdminUserProfile;
}

// ============================================================================
// Answer reading
// ============================================================================

/** Whether `value` is a non-null object whose fields can be read. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads the answer's body as the API's JSON envelope, or nothing when the body is not JSON (a
 * proxy's error page, an empty body), which the caller reads as an answer without a code.
 */
async function readEnvelope<T>(response: Response): Promise<ApiResponse<T> | undefined> {
  const text = await response.text();
  let parsed: ApiResponse<T> | null;
  try {
    parsed = JSON.parse(text);
  } catch {
    log.error("The API answered with a body that is not JSON", { status: response.status });
    return undefined;
  }
  return isRecord(parsed) ? parsed : undefined;
}

/** The issues of a validation failure's `details`, each with its path and text, if it has any. */
function issuesOf(details: unknown): ApiValidationIssue[] | undefined {
  if (!isRecord(details) || !Array.isArray(details.issues)) {
    return undefined;
  }
  const issues = details.issues.flatMap((issue: unknown) =>
    isRecord(issue) && typeof issue.path === "string" && typeof issue.message === "string"
      ? [{ path: issue.path, message: issue.message }]
      : []
  );
  return issues.length > 0 ? issues : undefined;
}

/**
 * Reads an error answer: its code in text, whether `error` is the code itself or an object
 * carrying one, and a validation failure's issues. An envelope that names no code, or no
 * envelope at all, reads as the portal's `UNKNOWN_ERROR`.
 */
function readApiError(envelope: ApiResponse<unknown> | undefined): ApiErrorReading {
  const error = envelope?.error;
  let code: string = ADMIN_AUTH_ERROR.UNKNOWN_ERROR;
  if (typeof error === "string" && error.length > 0) {
    code = error;
  } else if (isRecord(error) && typeof error.code === "string" && error.code.length > 0) {
    code = error.code;
  }
  const issues = issuesOf(envelope?.details);
  return { code, ...(issues !== undefined && { issues }) };
}

// ============================================================================
// Public API Functions
// ============================================================================

/**
 * Authenticate admin user — Server Actions pattern
 *
 * Returns a discriminated union that preserves the MFA signal instead of
 * collapsing both MFA-required and error cases to null.
 *
 * @description Signs an administrator in through the API, relaying the caller's address. The
 *   result keeps apart a success, a missing second factor, an administrator who must change the
 *   password first, and any other error, whose code comes back as text.
 * @param credentials - User login credentials (email, password, optional MFA token)
 * @returns A discriminated union with status "success", "mfa_required",
 *   "password_change_required" or "error"
 *
 * @example
 * ```typescript
 * const result = await authenticateAdmin({ email, password });
 * if (result.status === "success") {
 *   // result.user, result.tokens available
 * } else if (result.status === "mfa_required") {
 *   // result.mfaSessionToken available
 * } else if (result.status === "password_change_required") {
 *   // no session exists; the password is changed first
 * } else {
 *   // result.error code available
 * }
 * ```
 */
export async function authenticateAdmin(
  credentials: LoginCredentials
): Promise<AuthenticateAdminResult> {
  try {
    // Relay the real client IP so the backend AUTH limiter (5 / 15 min) keys the
    // caller, not this Server Action's socket. `headers()` reads the inbound
    // request headers in the Server Action scope.
    const inbound = await headers();
    const response = await fetch(`${API_URL}/admin/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...forwardedForHeaders(inbound),
      },
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password,
        ...(credentials.mfaToken !== undefined && { mfaToken: credentials.mfaToken }),
        ...(credentials.deviceId !== undefined && { deviceId: credentials.deviceId }),
        ...(credentials.deviceName !== undefined && { deviceName: credentials.deviceName }),
      }),
    });

    const data = await readEnvelope<LoginResponseData>(response);

    // Handle MFA requirement — preserve the token so the caller can resubmit
    if (data?.data?.requiresMfa) {
      return {
        status: "mfa_required",
        mfaSessionToken: data.data.mfaSessionToken ?? "",
      };
    }

    // Handle error responses
    if (!response.ok || data?.ok !== true) {
      const { code } = readApiError(data);
      if (code === ADMIN_AUTH_ERROR.PASSWORD_CHANGE_REQUIRED) {
        return { status: "password_change_required" };
      }
      return { status: "error", error: code };
    }

    // Validate expected shape
    if (!data.data?.user || !data.data?.tokens) {
      return { status: "error", error: "Invalid response from server" };
    }

    return {
      status: "success",
      user: data.data.user,
      tokens: data.data.tokens,
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

/**
 * @description Changes the password of an administrator who must change it, through
 *   `POST /admin/auth/password/change-required`, relaying the caller's address. The API runs the
 *   sign-in's checks on the e-mail, the current password and the second factor's code, and opens
 *   no session: the administrator then signs in with the new password. Never throws.
 * @param input - The e-mail, the current password, the new password, and the second factor's
 *   code once the API has asked for it
 * @returns `changed`, or an error with the API's code in text (and a validation failure's
 *   issues); `UNKNOWN_ERROR` when the answer names no code or the request never reached the API
 */
export async function changeRequiredPassword(
  input: RequiredPasswordChangeInput
): Promise<RequiredPasswordChangeResult> {
  try {
    // The endpoint spends the sign-in's rate-limit bucket, which keys the caller's address.
    const inbound = await headers();
    const response = await fetch(`${API_URL}/admin/auth/password/change-required`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...forwardedForHeaders(inbound),
      },
      body: JSON.stringify({
        email: input.email,
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        ...(input.mfaToken !== undefined && { mfaToken: input.mfaToken }),
      }),
    });

    const envelope = await readEnvelope<unknown>(response);
    if (response.ok && envelope?.ok === true) {
      return { status: "changed" };
    }

    const { code, issues } = readApiError(envelope);
    return { status: "error", error: code, ...(issues !== undefined && { issues }) };
  } catch (error) {
    log.error("The required password change did not reach the API", error);
    return { status: "error", error: ADMIN_AUTH_ERROR.UNKNOWN_ERROR };
  }
}

/**
 * Verify access token and retrieve user profile
 *
 * @param accessToken - JWT access token to verify
 * @returns Promise resolving to user profile on success, null on failure
 */
export const verifyAccessToken = cache(
  async (accessToken: string): Promise<AdminUserProfile | null> => {
    try {
      const response = await fetch(`${API_URL}/admin/auth/me`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      });

      if (!response.ok) {
        return null;
      }

      const data: ApiResponse<UserResponseData> = await response.json();

      if (!data.ok || !data.data?.user) {
        return null;
      }

      return data.data.user;
    } catch (error) {
      log.error("Network or parsing error during token verification", error);
      return null;
    }
  }
);

/**
 * Logout user from backend
 *
 * Sends logout request to the backend to invalidate the current session.
 * Optionally invalidates all sessions for the user across all devices.
 *
 * Backend `/admin/auth/logout` is protected by the CSRF middleware, so the
 * caller MUST pass the active CSRF token (read from the `admin-csrf` cookie
 * by the calling Server Action). Without it, the backend returns 403
 * `CSRF_MISSING` and the JWT remains valid server-side — silently breaking
 * the security guarantee of "logout invalidates the session everywhere."
 *
 * @description Asks the API to end the current session, or every session of the user, and logs a
 *   refusal instead of raising it, since the caller clears the portal's cookies regardless.
 * @param accessToken - JWT access token for authentication
 * @param csrfToken - CSRF token from the `admin-csrf` cookie. Required for
 *                    backend session invalidation; pass `null` only when
 *                    the caller has no active session (rare).
 * @param allSessions - If true, revoke all user sessions; if false, only current session
 */
export async function logoutFromBackend(
  accessToken: string,
  csrfToken: string | null,
  allSessions: boolean = false
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    };
    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken;
    }

    const response = await fetch(`${API_URL}/admin/auth/logout`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        allSessions,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      log.error("Logout request failed — backend session NOT invalidated", {
        status: response.status,
        body: body.slice(0, 200),
      });
      // Continue — frontend will clear session regardless. Log surfaces
      // the failure so observability picks up CSRF / session-state regressions.
    }
  } catch (error) {
    log.error("Network error during logout", error);
    // Continue — frontend will clear session regardless
  }
}
