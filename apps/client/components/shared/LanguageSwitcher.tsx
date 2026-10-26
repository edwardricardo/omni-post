/**
 * @file LanguageSwitcher.tsx
 * @description Locale switcher for the dashboard shell. Lists every locale
 *              `routing.locales` declares, each under its own name, and switches
 *              to the chosen one while preserving the current route; navigation
 *              goes through next-intl's locale-aware router, which also persists
 *              the choice in the NEXT_LOCALE cookie.
 * @component LanguageSwitcher
 * @layer infrastructure
 */
"use client";

import { useLocale } from "next-intl";
import { Languages, Check } from "lucide-react";
import { Button } from "@packages/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@packages/ui";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";

/**
 * The locale's name in its own language, first letter capitalised as a standalone menu label
 * ("English", "Español", "Français"); CLDR's own form is the mid-sentence one ("español").
 */
function nativeLanguageLabel(locale: string): string {
  // `of` is typed `string | undefined` for `fallback: "none"`; the default "code" fallback returns
  // the code itself, so the `??` only satisfies the type.
  const name = new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
  return name.replace(/^\p{Ll}/u, (letter) => letter.toLocaleUpperCase(locale));
}

/**
 * @component LanguageSwitcher
 * @description Dropdown that switches the active locale, keeping the user on
 *   the same route.
 */
export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const handleSelect = (next: AppLocale) => {
    if (next === locale) return;
    router.replace(pathname, { locale: next });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={nativeLanguageLabel(locale)}>
          <Languages className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {routing.locales.map((loc) => (
          <DropdownMenuItem key={loc} onClick={() => handleSelect(loc)}>
            <span className="flex-1" lang={loc}>
              {nativeLanguageLabel(loc)}
            </span>
            {loc === locale && <Check className="ml-2 h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
