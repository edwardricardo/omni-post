import rootConfig from '../../stryker.config.mjs'
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...rootConfig,
  tsconfigFile: 'tsconfig.json',
  incrementalFile: 'reports/stryker-incremental-micro.json',
  htmlReporter: { fileName: 'reports/mutation/micro-F1.html' },
  vitest: { configFile: 'vitest.config.ts' },
  coverageAnalysis: 'perTest',
  checkers: [],
  plugins: ['@stryker-mutator/vitest-runner'],
  concurrency: 4,
  dryRunTimeoutMinutes: 15,
  mutate: [
    "src/domain/entities/**/*.ts",
    "!src/domain/entities/**/*.test.ts",
    "!src/domain/entities/**/*.spec.ts"
],
  thresholds: { high: 80, low: 60, break: null },
}
