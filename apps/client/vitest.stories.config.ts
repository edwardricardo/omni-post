/**
 * @file vitest.stories.config.ts
 * @description Vitest configuration that runs every Storybook story of the client as a test in
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
  // own Vite plugins and resolve their imports through the client tsconfig, as the app does.
  plugins: [storybookTest({ configDir: path.join(import.meta.dirname, ".storybook") })],
  test: {
    name: "stories",
    setupFiles: ["./.storybook/vitest.setup.ts"],
    browser: {
      enabled: true,
      headless: true,
      // Playwright launches Chromium without its sandbox unless `chromiumSandbox` is set, which
      // is what lets the run start as root inside a container.
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
