// @ts-check
/**
 * @file plan-query.mjs
 * @description The plan's query command, behind `pnpm plan:show`, `pnpm plan:list` and
 *   `pnpm plan:check`. It reads the plan's six files on every run, through `plan-records.mjs`, and
 *   writes nothing to disk: no index is stored, so a record is never older than its file.
 *
 *   `show <id | <name>:<line>>` prints the one record that carries the id (a feature's canonical
 *   id or any record's id as written) or that starts on that line of the named file; an id that
 *   several records carry is refused with each location. `list` prints the records every filter
 *   matches, one line each (id, kind, location, title), or as JSON with `--json`, or their number
 *   with `--count`. `check` fails while a line of the plan is unclassified, a file cannot be read
 *   or the plan's structure lacks a part `plan-records.mjs` names as a failure. Each takes
 *   `--help`.
 *
 *   An argument is data: no shell runs and nothing is evaluated. `--file` takes one of the plan's
 *   fixed names and refuses every other value, a path or a traversal included, before anything is
 *   read; a filter's value is compared as literal text, never compiled as a regular expression,
 *   and an empty value or one that starts with `--` is a usage error.
 *
 *   Usage: `node scripts/plan/plan-query.mjs [--root <dir>] <show|list|check> [options]`. The root
 *   defaults to the repository this file lives in, located from the script's own URL. Exit 0 on
 *   success, 1 when a record is not found or the check fails, 2 on a usage error.
 * @layer infrastructure
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  FILTER_FIELDS,
  filterRecords,
  findRecords,
  parsePlan,
  readSources,
} from "./plan-records.mjs";
import { PLAN_FILES, plural } from "./plan-text.mjs";

/** @typedef {import("./plan-records.mjs").PlanRecord} PlanRecord */
/** @typedef {import("./plan-records.mjs").Filter} Filter */

/**
 * @typedef {object} Outcome
 * @property {number} exitCode
 * @property {string[]} stdout The lines written to standard output.
 * @property {string[]} stderr The lines written to standard error.
 */

const DEFAULT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PREFIX = "plan-query: ";
const NAMES = Object.keys(PLAN_FILES);
const NAMES_TEXT = `${NAMES.slice(0, -1).join(", ")} and ${NAMES.at(-1) ?? ""}`;
const KINDS = ["feature", "item"];

const USAGE = {
  general: [
    "usage: node scripts/plan/plan-query.mjs [--root <dir>] <show|list|check> [options]",
    "  show   prints one record (pnpm plan:show)",
    "  list   lists the records the filters match (pnpm plan:list)",
    "  check  fails while a line of the plan is unclassified (pnpm plan:check)",
    "  <command> --help explains a command",
  ],
  show: [
    "usage: pnpm plan:show <id | <file>:<line>> [--json]",
    "  <id> is a feature's canonical id (F-02, A-TEAM-03) or any record's id as written;",
    `  <file>:<line> names the record that starts there, <file> one of ${NAMES_TEXT}.`,
    "  Exit 0 when one record is found, 1 when none or several are, 2 on a usage error.",
  ],
  list: [
    "usage: pnpm plan:list [--kind feature|item] [--file <name>] [--<field> <value>]... [--json | --count]",
    `  --file takes one of ${NAMES_TEXT}.`,
    "  Fields, matched as literal text, every filter at once:",
    ...Object.entries(FILTER_FIELDS).map(([name, rule]) => `    --${name} (${rule.match})`),
    "  A value is never empty and never starts with --.",
    "  Exit 0, with no line or a count of 0 when nothing matches; 2 on a usage error.",
  ],
  check: [
    "usage: pnpm plan:check",
    "  Classifies every line of the plan's files outside fenced code, and names each line that",
    "  fits no shape with its file and line, and each part of the plan's structure that is",
    "  missing. Exit 0 when every line fits and nothing is missing, 1 otherwise.",
  ],
};

/**
 * @param {string[]} lines
 * @returns {Outcome}
 */
