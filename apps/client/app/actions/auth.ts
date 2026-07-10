"use server";

/**
 * @file auth.ts
 * @description Next.js Server Actions for client authentication (login, register).
 *              Both actions delegate token persistence to the shared
 *              `lib/auth/sessionCookie` helpers — same TTLs and same cookie
 *              names as the proxy `app/api/backend/[...path]/route.ts`. No
 *              hand-rolled `cookies().set(SESSION_COOKIE, ...)` lives here.
 * @layer infrastructure
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { ConsoleLoggerAdapter } from "@observability/browser-logger";

import { setSessionCookie, setRefreshCookie, readAuthTokens } from "@/lib/auth/sessionCookie";
import { forwardedForHeaders } from "@/lib/http/forwardedFor";
import { env } from "../../lib/env";

const log = new ConsoleLoggerAdapter("client.auth-actions", { alwaysEmit: true });

const API_URL = env.API_URL || "http://localhost:3000";

/** Fallback challenge TTL (seconds) if the backend omits `expiresInSeconds`. */
const DEFAULT_MFA_CHALLENGE_TTL_SECONDS = 180;

/** Backend error code that means "code was wrong, retry" (challenge stays alive). */
const MFA_INVALID_CODE = "INVALID_MFA_CODE";

/**
 * Inert MFA challenge carried in the login action state. Populated only when the
 * backend answers step 1 with `mfaRequired`; drives the step-2 challenge form.
 * The token lives in React state / a hidden input — never browser storage.
 */
export interface MfaChallengeState {
  challengeToken: string;
  expiresInSeconds: number;
  rememberMe: boolean;
}

// Action state type
export interface AuthActionState {
  error?: string;
  /** Present when step 1 requires a second factor — renders the challenge step. */
  mfaChallenge?: MfaChallengeState;
  /**
   * Set by `completeMfaLoginAction` when the challenge can no longer be
   * completed (expired / consumed / store outage) so the UI returns to the
   * password step. A wrong code does NOT set this (the challenge is retried).
   */
  mfaChallengeExpired?: boolean;
}

interface AuthResponseBody {
  ok?: boolean;
  data?: {
    accessToken?: string;
    refreshToken?: string;
    error?: string;
    message?: string;
    code?: string;
    mfaRequired?: boolean;
    challengeToken?: string;
    expiresInSeconds?: number;
  };
  error?: string;
  message?: string;
  code?: string;
  mfaRequired?: boolean;
  challengeToken?: string;
  expiresInSeconds?: number;
}

/**
 * Extract an MFA challenge from a backend login response body. The backend may
 * wrap payloads under `data` or return them flat — read both. Returns `null`
 * when the response is not an MFA challenge.
 */
function readMfaChallenge(
  body: AuthResponseBody
): { challengeToken: string; expiresInSeconds: number } | null {
  const src = body.data ?? body;
  if (src.mfaRequired === true && typeof src.challengeToken === "string") {
    return {
      challengeToken: src.challengeToken,
      expiresInSeconds:
        typeof src.expiresInSeconds === "number"
          ? src.expiresInSeconds
          : DEFAULT_MFA_CHALLENGE_TTL_SECONDS,
    };
  }
  return null;
}

/**
 * Server Action for user login.
 * Uses the shared sessionCookie helpers so TTL semantics match the proxy
 * (15min session, 7d refresh, 30d refresh on remember-me).
 */
