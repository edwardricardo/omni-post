/**
 * @file proxy.ts
 * @description Next.js 16 proxy composing next-intl locale routing with the
 *              admin auth gate. next-intl runs first (resolves locale, redirects
 *              "/" -> "/en", prepends the locale prefix); the auth logic then
 *              works against the locale-stripped pathname: unauthenticated users
 *              on protected routes go to the locale-prefixed login, and
 *              authenticated users on the login page go to the locale-prefixed
 *              dashboard root.
 * @layer infrastructure
 */
import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing.js";

const handleI18nRouting = createMiddleware(routing);

const COOKIE_NAME = "admin-session";
// Paths compared AFTER stripping the locale prefix.
const PUBLIC_PATHS = ["/login"];

const LOCALE_PREFIX_RE = /^\/(en|es)(?=\/|$)/;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const localeMatch = pathname.match(LOCALE_PREFIX_RE);
  const locale = localeMatch?.[1] ?? routing.defaultLocale;
  const pathWithoutLocale = localeMatch ? pathname.slice(localeMatch[0].length) || "/" : pathname;

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
