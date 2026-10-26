/**
 * @file route.ts
 * @description Server-side token refresh route handler. Called when the dashboard layout
 *              detects an expired access token on page load. Attempts to refresh using the
 *              stored refresh/csrf cookies, updates the session cookie via the shared
 *              `lib/auth/sessionCookie` helpers, and redirects to the admin app's root. It
 *              takes no return target: a query parameter it followed would let any link send a
 *              signed-in admin to another origin.
 * @layer infrastructure
 */

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  REFRESH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  clearAuthCookies,
  setSessionCookie,
} from "@/lib/auth/sessionCookie";
import { env } from "../../../../lib/env";
import { forwardedForHeaders } from "../../../../lib/http/forwardedFor";

const API_URL = env.API_URL ?? env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const APP_URL = env.NEXT_PUBLIC_URL ?? "http://localhost:3100";

/**
 * @description Refreshes the admin session from its refresh and CSRF cookies and redirects to the
 *   admin app's root; a missing cookie, a refused refresh or a response without an access token
 *   clears the auth cookies and redirects to the login page.
 * @param req - The incoming request; only its client-IP headers are relayed to the backend.
 * @returns The redirect to the admin root, or to the login page.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_COOKIE_NAME)?.value;
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME)?.value;

  if (!refreshToken || !csrfToken) {
    // No refresh tokens — clear everything and send to login
    await clearAuthCookies();
    return NextResponse.redirect(new URL("/login", APP_URL));
  }

  try {
    const res = await fetch(`${API_URL}/admin/auth/refresh`, {
      method: "POST",
      // Relay the real client IP so the backend AUTH limiter keys the caller.
      headers: { "Content-Type": "application/json", ...forwardedForHeaders(req.headers) },
      body: JSON.stringify({ refreshToken, csrfToken }),
      cache: "no-store",
    });

    if (!res.ok) {
      // Refresh failed — session is truly expired
      await clearAuthCookies();
      return NextResponse.redirect(new URL("/login", APP_URL));
    }

    const json: { ok?: boolean; data?: { tokens?: { accessToken?: string } } } = await res.json();
    const newAccessToken = json.data?.tokens?.accessToken;

    if (!newAccessToken) {
      await clearAuthCookies();
      return NextResponse.redirect(new URL("/login", APP_URL));
    }

    // Update session cookie with fresh access token (shared TTL = 15min)
    await setSessionCookie(newAccessToken);

    return NextResponse.redirect(new URL("/", APP_URL));
  } catch {
    await clearAuthCookies();
    return NextResponse.redirect(new URL("/login", APP_URL));
  }
}
