import rootConfig from "../../stryker.config.mjs";

/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...rootConfig,
  tsconfigFile: "tsconfig.json",
  incrementalFile: "reports/stryker-incremental.json",
  htmlReporter: {
    fileName: "reports/mutation/batch-5.html",
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
    "src/auth/**/*.ts",
    "!src/auth/**/*.test.ts",
    "!src/auth/**/*.spec.ts",
    "src/webhooks/**/*.ts",
    "!src/webhooks/**/*.test.ts",
    "!src/webhooks/**/*.spec.ts",
    "src/admin/**/*.ts",
    "!src/admin/**/*.test.ts",
    "!src/admin/**/*.spec.ts",
  ],
  thresholds: {
    high: 80,
    low: 60,
    break: 51,
  },
};
