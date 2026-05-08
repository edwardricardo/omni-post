/**
 * @file layout.tsx
 * @description Root layout for the admin dashboard. Configures Geist font family,
 *   next-intl i18n, ThemeProvider (dark/light), and the AdminToaster for notifications.
 * @layer infrastructure
 */
import React from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { LoggerProvider } from "@observability/browser-logger";

import { ThemeProvider } from "@/providers/ThemeProvider";
import { AdminToaster } from "@/components/ui/AdminToaster";
import "./globals.css";

export const metadata = { title: "Admin", description: "CMS Multicanal" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
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
