/**
 * @file layout.tsx
 * @description Locale-scoped root layout for the admin dashboard. Validates the
 *   locale segment, enables static rendering via `setRequestLocale`, configures
 *   the Geist font family, and wraps children in the next-intl client provider,
 *   ThemeProvider, and AdminToaster.
 * @component LocaleLayout
 * @layer infrastructure
 */
import React from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { LoggerProvider } from "@observability/browser-logger";

import { ThemeProvider } from "@/providers/ThemeProvider";
import { AdminToaster } from "@/components/ui/AdminToaster";
import { routing } from "@/i18n/routing";
import "../globals.css";

export const metadata = { title: "Admin", description: "CMS Multicanal" };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

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
    <html
      lang={locale}
      className={`dark ${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
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
