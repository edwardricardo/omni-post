// @ts-check
/**
 * @file reach-report.mjs
 * @description The reach engine's JSON report and the quarantine it runs with, read in one place
 *   outside `packages/test-contracts`: `metrics.mjs` runs the engine through it for M5, and
 *   `ledger.mjs` reads each collected file's sources and each quarantined file's owner. The command
 *   is fitness #30's plus `--json`. The engine exits 1 on a violation and still prints its report,
 *   so that exit is read rather than treated as no report. A report that names inputs the engine
 *   could not read is refused here, once, for every consumer. Every reader returns its value or
 *   the reason it has none, never an empty value standing in for an unread one.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/** The quarantine fitness #30 passes to the engine, relative to the repository root. */
const QUARANTINE_FILE = "packages/test-contracts/quarantine.json";

/**
 * @typedef {object} ReachViolation
 * @property {string} rule
 * @property {string} message
 */

/**
 * @typedef {object} ReachReport A report whose engine read every input in full.
 * @property {ReachViolation[]} violations
 * @property {unknown} reach Every collected file mapped to its `collector:source` labels, as
 *   printed; `reachLabels` reads it.
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

/**
 * @description Reads a report's per-file map: every collected file and the `collector:source`
 *   labels of the sources that collect it. A file no source collects has no entry.
 * @param {ReachReport} report
 * @returns {Map<string, string[]> | string} The map, or why the report holds none.
 */
export function reachLabels(report) {
  const { reach } = report;
  if (typeof reach !== "object" || reach === null || Array.isArray(reach)) {
    return "test-contracts reach printed a report with no reach map";
  }
  /** @type {Map<string, string[]>} */
  const labels = new Map();
  for (const [file, value] of Object.entries(reach)) {
    if (!Array.isArray(value) || !value.every((label) => typeof label === "string")) {
      return `test-contracts reach printed labels for ${file} that are not strings`;
    }
    labels.set(file, value);
  }
  return labels;
}

/**
 * @description Maps each file the engine's quarantine names to its entry's owner. A path two
 *   entries name is refused, since the ledger could not tell which owner holds it.
 * @param {string} root The repository root.
 * @returns {Map<string, string> | string} The map, or why the quarantine could not be read.
 */
export function quarantineOwners(root) {
  /** @type {{ entries?: unknown }} */
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path.join(root, QUARANTINE_FILE), "utf8"));
  } catch (error) {
    return `${QUARANTINE_FILE} could not be read: ${error instanceof Error ? error.message : ""}`;
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.entries)) {
    return `${QUARANTINE_FILE} holds no entries list`;
  }
  /** @type {Map<string, string>} */
  const owners = new Map();
  for (const [index, entry] of parsed.entries.entries()) {
    /** @type {{ path?: unknown, owner?: unknown }} */
    const fields = typeof entry === "object" && entry !== null ? entry : {};
    if (typeof fields.path !== "string" || typeof fields.owner !== "string") {
      return `${QUARANTINE_FILE}: entry ${index} has no path or no owner`;
    }
    if (owners.has(fields.path)) return `${QUARANTINE_FILE}: entry ${index} repeats ${fields.path}`;
    owners.set(fields.path, fields.owner);
  }
  return owners;
}
