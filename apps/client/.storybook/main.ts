/**
 * @file main.ts
 * @description Storybook configuration for the client app — story globs, addons and the
 *              Vite-based Next.js framework, which resolves imports through the client tsconfig.
 * @layer infrastructure
 */
import type { StorybookConfig } from "@storybook/nextjs-vite";

const config: StorybookConfig = {
  stories: [
    "../stories/**/*.stories.@(ts|tsx)",
    "../components/**/*.stories.@(ts|tsx)",
    // packages/ui stories are picked up here rather than running a separate
    // Storybook for the package, to avoid dual-maintenance of addons/preview.
    "../../../packages/ui/src/**/*.stories.@(ts|tsx)",
  ],
  addons: ["@storybook/addon-a11y", "@storybook/addon-docs", "@storybook/addon-vitest"],
  framework: {
    name: "@storybook/nextjs-vite",
    options: {
      nextConfigPath: "../next.config.mjs",
    },
  },
  typescript: {
    reactDocgen: "react-docgen-typescript",
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      propFilter: (prop) => (prop.parent ? !/node_modules/.test(prop.parent.fileName) : true),
    },
  },
  staticDirs: ["../public"],
  core: {
    disableTelemetry: true,
  },
  docs: {
    defaultName: "Documentation",
  },
};

export default config;