export async function loginAction(
  prevState: AuthActionState | null,
  formData: FormData
): Promise<AuthActionState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const rememberMe = formData.get("rememberMe") === "on";

  if (!email || !password) {
    return { error: "Email and password are required" };
  }

  try {
    // Relay the real inbound client IP so the backend's per-IP AUTH rate limiter
    // buckets this login by the real user, not the Next server IP (N-SEC-2).
    const inbound = await headers();
    const response = await fetch(`${API_URL}/auth/customer/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...forwardedForHeaders(inbound) },
      body: JSON.stringify({ email, password, rememberMe }),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as AuthResponseBody;
      return {
        error:
          errorData.error ?? errorData.message ?? errorData.data?.error ?? "Invalid credentials",
      };
    }

    const data = (await response.json()) as AuthResponseBody;

    // MFA required — return the inert challenge state (no cookies). The UI
    // switches to the challenge step; nothing is user-visible until the backend
    // actually emits `mfaRequired`.
    const challenge = readMfaChallenge(data);
    if (challenge) {
      return {
        mfaChallenge: {
          challengeToken: challenge.challengeToken,
          expiresInSeconds: challenge.expiresInSeconds,
          rememberMe,
        },
      };
    }

    const tokens = readAuthTokens(data);

    if (!tokens?.accessToken) {
      return { error: "Authentication failed - no token received" };
    }

    await setSessionCookie(tokens.accessToken);
    if (tokens.refreshToken) {
      await setRefreshCookie(tokens.refreshToken, { rememberMe });
    }
  } catch (error) {
    log.error("Login failed", error);
    return {
      error: error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }

  // Redirect OUTSIDE try/catch — redirect() throws internally (NEXT_REDIRECT)
  redirect(`/${await getLocale()}/dashboard`);
}

/**
 * Server Action for step 2 of a customer login that required MFA.
 * POSTs the opaque challenge token plus the user's TOTP / backup code to the
 * backend WITH the client-IP relay (N-SEC-2 — else the backend IP-binds and
 * rate-limits against the Next server), persists the returned tokens as
 * httpOnly cookies, and redirects to the dashboard.
 *
 * A wrong code keeps the challenge (retry); an invalid/expired challenge or a
 * store outage returns `mfaChallengeExpired` so the UI falls back to step 1.
 */
export async function completeMfaLoginAction(
  prevState: AuthActionState | null,
  formData: FormData
): Promise<AuthActionState> {
  const challengeToken = formData.get("challengeToken") as string;
  const code = formData.get("code") as string;
  const rememberMe = formData.get("rememberMe") === "on";

  if (!challengeToken) {
    return { mfaChallengeExpired: true, error: "MFA challenge is missing. Please sign in again." };
  }
  if (!code) {
    return { error: "MFA code is required" };
  }

  try {
    // Relay the real inbound client IP so the backend's per-IP AUTH rate limiter
    // and IP binding key off the real user, not the Next server IP (N-SEC-2).
    const inbound = await headers();
    const response = await fetch(`${API_URL}/auth/customer/login/mfa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...forwardedForHeaders(inbound) },
      body: JSON.stringify({ challengeToken, code, rememberMe }),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as AuthResponseBody;
      const errorCode = errorData.code ?? errorData.data?.code;
      const message =
        errorData.error ??
        errorData.message ??
        errorData.data?.error ??
        "Unable to complete multi-factor login";

      // Keep the challenge only for a wrong code (retry). Any other failure —
      // an invalid/expired/consumed challenge (401) or a store outage (503) —
      // drops back to the password step.
      const challengeGone =
        response.status === 503 || (response.status === 401 && errorCode !== MFA_INVALID_CODE);

      if (challengeGone) {
        return { mfaChallengeExpired: true, error: message };
      }
      return { error: message };
    }

    const data = (await response.json()) as AuthResponseBody;
    const tokens = readAuthTokens(data);

    if (!tokens?.accessToken) {
      return { mfaChallengeExpired: true, error: "MFA login failed. Please sign in again." };
    }

    await setSessionCookie(tokens.accessToken);
    if (tokens.refreshToken) {
      await setRefreshCookie(tokens.refreshToken, { rememberMe });
    }
  } catch (error) {
    log.error("MFA login failed", error);
    return {
      error: error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }

  // Redirect OUTSIDE try/catch — redirect() throws internally (NEXT_REDIRECT)
  redirect(`/${await getLocale()}/dashboard`);
}

/**
 * Server Action for user registration. Auto-logs in via the same backend
 * login endpoint and persists tokens via the shared cookie helpers.
 */
export async function registerAction(
  prevState: AuthActionState | null,
  formData: FormData
): Promise<AuthActionState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;
  const name = formData.get("name") as string;

  if (!email || !password || !confirmPassword || !name) {
    return { error: "All fields are required" };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match" };
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters long" };
  }

  try {
    const firstName = name.split(" ")[0] || name;
    const lastName = name.split(" ").slice(1).join(" ") || name;

    // Relay the real inbound client IP so both the register and the auto-login
    // egress are bucketed per user, not collapsed onto the Next server IP (N-SEC-2).
    const inbound = await headers();
    const forwarded = forwardedForHeaders(inbound);

    const registerResponse = await fetch(`${API_URL}/auth/customer/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...forwarded },
      body: JSON.stringify({
        accountName: name,
        accountEmail: email,
        firstName,
        lastName,
        email,
        password,
      }),
    });

    if (!registerResponse.ok) {
      const errorData = (await registerResponse.json().catch(() => ({}))) as AuthResponseBody;
      return {
        error:
          errorData.error ??
          errorData.message ??
          errorData.data?.error ??
          "Failed to create account",
      };
    }

    // Auto-login after registration
    const loginResponse = await fetch(`${API_URL}/auth/customer/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...forwarded },
      body: JSON.stringify({ email, password, rememberMe: false }),
    });

    if (!loginResponse.ok) {
      return {
        error: "Account created but login failed. Please try logging in manually.",
      };
    }

    const loginData = (await loginResponse.json()) as AuthResponseBody;
    const tokens = readAuthTokens(loginData);

    if (!tokens?.accessToken) {
      return { error: "Account created but authentication failed" };
    }

    await setSessionCookie(tokens.accessToken);
    if (tokens.refreshToken) {
      await setRefreshCookie(tokens.refreshToken);
    }
  } catch (error) {
    log.error("Registration failed", error);
    return {
      error: error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }

  // Redirect OUTSIDE try/catch — redirect() throws internally (NEXT_REDIRECT)
  redirect(`/${await getLocale()}/dashboard`);
}
