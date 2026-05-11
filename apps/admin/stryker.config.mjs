import rootConfig from "../../stryker.config.mjs";

/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...rootConfig,
  incrementalFile: "reports/stryker-incremental.json",
  htmlReporter: {
    fileName: "reports/mutation/index.html",
  },
  vitest: {
    configFile: "vitest.config.ts",
  },
  coverageAnalysis: "perTest",
  checkers: [],
  plugins: ["@stryker-mutator/vitest-runner"],
  concurrency: 4,
  mutate: [
    // Business logic — non-presentational
    "lib/**/*.ts",
    "lib/**/*.tsx",
    "!lib/**/*.test.ts",
    "!lib/**/*.test.tsx",
    "!lib/**/*.spec.ts",

    // Hooks with logic
    "hooks/**/*.ts",
    "hooks/**/*.tsx",
    "!hooks/**/*.test.ts",
    "!hooks/**/*.test.tsx",

    // Utility functions
    "components/**/*.ts",
    "!components/**/*.test.ts",
    "!components/**/*.stories.tsx",

    // Exclude presentational-only files
    "!**/*.css",
    "!**/*.svg",
  ],
  thresholds: {
    high: 80,
    low: 60,
    break: 71,
  },
};
