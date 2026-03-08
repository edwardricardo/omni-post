/**
 * @file route.ts
 * @description Universal backend proxy route handler that forwards admin client-side API
 * calls to the Fastify backend, injecting the httpOnly "admin-session" JWT so the browser
 * never directly handles the token.
 */

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

async function proxy(req: NextRequest, segments: string[]): Promise<NextResponse> {
  const cookieStore = await cookies();
  const session = cookieStore.get("admin-session");

  // Reconstruct target URL, forwarding any query string parameters
  const targetUrl = new URL(`/${segments.join("/")}`, API_URL);
  req.nextUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });

  // Build forwarded headers — inject Bearer token if session cookie exists
  const headers = new Headers();
  const contentType = req.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  if (session) headers.set("Authorization", `Bearer ${session.value}`);

  // Do not forward body for GET/HEAD — use conditional spreading to satisfy
  // exactOptionalPropertyTypes (body must not be explicitly undefined)
  const hasBody = !["GET", "HEAD"].includes(req.method);
  const bodyText = hasBody ? await req.text() : null;

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), {
      method: req.method,
      headers,
      ...(hasBody && { body: bodyText }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Backend unavailable" }, { status: 503 });
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
