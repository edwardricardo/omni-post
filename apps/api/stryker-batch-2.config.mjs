import rootConfig from "../../stryker.config.mjs";

/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...rootConfig,
  tsconfigFile: "tsconfig.json",
  incrementalFile: "reports/stryker-incremental.json",
  htmlReporter: {
    fileName: "reports/mutation/batch-2.html",
  },
  vitest: {
    configFile: "vitest.config.ts",
  },
  coverageAnalysis: "perTest",
  checkers: [],
  plugins: ["@stryker-mutator/vitest-runner"],
  concurrency: 4,
  dryRunTimeoutMinutes: 30,
  mutate: [
    "src/services/**/*.ts",
    "!src/services/**/*.test.ts",
    "!src/services/**/*.spec.ts",
    "src/posts/**/*.ts",
    "!src/posts/**/*.test.ts",
    "!src/posts/**/*.spec.ts",
    "src/monitoring/**/*.ts",
    "!src/monitoring/**/*.test.ts",
    "!src/monitoring/**/*.spec.ts",
    "src/audit/**/*.ts",
    "!src/audit/**/*.test.ts",
    "!src/audit/**/*.spec.ts",
    "src/trends/**/*.ts",
    "!src/trends/**/*.test.ts",
    "!src/trends/**/*.spec.ts",
    "src/saga/**/*.ts",
    "!src/saga/**/*.test.ts",
    "!src/saga/**/*.spec.ts",
  ],
  thresholds: {
    high: 80,
    low: 60,
    break: 56,
  },
};
