import rootConfig from '../../stryker.config.mjs'
export default {
  ...rootConfig,
  tsconfigFile: 'tsconfig.json',
  incrementalFile: 'reports/stryker-billing-incremental.json',
  htmlReporter: { fileName: 'reports/mutation/billing-only.html' },
  vitest: { configFile: 'vitest.config.ts' },
  coverageAnalysis: 'perTest',
  checkers: [],
  plugins: ['@stryker-mutator/vitest-runner'],
  concurrency: 4,
  dryRunTimeoutMinutes: 15,
  mutate: [
    'src/billing/**/*.ts',
    '!src/billing/**/*.test.ts',
    '!src/billing/**/*.spec.ts',
  ],
  thresholds: { high: 80, low: 60, break: null },
}
