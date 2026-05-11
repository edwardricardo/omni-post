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
    // Business logic
    "lib/**/*.ts",
    "lib/**/*.tsx",
    "!lib/**/*.test.ts",
    "!lib/**/*.test.tsx",
    "!lib/**/*.spec.ts",
    "!lib/api/__tests__/**",
    "!lib/templates/__tests__/**",
    "!lib/providers/__tests__/**",
    "!lib/auth/__tests__/**",
    "!lib/utils/__tests__/**",

    // Exclude React-only files (need integration/E2E testing, not unit mutation)
    "!lib/hooks/**",
    "!lib/scalability/**",
    "!lib/auth/authContext.tsx",

    // Hooks with logic (top-level — currently empty)
    "hooks/**/*.ts",
    "hooks/**/*.tsx",
    "!hooks/**/*.test.ts",
    "!hooks/**/*.test.tsx",

    // Utility functions
    "utils/**/*.ts",
    "!utils/**/*.test.ts",

    // Exclude presentational-only files
    "!**/*.css",
    "!**/*.svg",
  ],
  thresholds: {
    high: 80,
    low: 60,
    break: 50,
  },
};
