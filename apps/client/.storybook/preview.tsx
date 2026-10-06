/**
 * @file preview.tsx
 * @description Storybook preview configuration — global CSS, controls matchers, docs table of
 *              contents, viewports, backgrounds, the accessibility check that fails a story over
 *              WCAG 2.1 A/AA, and the theme and locale decorator.
 * @layer infrastructure
 */
import type { Preview } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";
import en from "../messages/en.json";
import es from "../messages/es.json";
import "../app/globals.css";

// The real catalogs, so a component that calls useTranslations renders its own text.
const MESSAGES = { en, es };

type StoryLocale = keyof typeof MESSAGES;

const isStoryLocale = (value: unknown): value is StoryLocale =>
  typeof value === "string" && Object.hasOwn(MESSAGES, value);

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
    docs: {
      toc: {
        contentsSelector: ".sbdocs-content",
        headingSelector: "h1, h2, h3",
        ignoreSelector: "#storybook-docs",
        title: "Table of Contents",
        disable: false,
        unsafeTocbotOptions: {
          orderedList: false,
        },
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
    locale: "en",
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
        items: [
          { value: "en", title: "English" },
          { value: "es", title: "Español" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme || "light";
      const locale = isStoryLocale(context.globals.locale) ? context.globals.locale : "en";

      return (
        <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
          <div className={theme} data-theme={theme}>
            <div className="min-h-screen bg-background text-foreground p-4">
              <Story />
            </div>
          </div>
        </NextIntlClientProvider>
      );
    },
  ],
  tags: ["autodocs"],
};

export default preview;
