import rootConfig from "../../stryker.config.mjs";
export default {
  ...rootConfig,
  tsconfigFile: "tsconfig.json",
  incrementalFile: "reports/stryker-domain-targeted.json",
  htmlReporter: { fileName: "reports/mutation/domain-targeted.html" },
  vitest: { configFile: "vitest.config.ts" },
  coverageAnalysis: "perTest",
  checkers: [],
  plugins: ["@stryker-mutator/vitest-runner"],
  concurrency: 4,
  dryRunTimeoutMinutes: 15,
  mutate: [
    "src/domain/aggregates/SocialMessageAggregate.ts",
    "src/domain/value-objects/ApprovalStatus.ts",
    "src/domain/value-objects/ScheduledTime.ts",
    "src/domain/value-objects/Content.ts",
    "src/analytics/roi/CostCalculator.ts",
    "src/analytics/roi/RevenueCalculator.ts",
  ],
  thresholds: { high: 80, low: 60, break: null },
};
