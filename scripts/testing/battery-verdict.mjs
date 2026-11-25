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
 *   readable report, no failed test and no `Worker exited` / `Unhandled Error` outside a test's
 *   name; and a tree that did not change while the battery ran. Anything else is RED, and every
 *   reason is named.
 *   Each check starts from what was actually written, so a verdict computed over missing inputs is
 *   RED, never GREEN.
 *
 *   A warning line is any line of any `*.log` carrying the word `warn`, `warns`, `warning` or
 *   `warnings` in any case, or a runtime warning category such as `DeprecationWarning`: the
 *   toolchain and the runtime (ESLint plugins, Node, Python, vite, React, the package manager) all
 *   speak that way. A line is read as a terminal shows it: its colour and other escape sequences
 *   are removed first, with Node's `stripVTControlCharacters`, the function ESLint's formatter
 *   measures its own coloured columns with, so a word a tool colours (the severity of ESLint's
 *   stylish row, `\u001b[33mwarning\u001b[39m`) is read like any other, and so is the first line
 *   of output under a vitest console header, which opens on the header's closing sequences. The
 *   word counts only when it stands apart from a path: a letter, digit, `_`,
 *   `.`, `/` or `-` glued to it on either side makes it part of a file name, a directory or a flag
 *   (`warning-banner.ts`, `src/warnings/`, `--max-warnings 0`), which a step that lists files or
 *   echoes its command prints without warning about anything. A `.` after the word still ends it
 *   when no letter, digit or `_` follows, so a sentence ending in "1 warning." is a warning. There
 *   is NO allowlist and no parameter to pass one: a warning is fixed, not waived, and the list in
 *   the verdict is the evidence of why it is RED. One kind of line is not a warning: the application's
 *   own pino records at level "warn" — the code under test logging on the failure paths its tests
 *   exercise. Those records are counted per message, so a new one is visible without failing the
 *   run. A record is a line that, as a terminal shows it, starts with its level and parses as one
 *   JSON object, so a record a test writes under a vitest console header, whose line opens on the
 *   header's closing sequences, is one. Pino writes
 *   its own level first, in two spellings, and both are that record: the label, as the API's logger
 *   formats it (`{"level":"warn",`), and the number, pino's default, written by every logger that
 *   sets no level formatter (the packages' loggers, Fastify's own: `{"level":40,`). A record at
 *   another level cannot start that way; a logger that defined a custom level numbered 40 would,
 *   and the repository defines none. A line that only quotes a record, one on which another tool's
 *   text comes before or after the record, and one that is cut are read whole, so a tool's warning
 *   on a record's line is a warning line.
 *
 *   One kind of text is not read: the name of a test, on a line where the tool that lists it writes
 *   it in that tool's own grammar. A name is data the tool copies from a test, so a test named "logs
 *   warnings" is not a warning wherever a runner or a gate prints it. Two tools write names into the
 *   battery's logs: the record-coverage gate and vitest.
 *
 *   The record-coverage gate (`scripts/testing/record-coverage-gate.mjs`) writes the title of a test
 *   block on the line where it lists that block; often a block of the base the change's author
 *   cannot edit. The exception holds only in the log named exactly
 *   `record-coverage.log` at the top of the log directory, and only on a line that is, from its
 *   first character to its last, the gate's grammar
 *   `record-coverage-gate: <class>: <path>::<title> (<kind>): <detail>`, with `<class>` one of
 *   `refused`, `behaviour change`, `live`, `no-collector` and `moved`, and `<kind>` `deletion` or
 *   `rewrite`. The title starts after the first `::` and runs to the last ` (<kind>): `, so it may
 *   hold `::`, parentheses and the gate's own words. A `moved` line's detail,
 *   `its bodyHash reappears as <path>::<title>`, names a second block whose title is not read either;
 *   its first title runs to the last ` (deletion): its bodyHash reappears as ` that a colon-free path
 *   and `::` follow. Everything else on such a line is read (the class, the paths, the detail), and
 *   so is the gate's grammar written after other text, every other line of that log (the gate's
 *   summary and its own problems, a runtime warning) and every line of every other log. A change to
 *   the gate's line that the grammar no longer matches turns its titles back into warning lines:
 *   RED, never a waived warning.
 *
 *   Vitest writes a test's name on three kinds of line, and the exception holds on them in any log,
 *   only after vitest's banner (` RUN  v<version> <root>`) came earlier in that log: a finished
 *   test its default reporter lists, which in the battery is a slow or a failed one
 *   (` <indentation><✓ or ×> <name> <duration>ms`, the indentation two spaces per level of nesting);
 *   the header above a test's console output (`stdout | <full name>` or `stderr | <full name>`); and
 *   the header above a failure's error (` FAIL  <full name>`). The name runs to the end of a header,
 *   and to the duration that ends a test line; a test file's line has the same shape and is read
 *   without its path. Everything else is read: the symbol and the duration, the output under a
 *   console header, the error under a failure header, every other line of the log (vitest's own
 *   warnings, a runtime's category), every line before the banner and every line of a log without
 *   one. The text the warning rule reads is also what the api runs' `Worker exited` /
 *   `Unhandled Error` count reads, so a test named after either is not counted.
 *
 *   Its residual limits, stated rather than implied. (1) A title may not hold every character: a
 *   carriage return before the line's end, U+2028 or U+2029 makes the line read whole, so a
 *   warning word in its title counts again, and a line feed splits it into lines that are each
 *   read whole. (2) That a path holds no `:` is
 *   assumed, never checked: a path holding `::` has the text after its first `::` read as the
 *   title, and a path holding a single `:` makes the line read whole. (3) No detail is known to hold
 *   no ` (<kind>): `: a behaviour-change detail lists changed file names and record file names, and
 *   a refused detail holds a record's verdict, which is free text. When one holds ` (deletion): ` or
 *   ` (rewrite): `, the detail's text before the last of them is taken for title and not read. What
 *   is then skipped is data of the tree, never a tool's own warning, and a refused line's step exits
 *   1, so it is RED anyway. (4) A moved line whose second title itself holds the moved phrase, a
 *   colon-free run and `::` splits there, and that run is read as a path: a warning word in it still
 *   counts. (5) The name must match exactly and the walk lists the top level only: a log whose name
 *   differs from `record-coverage.log` in case is read whole, and a `record-coverage.log` in a
 *   subdirectory, like every file there, is not read at all. (6) Once vitest's banner came, any
 *   line in a test line's shape, or opening on `stdout | `, `stderr | ` or ` FAIL  `, is taken for
 *   vitest's: a test's own console output written in that shape has its text after the symbol or
 *   the label unread. The rule holds to the end of the log, which is safe only while no battery
 *   step writes another tool's output into a vitest log after the banner: today each vitest
 *   step's command ends with its vitest run, so what follows the banner is vitest's output, the
 *   output of the tests it runs and pnpm's closing lines. A step that runs another tool after
 *   vitest into the same log must end the rule where that tool's output starts.
 *   (7) The grammar holds the lines the battery's runs print and no others: no
 *   retry, repeat or heap suffix (no configuration of the repository sets one), no skipped or todo
 *   test (fitness #32 refuses a committed one), no suite line (vitest lists suites only for a run
 *   that collects one file). Such a line, and a name holding a carriage return, U+2028 or U+2029, is
 *   read whole, and a line feed splits a name into lines that are each read whole: RED, never a
 *   waived warning. (8) No other runner prints a name on a line of a step that can be GREEN: the
 *   integration tier's log names each suite file, node:test's names reach it only in the output of a
 *   file that failed, whose step exits non-zero, and no step runs Playwright's runner. Those names,
 *   and the source a failing vitest test's code frame quotes, are read whole.
 * @layer infrastructure
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

const STEPS_FILE = "steps.tsv";
const STEP_ROW = /^([^\t]+)\t(\d+)$/;
/**
 * The neighbours that make a warning word part of a path, a file name or a flag. Before it: a word
 * character (`useWarn`), `.` (`warnings.warn`), `/` (`src/warnings/`) or `-` (`--max-warnings`).
 * After it: a word character (`warnings2`), `/` (`warnings/index.ts`), `-` (`warning-banner.ts`),
 * or `.` with a word character next (`warnings.ts`); a bare `.` ends a sentence and still counts.
 */
const NO_PATH_NEIGHBOUR_BEFORE = String.raw`(?<![\w./-])`;
const NO_PATH_NEIGHBOUR_AFTER = String.raw`(?![\w/-]|\.\w)`;
const WARNING_WORD = new RegExp(
  `${NO_PATH_NEIGHBOUR_BEFORE}warn(?:ing)?s?${NO_PATH_NEIGHBOUR_AFTER}`,
  "i"
);
/** Case-sensitive: `[A-Z]` is what tells Node's and Python's category names from prose. */
const WARNING_CATEGORY = new RegExp(
  `${NO_PATH_NEIGHBOUR_BEFORE}[A-Z][A-Za-z]*Warning${NO_PATH_NEIGHBOUR_AFTER}`
);
const COVERAGE_GATE_LOG = "record-coverage.log";
/**
 * The record-coverage gate's line for one listed block of every class but `moved`. The groups are
 * the text before the title and the text after it; the title between them is greedy, so it runs to
 * the last ` (<kind>): `.
 */
const COVERAGE_BLOCK_LINE =
  /^(record-coverage-gate: (?:refused|behaviour change|live|no-collector): [^:]*::).*( \((?:deletion|rewrite)\): .*)$/;
/**
 * The gate's `moved` line. The groups are the text before the first title and the text between the
 * two titles; the first title is greedy, so it runs to the last phrase a colon-free path and `::`
 * follow.
 */
const COVERAGE_MOVED_LINE =
  /^(record-coverage-gate: moved: [^:]*::).*( \(deletion\): its bodyHash reappears as [^:]*::).*$/;
/** The line vitest writes first for a run: ` RUN  v<version> <root>`. */
const VITEST_BANNER = /^ RUN {2}v\d+\.\d+\.\d+\S* /;
/**
 * A finished test as vitest's default reporter lists it, slow or failed: one space, two per level
 * of nesting, the state symbol and a space, the test's name, then its duration. The groups are the
 * text before the name and the duration; the name is lazy, so it runs to the duration that ends
 * the line.
 */
const VITEST_TEST_LINE = /^( (?: {2})*[✓×] ).*?( {1,2}\d+ms)$/;
/** The header vitest writes above a test's console output: the stream, then the test's full name. */
const VITEST_CONSOLE_HEADER = /^((?:stdout|stderr) \| ).*$/;
/** The header vitest writes above a failure's error: the label, then the task's full name. */
const VITEST_FAIL_HEADER = /^( FAIL {2}).*$/;
/**
 * How pino starts a record at warn: its level first, as the label the API's logger formats or as
 * pino's default number.
 */
const APP_WARN_RECORD_STARTS = ['{"level":"warn",', '{"level":40,'];
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
 * @property {number} unhandled Lines of the run's log carrying `Worker exited` or `Unhandled Error`
 *   outside a test's name.
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
 * A step recorded more than once keeps its FIRST record and yields one problem, however many times
 * it repeats. Appending the repeats would count one step as several, so a battery that ran every
 * planned step would also be reported as having run the wrong number of them, and a repeat with a
 * different exit code would add a second, contradictory reason for the same step.
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
  /** @type {Set<string>} */
  const repeated = new Set();
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
    if (steps.some((step) => step.name === name)) {
      if (!repeated.has(name)) problems.push(`step ${name} recorded twice`);
      repeated.add(name);
      return;
    }
    steps.push({ name, exit: Number(hit[2]) });
  });
  return { present: true, steps, problems };
}

