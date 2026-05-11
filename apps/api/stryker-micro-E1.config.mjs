import rootConfig from "../../stryker.config.mjs";
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...rootConfig,
  tsconfigFile: "tsconfig.json",
  incrementalFile: "reports/stryker-incremental-micro.json",
  htmlReporter: { fileName: "reports/mutation/micro-E1.html" },
  vitest: { configFile: "vitest.config.ts" },
  coverageAnalysis: "perTest",
  checkers: [],
  plugins: ["@stryker-mutator/vitest-runner"],
  concurrency: 4,
  dryRunTimeoutMinutes: 15,
  mutate: [
    "src/application/inbox/**/*.ts",
    "src/application/posts/**/*.ts",
    "src/application/ml/**/*.ts",
    "!src/application/inbox/**/*.test.ts",
    "!src/application/inbox/**/*.spec.ts",
    "!src/application/posts/**/*.test.ts",
    "!src/application/posts/**/*.spec.ts",
    "!src/application/ml/**/*.test.ts",
    "!src/application/ml/**/*.spec.ts",
  ],
  thresholds: { high: 80, low: 60, break: null },
};
