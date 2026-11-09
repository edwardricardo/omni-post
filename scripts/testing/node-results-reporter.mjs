// @ts-check
/**
 * @file node-results-reporter.mjs
 * @description The node:test reporter the differential mutation tool reads a node:test run from,
 *   passed as `--test-reporter=<this file> --test-reporter-destination=<run>.report.json`. Node
 *   ships no JSON reporter, so it reads the documented `TestsStream` events and yields, once, after
 *   the stream ends, one JSON document in the shape the tool's core reads from vitest's JSON
 *   reporter: `{ testResults: [{ name, status, message, assertionResults: [{ ancestorTitles, title,
 *   status }] }] }`, a result per file, by absolute path, sorted. A test's ancestors are the titles
 *   of the tests and suites around it, from the `test:start` events' nesting, per file; suites are
 *   left out; a skip is `skipped`, a todo `todo`, any other failure `failed`, a test its parent
 *   cancelled or that timed out included. The passing stand-in node:test reports for a file that
 *   registers no test is left out, by the summary reporter's own rule. A file whose own top-level
 *   entry failed (its child did not load, or crashed) is `failed`, and its `message` is the first
 *   error line its child printed with the frames after it outside Node, or the failure's own
 *   message and frames when it printed none; any other file's message is empty. Any role may run
 *   it: it reads events and writes nothing but what it yields.
 * @layer infrastructure
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { byCodeUnit } from "./lib/record-helpers.mjs";
import { isNoTestStandIn } from "./node-summary-reporter.mjs";

/** @typedef {import("./node-summary-reporter.mjs").TestEvent} TestEvent */

/**
 * @typedef {{ ancestorTitles: string[], title: string, status: string }} AssertionResult
 * @typedef {{ tests: AssertionResult[], failed: boolean, error: unknown, stderr: string[] }} FileEntry
 */

/** This module's absolute path, which a node:test run passes to `--test-reporter`. */
export const RESULTS_REPORTER_FILE = fileURLToPath(import.meta.url);

/** How many frames outside Node a file's message keeps. */
const FRAMES = 3;

/** The first line of an error as Node prints it: `Error: …`, `TypeError: …`, `Error [CODE]: …`. */
const ERROR_LINE = /^\s*(?:[A-Z][A-Za-z]*)?Error\b(?: \[[^\]]*\])?:/;

/**
 * @description The frames of a stack outside Node's own modules, trimmed, at most `FRAMES`.
 * @param {string} text
 * @returns {string[]}
 */
function framesOf(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at ") && !line.includes("node:"))
    .slice(0, FRAMES);
}

/**
 * @description The message of a file that failed: the first error line its child printed with
 *   the frames after it, else the failure's own message (its cause's when it has one) and frames.
 * @param {unknown} error The failure's `details.error`.
 * @param {string} stderr What the file's child printed on stderr.
 * @returns {string}
 */
function failureMessageOf(error, stderr) {
  const lines = stderr.split(/\r?\n/);
  const at = lines.findIndex((line) => ERROR_LINE.test(line));
  if (at !== -1) {
    return [(lines[at] ?? "").trim(), ...framesOf(lines.slice(at + 1).join("\n"))].join("\n");
  }
  /** @type {(value: unknown, key: string) => string} */
  const field = (value, key) => {
    const read = value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
    return typeof read === "string" ? read : "";
  };
  const cause =
    error !== null && typeof error === "object" ? Reflect.get(error, "cause") : undefined;
  const message = field(cause, "message") || field(error, "message");
  const stack = field(cause, "stack") || field(error, "stack");
  return [message, ...framesOf(stack)].filter((line) => line !== "").join("\n");
}

/**
 * @description The status of a finished test: `skipped`, `todo`, `passed` or `failed`.
 * @param {TestEvent} event
 * @returns {string}
 */
function statusOf(event) {
  const data = event.data ?? {};
  if (data.skip !== undefined) return "skipped";
  if (data.todo !== undefined) return "todo";
  return event.type === "test:pass" ? "passed" : "failed";
}

/**
 * @description Turns the events of a node:test run into the JSON document the tool reads.
 * @param {AsyncIterable<TestEvent>} source The events Node hands a custom reporter.
 * @returns {AsyncGenerator<string>} One JSON document, once the stream ends.
 * @public node:test loads it by `--test-reporter`, as a module's default export.
 */
export default async function* nodeResultsReporter(source) {
  /** @type {Map<string, FileEntry>} */
  const files = new Map();
  /** @type {Map<string, string[]>} */
  const stacks = new Map();
  /** @type {(file: string) => FileEntry} */
  const entryOf = (file) => {
    const known = files.get(file);
    if (known !== undefined) return known;
    /** @type {FileEntry} */
    const entry = { tests: [], failed: false, error: undefined, stderr: [] };
    files.set(file, entry);
    return entry;
  };
  for await (const event of source) {
    const data = event.data ?? {};
    const file = data.file;
    if (typeof file !== "string") continue;
    if (event.type === "test:stderr") {
      entryOf(file).stderr.push(String(data.message ?? ""));
    } else if (event.type === "test:start") {
      const stack = stacks.get(file) ?? [];
      stack.length = data.nesting ?? 0;
      stack.push(data.name ?? "");
      stacks.set(file, stack);
      entryOf(file);
    } else if (event.type === "test:pass" || event.type === "test:fail") {
      const entry = entryOf(file);
      const nesting = data.nesting ?? 0;
      const ownEntry =
        nesting === 0 && typeof data.name === "string" && path.resolve(data.name) === file;
      if (isNoTestStandIn(event)) continue;
      if (ownEntry || data.details?.type === "suite") {
        if (event.type === "test:fail") {
          entry.failed = true;
          if (ownEntry) entry.error = data.details?.error ?? null;
        }
        continue;
      }
      const ancestors = (stacks.get(file) ?? []).slice(0, nesting);
      entry.tests.push({
        ancestorTitles: ancestors,
        title: data.name ?? "",
        status: statusOf(event),
      });
    }
  }
  const testResults = [...files.keys()].sort(byCodeUnit).map((name) => {
    const entry = /** @type {FileEntry} */ (files.get(name));
    const failed = entry.failed || entry.tests.some((test) => test.status === "failed");
    return {
      name,
      status: failed ? "failed" : "passed",
      message:
        entry.error === undefined ? "" : failureMessageOf(entry.error, entry.stderr.join("")),
      assertionResults: entry.tests,
    };
  });
  yield `${JSON.stringify({ testResults })}\n`;
}
