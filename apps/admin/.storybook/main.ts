/**
 * @file main.ts
 * @description Storybook configuration for the admin app. Mirrors apps/client/.storybook/main.ts:
 *              same framework (@storybook/nextjs webpack), same TypeScript docgen settings, same
 *              node: protocol webpack workaround. Stories scanned from `../stories` and
 *              `../components` (co-located stories beside components are supported).
 * @layer infrastructure
 */
import { createRequire } from "node:module";
import type { StorybookConfig } from "@storybook/nextjs";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);

const config: StorybookConfig = {
  stories: [
    "../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../stories/**/*.stories.mdx",
    "../components/**/*.stories.@(ts|tsx)",
  ],
  addons: [getAbsolutePath("@storybook/addon-a11y"), getAbsolutePath("@storybook/addon-docs")],
  framework: {
    name: getAbsolutePath("@storybook/nextjs"),
    options: {
      nextConfigPath: "../next.config.mjs",
    },
  },
  typescript: {
    check: false,
    reactDocgen: "react-docgen-typescript",
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      propFilter: (prop) => (prop.parent ? !/node_modules/.test(prop.parent.fileName) : true),
    },
  },
  // Webpack configuration mirrors the client app. The @shared/types package re-exports modules
  // that import node:buffer; these server-only modules never execute in the browser Storybook
  // context but webpack still needs to resolve them during bundling.
  webpackFinal: async (config) => {
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...config.resolve.fallback,
      buffer: false,
      stream: false,
      util: false,
      events: false,
      crypto: false,
      path: false,
      fs: false,
    };
    // Rewrite node: protocol imports (webpack 5 does not support them by default).
    const webpack = require("webpack");
    config.plugins = config.plugins || [];
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
        resource.request = resource.request.replace(/^node:/, "");
      })
    );
    return config;
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

function getAbsolutePath(value: string): any {
  return dirname(require.resolve(join(value, "package.json")));
}
