/**
 * @file route.ts
 * @description Server-side token refresh route handler. Called when the dashboard layout
 * detects an expired access token on page load. Attempts to refresh using the stored
 * refresh/csrf cookies, updates the session cookie, and redirects back to the original page.
 */

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const APP_URL = process.env.NEXT_PUBLIC_URL ?? "http://localhost:3100";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("admin-refresh")?.value;
  const csrfToken = cookieStore.get("admin-csrf")?.value;
  const returnTo = req.nextUrl.searchParams.get("returnTo") ?? "/";

  if (!refreshToken || !csrfToken) {
    // No refresh tokens — clear everything and send to login
    cookieStore.delete("admin-session");
    cookieStore.delete("admin-refresh");
    cookieStore.delete("admin-csrf");
    return NextResponse.redirect(new URL("/login", APP_URL));
  }

  try {
    const res = await fetch(`${API_URL}/admin/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken, csrfToken }),
      cache: "no-store",
    });

    if (!res.ok) {
      // Refresh failed — session is truly expired
      cookieStore.delete("admin-session");
      cookieStore.delete("admin-refresh");
      cookieStore.delete("admin-csrf");
      return NextResponse.redirect(new URL("/login", APP_URL));
    }

    const json: { ok?: boolean; data?: { tokens?: { accessToken?: string } } } = await res.json();
    const newAccessToken = json.data?.tokens?.accessToken;

    if (!newAccessToken) {
      cookieStore.delete("admin-session");
      cookieStore.delete("admin-refresh");
      cookieStore.delete("admin-csrf");
      return NextResponse.redirect(new URL("/login", APP_URL));
    }

    // Update session cookie with fresh access token
    cookieStore.set("admin-session", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60,
    });

    // Redirect back to the page they were trying to visit
    return NextResponse.redirect(new URL(returnTo, APP_URL));
  } catch {
    cookieStore.delete("admin-session");
    cookieStore.delete("admin-refresh");
    cookieStore.delete("admin-csrf");
    return NextResponse.redirect(new URL("/login", APP_URL));
  }
}
