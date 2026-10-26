/**
 * @file intl-test-utils.tsx
 * @description Test helpers: wrap UI in NextIntlClientProvider with a real catalog, so components
 *              using useTranslations render in tests. `IntlTestProvider` renders in Spanish;
 *              `renderInLocale` renders in the locale a test names.
 * @layer infrastructure
 */
import { render, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import enMessages from "@/messages/en.json";
import messages from "@/messages/es.json";

/** The catalogs a test can render in, keyed by locale. */
export const TEST_CATALOGS = { en: enMessages, es: messages } as const;

/** A locale a test can render in. */
export type TestLocale = keyof typeof TEST_CATALOGS;

/**
 * @description Wraps `children` in next-intl's provider with the Spanish catalog.
 * @param props - The children to render.
 * @returns The wrapped children.
 */
export function IntlTestProvider({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="es" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

/**
 * @description Renders `ui` under next-intl with the real catalog of `locale`.
 * @param locale - The locale to render in.
 * @param ui - The element to render.
 * @returns Testing Library's render result.
 */
export function renderInLocale(locale: TestLocale, ui: ReactElement): RenderResult {
  return render(
    <NextIntlClientProvider locale={locale} messages={TEST_CATALOGS[locale]}>
      {ui}
    </NextIntlClientProvider>
  );
}
