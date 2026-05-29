/**
 * @file createRequestConfig.ts
 * @description Factory for next-intl request-scoped configuration. Returns a
 *   getRequestConfig handler bound to the app-specific message loader.
 *
 *   Each Next.js app keeps its own `i18n/request.ts` (next-intl plugin
 *   convention: the file must live in the app root for the framework to
 *   discover it), but both delegate to this factory so the locale-resolution
 *   logic is single-sourced. The `loadMessages` callback receives the
 *   resolved locale and returns the matching messages bundle — apps pass
 *   their own `import('../messages/${locale}.json')` to preserve the
 *   per-app message catalogue paths.
 *
 *   Note on the `Locale` cast: next-intl uses a `Locale` type that is
 *   ambient-augmented per app (admin = "en" | "es", client = "en" | "es"),
 *   but the shared factory only has `string` to work with. The cast at the
 *   return site is safe because `locale` is runtime-validated against
 *   `routing.locales` immediately above.
 * @layer infrastructure
 */
import { getRequestConfig } from "next-intl/server";
import type { AbstractIntlMessages, Locale } from "next-intl";

export interface RoutingConfig {
  readonly locales: ReadonlyArray<string>;
  readonly defaultLocale: string;
}

export function createRequestConfig(
  routing: RoutingConfig,
  loadMessages: (locale: string) => Promise<{ default: AbstractIntlMessages }>
) {
  return getRequestConfig(async ({ requestLocale }) => {
    const requested = await requestLocale;
    const isValid = requested !== undefined && routing.locales.includes(requested);
    const resolved = isValid ? requested : routing.defaultLocale;
    return {
      locale: resolved as Locale,
      messages: (await loadMessages(resolved)).default,
    };
  });
}
