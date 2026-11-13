/**
 * @file layout.tsx
 * @description Locale-scoped root layout for the admin dashboard. Validates the
 *   locale segment, enables static rendering via `setRequestLocale`, and wraps
 *   children in the next-intl client provider, ThemeProvider, and AdminToaster.
 * @component LocaleLayout
 * @layer infrastructure
 */
import React from "react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { LoggerProvider } from "@observability/browser-logger";

import { ThemeProvider } from "@/providers/ThemeProvider";
import { AdminToaster } from "@/components/ui/AdminToaster";
import { routing } from "@/i18n/routing";
import "../globals.css";

export const metadata = { title: "Admin", description: "CMS Multicanal" };

/**
 * @description Lists the locale segments to prerender, one per configured locale.
 * @returns One params object per locale of the routing configuration.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Renders the document shell for one locale: answers an unknown locale with a 404,
 * loads its messages, and wraps the page in the logger, theme and next-intl providers.
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale} className="dark" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <LoggerProvider defaultContext={{ app: "admin" }}>
          <ThemeProvider>
            <NextIntlClientProvider locale={locale} messages={messages}>
              {children}
              <AdminToaster />
            </NextIntlClientProvider>
          </ThemeProvider>
        </LoggerProvider>
      </body>
    </html>
  );
}
