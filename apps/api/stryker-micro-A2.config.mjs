import rootConfig from "../../stryker.config.mjs";
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...rootConfig,
  tsconfigFile: "tsconfig.json",
  incrementalFile: "reports/stryker-incremental-micro.json",
  htmlReporter: { fileName: "reports/mutation/micro-A2.html" },
  vitest: { configFile: "vitest.config.ts" },
  coverageAnalysis: "perTest",
  checkers: [],
  plugins: ["@stryker-mutator/vitest-runner"],
  concurrency: 4,
  dryRunTimeoutMinutes: 15,
  mutate: [
    "src/middleware/**/*.ts",
    "src/services/**/*.ts",
    "src/posts/**/*.ts",
    "src/projects/**/*.ts",
    "!src/middleware/**/*.test.ts",
    "!src/middleware/**/*.spec.ts",
    "!src/services/**/*.test.ts",
    "!src/services/**/*.spec.ts",
    "!src/posts/**/*.test.ts",
    "!src/posts/**/*.spec.ts",
    "!src/projects/**/*.test.ts",
    "!src/projects/**/*.spec.ts",
  ],
  thresholds: { high: 80, low: 60, break: null },
};