function usageError(lines) {
  return { exitCode: 2, stdout: [], stderr: lines };
}

/**
 * @param {string} message
 * @returns {Outcome}
 */
function failure(message) {
  return { exitCode: 1, stdout: [], stderr: [PREFIX + message] };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function shown(value) {
  if (Array.isArray(value)) return value.length === 0 ? "(none)" : value.join(", ");
  return value === null || value === undefined ? "(none)" : String(value);
}

/**
 * @param {PlanRecord} record
 * @returns {string[]}
 */
function recordLines(record) {
  return [
    `id: ${shown(record.id)}`,
    `kind: ${record.kind}`,
    `written id: ${shown(record.writtenId)}`,
    `location: ${record.file}:${String(record.line)}`,
    `title: ${record.title}`,
    `owner: ${shown(record.owner)}`,
    `list: ${shown(record.list)}`,
    `who: ${shown(record.who)}`,
    `today: ${shown(record.today)}`,
    `need: ${shown(record.need)}`,
    `depends on: ${shown(record.dependsOn)}`,
    `state: ${shown(record.state)}`,
    `closed by: ${shown(record.closedBy)}`,
    `where: ${shown(record.where)}`,
    `done: ${shown(record.done)}`,
    `done state: ${record.doneState}`,
    `tags: ${shown(record.tags)}`,
    `mentions: ${shown(record.mentions)}`,
    `text: ${record.text}`,
  ];
}

/**
 * @param {string} root
 * @param {Date} now
 * @returns {{ plan: import("./plan-records.mjs").ParsedPlan, failures: string[] }}
 */
function readPlan(root, now) {
  const { sources, failures } = readSources(root);
  const plan = parsePlan(sources, { now });
  return { plan, failures: [...failures, ...plan.failures] };
}

/**
 * @param {string[]} args
 * @param {string} root
 * @param {Date} now
 * @returns {Outcome}
 */
function show(args, root, now) {
  const json = args.includes("--json");
  const keys = args.filter((arg) => arg !== "--json");
  const key = keys[0];
  if (keys.length !== 1 || key === undefined || key === "" || key.startsWith("--")) {
    return usageError(USAGE.show);
  }
  const { plan, failures } = readPlan(root, now);
  if (failures.length > 0) {
    return { exitCode: 1, stdout: [], stderr: failures.map((line) => PREFIX + line) };
  }
  const found = findRecords(plan.records, key);
  const record = found[0];
  if (record === undefined) return failure(`no record carries the id "${key}"`);
  if (found.length > 1) {
    return failure(
      `${String(found.length)} records carry the id "${key}" ` +
        `(${found.map((r) => `${r.file}:${String(r.line)}`).join(", ")}); show one by its ` +
        `location, <file>:<line>, the file one of ${NAMES_TEXT}`
    );
  }
  return {
    exitCode: 0,
    stdout: json ? JSON.stringify(record, null, 2).split("\n") : recordLines(record),
    stderr: [],
  };
}

/**
 * @param {string[]} args
 * @param {string} root
 * @param {Date} now
 * @returns {Outcome}
 */
function list(args, root, now) {
  /** @type {Filter[]} */
  const filters = [];
  let json = false;
  let count = false;
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at] ?? "";
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--count") {
      count = true;
      continue;
    }
    if (arg === "--help") return { exitCode: 0, stdout: USAGE.list, stderr: [] };
    const name = arg.startsWith("--") ? arg.slice(2) : null;
    const known =
      name === "kind" || name === "file" || Object.keys(FILTER_FIELDS).some((f) => f === name);
    const value = args[at + 1];
    // A value that is empty matches every record, and one that starts with `--` is an option the
    // filter would swallow: both are mistakes of the command line, never a search.
    if (name === null || !known || value === undefined || value === "" || value.startsWith("--")) {
      return usageError(USAGE.list);
    }
    at += 1;
    if (name === "kind" && !KINDS.includes(value)) return usageError(USAGE.list);
    if (name === "file") {
      const file = Object.entries(PLAN_FILES).find(([key]) => key === value)?.[1];
      if (file === undefined) {
        return usageError([`${PREFIX}--file takes one of ${NAMES_TEXT}, not "${value}"`]);
      }
      filters.push({ field: "file", value: file });
      continue;
    }
    filters.push({ field: name, value });
  }
  if (json && count) return usageError(USAGE.list);
  const { plan, failures } = readPlan(root, now);
  if (failures.length > 0) {
    return { exitCode: 1, stdout: [], stderr: failures.map((line) => PREFIX + line) };
  }
  const records = filterRecords(plan.records, filters);
  /** @type {string[]} */
  let stdout;
  if (count) stdout = [String(records.length)];
  else if (json) stdout = JSON.stringify(records, null, 2).split("\n");
  else {
    stdout = records.map(
      (r) => `${r.id ?? "(no id)"}\t${r.kind}\t${r.file}:${String(r.line)}\t${r.title}`
    );
  }
  return { exitCode: 0, stdout, stderr: [] };
}

