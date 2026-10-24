// @ts-check
/**
 * @file reach-report.mjs
 * @description The reach engine's JSON report, read in one place outside
 *   `packages/test-contracts`: `metrics.mjs` runs the engine through it for M5. The command is
 *   fitness #30's plus `--json`. The engine exits 1 on a violation and still prints its report, so
 *   that exit is read rather than treated as no report. A report that names inputs the engine
 *   could not read is refused here, once, for every consumer. Every reader returns its value or
 *   the reason it has none, never an empty value standing in for an unread one.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";

/**
 * @typedef {object} ReachViolation
 * @property {string} rule
 * @property {string} message
 */

/**
 * @typedef {object} ReachReport A report whose engine read every input in full.
 * @property {ReachViolation[]} violations
 * @property {unknown} reach Every collected file mapped to its `collector:source` labels, as
 *   printed.
 */

/**
 * @description Reads the text `reach --json` prints, or a report saved from it. A report whose
 *   `errors` list names inputs the engine could not read is refused, naming them.
 * @param {string} text
 * @returns {ReachReport | string} The report, or why the text is none.
 */
export function parseReachReport(text) {
  /** @type {{ violations?: unknown, errors?: unknown, reach?: unknown }} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "test-contracts reach printed no JSON report";
  }
  if (typeof parsed !== "object" || parsed === null) {
    return "test-contracts reach printed no JSON report";
  }
  if (!Array.isArray(parsed.violations) || !Array.isArray(parsed.errors)) {
    return "test-contracts reach printed a report with no violations or errors list";
  }
  if (parsed.errors.length > 0) {
    return `test-contracts reach could not read an input: ${parsed.errors.join("; ")}`;
  }
  return { violations: parsed.violations, reach: parsed.reach };
}

/**
 * @callback Spawn Runs a command in a directory and returns what it printed; on a non-zero exit
 *   it throws as `execFileSync` does, the error carrying the exit `status` and the `stdout`.
 * @param {string} command
 * @param {readonly string[]} args
 * @param {string} cwd
 * @returns {string}
 */

/** @type {Spawn} */
function spawnEngine(command, args, cwd) {
  return execFileSync(command, [...args], {
    encoding: "utf8",
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * @description Runs `pnpm --filter @packages/test-contracts reach --quarantine quarantine.json
 *   --json` in a repository and reads its report.
 * @param {string} root The repository root, where `pnpm` runs.
 * @param {{ spawn?: Spawn }} [seams] The suite's replacement for the process; `metrics.mjs` and
 *   the ledger pass none.
 * @returns {ReachReport | string} The report, or why there is none.
 */
export function reachReport(root, { spawn = spawnEngine } = {}) {
  /** @type {string} */
  let stdout;
  try {
    stdout = spawn(
      "pnpm",
      [
        "--silent",
        "--filter",
        "@packages/test-contracts",
        "reach",
        "--quarantine",
        "quarantine.json",
        "--json",
      ],
      root
    );
  } catch (error) {
    /** @type {{ status?: unknown, stdout?: unknown }} */
    const failed = typeof error === "object" && error !== null ? error : {};
    if (typeof failed.status !== "number") {
      return `test-contracts reach could not run: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (failed.status !== 1 || typeof failed.stdout !== "string") {
      return `test-contracts reach exited ${failed.status} with no report`;
    }
    stdout = failed.stdout;
  }
  return parseReachReport(stdout);
}
