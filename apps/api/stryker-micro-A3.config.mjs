import rootConfig from "../../stryker.config.mjs";
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...rootConfig,
  tsconfigFile: "tsconfig.json",
  incrementalFile: "reports/stryker-incremental-micro.json",
  htmlReporter: { fileName: "reports/mutation/micro-A3.html" },
  vitest: { configFile: "vitest.config.ts" },
  coverageAnalysis: "perTest",
  checkers: [],
  plugins: ["@stryker-mutator/vitest-runner"],
  concurrency: 4,
  dryRunTimeoutMinutes: 15,
  mutate: [
    "src/monitoring/**/*.ts",
    "src/audit/**/*.ts",
    "src/trends/**/*.ts",
    "src/saga/**/*.ts",
    "!src/monitoring/**/*.test.ts",
    "!src/monitoring/**/*.spec.ts",
    "!src/audit/**/*.test.ts",
    "!src/audit/**/*.spec.ts",
    "!src/trends/**/*.test.ts",
    "!src/trends/**/*.spec.ts",
    "!src/saga/**/*.test.ts",
    "!src/saga/**/*.spec.ts",
  ],
  thresholds: { high: 80, low: 60, break: null },
};
