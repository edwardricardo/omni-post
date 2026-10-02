// @ts-check
/**
 * @file battery-state.mjs
 * @description Records the local battery's verdict where a hook can read it. `scripts/testing/
 *   battery.sh` calls this CLI after its last step; it asks `evaluateBattery`
 *   (`scripts/testing/battery-verdict.mjs`, which holds the rules) for the verdict over the log
 *   directory, prints it, and writes `<state dir>/battery/<full sha>.json`, which a hook reads
 *   before a push is proposed. The verdict lives in a file because a line on stdout cannot be
 *   checked by anything once it has scrolled by.
 *
 *   The state file is written whatever the status, so a RED verdict is as readable as a GREEN one,
 *   and it is written through a sibling file and a rename, so a reader never sees half of one.
 *
 *   Usage: `node scripts/testing/battery-state.mjs --out <log dir> --sha <sha> --tree <tree sha>
 *   --state-dir <dir> --expected-steps <n> --started-at <iso> --dirty-at-end <0|1>`.
 *   Exit codes: 0 GREEN, 1 RED, 2 a usage error naming the argument.
 * @layer infrastructure
 */
import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateBattery } from "./battery-verdict.mjs";

/** @typedef {import("./battery-verdict.mjs").Verdict} Verdict */

const STATE_SCHEMA = "omnipost.battery/v1";
/** A full object name, SHA-1 or SHA-256; it becomes a file name, so nothing else is accepted. */
const OBJECT_NAME = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const FLAGS = [
  "--out",
  "--sha",
  "--tree",
  "--state-dir",
  "--expected-steps",
  "--started-at",
  "--dirty-at-end",
];
const USAGE =
  "usage: node scripts/testing/battery-state.mjs --out <log dir> --sha <sha> --tree <tree sha> " +
  "--state-dir <dir> --expected-steps <n> --started-at <iso> --dirty-at-end <0|1>";

/**
 * @typedef {object} Options
 * @property {string} out
 * @property {string} sha
 * @property {string} tree
 * @property {string} stateDir
 * @property {number} expectedSteps
 * @property {string} startedAt
 * @property {boolean} dirtyAtEnd
 */

/**
 * The state file's document. The key order is the schema's, so two verdicts diff line by line.
 *
 * @param {{ sha: string, tree: string, startedAt: string, finishedAt: string, verdict: Verdict }} input
 * @returns {Record<string, unknown>}
 */
export function buildState({ sha, tree, startedAt, finishedAt, verdict }) {
  return {
    schema: STATE_SCHEMA,
    sha,
    tree,
    status: verdict.status,
    reasons: verdict.reasons,
    startedAt,
    finishedAt,
    steps: verdict.steps,
    warnings: verdict.warnings,
    appWarnRecords: verdict.appWarnRecords,
    apiRuns: verdict.apiRuns,
  };
}

/**
 * Parses the CLI arguments. Every argument is required and validated, and an unknown one is
 * refused rather than ignored: a flag this module silently dropped could only ever be an attempt to
 * change the verdict from outside the rule.
 *
 * @param {string[]} argv
 * @returns {{ ok: true, options: Options } | { ok: false, problem: string }}
 */
export function parseArguments(argv) {
  /** @param {string} problem */
  const refuse = (problem) => /** @type {const} */ ({ ok: false, problem });
  /** @type {Map<string, string>} */
  const given = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] ?? "";
    const value = argv[i + 1];
    if (!FLAGS.includes(flag)) return refuse(`unknown argument ${flag}`);
    if (given.has(flag)) return refuse(`${flag} is given twice`);
    if (value === undefined) return refuse(`${flag} needs a value`);
    given.set(flag, value);
  }
  const missing = FLAGS.filter((flag) => !given.has(flag));
  if (missing.length > 0) return refuse(`missing required argument ${missing.join(", ")}`);

  /** @param {string} flag */
  const value = (flag) => given.get(flag) ?? "";
  for (const flag of ["--out", "--state-dir"]) {
    if (value(flag).length === 0) return refuse(`${flag} is empty`);
  }
  for (const flag of ["--sha", "--tree"]) {
    if (!OBJECT_NAME.test(value(flag))) {
      return refuse(`${flag} must be a full lowercase hex object name, got "${value(flag)}"`);
    }
  }
  if (!/^[1-9]\d*$/.test(value("--expected-steps"))) {
    return refuse(
      `--expected-steps must be a positive integer, got "${value("--expected-steps")}"`
    );
  }
  const startedAt = value("--started-at");
  if (!ISO_INSTANT.test(startedAt) || Number.isNaN(Date.parse(startedAt))) {
    return refuse(`--started-at must be an ISO 8601 instant, got "${startedAt}"`);
  }
  const dirty = value("--dirty-at-end");
  if (dirty !== "0" && dirty !== "1") {
    return refuse(`--dirty-at-end must be 0 or 1, got "${dirty}"`);
  }
  return {
    ok: true,
    options: {
      out: value("--out"),
      sha: value("--sha"),
      tree: value("--tree"),
      stateDir: value("--state-dir"),
      expectedSteps: Number(value("--expected-steps")),
      startedAt: new Date(startedAt).toISOString(),
      dirtyAtEnd: dirty === "1",
    },
  };
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Removes what a failed write left at the staging path. A failure here must not replace the
 * write's own error, which is the one that says why no verdict was recorded: it is appended to
 * that error instead, naming the path left behind, with the write's error kept as the cause.
 *
 * @param {string} staging
 * @param {unknown} primary The error that made the write fail.
 * @returns {void}
 */
