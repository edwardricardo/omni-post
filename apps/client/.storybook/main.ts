import { createRequire } from "node:module";
import type { StorybookConfig } from "@storybook/nextjs";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)", "../stories/**/*.stories.mdx"],
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
  // Webpack configuration for handling node: protocol imports.
  // The @shared/types package re-exports cqrs.js which imports node:buffer.
  // These server-only modules never execute in the browser Storybook context
  // but webpack still needs to resolve them during bundling.
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
    // Handle the node: protocol scheme that webpack 5 does not support by default.
    // NormalModuleReplacementPlugin rewrites node:X imports to X so the fallback above applies.
    // Use require() since webpack is a transitive dependency (via @storybook/builder-webpack5).
    const webpack = require("webpack");
    config.plugins = config.plugins || [];
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
        resource.request = resource.request.replace(/^node:/, "");
      })
    );
    return config;
  },
  // Next.js framework handles webpack configuration automatically
  // Including path aliases, CSS processing, and PostCSS/Tailwind
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
