/**
 * @file page.tsx
 * @component RootPage
 * @description Root page that redirects to the locale-prefixed login page.
 * @layer infrastructure
 */

import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { redirect } from "@/i18n/navigation";

export default async function RootPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  redirect({ href: "/login", locale });
}
