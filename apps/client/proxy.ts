/**
 * @file proxy.ts
 * @description Next.js 16 proxy composing next-intl locale routing with the
 *              customer auth gate. next-intl runs first (resolves locale,
 *              redirects "/" -> "/es", prepends the locale prefix); the auth
 *              logic then works against the locale-stripped pathname:
 *              unauthenticated users on protected routes are sent to the
 *              locale-prefixed login, and authenticated users on auth pages
 *              are sent to the locale-prefixed dashboard.
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

const LOCALE_PREFIX_RE = /^\/(es|en)(?=\/|$)/;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const localeMatch = pathname.match(LOCALE_PREFIX_RE);
  const locale = localeMatch?.[1] ?? routing.defaultLocale;
  const pathWithoutLocale = localeMatch ? pathname.slice(localeMatch[0].length) || "/" : pathname;

  const session = request.cookies.get("customer-session");
  const isPublic = PUBLIC_PATHS.includes(pathWithoutLocale);
  const isAuthPage = AUTH_PATHS.includes(pathWithoutLocale);

  if (isPublic) {
    // Authenticated user on an auth page → dashboard (locale-prefixed).
    if (session && isAuthPage) {
      const returnTo = request.nextUrl.searchParams.get("returnTo");
      const target = returnTo || `/${locale}/dashboard`;
      return NextResponse.redirect(new URL(target, request.url));
    }
    return handleI18nRouting(request);
  }

  // Protected path without a session → login (locale-prefixed), preserving
  // the originally requested path for post-login return.
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
