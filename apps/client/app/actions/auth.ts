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

// Action state type
export interface AuthActionState {
  error?: string;
}

interface AuthResponseBody {
  ok?: boolean;
  data?: {
    accessToken?: string;
    refreshToken?: string;
    error?: string;
    message?: string;
  };
  error?: string;
  message?: string;
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
