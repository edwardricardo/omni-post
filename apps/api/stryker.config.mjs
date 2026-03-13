import rootConfig from '../../stryker.config.mjs'

/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...rootConfig,
  tsconfigFile: 'tsconfig.json',
  incrementalFile: 'reports/stryker-incremental.json',
  htmlReporter: {
    fileName: 'reports/mutation/index.html',
  },
  vitest: {
    configFile: 'vitest.config.ts',
  },
  coverageAnalysis: 'perTest',
  // Disable typescript checker — use vitest's own TS handling
  checkers: [],
  plugins: ['@stryker-mutator/vitest-runner'],
  // 4 workers — vitest forks pool handles isolation per file
  concurrency: 4,
  mutate: [
    // Domain layer — pure logic, no infrastructure dependencies
    'src/domain/**/*.ts',
    '!src/domain/**/*.test.ts',
    '!src/domain/**/*.spec.ts',

    // Application layer
    'src/application/apiKeys/**/*.ts',
    '!src/application/apiKeys/**/*.test.ts',

    'src/application/analytics/**/*.ts',
    '!src/application/analytics/**/*.test.ts',

    'src/application/crisis/**/*.ts',
    '!src/application/crisis/**/*.test.ts',

    'src/application/events/**/*.ts',
    '!src/application/events/**/*.test.ts',

    'src/application/links/**/*.ts',
    '!src/application/links/**/*.test.ts',

    // Auth & security layer (now DB-free with mocked prisma)
    'src/auth/**/*.ts',
    '!src/auth/**/*.test.ts',

    'src/audit/**/*.ts',
    '!src/audit/**/*.test.ts',

    'src/billing/**/*.ts',
    '!src/billing/**/*.test.ts',

    'src/webhooks/**/*.ts',
    '!src/webhooks/**/*.test.ts',

    'src/security/**/*.ts',
    '!src/security/**/*.test.ts',

    'src/services/**/*.ts',
    '!src/services/**/*.test.ts',

    'src/admin/**/*.ts',
    '!src/admin/**/*.test.ts',
  ],
  thresholds: {
    high: 80,
    low: 60,
    break: null,   // will be set to (baseline - 3) after first successful run
  },
}
