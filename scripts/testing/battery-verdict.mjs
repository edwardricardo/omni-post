// @ts-check
/**
 * @file battery-verdict.mjs
 * @description The rules of the local battery's verdict. `scripts/testing/battery.sh` runs every
 *   local gate on one commit and leaves, in one log directory, a `<step>.log` per step and a
 *   `steps.tsv` of `<step>\t<exit code>` rows; `evaluateBattery` reads that directory and decides
 *   GREEN or RED. It writes nothing: persisting the verdict and reporting it belong to its caller,
 *   so the rule can be read and tested on its own.
 *
 *   GREEN needs ALL of: `steps.tsv` present and holding exactly the planned number of steps, each
 *   with its log; every exit code 0; no toolchain warning line in any log; every api run with a
 *   readable report, no failed test and no `Worker exited` / `Unhandled Error` line; and a tree
 *   that did not change while the battery ran. Anything else is RED, and every reason is named.
 *   Each check starts from what was actually written, so a verdict computed over missing inputs is
 *   RED, never GREEN.
 *
 *   A warning line is any line of any `*.log` matching `\bwarn(ing)?s?\b`, case-insensitive: the
 *   toolchain and the runtime (ESLint plugins, Node, vite, React, the package manager) all speak
 *   that way. There is NO allowlist and no parameter to pass one: a warning is fixed, not waived,
 *   and the list in the verdict is the evidence of why it is RED. Two kinds of line are not
 *   warnings: command echoes carrying `--max-warnings 0`, and the application's own pino records at
 *   level "warn" — the code under test logging on the failure paths its tests exercise. Those
 *   records are counted per message, so a new one is visible without failing the run.
 * @layer infrastructure
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const STEPS_FILE = "steps.tsv";
const STEP_ROW = /^([^\t]+)\t(\d+)$/;
const WARNING_LINE = /\bwarn(ing)?s?\b/i;
const COMMAND_ECHO = "--max-warnings 0";
const APP_WARN_RECORD = '"level":"warn"';
const APP_WARN_MESSAGE = /"msg":"((?:[^"\\]|\\.)*)/;
const NO_MESSAGE = "<no msg field>";
const UNHANDLED_LINE = /Worker exited|Unhandled Error/;
const API_STEP = /^api-(\d+)$/;
const API_LOG = /^api-(\d+)\.log$/;
const API_ARTIFACT = /^api-(\d+)\.(?:log|json)$/;
const WARNING_TEXT_LIMIT = 220;
const MESSAGE_LIMIT = 80;

/**
 * @typedef {object} StepRecord
 * @property {string} name
 * @property {number} exit
 */

/**
 * @typedef {object} WarningLine
 * @property {string} log The log's file name.
 * @property {number} line One-based.
 * @property {string} text Cut at 220 characters.
 */

/**
 * @typedef {object} AppWarnRecords
 * @property {number} total
 * @property {{ msg: string, count: number }[]} messages By count descending, then message.
 */

/**
 * @typedef {object} ApiRun
 * @property {number} run
 * @property {number | null} files Each count is null when the run's report is missing or unreadable.
 * @property {number | null} tests
 * @property {number | null} passed
 * @property {number | null} pending
 * @property {number | null} failed
 * @property {number} unhandled Lines of the run's log carrying `Worker exited` or `Unhandled Error`.
 */

/**
 * @typedef {object} Verdict
 * @property {"GREEN" | "RED"} status
 * @property {string[]} reasons Empty exactly when the status is GREEN.
 * @property {StepRecord[]} steps
 * @property {WarningLine[]} warnings
 * @property {AppWarnRecords} appWarnRecords
 * @property {ApiRun[]} apiRuns
 */

/**
 * @param {string} dir
 * @returns {string[]} Entry names, sorted; an absent or unreadable directory lists nothing, and the
 *   missing `steps.tsv` then names the problem.
 */
