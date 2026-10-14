/**
 * @file script-contract.ts
 * @description Part C of the reach engine, the script contract: rule C1 holds every package that
 *              keeps a tracked vitest config to a `test` script of exactly `vitest run`. A bare
 *              `vitest` decides between one run and watch mode by whether a terminal is attached,
 *              so the same script that ends in CI never ends in a developer's shell or under a
 *              pseudo-terminal, and a workflow that runs it has to know which package is which.
 *              With every package on `vitest run`, `pnpm --filter <package> test` means one run
 *              everywhere, and that is the command collectors.json registers.
 *
 *              A package is the directory of a tracked `vitest.config.*`, the same set the vitest
 *              collector lists and holds to its floor, so a listing short of configs already
 *              fails the run there. A directory with no tracked `package.json` breaks the rule:
 *              no package script runs its config. A manifest that cannot be read or does not
 *              parse is an error, never a pass. Nothing here reads a file: the command line in
 *              `reach.ts` hands the reading in.
 * @layer infrastructure
 */
import path from "node:path";
import type { Result } from "@shared/types";
import { asRecord, describeError } from "./registry.js";
import { RULE, type Violation } from "./rules.js";
import { VITEST_CONFIG } from "./vitest-collector.js";

/** The `test` script of every package that keeps a vitest config: one run, never watch mode. */
const TEST_SCRIPT = "vitest run";

/** What C1 found over every package that keeps a tracked vitest config. */
export interface ScriptContractVerdict {
  /** The packages held to the contract: one per directory holding a tracked vitest config. */
  readonly packages: number;
  readonly violations: readonly Violation[];
  /** Manifests that could not be read or parsed; any one fails the run. */
  readonly errors: readonly string[];
}

/**
 * @description Holds every package that keeps a tracked vitest config to the script contract.
 * @param tracked - Every tracked file, repository-relative.
 * @param read - Reads a repository-relative file, or says why it could not.
 * @returns The packages held to the contract, the C1 violations and the manifests not read.
 */
export function checkScriptContract(
  tracked: readonly string[],
  read: (file: string) => Result<string, string>
): ScriptContractVerdict {
  const trackedFiles = new Set(tracked);
  const configs = new Map<string, string>();
  for (const config of tracked.filter((file) => VITEST_CONFIG.test(file))) {
    const directory = path.posix.dirname(config);
    if (!configs.has(directory)) configs.set(directory, config);
  }
  const violations: Violation[] = [];
  const errors: string[] = [];
  for (const [directory, config] of [...configs].sort(([a], [b]) => a.localeCompare(b))) {
    const manifest = path.posix.join(directory, "package.json");
    if (!trackedFiles.has(manifest)) {
      violations.push({
        rule: RULE.C1,
        file: manifest,
        message: `missing: no package script runs the tracked vitest config ${config}`,
      });
      continue;
    }
    const text = read(manifest);
    if (!text.ok) {
      errors.push(`manifest ${manifest} cannot be read: ${text.error}`);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.value);
    } catch (error: unknown) {
      errors.push(`manifest ${manifest} is not JSON: ${describeError(error)}`);
      continue;
    }
    const fields = asRecord(parsed);
    if (fields === null) {
      errors.push(`manifest ${manifest} is not a JSON object`);
      continue;
    }
    const test = asRecord(fields.scripts)?.test;
    if (test !== TEST_SCRIPT) {
      violations.push({
        rule: RULE.C1,
        file: manifest,
        message:
          test === undefined
            ? `declares no "test" script; a package with a vitest config runs it with "${TEST_SCRIPT}"`
            : `"test" is ${JSON.stringify(test)}, not "${TEST_SCRIPT}"`,
      });
    }
  }
  return { packages: configs.size, violations, errors };
}
