/**
 * @file auth.ts
 * @description Server Actions for admin authentication using the httpOnly cookie pattern.
 *              Handles login (with optional MFA), the password change an administrator must
 *              make before signing in, and logout. Cookie names + TTLs come from
 *              the shared `lib/auth/sessionCookie` module — single source of truth shared
 *              with the refresh route handler. Session TTL = 15min (matches access token).
 * @layer infrastructure
 */
"use server";

import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { cookies } from "next/headers";

import { ConsoleLoggerAdapter } from "@observability/browser-logger";

import {
  ADMIN_AUTH_ERROR,
  type AdminAuthState,
  type RequiredPasswordChangeState,
} from "@/lib/auth/types";
import {
  authenticateAdmin,
  changeRequiredPassword,
  logoutFromBackend,
} from "@/lib/auth/backend-client";
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
 *
 * @description Signs an administrator in and opens the session, then redirects to the dashboard
 *   of the active locale; an administrator who must change the password first is redirected to
 *   the page that changes it, with no session and nothing in the URL.
 * @param prevState - The previous state of the form
 * @param formData - The form's e-mail and password, and the second factor's fields once asked
 * @returns The error or the second-factor request to show; a sign-in redirects instead
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

  // No session exists for an administrator who must change the password: the page that changes
  // it asks for the credentials again, so nothing travels with the redirect.
  let mustChangePassword = false;

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

    if (result.status === "password_change_required") {
      mustChangePassword = true;
    } else {
      await setAuthTokens({
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        csrfToken: result.tokens.csrfToken,
      });
    }
  } catch (error) {
    log.error("Unexpected login error", error);
    return {
      error: error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }

  // Redirect OUTSIDE try/catch — redirect() throws internally (NEXT_REDIRECT)
  const locale = await getLocale();
  redirect(mustChangePassword ? `/${locale}/login/change-password` : `/${locale}`);
}

// ---------------------------------------------------------------------------
// Required Password Change Action
// ---------------------------------------------------------------------------

/** The text of a form field, or an empty string when the form has none. */
function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Server Action for the password change an administrator must make before signing in.
 *
 * Signature is compatible with React 19 `useActionState`. It sends the form's e-mail, current
 * password, new password and second-factor code to the API, which runs the sign-in's checks and
 * opens no session; the confirmation of the new password is compared by the form and never sent.
 * The second factor's field is asked for once the API answers `MFA_REQUIRED`, and stays once the
 * form holds it.
 *
 * @description Changes a password that must be changed, then sends the administrator to the
 *   sign-in of the active locale with the changed flag, where the new password signs in.
 * @param _prevState - The previous state, unused: the form's fields say what to send
 * @param formData - The form's e-mail, current password, new password and, once asked, the code
 * @returns The API's error code, the fields a validation failure names, and whether the form asks
 *   for the second factor's code; a change redirects instead of returning
 */
export async function changeRequiredPasswordAction(
  _prevState: RequiredPasswordChangeState | null,
  formData: FormData
): Promise<RequiredPasswordChangeState> {
  const mfaToken = textField(formData, "mfaToken");
  const result = await changeRequiredPassword({
    email: textField(formData, "email"),
    currentPassword: textField(formData, "currentPassword"),
    newPassword: textField(formData, "newPassword"),
    ...(mfaToken !== "" && { mfaToken }),
  });

  if (result.status === "error") {
    const requiresMfa = formData.has("mfaToken") || result.error === ADMIN_AUTH_ERROR.MFA_REQUIRED;
    return {
      error: result.error,
      ...(result.issues !== undefined && {
        invalidFields: result.issues.map((issue) => issue.path),
      }),
      ...(requiresMfa && { requiresMfa }),
    };
  }

  // `changeRequiredPassword` never throws, so the redirect needs no try/catch around it.
  redirect(`/${await getLocale()}/login?passwordChanged=1`);
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
 *
 * @description Ends the session in the API and in the portal's cookies, then redirects to the
 *   sign-in of the active locale.
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
  redirect(`/${await getLocale()}/login`);
}
