/**
 * @file auth.ts
 * @description Server Actions for admin authentication using the httpOnly cookie pattern.
 *              Handles login (with optional MFA) and logout. Cookie names + TTLs come from
 *              the shared `lib/auth/sessionCookie` module — single source of truth shared
 *              with the refresh route handler. Session TTL = 15min (matches access token).
 * @layer infrastructure
 */
"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { ConsoleLoggerAdapter } from "@observability/browser-logger";

import type { AdminAuthState } from "@/lib/auth/types";
import { authenticateAdmin, logoutFromBackend } from "@/lib/auth/backend-client";
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  setAuthTokens,
  clearAuthCookies,
} from "@/lib/auth/sessionCookie";

const log = new ConsoleLoggerAdapter("admin.auth-actions", { alwaysEmit: true });

// ---------------------------------------------------------------------------
// Login Action
// ---------------------------------------------------------------------------

/**
 * Server Action for admin login.
 *
 * Signature is compatible with React 19 `useActionState`:
 *   const [state, action] = useActionState(loginAction, null);
 *
 * MFA flow:
 *   1. First submission: email + password → backend returns mfa_required
 *      → return { requiresMfa: true, mfaSessionToken }
 *   2. Second submission: form includes mfaToken hidden field
 *      → backend returns success token → cookie set → redirect
 *
 * IMPORTANT: `redirect()` is called OUTSIDE try/catch because it throws
 * internally (NEXT_REDIRECT) and must not be caught.
 */
export async function loginAction(
  prevState: AdminAuthState | null,
  formData: FormData
): Promise<AdminAuthState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const mfaToken = formData.get("mfaToken") as string | null;
  const mfaSessionToken = formData.get("mfaSessionToken") as string | null;

  if (!email || !password) {
    return { error: "Email and password are required" };
  }

  try {
    const result = await authenticateAdmin({
      email,
      password,
      ...(mfaToken ? { mfaToken } : {}),
      ...(mfaSessionToken ? { deviceId: mfaSessionToken } : {}),
    });

    if (result.status === "mfa_required") {
      return {
        requiresMfa: true,
        mfaSessionToken: result.mfaSessionToken,
      };
    }

    if (result.status === "error") {
      return { error: result.error };
    }

    // result.status === "success"
    await setAuthTokens({
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      csrfToken: result.tokens.csrfToken,
    });
  } catch (error) {
    log.error("Unexpected login error", error);
    return {
      error: error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }

  // Redirect OUTSIDE try/catch — redirect() throws internally (NEXT_REDIRECT)
  redirect("/");
}

// ---------------------------------------------------------------------------
// Logout Action
// ---------------------------------------------------------------------------

/**
 * Server Action for admin logout.
 *
 * Reads the admin-session cookie, calls the backend logout endpoint to
 * invalidate the token, deletes all auth cookies, and redirects to the login page.
 *
 * Backend errors are intentionally swallowed — the cookie is always deleted
 * so the user is always logged out on the frontend regardless.
 */
export async function logoutAction(): Promise<void> {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(SESSION_COOKIE_NAME);
    const csrf = cookieStore.get(CSRF_COOKIE_NAME);

    if (session) {
      // Backend logout is CSRF-protected — pass the token from the cookie so
      // the request actually reaches `AdminAuthService.logout` instead of
      // being rejected at the middleware (403 CSRF_MISSING) and silently
      // swallowed, which would leave the JWT valid server-side post-"logout".
      await logoutFromBackend(session.value, csrf?.value ?? null, false);
    }

    await clearAuthCookies();
  } catch (error) {
    log.error("Logout error", error);
    // Still redirect even if there's an unexpected error
  }

  // Redirect OUTSIDE try/catch — redirect() throws internally (NEXT_REDIRECT)
  redirect("/login");
}
