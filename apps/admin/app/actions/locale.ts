/**
 * @file locale.ts
 * @description Server Action for switching the admin app's locale. Writes the
 *              `NEXT_LOCALE` cookie server-side and revalidates the root
 *              layout so every Server Component picks up the new
 *              translations on the next render. Replaces the legacy
 *              client-side `document.cookie` + `window.location.reload()`
 *              pair (Next.js App Router anti-pattern).
 * @layer infrastructure
 */
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

const SUPPORTED_LOCALES = ["en", "es"] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const LOCALE_COOKIE_NAME = "NEXT_LOCALE";
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // one year

/**
 * @method setLocaleAction
 * @description Persists the user's locale preference in the `NEXT_LOCALE`
 *   cookie and revalidates the root layout so every Server Component
 *   re-renders with the new translations on the next request.
 * @param locale - Either "en" or "es"; any other value is ignored.
 */
export async function setLocaleAction(locale: SupportedLocale): Promise<void> {
  if (!SUPPORTED_LOCALES.includes(locale)) {
    return;
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE_NAME, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });

  revalidatePath("/", "layout");
}
