/**
 * @file vitest.stories.config.ts
 * @description Vitest configuration that runs every Storybook story of the admin as a test in
 *              headless Chromium through @storybook/addon-vitest: the story renders, its play
 *              function runs, and axe and the console contract can fail it. Kept apart from
 *              vitest.config.ts, because the jsdom suite must never start a browser.
 * @layer infrastructure
 */
import path from "node:path";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The plugin loads .storybook/main.ts, so the stories render through the Next.js framework's
  // own Vite plugins and resolve their imports through the admin tsconfig, as the app does.
  plugins: [storybookTest({ configDir: path.join(import.meta.dirname, ".storybook") })],
  // The preview imports the routing, and so next-intl/routing, which Vite's dependency scan does
  // not reach; listing it keeps the optimizer from reloading the browser mid-run.
  optimizeDeps: { include: ["next-intl/routing"] },
  test: {
    name: "stories",
    // The console contract every portal's stories run under: a console.error or console.warn
    // fails the story.
    setupFiles: ["@packages/vitest-shared/story-console-contract"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
