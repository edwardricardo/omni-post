/**
 * @file ci.ts
 * @description Builds the CI side of the reach engine's self-tests as text: a workflow, a ruleset
 *              in the shape GitHub's rulesets API returns, and a `collectors.json`.
 * @layer infrastructure
 */
import type { ExecutedByEntry } from "../../src/lib/executed-by.js";

/** The paths the engine reads the registry, the ruleset and the workflow from. */
export const CI_PATHS = {
  registry: "packages/test-contracts/collectors.json",
  ruleset: ".github/rulesets/main.json",
  workflow: ".github/workflows/ci.yml",
} as const;

/** The job every planted workflow holds, its check name and the command its step runs. */
const UNIT_JOB = { id: "unit", name: "Unit", run: "pnpm exec vitest run" } as const;

/** A workflow with the one job {@link UNIT_JOB}. */
export const UNIT_WORKFLOW = [
  "name: CI",
  "on: [pull_request]",
  "jobs:",
  `  ${UNIT_JOB.id}:`,
  `    name: ${UNIT_JOB.name}`,
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: actions/checkout@v7",
  `      - run: ${UNIT_JOB.run}`,
  "",
].join("\n");

/**
 * @param contexts - The required status checks.
 * @returns A ruleset that requires exactly those checks.
 */
export function rulesetRequiring(contexts: readonly string[]): string {
  return JSON.stringify({
    name: "main",
    target: "branch",
    rules: [
      { type: "deletion" },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: contexts.map((context) => ({ context, integration_id: 15368 })),
        },
      },
    ],
  });
}

/**
 * @param collectors - Collector id → its entries.
 * @returns The `collectors.json` text.
 */
export function registryOf(
  collectors: Readonly<Record<string, readonly ExecutedByEntry[]>>
): string {
  const body = Object.fromEntries(
    Object.entries(collectors).map(([id, executedBy]) => [id, { executedBy }])
  );
  return JSON.stringify({ collectors: body });
}

/** The entry that runs every vitest source through {@link UNIT_JOB}. */
export const UNIT_ENTRY: ExecutedByEntry = {
  workflow: CI_PATHS.workflow,
  jobId: UNIT_JOB.id,
  entrypoint: UNIT_JOB.run,
};
