import rootConfig from "../../stryker.config.mjs";
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...rootConfig,
  tsconfigFile: "tsconfig.json",
  incrementalFile: "reports/stryker-incremental-micro.json",
  htmlReporter: { fileName: "reports/mutation/micro-A5.html" },
  vitest: { configFile: "vitest.config.ts" },
  coverageAnalysis: "perTest",
  checkers: [],
  plugins: ["@stryker-mutator/vitest-runner"],
  concurrency: 4,
  dryRunTimeoutMinutes: 15,
  mutate: [
    "src/templates/**/*.ts",
    "src/video/**/*.ts",
    "src/ai/**/*.ts",
    "src/billing/**/*.ts",
    "!src/templates/**/*.test.ts",
    "!src/templates/**/*.spec.ts",
    "!src/video/**/*.test.ts",
    "!src/video/**/*.spec.ts",
    "!src/ai/**/*.test.ts",
    "!src/ai/**/*.spec.ts",
    "!src/billing/**/*.test.ts",
    "!src/billing/**/*.spec.ts",
  ],
  thresholds: { high: 80, low: 60, break: null },
};
