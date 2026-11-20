/**
 * @file preview.tsx
 * @description Storybook preview of the client app: the shared preview of @packages/ui/storybook
 *              (accessibility check over WCAG 2.1 A/AA, viewports, toolbars, theme and locale
 *              decorator) built with the client's intl provider, catalogs and light default
 *              theme, plus the client's global CSS and its preview backgrounds.
 * @layer infrastructure
 */
/// <reference types="vite/client" />
import type { Preview } from "@storybook/nextjs-vite";
import { createStoryPreview, type StoryMessages } from "@packages/ui/storybook";
import { NextIntlClientProvider } from "next-intl";
import { routing } from "../i18n/routing";
import "../app/globals.css";

// The real catalogs, so a component that calls useTranslations renders its own text. The routing
// names the locales and fitness #51 holds a catalog under messages/ for each, so a locale added to
// the routing reaches the stories with no edit here.
const CATALOGS = import.meta.glob<StoryMessages>("../messages/*.json", {
  eager: true,
  import: "default",
});

const shared = createStoryPreview({
  IntlProvider: NextIntlClientProvider,
  routing,
  catalogs: CATALOGS,
  defaultTheme: "light",
});

const preview: Preview = {
  ...shared,
  parameters: {
    ...shared.parameters,
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
    ...shared.initialGlobals,
    backgrounds: { value: "light" },
  },
};

export default preview;
