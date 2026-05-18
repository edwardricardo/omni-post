/**
 * @file route.ts
 * @description Universal backend proxy route handler that forwards admin client-side API
 * calls to the Fastify backend, injecting the httpOnly "admin-session" JWT so the browser
 * never directly handles the token. Automatically refreshes expired access tokens using
 * the stored refresh token cookie.
 */

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { env } from "../../../../lib/env";

const API_URL = env.API_URL ?? env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// ---------------------------------------------------------------------------
// Token Refresh
// ---------------------------------------------------------------------------

async function attemptTokenRefresh(): Promise<string | null> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("admin-refresh")?.value;
  const csrfToken = cookieStore.get("admin-csrf")?.value;

  if (!refreshToken || !csrfToken) return null;

  try {
    const res = await fetch(`${API_URL}/admin/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken, csrfToken }),
      cache: "no-store",
    });

    if (!res.ok) return null;

    const json: { ok?: boolean; data?: { tokens?: { accessToken?: string } } } = await res.json();
    const newAccessToken = json.data?.tokens?.accessToken;

    if (!newAccessToken) return null;

    // Update the session cookie with the fresh access token
    cookieStore.set("admin-session", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60,
    });

    return newAccessToken;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Proxy
// ---------------------------------------------------------------------------

function buildTargetUrl(req: NextRequest, segments: string[]): string {
  const targetUrl = new URL(`/${segments.join("/")}`, API_URL);
  req.nextUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });
  return targetUrl.toString();
}

async function buildHeaders(req: NextRequest, token: string | undefined): Promise<Headers> {
  const headers = new Headers();
  const contentType = req.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  // Forward CSRF token from httpOnly cookie as header for backend validation
  const cookieStore = await cookies();
  const csrfCookie = cookieStore.get("admin-csrf");
  if (csrfCookie?.value) {
    headers.set("X-CSRF-Token", csrfCookie.value);
  }

  return headers;
}

function sendUpstream(
  method: string,
  url: string,
  headers: Headers,
  body: string | null
): Promise<Response> {
  return fetch(url, {
    method,
    headers,
    ...(body !== null && { body }),
    cache: "no-store",
  });
}

async function proxy(req: NextRequest, segments: string[]): Promise<NextResponse> {
  const hasBody = !["GET", "HEAD"].includes(req.method);
  const [cookieStore, bodyText] = await Promise.all([
    cookies(),
    hasBody ? req.text() : Promise.resolve(null),
  ]);
  const session = cookieStore.get("admin-session");
  const url = buildTargetUrl(req, segments);

  let upstream: Response;
  try {
    upstream = await sendUpstream(
      req.method,
      url,
      await buildHeaders(req, session?.value),
      bodyText
    );
  } catch {
    return NextResponse.json({ ok: false, error: "Backend unavailable" }, { status: 503 });
  }

  // If 401 with TOKEN_EXPIRED, attempt refresh and retry once
  if (upstream.status === 401) {
    const errorBody = await upstream.text();
    let isTokenExpired = false;
    try {
      const parsed = JSON.parse(errorBody);
      isTokenExpired = parsed?.error?.code === "TOKEN_EXPIRED";
    } catch {
      // Not JSON — pass through
    }

    if (isTokenExpired) {
      const newToken = await attemptTokenRefresh();
      if (newToken) {
        // Retry the original request with the fresh token (body was saved earlier)
        try {
          upstream = await sendUpstream(
            req.method,
            url,
            await buildHeaders(req, newToken),
            bodyText
          );
        } catch {
          return NextResponse.json({ ok: false, error: "Backend unavailable" }, { status: 503 });
        }

        // Return the retried response
        const retryText = await upstream.text();
        return new NextResponse(retryText, {
          status: upstream.status,
          headers: {
            "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
          },
        });
      }
    }

    // Refresh failed or different 401 — pass through original error
    return new NextResponse(errorBody, {
      status: 401,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  }

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

const handler = (req: NextRequest, ctx: RouteContext): Promise<NextResponse> =>
  ctx.params.then(({ path }) => proxy(req, path));

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
