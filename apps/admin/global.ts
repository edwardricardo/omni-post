/**
 * @file global.ts
 * @description next-intl type-safe configuration. Augments `AppConfig` with the
 *              supported `Locale` union (from routing) and the `Messages` shape
 *              (from the default-locale catalog), so `useTranslations`/`t()`
 *              keys are checked by TypeScript — a non-existent key becomes a
 *              compile error. This IS the i18n lint (next-intl validates via
 *              TypeScript; there is no separate lint command).
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
