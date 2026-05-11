import rootConfig from "../../stryker.config.mjs";

/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...rootConfig,
  tsconfigFile: "tsconfig.json",
  incrementalFile: "reports/stryker-incremental.json",
  htmlReporter: {
    fileName: "reports/mutation/batch-4.html",
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
    "src/security/**/*.ts",
    "!src/security/**/*.test.ts",
    "!src/security/**/*.spec.ts",
    "src/orchestration/**/*.ts",
    "!src/orchestration/**/*.test.ts",
    "!src/orchestration/**/*.spec.ts",
  ],
  thresholds: {
    high: 80,
    low: 60,
    break: 50,
  },
};
