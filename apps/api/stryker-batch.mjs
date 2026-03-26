/**
 * @file stryker-batch.mjs
 * @description Batch runner for API Stryker mutation testing.
 *              Splits 43K mutants into 8 manageable batches.
 *              Usage: node stryker-batch.mjs [batch-number]
 *              Example: node stryker-batch.mjs 1  (runs batch 1 only)
 *                       node stryker-batch.mjs    (runs all batches sequentially)
 */
import { execSync } from 'node:child_process'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'

const BATCHES = {
  1: {
    name: 'MINI (~1K mutants)',
    dirs: ['health', 'utils', 'validation', 'middleware', 'metrics'],
  },
  2: {
    name: 'PEQUEÑO-A (~2.6K mutants)',
    dirs: ['services', 'posts', 'monitoring', 'audit', 'trends', 'saga'],
  },
  3: {
    name: 'PEQUEÑO-B (~5.9K mutants)',
    dirs: ['database', 'lib', 'templates', 'cqrs', 'providers', 'video', 'ai', 'billing'],
  },
  4: {
    name: 'MEDIANO-A (~3.5K mutants)',
    dirs: ['security', 'orchestration'],
  },
  5: {
    name: 'MEDIANO-B (~7.4K mutants)',
    dirs: ['auth', 'webhooks', 'admin'],
  },
  6: {
    name: 'MEDIANO-C (~2.9K mutants)',
    dirs: ['analytics'],
  },
  7: {
    name: 'GRANDE-A (~3.4K mutants)',
    dirs: ['application'],
  },
  8: {
    name: 'GRANDE-B (~4.5K mutants)',
    dirs: ['domain'],
  },
}

function buildMutateArray(dirs) {
  const patterns = []
  for (const dir of dirs) {
    patterns.push(`'src/${dir}/**/*.ts'`)
    patterns.push(`'!src/${dir}/**/*.test.ts'`)
    patterns.push(`'!src/${dir}/**/*.spec.ts'`)
  }
  // Special exclusion for lib/templates
  if (dirs.includes('lib')) {
    patterns.push(`'!src/lib/templates/**/*.ts'`)
  }
  return patterns
}

function buildConfig(batchNum) {
  const batch = BATCHES[batchNum]
  const mutatePatterns = buildMutateArray(batch.dirs)

  return `import rootConfig from '../../stryker.config.mjs'

/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...rootConfig,
  tsconfigFile: 'tsconfig.json',
  incrementalFile: 'reports/stryker-incremental.json',
  htmlReporter: {
    fileName: 'reports/mutation/batch-${batchNum}.html',
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
    ${mutatePatterns.join(',\n    ')},
  ],
  thresholds: {
    high: 80,
    low: 60,
    break: null,
  },
}
`
}

function runBatch(batchNum) {
  const batch = BATCHES[batchNum]
  const configPath = `stryker-batch-${batchNum}.config.mjs`

  console.log(`\n${'='.repeat(60)}`)
  console.log(`BATCH ${batchNum}/8: ${batch.name}`)
  console.log(`Directories: ${batch.dirs.join(', ')}`)
  console.log(`${'='.repeat(60)}\n`)

  // Write temporary config
  writeFileSync(configPath, buildConfig(batchNum))

  try {
    execSync(`pnpm exec stryker run ${configPath}`, {
      stdio: 'inherit',
      timeout: 10800000, // 3 hours max per batch
    })
    console.log(`\n✓ Batch ${batchNum} completed successfully\n`)
  } catch (error) {
    console.error(`\n✗ Batch ${batchNum} failed: ${error.message}\n`)
  }
}

// Parse arguments
const requestedBatch = parseInt(process.argv[2])

if (requestedBatch) {
  if (!BATCHES[requestedBatch]) {
    console.error(`Invalid batch number: ${requestedBatch}. Valid: 1-8`)
    process.exit(1)
  }
  runBatch(requestedBatch)
} else {
  console.log('Running all 8 batches sequentially...\n')
  const startTime = Date.now()

  for (let i = 1; i <= 8; i++) {
    runBatch(i)
  }

  const elapsed = ((Date.now() - startTime) / 60000).toFixed(1)
  console.log(`\n${'='.repeat(60)}`)
  console.log(`ALL BATCHES COMPLETE — Total time: ${elapsed} minutes`)
  console.log(`${'='.repeat(60)}`)
}
