/**
 * @file route.ts
 * @description Server-side token refresh route handler. Called when the dashboard layout
 *              detects an expired access token on page load. Attempts to refresh using the
 *              stored refresh/csrf cookies, updates the session cookie via the shared
 *              `lib/auth/sessionCookie` helpers, and redirects back to the original page.
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
import { forwardedForHeaders } from "@/lib/http/forwardedFor";
import { env } from "../../../../lib/env";

const API_URL = env.API_URL ?? env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const APP_URL = env.NEXT_PUBLIC_URL ?? "http://localhost:3100";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_COOKIE_NAME)?.value;
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME)?.value;
  const returnTo = req.nextUrl.searchParams.get("returnTo") ?? "/";

  if (!refreshToken || !csrfToken) {
    // No refresh tokens — clear everything and send to login
    await clearAuthCookies();
    return NextResponse.redirect(new URL("/login", APP_URL));
  }

  try {
    const res = await fetch(`${API_URL}/admin/auth/refresh`, {
      method: "POST",
      // Relay the real inbound client IP so this session-refresh path is bucketed
      // per user, not collapsed onto the Next server IP (N-SEC-2).
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

    // Redirect back to the page they were trying to visit
    return NextResponse.redirect(new URL(returnTo, APP_URL));
  } catch {
    await clearAuthCookies();
    return NextResponse.redirect(new URL("/login", APP_URL));
  }
}