function listDirectory(dir) {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/**
 * Reads `steps.tsv`. A row that is not `<name>\t<integer>` is refused by line number rather than
 * guessed at: a guessed exit code is exactly the input a verdict must not trust.
 *
 * @param {string} outDir
 * @returns {{ present: boolean, steps: StepRecord[], problems: string[] }}
 */
function readSteps(outDir) {
  /** @type {string} */
  let content;
  try {
    content = readFileSync(path.join(outDir, STEPS_FILE), "utf8");
  } catch {
    return { present: false, steps: [], problems: [] };
  }
  /** @type {StepRecord[]} */
  const steps = [];
  /** @type {string[]} */
  const problems = [];
  content.split("\n").forEach((row, index) => {
    if (row.length === 0) return;
    const hit = STEP_ROW.exec(row);
    if (hit === null) {
      problems.push(
        `${STEPS_FILE} line ${String(index + 1)} is not "<step>\\t<exit code>": ${row}`
      );
      return;
    }
    const name = hit[1] ?? "";
    if (steps.some((step) => step.name === name)) problems.push(`step ${name} recorded twice`);
    steps.push({ name, exit: Number(hit[2]) });
  });
  return { present: true, steps, problems };
}

/**
 * @param {string} line A line carrying an application warn record.
 * @returns {string}
 */
function messageOf(line) {
  const hit = APP_WARN_MESSAGE.exec(line);
  return hit === null ? NO_MESSAGE : (hit[1] ?? "").slice(0, MESSAGE_LIMIT);
}

/**
 * Scans every `*.log` once: toolchain warning lines, application warn records, and the unhandled
 * lines of each api run.
 *
 * @param {string} outDir
 * @param {string[]} entries
 * @returns {{ logs: string[], unreadable: string[], warnings: WarningLine[],
 *   appWarnRecords: AppWarnRecords, unhandled: Map<number, number> }}
 */
function scanLogs(outDir, entries) {
  const logs = entries.filter((name) => name.endsWith(".log"));
  /** @type {string[]} */
  const unreadable = [];
  /** @type {WarningLine[]} */
  const warnings = [];
  /** @type {Map<string, number>} */
  const messages = new Map();
  /** @type {Map<number, number>} */
  const unhandled = new Map();
  let total = 0;
  for (const log of logs) {
    /** @type {string} */
    let content;
    try {
      content = readFileSync(path.join(outDir, log), "utf8");
    } catch {
      unreadable.push(log);
      continue;
    }
    const apiLog = API_LOG.exec(log);
    const run = apiLog === null ? null : Number(apiLog[1]);
    content.split("\n").forEach((raw, index) => {
      const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (run !== null && UNHANDLED_LINE.test(text)) {
        unhandled.set(run, (unhandled.get(run) ?? 0) + 1);
      }
      if (text.includes(APP_WARN_RECORD)) {
        total += 1;
        const msg = messageOf(text);
        messages.set(msg, (messages.get(msg) ?? 0) + 1);
        return;
      }
      if (!WARNING_LINE.test(text) || text.includes(COMMAND_ECHO)) return;
      warnings.push({ log, line: index + 1, text: text.slice(0, WARNING_TEXT_LIMIT) });
    });
  }
  const sorted = [...messages]
    .map(([msg, count]) => ({ msg, count }))
    .sort((a, b) => b.count - a.count || (a.msg < b.msg ? -1 : a.msg > b.msg ? 1 : 0));
  return { logs, unreadable, warnings, appWarnRecords: { total, messages: sorted }, unhandled };
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isCount(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Reads one vitest JSON report. Anything that is not a report carrying every count is treated like
 * a missing report, because counts read from a malformed document would be guesses.
 *
 * @param {string} outDir
 * @param {number} run
 * @returns {{ files: number, tests: number, passed: number, pending: number, failed: number } | null}
 */
function readApiReport(outDir, run) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path.join(outDir, `api-${String(run)}.json`), "utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const report = /** @type {Record<string, unknown>} */ (parsed);
  const { testResults, numTotalTests, numPassedTests, numPendingTests, numFailedTests } = report;
  if (
    !Array.isArray(testResults) ||
    !isCount(numTotalTests) ||
    !isCount(numPassedTests) ||
    !isCount(numPendingTests) ||
    !isCount(numFailedTests)
  ) {
    return null;
  }
  return {
    files: testResults.length,
    tests: numTotalTests,
    passed: numPassedTests,
    pending: numPendingTests,
    failed: numFailedTests,
  };
}

/**
 * Computes the verdict over one battery log directory. It reads only what the battery wrote, so
 * every check has an input to fail on: nothing absent can pass for clean.
 *
 * @param {{ outDir: string, expectedSteps: number, dirtyAtEnd: boolean }} input
 * @returns {Verdict}
 */
export function evaluateBattery({ outDir, expectedSteps, dirtyAtEnd }) {
  /** @type {string[]} */
  const reasons = [];
  const entries = listDirectory(outDir);
  const { present, steps, problems } = readSteps(outDir);
  if (!present) {
    reasons.push(`${STEPS_FILE} is missing from ${outDir}`);
  } else if (steps.length !== expectedSteps) {
    reasons.push(`expected ${String(expectedSteps)} steps, found ${String(steps.length)}`);
  }
  reasons.push(...problems);

  const scan = scanLogs(outDir, entries);
  for (const step of steps) {
    if (step.exit !== 0) reasons.push(`step ${step.name} exit ${String(step.exit)}`);
    if (!scan.logs.includes(`${step.name}.log`)) reasons.push(`step ${step.name} left no log`);
  }
  for (const log of scan.unreadable) reasons.push(`${log} could not be read`);
  if (scan.warnings.length > 0) reasons.push(`${String(scan.warnings.length)} warning line(s)`);

  /** @type {Set<number>} */
  const runs = new Set();
  for (const step of steps) {
    const hit = API_STEP.exec(step.name);
    if (hit !== null) runs.add(Number(hit[1]));
  }
  for (const entry of entries) {
    const hit = API_ARTIFACT.exec(entry);
    if (hit !== null) runs.add(Number(hit[1]));
  }
  /** @type {ApiRun[]} */
  const apiRuns = [];
  for (const run of [...runs].sort((a, b) => a - b)) {
    const report = readApiReport(outDir, run);
    const unhandled = scan.unhandled.get(run) ?? 0;
    apiRuns.push({
      run,
      files: report?.files ?? null,
      tests: report?.tests ?? null,
      passed: report?.passed ?? null,
      pending: report?.pending ?? null,
      failed: report?.failed ?? null,
      unhandled,
    });
    const label = `api-${String(run)}`;
    if (report === null) reasons.push(`${label}.json is missing or unreadable`);
    else if (report.failed > 0) reasons.push(`${label}: ${String(report.failed)} failed test(s)`);
    if (unhandled > 0) {
      reasons.push(`${label}: ${String(unhandled)} line(s) with Worker exited or Unhandled Error`);
    }
  }

  if (dirtyAtEnd) reasons.push("tree changed during the battery");
  return {
    status: reasons.length === 0 ? "GREEN" : "RED",
    reasons,
    steps,
    warnings: scan.warnings,
    appWarnRecords: scan.appWarnRecords,
    apiRuns,
  };
}
