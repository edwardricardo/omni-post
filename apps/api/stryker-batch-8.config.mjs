import rootConfig from '../../stryker.config.mjs'

/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...rootConfig,
  tsconfigFile: 'tsconfig.json',
  incrementalFile: 'reports/stryker-incremental.json',
  htmlReporter: {
    fileName: 'reports/mutation/batch-8.html',
  },
  vitest: {
    configFile: 'vitest.config.ts',
  },
  coverageAnalysis: 'perTest',
  checkers: [],
  plugins: ['@stryker-mutator/vitest-runner'],
  concurrency: 4,
  dryRunTimeoutMinutes: 30,
  mutate: [
    'src/domain/**/*.ts',
    '!src/domain/**/*.test.ts',
    '!src/domain/**/*.spec.ts',
  ],
  thresholds: {
    high: 80,
    low: 60,
    break: 52,
  },
}
