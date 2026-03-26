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
  // 43K mutants — initial test run needs more time for perTest coverage analysis
  dryRunTimeoutMinutes: 30,
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

    // Auth & security layer
    'src/auth/**/*.ts',
    '!src/auth/**/*.test.ts',
    'src/audit/**/*.ts',
    '!src/audit/**/*.test.ts',
    'src/security/**/*.ts',
    '!src/security/**/*.test.ts',

    // Infrastructure & middleware
    'src/billing/**/*.ts',
    '!src/billing/**/*.test.ts',
    'src/webhooks/**/*.ts',
    '!src/webhooks/**/*.test.ts',
    'src/services/**/*.ts',
    '!src/services/**/*.test.ts',
    'src/admin/**/*.ts',
    '!src/admin/**/*.test.ts',

    // Expanded scope — directories with DB-free unit tests
    'src/ai/**/*.ts',
    '!src/ai/**/*.test.ts',
    'src/analytics/**/*.ts',
    '!src/analytics/**/*.test.ts',
    'src/cqrs/**/*.ts',
    '!src/cqrs/**/*.test.ts',
    'src/database/**/*.ts',
    '!src/database/**/*.test.ts',
    'src/health/**/*.ts',
    '!src/health/**/*.test.ts',
    'src/lib/**/*.ts',
    '!src/lib/**/*.test.ts',
    '!src/lib/templates/**/*.ts', // imports @infra/prisma — breaks in Stryker sandbox
    'src/metrics/**/*.ts',
    '!src/metrics/**/*.test.ts',
    'src/middleware/**/*.ts',
    '!src/middleware/**/*.test.ts',
    'src/monitoring/**/*.ts',
    '!src/monitoring/**/*.test.ts',
    'src/orchestration/**/*.ts',
    '!src/orchestration/**/*.test.ts',
    'src/posts/**/*.ts',
    '!src/posts/**/*.test.ts',
    'src/providers/**/*.ts',
    '!src/providers/**/*.test.ts',
    'src/saga/**/*.ts',
    '!src/saga/**/*.test.ts',
    'src/templates/**/*.ts',
    '!src/templates/**/*.test.ts',
    'src/trends/**/*.ts',
    '!src/trends/**/*.test.ts',
    'src/utils/**/*.ts',
    '!src/utils/**/*.test.ts',
    'src/validation/**/*.ts',
    '!src/validation/**/*.test.ts',
    'src/video/**/*.ts',
    '!src/video/**/*.test.ts',
  ],
  thresholds: {
    high: 80,
    low: 60,
    break: 52,
  },
}
