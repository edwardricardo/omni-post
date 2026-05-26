/**
 * @file request.ts
 * @description next-intl request-scoped configuration. Resolves the active
 *              locale from the request (locale path segment via the proxy /
 *              routing), validates it against the supported set, falls back
 *              to the default locale, and loads the matching message
 *              catalogue from `messages/{locale}.json`.
 * @layer infrastructure
 */
import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
