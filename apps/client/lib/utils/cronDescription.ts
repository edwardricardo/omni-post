/**
 * @file cronDescription.ts
 * @description Describes a cron expression in the language the user is viewing. It holds the one
 *              place that imports cronstrue locales: one per language of `routing.locales`, so the
 *              client never ships the bundle that carries every language.
 * @layer infrastructure
 */
import cronstrue from "cronstrue";
// English is built into cronstrue; every other routing language needs its locale module here.
import "cronstrue/locales/es";
import { routing, type AppLocale } from "@/i18n/routing";

/**
 * The cronstrue locale code for each language of the routing. Typed over `AppLocale`, so a
 * language added to the routing without an entry here fails the typecheck.
 */
export const CRONSTRUE_LOCALES = {
  en: "en",
  es: "es",
} as const satisfies Record<AppLocale, string>;

/** Options a caller may set; the 24-hour clock is each screen's own choice. */
export interface CronDescriptionOptions {
  /** Whether times read on a 24-hour clock. */
  use24HourTimeFormat: boolean;
}

function isRoutingLocale(locale: string): locale is AppLocale {
  return (routing.locales as readonly string[]).includes(locale);
}

/**
 * @description Describes `expression` in `locale`. Returns the expression itself when cronstrue
 *   cannot parse it, and also when `locale` is not a language of the routing: describing it in
 *   English would pass an unsupported language off as supported.
 * @param expression - The cron expression, as the user typed or stored it.
 * @param locale - The active UI locale, as `useLocale()` returns it.
 * @param options - The screen's own clock setting.
 * @returns The description in the user's language, or the raw expression.
 */
export function describeCron(
  expression: string,
  locale: string,
  { use24HourTimeFormat }: CronDescriptionOptions
): string {
  if (!isRoutingLocale(locale)) return expression;
  try {
    return cronstrue.toString(expression, {
      use24HourTimeFormat,
      locale: CRONSTRUE_LOCALES[locale],
    });
  } catch {
    return expression;
  }
}
