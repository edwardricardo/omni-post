/**
 * @file proxy.ts
 * @description Next.js 16 proxy for the admin app — cookie-based route protection that redirects
 *              unauthenticated users to /auth/login and authenticated users away from login.
 * @layer infrastructure
 */

import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "admin-session";
const PUBLIC_PATHS = ["/login"];

export function proxy(request: NextRequest) {
  const session = request.cookies.get(COOKIE_NAME);
  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!session && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (session && isPublic) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

/**
 * Proxy Matcher Configuration
 *
 * Apply proxy to all routes except:
 * - /api/* (Next.js API routes)
 * - _next/static (static files)
 * - _next/image (image optimization)
 * - favicon.ico
 * - public image files
 */
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
