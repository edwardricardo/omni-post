/**
 * @file preview.tsx
 * @description Storybook preview of the admin app: the shared preview of @packages/ui/storybook
 *              (accessibility check over WCAG 2.1 A/AA, viewports, toolbars, theme and locale
 *              decorator) built with the admin's intl provider, catalogs and dark default theme,
 *              the theme the app renders in, plus the admin's global CSS.
 * @layer infrastructure
 */
/// <reference types="vite/client" />
import { createStoryPreview, type StoryMessages } from "@packages/ui/storybook";
import { NextIntlClientProvider } from "next-intl";
import { routing } from "../i18n/routing";
import "../app/globals.css";

export default createStoryPreview({
  IntlProvider: NextIntlClientProvider,
  routing,
  // The real catalogs, so a component that calls useTranslations renders its own text; fitness
  // #51 holds a catalog under messages/ for each locale the routing declares.
  catalogs: import.meta.glob<StoryMessages>("../messages/*.json", {
    eager: true,
    import: "default",
  }),
  defaultTheme: "dark",
});