/**
 * @param {string[]} args
 * @param {string} root
 * @param {Date} now
 * @returns {Outcome}
 */
function check(args, root, now) {
  if (args.length > 0) return usageError(USAGE.check);
  const { sources, failures } = readSources(root);
  const plan = parsePlan(sources, { now });
  const problems = [
    ...failures,
    ...plan.failures,
    ...plan.unclassified.map(
      (line) => `${line.file}:${String(line.line)} is unclassified: ${line.reason ?? ""}`
    ),
  ];
  if (problems.length > 0) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: [
        ...problems,
        ...(plan.unclassified.length > 0
          ? [plural(plan.unclassified.length, "unclassified line")]
          : []),
      ].map((line) => PREFIX + line),
    };
  }
  return {
    exitCode: 0,
    stdout: [
      `${PREFIX}${plural(plan.lines.length, "line")} read in ${plural(sources.length, "file")}, ` +
        "every line outside fenced code classified",
    ],
    stderr: [],
  };
}

/**
 * @description Runs one command of the plan's query against a plan tree, writing nothing.
 * @param {{ argv: string[], root: string, now?: Date }} input `argv` is the command and its
 *   arguments; `root` holds `docs/product/`; `now` decides which decision dates are still to come
 *   (the current time by default).
 * @returns {Outcome} The exit code and the lines for each stream: 0 on success, 1 when a record is
 *   not found, a file cannot be read or the check fails, 2 on a usage error.
 */
export function runQuery({ argv, root, now = new Date() }) {
  const [command, ...args] = argv;
  if (command === "--help" && args.length === 0) {
    return { exitCode: 0, stdout: USAGE.general, stderr: [] };
  }
  if (command !== "show" && command !== "list" && command !== "check") {
    return usageError(USAGE.general);
  }
  // A list reads `--help` where an option stands, so a filter's value is never taken for it.
  if (command !== "list" && args.includes("--help")) {
    return { exitCode: 0, stdout: USAGE[command], stderr: [] };
  }
  if (command === "show") return show(args, root, now);
  if (command === "list") return list(args, root, now);
  return check(args, root, now);
}

/**
 * @param {string[]} argv
 * @returns {{ root: string, argv: string[] } | null} The root and the command's arguments, or
 *   `null` when `--root` has no directory.
 */
function rootOf(argv) {
  if (argv[0] !== "--root") return { root: DEFAULT_ROOT, argv };
  const root = argv[1] ?? "";
  return root === "" ? null : { root, argv: argv.slice(2) };
}

/**
 * True only when this file is the process entry point, so the suite's import runs nothing.
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

if (invokedAsScript()) {
  const input = rootOf(process.argv.slice(2));
  const outcome = input === null ? usageError(USAGE.general) : runQuery(input);
  for (const line of outcome.stdout) process.stdout.write(`${line}\n`);
  for (const line of outcome.stderr) process.stderr.write(`${line}\n`);
  process.exitCode = outcome.exitCode;
}