/**
 * @param {string} line A line of a step's log.
 * @returns {boolean} Whether the line is an application record at warn: it starts with the level,
 *   in either spelling, and parses as one JSON object, so another tool's text before or after the
 *   record leaves the line a line to read.
 */
function isAppWarnRecord(line) {
  if (!APP_WARN_RECORD_STARTS.some((start) => line.startsWith(start))) return false;
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
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
 * The text of a log line the warning rule reads: the line whole, except a line that lists a test
 * by its name in the grammar of the tool that wrote it, which is read without the name. Those are
 * a line of the record-coverage gate's log that lists a test block, and a test line, a console
 * header or a failure header in a log after vitest's banner.
 *
 * @param {string} log The log's file name.
 * @param {string} text The line as a terminal shows it: no line ending, no colour sequence.
 * @param {boolean} vitest Whether vitest's banner came earlier in the log.
 * @returns {string}
 */
function warningTextOf(log, text, vitest) {
  const hit =
    log === COVERAGE_GATE_LOG
      ? (COVERAGE_BLOCK_LINE.exec(text) ?? COVERAGE_MOVED_LINE.exec(text))
      : vitest
        ? (VITEST_TEST_LINE.exec(text) ??
          VITEST_CONSOLE_HEADER.exec(text) ??
          VITEST_FAIL_HEADER.exec(text))
        : null;
  return hit === null ? text : hit.slice(1).join("");
}

/**
 * Scans every `*.log` once: toolchain warning lines, application warn records, and the unhandled
 * lines of each api run. Each line is read without its escape sequences, by every rule, the
 * record's included; the warning and unhandled rules also read it without a test's name its tool
 * writes.
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
    let vitest = false;
    content.split("\n").forEach((raw, index) => {
      const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      const shown = stripVTControlCharacters(text);
      if (VITEST_BANNER.test(shown)) vitest = true;
      const read = warningTextOf(log, shown, vitest);
      if (run !== null && UNHANDLED_LINE.test(read)) {
        unhandled.set(run, (unhandled.get(run) ?? 0) + 1);
      }
      if (isAppWarnRecord(shown)) {
        total += 1;
        const msg = messageOf(shown);
        messages.set(msg, (messages.get(msg) ?? 0) + 1);
        return;
      }
      if (!WARNING_WORD.test(read) && !WARNING_CATEGORY.test(read)) return;
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
