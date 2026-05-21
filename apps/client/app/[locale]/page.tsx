/**
 * @file page.tsx
 * @component RootPage
 * @description Root page that redirects to the locale-prefixed login page.
 * @layer infrastructure
 */

import { redirect } from "@/i18n/navigation";

export default async function RootPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect({ href: "/login", locale });
}
