/**
 * @file intl-test-utils.tsx
 * @description Test helper: wraps UI in NextIntlClientProvider with the real
 *              Spanish catalog so components using useTranslations render in tests.
 * @layer infrastructure
 */
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import messages from "@/messages/es.json";

export function IntlTestProvider({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="es" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
