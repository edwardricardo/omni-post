/**
 * @file routing.ts
 * @description next-intl routing configuration for the client app. Defines
 *              the supported locales (es default for LATAM, en), and the
 *              "always" prefix mode so every route carries an explicit
 *              locale segment (/es/..., /en/...); the root "/" redirects to
 *              the default locale.
 * @layer infrastructure
 */
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["es", "en"],
  defaultLocale: "es",
  localePrefix: "always",
});

export type AppLocale = (typeof routing.locales)[number];
