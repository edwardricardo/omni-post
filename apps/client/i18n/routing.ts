/**
 * @file routing.ts
 * @description next-intl routing configuration for the client app. Defines
 *              the supported locales (en default, es), and the "always" prefix
 *              mode so every route carries an explicit locale segment
 *              (/en/..., /es/...); the root "/" redirects to the default
 *              locale.
 * @layer infrastructure
 */
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "es"],
  defaultLocale: "en",
  localePrefix: "always",
});

export type AppLocale = (typeof routing.locales)[number];
