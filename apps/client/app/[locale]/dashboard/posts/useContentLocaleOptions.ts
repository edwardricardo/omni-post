/**
 * @file useContentLocaleOptions.ts
 * @description The content languages the post composer offers, and the name it shows for each:
 *              the interface catalog's `posts.language.<code>` message, or the language's own
 *              name from `Intl.DisplayNames` in the interface language when the catalog has none.
 *              The list is CONTENT_LOCALES, so a language added there is offered with no edit here.
 * @layer infrastructure
 */
import { useLocale, useMessages } from "next-intl";
import { CONTENT_LOCALES, type ContentLocale } from "@shared/types";

/** One option of the composer's language select. */
export interface ContentLocaleOption {
  /** The content language. */
  value: ContentLocale;
  /** Its name in the interface language. */
  label: string;
}

/**
 * @function contentLocaleLabel
 * @description Names a content language for a reader of the interface language.
 * @param locale - The content language's code.
 * @param catalog - The interface catalog's `posts.language` messages, keyed by code.
 * @param uiLocale - The interface language.
 * @returns The catalog's name for the code, otherwise the language's name from Intl.DisplayNames.
 */
export function contentLocaleLabel(
  locale: string,
  catalog: Readonly<Record<string, string | undefined>>,
  uiLocale: string
): string {
  return (
    catalog[locale] ?? new Intl.DisplayNames([uiLocale], { type: "language" }).of(locale) ?? locale
  );
}

/**
 * @hook useContentLocaleLabel
 * @description Names content languages in the interface language of the current page.
 * @returns A function from a content language to its name.
 */
export function useContentLocaleLabel(): (locale: ContentLocale) => string {
  const uiLocale = useLocale();
  const catalog: Readonly<Record<string, string | undefined>> = useMessages().posts.language;
  return (locale) => contentLocaleLabel(locale, catalog, uiLocale);
}

/**
 * @hook useContentLocaleOptions
 * @description The options of the composer's language select.
 * @returns One option per entry of CONTENT_LOCALES, in its order, each named in the interface
 *   language.
 */
export function useContentLocaleOptions(): ContentLocaleOption[] {
  const label = useContentLocaleLabel();
  return CONTENT_LOCALES.map((value) => ({ value, label: label(value) }));
}
