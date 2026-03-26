import rootConfig from '../../stryker.config.mjs'
export default {
  ...rootConfig, tsconfigFile: 'tsconfig.json',
  incrementalFile: 'reports/stryker-inbox.json',
  htmlReporter: { fileName: 'reports/mutation/inbox.html' },
  vitest: { configFile: 'vitest.config.ts' },
  coverageAnalysis: 'perTest', checkers: [], plugins: ['@stryker-mutator/vitest-runner'],
  concurrency: 4, dryRunTimeoutMinutes: 15,
  mutate: [
    'src/application/inbox/IngestSocialMessageUseCase.ts',
    'src/application/inbox/MarkMessageReadUseCase.ts',
  ],
  thresholds: { high: 80, low: 60, break: null },
}
