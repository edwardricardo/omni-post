/**
 * @file proxy.ts
 * @description Next.js 16 proxy for the client app: the customer session gate, in front of
 *              next-intl's locale routing. The gate reads the locale prefix against
 *              `routing.locales`, so adding a locale to the routing is all it needs.
 * @layer infrastructure
 */
import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const handleI18nRouting = createMiddleware(routing);

// Paths compared AFTER stripping the locale prefix.
const PUBLIC_PATHS = ["/login", "/register", "/"];
const AUTH_PATHS = ["/login", "/register"];

// The first path segment: where the "always" prefix mode puts the locale.
const FIRST_SEGMENT_RE = /^\/([^/]*)/;

/**
 * @description Gates every matched request on the customer session. The locale prefix is the
 *   first path segment when `routing.locales` declares it; without one the default locale is
 *   used. A signed-in request for an auth page is redirected to `/<locale>/dashboard`, whatever its
 *   query holds, so no parameter can send the browser to another origin; an anonymous request
 *   for a non-public path to `/<locale>/login`, with the requested path in `redirect`; every
 *   other request goes to next-intl.
 * @param request - The incoming request.
 * @returns The redirect, or next-intl's locale-routing response.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const firstSegment = FIRST_SEGMENT_RE.exec(pathname)?.[1];
  // Not next-intl's `hasLocale`: importing it pulls use-intl's formatters and ICU message parser
  // into the proxy bundle, none of which the proxy runs.
  const prefixLocale = routing.locales.find((candidate) => candidate === firstSegment);
  const locale = prefixLocale ?? routing.defaultLocale;
  const pathWithoutLocale = prefixLocale
    ? pathname.slice(`/${prefixLocale}`.length) || "/"
    : pathname;

  const session = request.cookies.get("customer-session");
  const isPublic = PUBLIC_PATHS.includes(pathWithoutLocale);
  const isAuthPage = AUTH_PATHS.includes(pathWithoutLocale);

  if (isPublic) {
    // Authenticated user on an auth page → dashboard (locale-prefixed).
    if (session && isAuthPage) {
      return NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url));
    }
    return handleI18nRouting(request);
  }

  // Protected path without a session → login (locale-prefixed). The requested path rides in
  // `redirect`; no page reads it today.
  if (!session) {
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return handleI18nRouting(request);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
