/**
 * @file backend-client.ts
 * @description Server-side API client for proxying authenticated requests from the admin
 * dashboard to the Fastify backend via httpOnly session cookies. Provides login, token
 * verification, token refresh, logout, and health-check functions.
 */

import { ConsoleLoggerAdapter } from "@observability/browser-logger";

import type { AdminUserProfile, AuthenticateAdminResult, TokenPair } from "./types";

const log = new ConsoleLoggerAdapter("admin.backend-client", { alwaysEmit: true });

// ============================================================================
// Constants & Configuration
// ============================================================================

// Prefer API_URL (server-side only) over NEXT_PUBLIC_API_URL for Server Actions/RSC
const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

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
 * The API uses `data` field (from BaseRouteHandler.sendSuccess)
 */
interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
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
// Public API Functions
// ============================================================================

/**
 * Authenticate admin user — Server Actions pattern
 *
 * Returns a discriminated union that preserves the MFA signal instead of
 * collapsing both MFA-required and error cases to null.
 *
 * @param credentials - User login credentials (email, password, optional MFA token)
 * @returns Promise resolving to a discriminated union with status "success" | "mfa_required" | "error"
 *
 * @example
 * ```typescript
 * const result = await authenticateAdmin({ email, password });
 * if (result.status === "success") {
 *   // result.user, result.tokens available
 * } else if (result.status === "mfa_required") {
 *   // result.mfaSessionToken available
 * } else {
 *   // result.error message available
 * }
 * ```
 */
export async function authenticateAdmin(
  credentials: LoginCredentials
): Promise<AuthenticateAdminResult> {
  try {
    const response = await fetch(`${API_URL}/admin/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password,
        ...(credentials.mfaToken !== undefined && { mfaToken: credentials.mfaToken }),
        ...(credentials.deviceId !== undefined && { deviceId: credentials.deviceId }),
        ...(credentials.deviceName !== undefined && { deviceName: credentials.deviceName }),
      }),
    });

    const data: ApiResponse<LoginResponseData> = await response.json();

    // Handle MFA requirement — preserve the token so the caller can resubmit
    if (data.data?.requiresMfa) {
      return {
        status: "mfa_required",
        mfaSessionToken: data.data.mfaSessionToken ?? "",
      };
    }

    // Handle error responses
    if (!response.ok || !data.ok) {
      return {
        status: "error",
        error: data.error ?? "Authentication failed",
      };
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
 * Verify access token and retrieve user profile
 *
 * @param accessToken - JWT access token to verify
 * @returns Promise resolving to user profile on success, null on failure
 */
export async function verifyAccessToken(accessToken: string): Promise<AdminUserProfile | null> {
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

/**
 * Logout user from backend
 *
 * Sends logout request to the backend to invalidate the current session.
 * Optionally invalidates all sessions for the user across all devices.
 *
 * @param accessToken - JWT access token for authentication
 * @param allSessions - If true, revoke all user sessions; if false, only current session
 */
export async function logoutFromBackend(
  accessToken: string,
  allSessions: boolean = false
): Promise<void> {
  try {
    const response = await fetch(`${API_URL}/admin/auth/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        allSessions,
      }),
    });

    if (!response.ok) {
      log.error("Logout request failed", { status: response.status });
      // Continue — frontend will clear session regardless
    }
  } catch (error) {
    log.error("Network error during logout", error);
    // Continue — frontend will clear session regardless
  }
}
