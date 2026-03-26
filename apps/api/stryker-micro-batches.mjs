/**
 * @file stryker-micro-batches.mjs
 * @description Generates and runs Stryker micro-batch configs sequentially.
 * Each micro-batch targets ~1,000-2,500 LOC to keep runs under 30 minutes.
 *
 * Usage: node stryker-micro-batches.mjs [batch-number]
 *   - No argument: run all batches sequentially
 *   - With number: run only that batch
 *
 * Monitor: tail -f ../../.claude/session-b-progress.log
 */

import { execSync } from "node:child_process";
import { writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const LOG = resolve("../../.claude/session-b-progress.log");
const log = (msg) => {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  appendFileSync(LOG, line + "\n");
};

// ── Micro-batch definitions ──────────────────────────────────────────────────
// Grouped by ~1,000-2,500 LOC per batch

const MICRO_BATCHES = [
  // ── Category A: Small utility directories (~500-1,500 LOC each) ──
  {
    id: "A1",
    name: "health + utils + validation + metrics",
    mutate: ["src/health/**/*.ts", "src/utils/**/*.ts", "src/validation/**/*.ts", "src/metrics/**/*.ts"],
  },
  {
    id: "A2",
    name: "middleware + services + posts + projects",
    mutate: ["src/middleware/**/*.ts", "src/services/**/*.ts", "src/posts/**/*.ts", "src/projects/**/*.ts"],
  },
  {
    id: "A3",
    name: "monitoring + audit + trends + saga",
    mutate: ["src/monitoring/**/*.ts", "src/audit/**/*.ts", "src/trends/**/*.ts", "src/saga/**/*.ts"],
  },
  {
    id: "A4",
    name: "database + lib + cqrs + providers",
    mutate: ["src/database/**/*.ts", "src/lib/**/*.ts", "!src/lib/templates/**/*.ts", "src/cqrs/**/*.ts", "src/providers/**/*.ts"],
  },
  {
    id: "A5",
    name: "templates + video + ai + billing",
    mutate: ["src/templates/**/*.ts", "src/video/**/*.ts", "src/ai/**/*.ts", "src/billing/**/*.ts"],
  },
  {
    id: "A6",
    name: "events + inbox + mappers + accounts + channels",
    mutate: ["src/events/**/*.ts", "src/inbox/**/*.ts", "src/mappers/**/*.ts", "src/accounts/**/*.ts", "src/channels/**/*.ts"],
  },
  {
    id: "A7",
    name: "small routes: campaigns + notifications + reports + recurring + approvals + comments + team + links",
    mutate: [
      "src/campaigns/**/*.ts", "src/notifications/**/*.ts", "src/reports/**/*.ts",
      "src/recurring/**/*.ts", "src/approvals/**/*.ts", "src/comments/**/*.ts",
      "src/team/**/*.ts", "src/links/**/*.ts",
    ],
  },
  {
    id: "A8",
    name: "tiny routes: external-notifications + first-comment + utm + ai-image + brand-voice + usage",
    mutate: [
      "src/external-notifications/**/*.ts", "src/first-comment/**/*.ts", "src/utm/**/*.ts",
      "src/ai-image/**/*.ts", "src/brand-voice/**/*.ts", "src/usage/**/*.ts",
    ],
  },
  // ── Category B: Security + Orchestration (~10K LOC) ──
  {
    id: "B1",
    name: "security",
    mutate: ["src/security/**/*.ts"],
  },
  {
    id: "B2",
    name: "orchestration",
    mutate: ["src/orchestration/**/*.ts"],
  },
  // ── Category C: Auth + Webhooks + Admin (~22K LOC) ──
  {
    id: "C1",
    name: "auth",
    mutate: ["src/auth/**/*.ts"],
  },
  {
    id: "C2",
    name: "webhooks",
    mutate: ["src/webhooks/**/*.ts"],
  },
  {
    id: "C3",
    name: "admin",
    mutate: ["src/admin/**/*.ts"],
  },
  // ── Category D: Analytics (~10K LOC) ──
  {
    id: "D1",
    name: "analytics/crossPlatform",
    mutate: ["src/analytics/crossPlatform/**/*.ts"],
  },
  {
    id: "D2",
    name: "analytics/performanceComparison + roi",
    mutate: ["src/analytics/performanceComparison/**/*.ts", "src/analytics/roi/**/*.ts"],
  },
  {
    id: "D3",
    name: "analytics root (routes, utils, engagement, realtime, thread)",
    mutate: [
      "src/analytics/*.ts",
    ],
  },
  // ── Category E: Application use cases (~11K LOC, split by subdomain) ──
  {
    id: "E1",
    name: "application: inbox + posts + ml",
    mutate: ["src/application/inbox/**/*.ts", "src/application/posts/**/*.ts", "src/application/ml/**/*.ts"],
  },
  {
    id: "E2",
    name: "application: recurring + analytics + campaigns + notifications",
    mutate: [
      "src/application/recurring/**/*.ts", "src/application/analytics/**/*.ts",
      "src/application/campaigns/**/*.ts", "src/application/notifications/**/*.ts",
    ],
  },
  {
    id: "E3",
    name: "application: reports + approvals + links + team + comments + first-comment",
    mutate: [
      "src/application/reports/**/*.ts", "src/application/approvals/**/*.ts",
      "src/application/links/**/*.ts", "src/application/team/**/*.ts",
      "src/application/comments/**/*.ts", "src/application/first-comment/**/*.ts",
    ],
  },
  {
    id: "E4",
    name: "application: crisis + aiPromptTemplates + external-notifications + api-keys + ai-image + brand-voice + events + utm + usage",
    mutate: [
      "src/application/crisis/**/*.ts", "src/application/aiPromptTemplates/**/*.ts",
      "src/application/external-notifications/**/*.ts", "src/application/apiKeys/**/*.ts",
      "src/application/ai-image/**/*.ts", "src/application/brand-voice/**/*.ts",
      "src/application/events/**/*.ts", "src/application/utm/**/*.ts",
      "src/application/usage/**/*.ts",
    ],
  },
  // ── Category F: Domain (~14K LOC, split by layer) ──
  {
    id: "F1",
    name: "domain/entities",
    mutate: ["src/domain/entities/**/*.ts"],
  },
  {
    id: "F2",
    name: "domain/value-objects",
    mutate: ["src/domain/value-objects/**/*.ts"],
  },
  {
    id: "F3",
    name: "domain/repositories",
    mutate: ["src/domain/repositories/**/*.ts"],
  },
  {
    id: "F4",
    name: "domain/aggregates + events + errors",
    mutate: ["src/domain/aggregates/**/*.ts", "src/domain/events/**/*.ts", "src/domain/errors/**/*.ts"],
  },
  // ── Category G: Infrastructure (~12K LOC) ──
  {
    id: "G1",
    name: "infrastructure (all)",
    mutate: ["src/infrastructure/**/*.ts"],
  },
  // ── Category H: Content (~5.7K LOC) ──
  {
    id: "H1",
    name: "content",
    mutate: ["src/content/**/*.ts"],
  },
];

function generateConfig(batch) {
  const excludes = batch.mutate
    .filter((p) => !p.startsWith("!"))
    .flatMap((p) => [
      p.replace("**/*.ts", "**/*.test.ts"),
      p.replace("**/*.ts", "**/*.spec.ts"),
    ]);

  const allMutate = [...batch.mutate, ...excludes.map((e) => `!${e}`)];

  return `import rootConfig from '../../stryker.config.mjs'
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...rootConfig,
  tsconfigFile: 'tsconfig.json',
  incrementalFile: 'reports/stryker-incremental-micro.json',
  htmlReporter: { fileName: 'reports/mutation/micro-${batch.id}.html' },
  vitest: { configFile: 'vitest.config.ts' },
  coverageAnalysis: 'perTest',
  checkers: [],
  plugins: ['@stryker-mutator/vitest-runner'],
  concurrency: 4,
  dryRunTimeoutMinutes: 15,
  mutate: ${JSON.stringify(allMutate, null, 4)},
  thresholds: { high: 80, low: 60, break: null },
}
`;
}

async function runBatch(batch) {
  const configPath = `stryker-micro-${batch.id}.config.mjs`;
  log(`── MICRO-BATCH ${batch.id}: ${batch.name} ──`);

  // Write config
  writeFileSync(configPath, generateConfig(batch));
  log(`Config written: ${configPath}`);

  try {
    const output = execSync(
      `pnpm exec stryker run ${configPath} 2>&1`,
      { timeout: 7200_000, maxBuffer: 50 * 1024 * 1024 }
    ).toString();

    // Extract score
    const scoreMatch = output.match(/Final mutation score[^\d]*(\d+\.?\d*)/);
    const score = scoreMatch ? scoreMatch[1] : "N/A";

    // Extract summary line
    const summaryMatch = output.match(/All files\s*\|\s*[\d.]+\s*\|\s*[\d.]+\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)/);
    const killed = summaryMatch ? summaryMatch[1] : "?";
    const timeout = summaryMatch ? summaryMatch[2] : "?";
    const survived = summaryMatch ? summaryMatch[3] : "?";
    const noCov = summaryMatch ? summaryMatch[4] : "?";

    const doneMatch = output.match(/Done in (.+)\./);
    const duration = doneMatch ? doneMatch[1] : "?";

    log(`✅ ${batch.id} DONE: score=${score}% | killed=${killed} timeout=${timeout} survived=${survived} noCov=${noCov} | ${duration}`);

    return { id: batch.id, name: batch.name, score, killed, timeout, survived, noCov, duration };
  } catch (err) {
    const output = err.stdout?.toString() || "";
    const scoreMatch = output.match(/Final mutation score[^\d]*(\d+\.?\d*)/);
    const score = scoreMatch ? scoreMatch[1] : "ERROR";
    log(`⚠️  ${batch.id} FINISHED (break threshold or error): score=${score}%`);
    return { id: batch.id, name: batch.name, score, killed: "?", timeout: "?", survived: "?", noCov: "?", duration: "?" };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const targetBatch = process.argv[2];
const batches = targetBatch
  ? MICRO_BATCHES.filter((b) => b.id === targetBatch)
  : MICRO_BATCHES;

if (batches.length === 0) {
  console.error(`Unknown batch: ${targetBatch}`);
  console.error(`Available: ${MICRO_BATCHES.map((b) => b.id).join(", ")}`);
  process.exit(1);
}

log(`\n${"═".repeat(60)}`);
log(`SESSION B — Micro-batch execution: ${batches.length} batches`);
log(`${"═".repeat(60)}`);

const results = [];
for (const batch of batches) {
  const result = await runBatch(batch);
  results.push(result);
}

log(`\n${"═".repeat(60)}`);
log(`SESSION B — SUMMARY`);
log(`${"═".repeat(60)}`);
for (const r of results) {
  log(`${r.id.padEnd(4)} | ${r.score.toString().padStart(6)}% | ${r.name}`);
}
log(`${"═".repeat(60)}`);
