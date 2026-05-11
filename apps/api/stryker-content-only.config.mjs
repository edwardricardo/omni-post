import rootConfig from "../../stryker.config.mjs";
export default {
  ...rootConfig,
  tsconfigFile: "tsconfig.json",
  incrementalFile: "reports/stryker-content-incremental.json",
  htmlReporter: { fileName: "reports/mutation/content-only.html" },
  vitest: { configFile: "vitest.config.ts" },
  coverageAnalysis: "perTest",
  checkers: [],
  plugins: ["@stryker-mutator/vitest-runner"],
  concurrency: 4,
  dryRunTimeoutMinutes: 15,
  mutate: ["src/content/DiffCalculator.ts", "src/content/ConflictDetector.ts"],
  thresholds: { high: 80, low: 60, break: null },
};
