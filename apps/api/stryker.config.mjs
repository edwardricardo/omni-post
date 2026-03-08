/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: "pnpm",

  testRunner: "tap",
  tap: {
    testFiles: [
      // Domain Tier-0 (7 files — pure logic, no DB)
      "tests/unit/domain/value-objects.test.ts",
      "tests/unit/domain/entities.test.ts",
      "tests/unit/domain/aggregates.test.ts",
      "tests/unit/domain/domain-errors.test.ts",
      "tests/unit/domain/crisisMode.test.ts",
      "tests/unit/domain/linkTracking.test.ts",
      "tests/unit/domain/Container.test.ts",
      // Application Tier-0 (5 files — mocked repos, no DB)
      "tests/unit/application/AnalyticsUseCases.test.ts",
      "tests/unit/application/EventCQRSUseCases.test.ts",
      "tests/unit/application/ApiKeyUseCases.test.ts",
      "tests/unit/application/crisis/crisisUseCases.test.ts",
      "tests/unit/application/links/linkUseCases.test.ts",
    ],
    nodeArgs: [
      "--import", "tsx",
      "--test-reporter=tap",
      "--test-force-exit",
      "--test-timeout=30000",
      "-r", "{{hookFile}}",
      "{{testFile}}",
    ],
    forceBail: true,
  },

  mutate: [
    // Domain layer — value objects, entities, aggregates, events, errors
    "src/domain/**/*.ts",
    "!src/domain/**/index.ts",
    "!src/domain/repositories/**",
    // Application layer — use cases WITH Tier-0 tests only
    "src/application/apiKeys/**/*.ts",
    "src/application/analytics/**/*.ts",
    "src/application/crisis/**/*.ts",
    "src/application/events/**/*.ts",
    "src/application/links/**/*.ts",
    "!src/application/**/index.ts",
    "!src/application/**/types.ts",
    // Excluded (no Tier-0 tests — require Prisma):
    //   src/application/posts/** → UseCases.test.ts is Tier-1
    //   src/application/ml/**   → MLUseCases.test.ts is Tier-1
  ],

  checkers: ["typescript"],

  plugins: [
    "@stryker-mutator/tap-runner",
    "@stryker-mutator/typescript-checker",
  ],

  ignoreStatic: true,
  coverageAnalysis: "perTest",

  // Baseline (2026-02-24): 25.55% overall → ~50.9% on tested code
  // NoCoverage mutants excluded from score by scoping mutate targets
  thresholds: {
    high: 80,
    low: 60,
    break: null, // No CI failure — establishing baseline
  },

  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: {
    fileName: "reports/mutation/index.html",
  },
  jsonReporter: {
    fileName: "reports/mutation/mutation.json",
  },

  incremental: true,
  incrementalFile: "reports/stryker-incremental.json",

  concurrency: 4,
  timeoutMS: 10000,
};

export default config;
