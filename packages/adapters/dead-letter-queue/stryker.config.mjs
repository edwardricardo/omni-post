import rootConfig from '../../../stryker.config.mjs'

/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...rootConfig,
  incrementalFile: 'reports/stryker-incremental.json',
  htmlReporter: {
    fileName: 'reports/mutation/index.html',
  },
  vitest: {
    configFile: 'vitest.config.ts',
    related: false,
  },
  coverageAnalysis: 'perTest',
  checkers: [],
  plugins: ['@stryker-mutator/vitest-runner'],
  concurrency: 4,
  mutate: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.d.ts',
  ],
  thresholds: {
    high: 80,
    low: 60,
    break: 63,
  },
}
