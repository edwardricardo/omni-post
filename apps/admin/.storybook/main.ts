/**
 * @file main.ts
 * @description Storybook configuration for the admin app — the stories beside the admin's
 *              components, the accessibility and vitest addons, and the Vite-based Next.js
 *              framework, which resolves imports through the admin tsconfig.
 * @layer infrastructure
 */
import type { StorybookConfig } from "@storybook/nextjs-vite";

const config: StorybookConfig = {
  stories: ["../components/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-vitest"],
  framework: {
    name: "@storybook/nextjs-vite",
    options: {
      nextConfigPath: "../next.config.mjs",
    },
  },
  staticDirs: ["../public"],
  core: {
    disableTelemetry: true,
  },
};

export default config;
