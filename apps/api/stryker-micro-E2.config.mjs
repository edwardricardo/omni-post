import rootConfig from '../../stryker.config.mjs'
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...rootConfig,
  tsconfigFile: 'tsconfig.json',
  incrementalFile: 'reports/stryker-incremental-micro.json',
  htmlReporter: { fileName: 'reports/mutation/micro-E2.html' },
  vitest: { configFile: 'vitest.config.ts' },
  coverageAnalysis: 'perTest',
  checkers: [],
  plugins: ['@stryker-mutator/vitest-runner'],
  concurrency: 4,
  dryRunTimeoutMinutes: 15,
  mutate: [
    "src/application/recurring/**/*.ts",
    "src/application/analytics/**/*.ts",
    "src/application/campaigns/**/*.ts",
    "src/application/notifications/**/*.ts",
    "!src/application/recurring/**/*.test.ts",
    "!src/application/recurring/**/*.spec.ts",
    "!src/application/analytics/**/*.test.ts",
    "!src/application/analytics/**/*.spec.ts",
    "!src/application/campaigns/**/*.test.ts",
    "!src/application/campaigns/**/*.spec.ts",
    "!src/application/notifications/**/*.test.ts",
    "!src/application/notifications/**/*.spec.ts"
],
  thresholds: { high: 80, low: 60, break: null },
}
