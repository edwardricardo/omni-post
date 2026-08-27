import rootConfig from "../../stryker.config.mjs";

/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...rootConfig,
  tsconfigFile: "tsconfig.json",
  incrementalFile: "reports/stryker-incremental.json",
  htmlReporter: {
    fileName: "reports/mutation/index.html",
  },
  vitest: {
    configFile: "vitest.stryker.config.ts",
  },
  coverageAnalysis: "perTest",
  // Disable typescript checker — use vitest's own TS handling
  checkers: [],
  plugins: ["@stryker-mutator/vitest-runner"],
  // Static mutants (module-level constants/initializers) consume ~98% of run time
  // for ~10% of mutants. Run without this flag only in the nightly pipeline.
  ignoreStatic: true,
  // Concurrency inherited from root (2) — overriding to 4 exceeded WSL2 16GB ceiling
  // 43K mutants — initial test run needs more time for perTest coverage analysis
  dryRunTimeoutMinutes: 30,
  // Every POSITIVE glob below must resolve to at least one file on disk (fitness
  // #36 enforces exactly that; negations that match nothing are inert protection
  // and deliberately out of its scope — see SMELL-84). A positive glob whose
  // directory no longer exists mutates nothing and produces no signal, while the
  // report still reads as if the scope were covered: the 13 `src/domain/**` and
  // `src/application/**` entries removed here survived the relocation of both
  // layers to `packages/core/` and had the self-declared "primary quality gate"
  // mutating zero domain files. Measuring `packages/core` is a separate scope,
  // not a repoint of these globs.
  mutate: [
    // Auth & security layer
    "src/auth/**/*.ts",
    "!src/auth/**/*.test.ts",
    "src/audit/**/*.ts",
    "!src/audit/**/*.test.ts",
    "src/security/**/*.ts",
    "!src/security/**/*.test.ts",

    // Infrastructure & middleware
    "src/billing/**/*.ts",
    "!src/billing/**/*.test.ts",
    "src/webhooks/**/*.ts",
    "!src/webhooks/**/*.test.ts",
    "src/services/**/*.ts",
    "!src/services/**/*.test.ts",
    "src/admin/**/*.ts",
    "!src/admin/**/*.test.ts",

    // Expanded scope — directories with DB-free unit tests
    "src/ai/**/*.ts",
    "!src/ai/**/*.test.ts",
    "src/analytics/**/*.ts",
    "!src/analytics/**/*.test.ts",
    "src/cqrs/**/*.ts",
    "!src/cqrs/**/*.test.ts",
    "src/database/**/*.ts",
    "!src/database/**/*.test.ts",
    "src/health/**/*.ts",
    "!src/health/**/*.test.ts",
    "src/lib/**/*.ts",
    "!src/lib/**/*.test.ts",
    "!src/lib/templates/**/*.ts", // imports @infra/prisma — breaks in Stryker sandbox
    "src/metrics/**/*.ts",
    "!src/metrics/**/*.test.ts",
    "src/middleware/**/*.ts",
    "!src/middleware/**/*.test.ts",
    "src/monitoring/**/*.ts",
    "!src/monitoring/**/*.test.ts",
    "src/orchestration/**/*.ts",
    "!src/orchestration/**/*.test.ts",
    "src/posts/**/*.ts",
    "!src/posts/**/*.test.ts",
    "src/providers/**/*.ts",
    "!src/providers/**/*.test.ts",
    "src/saga/**/*.ts",
    "!src/saga/**/*.test.ts",
    "src/templates/**/*.ts",
    "!src/templates/**/*.test.ts",
    "src/trends/**/*.ts",
    "!src/trends/**/*.test.ts",
    "src/utils/**/*.ts",
    "!src/utils/**/*.test.ts",
    "src/validation/**/*.ts",
    "!src/validation/**/*.test.ts",
    "src/video/**/*.ts",
    "!src/video/**/*.test.ts",
    "src/compliance/**/*.ts",
    "!src/compliance/**/*.test.ts",
    "src/settings/**/*.ts",
    "!src/settings/**/*.test.ts",
    "src/onboarding/**/*.ts",
    "!src/onboarding/**/*.test.ts",
    "src/announcements/**/*.ts",
    "!src/announcements/**/*.test.ts",
  ],
  thresholds: {
    high: 80,
    low: 60,
    break: 52,
  },
};
