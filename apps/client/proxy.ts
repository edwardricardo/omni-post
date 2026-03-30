import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Next.js 16 Proxy for Authentication
 *
 * Protects routes based on session cookie (set by Server Actions)
 * Redirects unauthenticated users to login
 * Redirects authenticated users away from auth pages
 */

const publicPaths = ["/login", "/register", "/"];
const authPaths = ["/login", "/register"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check for session cookie (set by Server Actions)
  const session = request.cookies.get("customer-session");

  // Allow public paths
  if (publicPaths.includes(pathname)) {
    // If user is already authenticated and tries to access auth pages, redirect to dashboard
    if (session && authPaths.includes(pathname)) {
      // Check if there's a returnTo parameter from Server Action redirect
      const returnTo = request.nextUrl.searchParams.get("returnTo");
      const redirectUrl = new URL(returnTo || "/dashboard", request.url);
      return NextResponse.redirect(redirectUrl);
    }
    return NextResponse.next();
  }

  // For all other paths (including /dashboard/*), require authentication
  if (!session) {
    // Redirect to login with return URL
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
