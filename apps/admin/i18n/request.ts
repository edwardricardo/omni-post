/**
 * @file request.ts
 * @description next-intl server configuration. Resolves locale from
 * the NEXT_LOCALE cookie (set by the language switcher) or falls back
 * to the browser's Accept-Language header, defaulting to English.
 * @layer infrastructure
 */
import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

const SUPPORTED_LOCALES = ["en", "es"] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

function isValidLocale(locale: string): locale is Locale {
  return SUPPORTED_LOCALES.includes(locale as Locale);
}

export default getRequestConfig(async ({ requestLocale }) => {
  // 1. Try requestLocale (from middleware or [locale] routing)
  let locale: Locale = "en";
  const requested = await requestLocale;
  if (requested && isValidLocale(requested)) {
    locale = requested;
  } else {
    // 2. Fall back to NEXT_LOCALE cookie (set by language switcher)
    try {
      const cookieStore = await cookies();
      const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
      if (cookieLocale && isValidLocale(cookieLocale)) {
        locale = cookieLocale;
      }
    } catch {
      // cookies() may throw in certain contexts — use default
    }
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
