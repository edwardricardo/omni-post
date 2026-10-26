/**
 * @file preview.tsx
 * @description Storybook preview configuration — global CSS, controls matchers, docs table of
 *              contents, viewports, backgrounds, the accessibility check that fails a story over
 *              WCAG 2.1 A/AA, and the theme and locale decorator.
 * @layer infrastructure
 */
/// <reference types="vite/client" />
import type { Preview } from "@storybook/nextjs-vite";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { routing, type AppLocale } from "../i18n/routing";
import "../app/globals.css";

// The real catalogs, so a component that calls useTranslations renders its own text. The routing
// names the locales and fitness #51 holds a catalog under messages/ for each, so a locale added to
// the routing reaches the stories with no edit here.
const CATALOGS = import.meta.glob<AbstractIntlMessages>("../messages/*.json", {
  eager: true,
  import: "default",
});

const messagesOf = (locale: AppLocale): AbstractIntlMessages =>
  CATALOGS[`../messages/${locale}.json`] ?? {};

const isStoryLocale = (value: unknown): value is AppLocale =>
  typeof value === "string" && routing.locales.some((locale) => locale === value);

/** The locale's name in its own language, first letter capitalised as a toolbar label. */
const nativeLanguageLabel = (locale: string): string => {
  // The default "code" fallback returns the code itself; the `??` only satisfies the type.
  const name = new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
  return name.replace(/^\p{Ll}/u, (letter) => letter.toLocaleUpperCase(locale));
};

const preview: Preview = {
  parameters: {
    nextjs: {
      appDirectory: true,
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    viewport: {
      options: {
        mobile: { name: "Mobile", styles: { width: "375px", height: "667px" } },
        tablet: { name: "Tablet", styles: { width: "768px", height: "1024px" } },
        desktop: { name: "Desktop", styles: { width: "1440px", height: "900px" } },
        widescreen: { name: "Widescreen", styles: { width: "1920px", height: "1080px" } },
      },
    },
    a11y: {
      // `error` fails a story's test on any violation; the addon's default, `todo`, only reports it.
      test: "error",
      options: {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        checks: { "color-contrast": { options: { noScroll: true } } },
        restoreScroll: true,
      },
    },
    backgrounds: {
      options: {
        light: { name: "light", value: "#ffffff" },
        dark: { name: "dark", value: "#0a0a0a" },
        twitter: { name: "twitter", value: "#1da1f2" },
        instagram: { name: "instagram", value: "#e4405f" },
      },
    },
  },
  initialGlobals: {
    theme: "light",
    locale: routing.defaultLocale,
    backgrounds: { value: "light" },
  },
  globalTypes: {
    theme: {
      description: "Global theme for components",
      toolbar: {
        title: "Theme",
        icon: "paintbrush",
        items: [
          { value: "light", title: "Light", icon: "sun" },
          { value: "dark", title: "Dark", icon: "moon" },
        ],
        dynamicTitle: true,
      },
    },
    locale: {
      description: "Locale of the messages the components read",
      toolbar: {
        title: "Locale",
        icon: "globe",
        items: routing.locales.map((value) => ({ value, title: nativeLanguageLabel(value) })),
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme || "light";
      const locale = isStoryLocale(context.globals.locale)
        ? context.globals.locale
        : routing.defaultLocale;

      return (
        <NextIntlClientProvider locale={locale} messages={messagesOf(locale)}>
          <div className={theme} data-theme={theme}>
            <div className="min-h-screen bg-background text-foreground p-4">
              <Story />
            </div>
          </div>
        </NextIntlClientProvider>
      );
    },
  ],
};

export default preview;
