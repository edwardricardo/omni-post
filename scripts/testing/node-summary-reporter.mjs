// @ts-check
/**
 * @file node-summary-reporter.mjs
 * @description The node:test reporter the integration collector reads its verdict from.
 *   `apps/api/scripts/run-tests.sh` runs each suite file in its own process with
 *   `--test-reporter=<this file>`, and reads ONE line of what it prints:
 *
 *     `@@SUMMARY tests=N pass=N fail=N cancelled=N skipped=N todo=N`
 *
 *   Node declares the text of its reporters unstable and ships no JSON reporter (Node
 *   24.15.0 has `dot`, `junit`, `spec`, `tap` and `lcov`), so the collector no longer
 *   greps TAP: this module reads the documented `TestsStream` events instead (design
 *   decision DD-7 of the testing re-foundation).
 *
 *   The counts come from the cumulative `test:summary` event, the one without a `file`,
 *   and are cross-checked against a tally of the `test:pass` and `test:fail` events,
 *   classified the way Node's own runner counts them: suites apart; a skip or a todo
 *   directive first; then a failure whose `failureType` Node treats as a cancellation
 *   (`cancelledByParent`, `testTimeoutFailure`, `testAborted`); then any other failure.
 *   When the two disagree, both are printed and each count takes the value that fails
 *   the run: the larger fail, cancelled, skipped and todo counts, the smaller tests and
 *   pass counts, since the collector fails a tier run on any failure, cancellation or
 *   skip and on zero tests.
 *
 *   One passing test is left out of both: the one node:test reports, named by the file's
 *   own path, in place of a file that registers no test at all. Counted, an emptied suite
 *   would read as one passing test and the collector's zero-collection guard would never
 *   see it.
 *
 *   Everything else it prints is for the reader of a red: every failing test and suite
 *   with its error, its cause and its first stack frames outside Node itself, every
 *   skipped and todo test with its reason, and every line a suite wrote to stdout or
 *   stderr and every diagnostic, each prefixed with `# ` so that no line a suite prints
 *   can pass for one of the reporter's own, the anchored summary least of all.
 * @layer infrastructure
 */
import path from "node:path";

/**
 * The `failureType` values Node's runner counts as cancelled rather than failed: the
 * set `kCanceledTests` its file runner builds, read on Node 24.15.0.
 */
const CANCELLED_FAILURE_TYPES = new Set(["cancelledByParent", "testTimeoutFailure", "testAborted"]);

/** A failure block's detail is cut at this many lines, so one error cannot flood the log. */
const MAX_DETAIL_LINES = 40;

/** How many stack frames outside Node itself a failure block shows. */
const MAX_STACK_FRAMES = 10;

/**
 * A frame inside Node itself names its module by the `node:` scheme (`node:internal/…`,
 * `node:async_hooks`), and says nothing about the test that failed.
 */
