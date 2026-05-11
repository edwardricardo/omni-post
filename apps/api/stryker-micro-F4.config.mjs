import rootConfig from "../../stryker.config.mjs";
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...rootConfig,
  tsconfigFile: "tsconfig.json",
  incrementalFile: "reports/stryker-incremental-micro.json",
  htmlReporter: { fileName: "reports/mutation/micro-F4.html" },
  vitest: { configFile: "vitest.config.ts" },
  coverageAnalysis: "perTest",
  checkers: [],
  plugins: ["@stryker-mutator/vitest-runner"],
  concurrency: 4,
  dryRunTimeoutMinutes: 15,
  mutate: [
    "src/domain/aggregates/**/*.ts",
    "src/domain/events/**/*.ts",
    "src/domain/errors/**/*.ts",
    "!src/domain/aggregates/**/*.test.ts",
    "!src/domain/aggregates/**/*.spec.ts",
    "!src/domain/events/**/*.test.ts",
    "!src/domain/events/**/*.spec.ts",
    "!src/domain/errors/**/*.test.ts",
    "!src/domain/errors/**/*.spec.ts",
  ],
  thresholds: { high: 80, low: 60, break: null },
};
