/**
 * @file auth.ts
 * @description Server Actions for admin authentication using the httpOnly cookie pattern.
 * Handles login (with optional MFA) and logout by proxying credentials to the Fastify backend
 * and managing the "admin-session" cookie lifecycle.
 */
"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import type { AdminAuthState } from "@/lib/auth/types";
import { authenticateAdmin, logoutFromBackend } from "@/lib/auth/backend-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth-actions");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COOKIE_NAME = "admin-session";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 24 * 60 * 60, // 1 day
};

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

  let accessToken: string | null = null;

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
    accessToken = result.tokens.accessToken;

    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, accessToken, COOKIE_OPTIONS);
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
 * invalidate the token, deletes the cookie, and redirects to the login page.
 *
 * Backend errors are intentionally swallowed — the cookie is always deleted
 * so the user is always logged out on the frontend regardless.
 */
export async function logoutAction(): Promise<void> {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(COOKIE_NAME);

    if (session) {
      await logoutFromBackend(session.value, false).catch(() => {
        // Intentionally ignored — cookie will still be cleared below
      });
    }

    cookieStore.delete(COOKIE_NAME);
  } catch (error) {
    log.error("Logout error", error);
    // Still redirect even if there's an unexpected error
  }

  // Redirect OUTSIDE try/catch — redirect() throws internally (NEXT_REDIRECT)
  redirect("/auth/login");
}