const NODE_CORE_FRAME = /[( ]node:/;

/**
 * @typedef {"tests" | "passed" | "failed" | "cancelled" | "skipped" | "todo"} CountKey
 */

/**
 * The fields of the machine line, in order: the label it prints, the key of Node's
 * `counts` it is read from, and how a disagreement with the tally resolves — toward the
 * value that fails the run, since the collector fails a tier run on any failure,
 * cancellation or skip and on zero tests.
 * @type {ReadonlyArray<{ label: string, key: CountKey, resolve: (a: number, b: number) => number }>}
 */
const FIELDS = [
  { label: "tests", key: "tests", resolve: Math.min },
  { label: "pass", key: "passed", resolve: Math.min },
  { label: "fail", key: "failed", resolve: Math.max },
  { label: "cancelled", key: "cancelled", resolve: Math.max },
  { label: "skipped", key: "skipped", resolve: Math.max },
  { label: "todo", key: "todo", resolve: Math.max },
];

/**
 * @typedef {object} TestError
 * @property {unknown} [message]
 * @property {unknown} [stack]
 * @property {unknown} [failureType]
 * @property {unknown} [cause]
 * @property {unknown} [exitCode]
 * @property {unknown} [signal]
 */

/**
 * @typedef {object} TestEventData
 * @property {string} [name]
 * @property {number} [nesting]
 * @property {string} [file]
 * @property {number} [line]
 * @property {number} [column]
 * @property {string | boolean} [skip]
 * @property {string | boolean} [todo]
 * @property {{ type?: string, error?: TestError }} [details]
 * @property {string} [message]
 * @property {Partial<Record<CountKey, number>>} [counts]
 * @property {Array<{ name: string, file?: string, line?: number, column?: number }>} [tests]
 */

/**
 * @typedef {{ type: string, data?: TestEventData }} TestEvent
 */

/** @typedef {Record<CountKey, number>} Counts */

/**
 * Returns a tally with every count at zero.
 * @returns {Counts}
 */
function emptyCounts() {
  return { tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0 };
}

/**
 * Returns the counter a completed test lands in, in Node's own order, or null for a suite,
 * which Node counts apart from the tests.
 * @param {TestEvent} event - A `test:pass` or `test:fail` event.
 * @returns {CountKey | null} The counter, or null for a suite.
 */
function counterOf(event) {
  const data = event.data ?? {};
  if (data.details?.type === "suite") return null;
  if (data.skip !== undefined) return "skipped";
  if (data.todo !== undefined) return "todo";
  if (event.type === "test:pass") return "passed";
  const failureType = data.details?.error?.failureType;
  if (typeof failureType === "string" && CANCELLED_FAILURE_TYPES.has(failureType)) {
    return "cancelled";
  }
  return "failed";
}

/**
 * Returns true for the passing test node:test reports in place of a file that registers no
 * test: it sits at the top, is named by the file's path, and is located at that file's
 * first line and column.
 * @param {TestEvent} event - Any event.
 * @returns {boolean} Whether the event is that stand-in.
 */
function isNoTestStandIn(event) {
  const data = event.data ?? {};
  return (
    event.type === "test:pass" &&
    data.nesting === 0 &&
    data.details?.type === "test" &&
    data.skip === undefined &&
    data.todo === undefined &&
    data.line === 1 &&
    data.column === 1 &&
    typeof data.name === "string" &&
    typeof data.file === "string" &&
    path.resolve(data.name) === data.file
  );
}

/**
 * Returns where an event's test is declared, relative to the working directory when it
 * sits beneath it, or an empty string when the event names no file.
 * @param {TestEventData} data - The event's data.
 * @returns {string} `<file>:<line>:<column>`, or "".
 */
function locationOf(data) {
  if (typeof data.file !== "string") return "";
  const relative = path.relative(process.cwd(), data.file);
  const shown =
    relative === "" || relative.startsWith("..") || path.isAbsolute(relative)
      ? data.file
      : relative;
  return data.line === undefined ? shown : `${shown}:${data.line}:${data.column ?? 1}`;
}

/**
 * Returns the text of a value an error carries, or undefined when it carries none.
 * @param {unknown} value - A message or a thrown value.
 * @returns {string | undefined} Its text.
 */
function textOf(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "object" && "message" in value) return textOf(value.message);
  return String(value);
}

/**
 * Returns the stack frames of `value` that lie outside Node itself, trimmed.
 * @param {unknown} value - An error, or anything thrown in place of one.
 * @returns {string[]} The frames, at most `MAX_STACK_FRAMES`.
 */
function framesOf(value) {
  if (typeof value !== "object" || value === null || !("stack" in value)) return [];
  if (typeof value.stack !== "string") return [];
  return value.stack
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at ") && !NODE_CORE_FRAME.test(line))
    .slice(0, MAX_STACK_FRAMES);
}

/**
 * Returns the lines that explain a failure: the failure type and message, the cause when
 * its message differs, the exit code or signal of a file whose process failed, and the
 * first frames of the cause's stack (the error's own when the cause has none).
 * @param {TestError | undefined} error - The error a `test:fail` event carries.
 * @returns {string[]} The lines, unindented except for the frames.
 */
function errorLines(error) {
  if (error === undefined) return ["the event carried no error"];
  const message = textOf(error.message) ?? "";
  const [first = "", ...rest] = message.split(/\r?\n/);
  const failureType = typeof error.failureType === "string" ? error.failureType : "error";
  const lines = [`${failureType}: ${first}`, ...rest];
  const cause = textOf(error.cause);
  if (cause !== undefined && cause !== message) {
    const [causeFirst = "", ...causeRest] = cause.split(/\r?\n/);
    lines.push(`cause: ${causeFirst}`, ...causeRest);
  }
  if (typeof error.exitCode === "number") lines.push(`exit code ${error.exitCode}`);
  if (typeof error.signal === "string") lines.push(`signal ${error.signal}`);
  const frames = framesOf(error.cause);
  for (const frame of frames.length > 0 ? frames : framesOf(error)) lines.push(`  ${frame}`);
  return lines;
}

/**
 * Returns the lines one completed test is reported with: none for a passing test or
 * suite, one for a skipped or todo test, and a header with its indented detail for every
 * failure.
 * @param {TestEvent} event - A `test:pass` or `test:fail` event.
 * @param {string} fullName - The test's name behind the names of its suites.
 * @returns {string[]} The lines.
 */
