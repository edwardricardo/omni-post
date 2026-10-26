/**
 * @file global.ts
 * @description next-intl type-safe configuration. Augments `AppConfig` with the
 *              supported `Locale` union (from routing) and the `Messages` shape
 *              (from the default-locale catalog), so `useTranslations`/`t()`
 *              keys are checked by TypeScript — a non-existent key becomes a
 *              compile error. The catalogs themselves (valid ICU, key and argument
 *              parity across the declared locales) are checked by `pnpm check:i18n`,
 *              fitness #51.
 * @layer infrastructure
 */
import type { routing } from "@/i18n/routing";
import type messages from "@/messages/en.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
