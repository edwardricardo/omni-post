/**
 * @file proxy.ts
 * @description Next.js 16 proxy for the admin app: the session gate, in front of next-intl's
 *              locale routing. The gate reads the locale prefix against `routing.locales`, so
 *              adding a locale to the routing is all it needs.
 * @layer infrastructure
 */
import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const handleI18nRouting = createMiddleware(routing);

const COOKIE_NAME = "admin-session";
// Paths compared AFTER stripping the locale prefix.
const PUBLIC_PATHS = ["/login"];

// The first path segment: where the "always" prefix mode puts the locale.
const FIRST_SEGMENT_RE = /^\/([^/]*)/;

/**
 * @description Gates every matched request on the admin session. The locale prefix is the first
 *   path segment when `routing.locales` declares it; without one the default locale is used. An
 *   anonymous request for a non-public path is redirected to `/<locale>/login`, a signed-in
 *   request for a public path to `/<locale>`, and every other request goes to next-intl.
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

  const session = request.cookies.get(COOKIE_NAME);
  const isPublic = PUBLIC_PATHS.some((p) => pathWithoutLocale.startsWith(p));

  if (!session && !isPublic) {
    return NextResponse.redirect(new URL(`/${locale}/login`, request.url));
  }
  if (session && isPublic) {
    return NextResponse.redirect(new URL(`/${locale}`, request.url));
  }

  return handleI18nRouting(request);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