function completionLines(event, fullName) {
  const data = event.data ?? {};
  const counter = counterOf(event);
  const location = locationOf(data);
  const where = location === "" ? fullName : `${fullName} (${location})`;
  const directive = counter === "skipped" ? data.skip : counter === "todo" ? data.todo : undefined;
  const reason = typeof directive === "string" ? ` — ${directive}` : "";
  if (event.type === "test:pass") {
    return counter === "skipped" || counter === "todo" ? [`${counter}: ${where}${reason}`] : [];
  }
  const kind = counter === null ? "suite failed" : counter;
  const detail = errorLines(data.details?.error).map((line) => `  ${line}`);
  if (detail.length > MAX_DETAIL_LINES) {
    const cut = detail.length - MAX_DETAIL_LINES;
    detail.length = MAX_DETAIL_LINES;
    detail.push(`  … ${cut} more lines`);
  }
  return [`${kind}: ${where}${reason}`, ...detail];
}

/**
 * Returns the summary block: the mismatch lines when the summary event and the tally
 * disagree, then the anchored machine line.
 * @param {Partial<Record<CountKey, number>>} counts - The cumulative `test:summary` counts.
 * @param {Counts} tally - The counts of the completed-test events.
 * @param {number} standIns - How many no-test stand-ins the run reported.
 * @returns {string[]} The lines.
 */
function summaryLines(counts, tally, standIns) {
  const fromSummary = FIELDS.map(({ key }) => {
    const value = counts[key];
    if (typeof value !== "number") return Number.NaN;
    return key === "tests" || key === "passed" ? value - standIns : value;
  });
  const fromEvents = FIELDS.map(({ key }) => tally[key]);
  const resolved = FIELDS.map(({ resolve }, index) => {
    const summaryValue = fromSummary[index] ?? Number.NaN;
    const eventValue = fromEvents[index] ?? 0;
    if (Number.isNaN(summaryValue)) return eventValue;
    return Math.max(0, resolve(summaryValue, eventValue));
  });
  /** @param {number[]} values */
  const render = (values) =>
    FIELDS.map(({ label }, index) => {
      const value = values[index] ?? Number.NaN;
      return `${label}=${Number.isNaN(value) ? "absent" : value}`;
    }).join(" ");
  const lines = [];
  if (render(fromSummary) !== render(fromEvents)) {
    lines.push(
      `summary mismatch: the test:summary event counts ${render(fromSummary)}`,
      `summary mismatch: the test events add up to   ${render(fromEvents)}`,
      "summary mismatch: each count below takes the value that fails the run"
    );
  }
  lines.push(`@@SUMMARY ${render(resolved)}`);
  return lines;
}

/**
 * Prefixes each non-empty line of `text` with `# `, the mark of a line the reporter
 * relays rather than writes.
 * @param {string} text - What a suite printed, or a diagnostic.
 * @returns {string[]} The prefixed lines.
 */
function relayed(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => `# ${line}`);
}

/**
 * Turns the `TestsStream` events of a node:test run into the collector's report: each
 * failure with its detail, each skip and todo, every relayed line, and one anchored
 * `@@SUMMARY` line per cumulative `test:summary` event.
 * @param {AsyncIterable<TestEvent>} source - The events Node hands a custom reporter.
 * @returns {AsyncGenerator<string>} The report, a chunk of whole lines at a time.
 */
export default async function* nodeSummaryReporter(source) {
  const tally = emptyCounts();
  /** @type {string[]} */
  const ancestors = [];
  let standIns = 0;
  let summarized = false;
  for await (const event of source) {
    const data = event.data ?? {};
    /** @type {string[]} */
    let lines = [];
    switch (event.type) {
      case "test:start":
        ancestors.length = data.nesting ?? 0;
        ancestors.push(data.name ?? "");
        break;
      case "test:pass":
      case "test:fail": {
        if (isNoTestStandIn(event)) {
          standIns += 1;
          lines = [
            `no test registered: ${data.name} — Node reports such a file as one passing test, which this summary does not count`,
          ];
          break;
        }
        const counter = counterOf(event);
        if (counter !== null) {
          tally[counter] += 1;
          tally.tests += 1;
        }
        const fullName = [...ancestors.slice(0, data.nesting ?? 0), data.name ?? ""].join(" > ");
        lines = completionLines(event, fullName);
        break;
      }
      case "test:stdout":
      case "test:stderr":
      case "test:diagnostic":
        lines = relayed(data.message ?? "");
        break;
      case "test:interrupted":
        lines = (data.tests ?? []).map((test) => {
          const location = locationOf(test);
          return `interrupted: ${test.name}${location === "" ? "" : ` (${location})`}`;
        });
        break;
      case "test:summary":
        if (data.file === undefined && data.counts !== undefined) {
          summarized = true;
          lines = summaryLines(data.counts, tally, standIns);
        }
        break;
      default:
        break;
    }
    if (lines.length > 0) yield `${lines.join("\n")}\n`;
  }
  if (!summarized) {
    yield "no cumulative test:summary event arrived, so this run reports no @@SUMMARY line\n";
  }
}
