/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  packageManager: 'pnpm',
  testRunner: 'vitest',
  plugins: [
    '@stryker-mutator/vitest-runner',
    '@stryker-mutator/typescript-checker',
  ],
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  reporters: ['html', 'clear-text', 'progress'],
  htmlReporter: {
    fileName: 'reports/mutation/index.html',
  },
  thresholds: {
    high: 80,
    low: 60,
    break: 52,
  },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
  concurrency: 2,   // conservative — adjust after measuring run time
}
