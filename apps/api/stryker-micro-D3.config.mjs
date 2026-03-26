import rootConfig from '../../stryker.config.mjs'
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...rootConfig,
  tsconfigFile: 'tsconfig.json',
  incrementalFile: 'reports/stryker-incremental-micro.json',
  htmlReporter: { fileName: 'reports/mutation/micro-D3.html' },
  vitest: { configFile: 'vitest.config.ts' },
  coverageAnalysis: 'perTest',
  checkers: [],
  plugins: ['@stryker-mutator/vitest-runner'],
  concurrency: 4,
  dryRunTimeoutMinutes: 15,
  mutate: [
    "src/analytics/*.ts",
    "!src/analytics/*.ts",
    "!src/analytics/*.ts"
],
  thresholds: { high: 80, low: 60, break: null },
}
