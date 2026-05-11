import rootConfig from "../../stryker.config.mjs";

/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...rootConfig,
  tsconfigFile: "tsconfig.json",
  incrementalFile: "reports/stryker-incremental.json",
  htmlReporter: {
    fileName: "reports/mutation/batch-1.html",
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
    "src/health/**/*.ts",
    "!src/health/**/*.test.ts",
    "!src/health/**/*.spec.ts",
    "src/utils/**/*.ts",
    "!src/utils/**/*.test.ts",
    "!src/utils/**/*.spec.ts",
    "src/validation/**/*.ts",
    "!src/validation/**/*.test.ts",
    "!src/validation/**/*.spec.ts",
    "src/middleware/**/*.ts",
    "!src/middleware/**/*.test.ts",
    "!src/middleware/**/*.spec.ts",
    "src/metrics/**/*.ts",
    "!src/metrics/**/*.test.ts",
    "!src/metrics/**/*.spec.ts",
  ],
  thresholds: {
    high: 80,
    low: 60,
    break: 57,
  },
};