function removeStaging(staging, primary) {
  try {
    rmSync(staging, { force: true });
  } catch (cleanup) {
    throw new Error(
      `${errorText(primary)}; the staging file ${staging} could not be removed either and is ` +
        `left behind: ${errorText(cleanup)}`,
      { cause: primary }
    );
  }
}

/**
 * Writes the state file through a sibling file and a rename, so a reader sees the previous verdict
 * or the new one, never half of one. Only a failed write is cleaned up: after a rename succeeds
 * there is nothing at the staging path to remove.
 *
 * @param {string} stateDir
 * @param {string} sha
 * @param {Record<string, unknown>} state
 * @returns {string} The state file's path.
 */
function writeState(stateDir, sha, state) {
  const dir = path.join(stateDir, "battery");
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${sha}.json`);
  const staging = path.join(dir, `.${sha}.json.${String(process.pid)}`);
  try {
    writeFileSync(staging, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(staging, target);
  } catch (error) {
    removeStaging(staging, error);
    throw error;
  }
  return target;
}

/**
 * @param {number | null} count
 * @returns {string}
 */
function shown(count) {
  return count === null ? "?" : String(count);
}

/**
 * @param {Verdict} verdict
 * @returns {string[]}
 */
function reportLines(verdict) {
  /** @type {string[]} */
  const lines = verdict.steps.map((step) => `${step.name} exit=${String(step.exit)}`);
  for (const run of verdict.apiRuns) {
    lines.push(
      `api-${String(run.run)} files ${shown(run.files)} tests ${shown(run.tests)} passed ` +
        `${shown(run.passed)} pending ${shown(run.pending)} failed ${shown(run.failed)} ` +
        `unhandled ${String(run.unhandled)}`
    );
  }
  if (verdict.warnings.length > 0) {
    lines.push(`warning lines: ${String(verdict.warnings.length)}`);
    for (const warning of verdict.warnings) {
      lines.push(`  ${warning.log}:${String(warning.line)}:${warning.text}`);
    }
  }
  const { total, messages } = verdict.appWarnRecords;
  lines.push(
    `app-log warn (code under test, not a toolchain warning): ${String(total)} record(s), ` +
      `${String(messages.length)} distinct message(s)`
  );
  for (const { msg, count } of messages) lines.push(`    ${String(count)} ${msg}`);
  for (const reason of verdict.reasons) lines.push(`RED because ${reason}`);
  return lines;
}

/**
 * @param {string[]} argv
 * @returns {number} Process exit code.
 */
function main(argv) {
  const parsed = parseArguments(argv);
  if (!parsed.ok) {
    process.stderr.write(`battery-state: ${parsed.problem}\n${USAGE}\n`);
    return 2;
  }
  const { options } = parsed;
  const verdict = evaluateBattery({
    outDir: options.out,
    expectedSteps: options.expectedSteps,
    dirtyAtEnd: options.dirtyAtEnd,
  });
  const state = buildState({
    sha: options.sha,
    tree: options.tree,
    startedAt: options.startedAt,
    finishedAt: new Date().toISOString(),
    verdict,
  });
  for (const line of reportLines(verdict)) process.stdout.write(`${line}\n`);
  try {
    process.stdout.write(`state: ${writeState(options.stateDir, options.sha, state)}\n`);
  } catch (error) {
    process.stderr.write(
      `battery-state: the state file could not be written, so this run certifies nothing: ` +
        `${errorText(error)}\n`
    );
    process.stdout.write("BATTERY RED\n");
    return 1;
  }
  process.stdout.write(`BATTERY ${verdict.status}\n`);
  return verdict.status === "GREEN" ? 0 : 1;
}

/**
 * True only when this file is the process entry point. `buildState` and `parseArguments` are
 * exported, and importing them must not run the CLI as a side effect.
 *
 * @returns {boolean}
 */
function invokedAsScript() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedAsScript()) process.exitCode = main(process.argv.slice(2));
