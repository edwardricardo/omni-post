/**
 * @file createRequestConfig.ts
 * @description Factory for next-intl request-scoped configuration. Returns a
 *   getRequestConfig handler bound to the app-specific message loader.
 *
 *   Each Next.js app keeps its own `i18n/request.ts` (next-intl plugin
 *   convention: the file must live in the app root for the framework to
 *   discover it), but both delegate to this factory so the locale-resolution
 *   logic is single-sourced.
 *
 *   It lives HERE, in a frontend-only package, and not in `@shared/types`,
 *   because that package is consumed by the API and the workers too. It
 *   declared `next-intl` as an OPTIONAL peer precisely to keep it out of their
 *   installs — and that was not enough: the peer is satisfiable in this
 *   workspace, so pnpm resolved the edge anyway and `pnpm deploy --prod` for
 *   the API carried `next` (198MB) plus `@next/swc-linux-x64-gnu` (93MB) into
 *   an image that will never render a page. A module's dependencies follow the
 *   module; the only way to keep a frontend framework out of a backend closure
 *   is for the file that needs it to live outside the package the backend
 *   imports. The `loadMessages` callback receives the
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
