// @ts-check
/**
 * @file mutation-diff-core.mjs
 * @description The pure core of the differential mutation tool: the case file and its refusals,
 *   the scope a case runs, the block a ledger id resolves to and the classifier's hash of it, the
 *   reading of a vitest JSON report, the verdict table, the record and the exit code. It spawns
 *   nothing and writes nothing; `scripts/testing/mutation-diff.mjs` runs the four vitest runs of
 *   each case and hands their reports here. The direct-import read of the scope is
 *   `record-coverage-core.mjs`'s, shared with the record-coverage gate, fitness #54.
 *
 *   THE TABLE. "Red" is a test the JSON report marks failed, or a file that failed with none of its
 *   tests failed (it did not load, or a hook of its own failed); a test that did not run is never
 *   green. Precondition, for every kind: on both clean runs every scope test that exists on that
 *   side is green, else UNDECIDED `base-red-clean` or `head-red-clean`. Ahead of those, a scope
 *   file that fails to load on a clean run, with no test at all, is read on both sides:
 *   `base-unreadable` when it fails at the base alone (the base content not loading against
 *   today's subject), `head-unreadable` at the head alone, `both-unreadable` on both, which points
 *   at the environment the runs share rather than at either side's content. Each such file is
 *   named on its own side's red list, with the first non-empty line of the message vitest reports
 *   for it, trimmed and cut at 200 characters, because the report keeps that message nowhere else.
 *   A rewrite needs its listed block on both sides and a deletion its block at the base
 *   alone: a block the head still holds is `block-present-at-head`, a rewrite of a block the base
 *   lacks is `block-missing` (a new test is an addition, not a rewrite), and a base with no scope
 *   file to run is `base-empty`, since a mutated run that ran nothing is never a verdict; a deletion's
 *   head with no scope file is LOST, nothing being left there to catch the mutation. A rewrite is GAIN when no scope test is red at the base under the mutation and every
 *   listed block is red at the head; NO-GAIN when any scope test is red at the base, each one named,
 *   since the coverage already existed: the whole base scope is compared, never the listed block's
 *   old version alone; BROKEN when a listed block is green at the head under its own mutation. A
 *   deletion is SAFE when the deleted block is red at the base and a scope test is red at the head,
 *   LOST when no scope test is red at the head, VACUOUS when the deleted block is green at the base
 *   under the mutation. A listed block with no passed or failed result is `block-missing`, so it is
 *   never GAIN or SAFE. Either kind is BEHAVIOUR-CHANGED, ahead of `base-red-clean`, when its base
 *   clean run is red on listed blocks alone, at least one of them, and its head clean run is green:
 *   the old test fails on the new code, a fact measured, not declared. Any other clean-run red stays
 *   UNDECIDED.
 *
 *   DETERMINISTIC. Every object of the record is written with its keys in code-unit order, its
 *   cases by id and every list sorted, with no clock and no path outside the repository, so the
 *   same input renders the same bytes.
 * @layer infrastructure
 */
import path from "node:path";
import { classifyFile } from "@packages/eslint-plugin-testing";
import { sortedKeys, testNamePattern } from "./hard-probe-core.mjs";
import { blockRows } from "./ledger-core.mjs";
import { importsSubject } from "./record-coverage-core.mjs";
import { byCodeUnit, isObject } from "./record-helpers.mjs";

/** The version of the record; a change of its shape raises it. */
const RECORD_VERSION = 1;

/** Every key a case may carry. */
const CASE_KEYS = Object.freeze([
  "id",
  "kind",
  "test",
  "blocks",
  "subject",
  "search",
  "replace",
  "base",
  "scope",
  "note",
]);

/** The keys a case must carry. */
const REQUIRED_KEYS = Object.freeze([
  "id",
  "kind",
  "test",
  "blocks",
  "subject",
  "search",
  "replace",
  "note",
]);

/** The two kinds of case. */
const KINDS = Object.freeze(["rewrite", "deletion"]);

/** The name a file that failed with no failed test is reported under. */
const FILE_FAILED = "(the file failed)";

/** The reasons a clean run whose scope file did not load is undecided under, by side. */
const BASE_UNREADABLE = "base-unreadable";
const HEAD_UNREADABLE = "head-unreadable";
const BOTH_UNREADABLE = "both-unreadable";

/** The most characters of a load failure's message a red entry carries. */
const MESSAGE_LIMIT = 200;

/**
 * @typedef {"rewrite" | "deletion"} Kind
 * @typedef {"base" | "head"} Side
 * @typedef {{ value: T } | { error: string }} Result
 * @template T
 */

/**
 * @typedef {object} Case A case as the case file states it.
 * @property {string} id
 * @property {Kind} kind
 * @property {string} test The test file the blocks belong to, repository-relative.
 * @property {string[]} blocks Ledger ids, `<test>::<title>`.
 * @property {string} subject The source file the mutation changes, repository-relative.
 * @property {string} search Replaced at its first occurrence.
 * @property {string} replace
 * @property {string} [base] The base this case compares against, in place of `--base`.
 * @property {string[]} [scope] Test files run besides the default scope.
 * @property {string} note
 */

/**
 * @typedef {object} TestResult One test of a vitest report.
 * @property {string[]} ancestors The titles around it, outermost first.
 * @property {string} title
 * @property {string} status `passed`, `failed`, `skipped`, `pending` or `todo`.
 */

/**
 * @typedef {object} FileReport One file of a vitest report.
 * @property {string} status
 * @property {TestResult[]} tests
 * @property {string} [message] Vitest's message for the file, present only when it is a non-empty
 *   string: a file that did not load reports its error here and nowhere else.
 */

/**
 * @typedef {object} Run What one vitest run gave.
 * @property {string | null} failure Why the run says nothing: `runner-failed`, `timeout`,
 *   `not-applied` (no marker of the mutation), `not-served` (a served file never reached
 *   the plugin) or `base-unreadable` (a scope file the base's tree lists whose content could not
 *   be read, so nothing ran); the table's `head-unreadable` and `both-unreadable` come from the
 *   clean reports, never from here.
 * @property {ReadonlyMap<string, FileReport>} report Each file's report, by repository-relative path.
 */

/**
 * @typedef {{ state: "found", describe: string[], title: string } | { state: "missing" } | { state: "ambiguous" }} Resolution
 */

/**
 * @typedef {object} Block A block of a test file, by its ledger id.
 * @property {string} id
 * @property {string[]} describe
 * @property {string} title
 * @property {string} bodyHash The classifier's hash, the one `ledger.json` holds.
 */

/** @typedef {{ base: string | null, head: string | null }} Hashes */

/**
 * @typedef {object} Decided The verdict of one case.
 * @property {string} verdict
 * @property {string | null} reason
 * @property {{ base: string[], head: string[] }} red
 */

/**
 * @typedef {object} DecideInput What a verdict reads.
 * @property {Kind} kind
 * @property {string} test
 * @property {readonly string[]} blocks
 * @property {boolean} searchFound
 * @property {Readonly<Record<string, Readonly<Record<Side, Resolution>>>>} resolutions
 * @property {Readonly<Record<Side, { clean: Run, mutated: Run }>>} runs
 * @property {Readonly<Record<Side, readonly string[]>>} files The scope files that run on each side.
 */

/**
 * @description Says whether a value is an array of non-empty strings.
 * @param {unknown} value
 * @returns {value is string[]}
 */
function isNameList(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry !== "");
}

/**
 * @description Refuses one case, naming the field: a key no case carries, a field left out, or a
 *   field of the wrong shape, a `blocks` entry outside `test` among them.
 * @param {Record<string, unknown>} entry
 * @param {string} name How the refusal names the case.
 * @returns {string | null} The refusal, or `null`.
 */
function refusalOf(entry, name) {
  for (const key of Object.keys(entry)) {
    if (!CASE_KEYS.includes(key)) return `${name}: unknown key "${key}"`;
  }
  for (const key of REQUIRED_KEYS) {
    if (!(key in entry)) return `${name}: missing field "${key}"`;
  }
  for (const key of ["id", "test", "subject", "search", "note"]) {
    if (typeof entry[key] !== "string" || entry[key] === "") {
      return `${name}: field "${key}" is not a non-empty string`;
    }
  }
  if (typeof entry["replace"] !== "string") return `${name}: field "replace" is not a string`;
  if (!KINDS.includes(String(entry["kind"]))) {
    return `${name}: field "kind" is ${JSON.stringify(entry["kind"])}, not rewrite or deletion`;
  }
  const blocks = entry["blocks"];
  if (!isNameList(blocks) || blocks.length === 0) {
    return `${name}: field "blocks" is not a non-empty list of ids`;
  }
  const test = String(entry["test"]);
  const outside = blocks.find((id) => !id.startsWith(`${test}::`) || id === `${test}::`);
  if (outside !== undefined) {
    return `${name}: field "blocks" names ${outside}, whose path is not "test" (${test})`;
  }
  if ("base" in entry && (typeof entry["base"] !== "string" || entry["base"] === "")) {
    return `${name}: field "base" is not a non-empty string`;
  }
  if ("scope" in entry && !isNameList(entry["scope"])) {
    return `${name}: field "scope" is not a list of paths`;
  }
  return null;
}

/**
 * @description Reads a case file: a JSON array of cases, each refused, naming the field, when it
 *   carries an unknown key, lacks a field, holds a field of the wrong shape, lists a block outside
 *   its `test`, or repeats an id.
 * @param {string} text
 * @returns {Result<Case[]>}
 */
export function parseCases(text) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { error: `the case file is not JSON: ${error instanceof Error ? error.message : ""}` };
  }
  if (!Array.isArray(parsed)) return { error: "the case file is not a JSON array of cases" };
  if (parsed.length === 0) return { error: "the case file holds no case" };
  /** @type {Set<string>} */
  const ids = new Set();
  for (const [index, entry] of parsed.entries()) {
    const label = isObject(entry) && typeof entry["id"] === "string" ? ` (${entry["id"]})` : "";
    const name = `case ${index + 1}${label}`;
    if (!isObject(entry)) return { error: `${name} is not an object` };
    const refusal = refusalOf(entry, name);
    if (refusal !== null) return { error: refusal };
    const id = String(entry["id"]);
    if (ids.has(id)) return { error: `${name}: duplicate id "${id}"` };
    ids.add(id);
  }
  return { value: /** @type {Case[]} */ (parsed) };
}

/**
 * @description The test files a case runs: its test, the files its `scope` names, and every
 *   candidate (a test of the same vitest project) that imports the subject directly. A test that
 *   reaches the subject through another module is outside unless named.
 * @param {{ test: string, scope: readonly string[], subject: string, candidates: readonly { path: string, text: string }[] }} input
 * @returns {string[]} Sorted, each once.
 */
export function scopeOf({ test, scope, subject, candidates }) {
  const importers = candidates
    .filter((candidate) => importsSubject(candidate.path, candidate.text, subject))
    .map((candidate) => candidate.path);
  return [...new Set([test, ...scope, ...importers])].sort(byCodeUnit);
}

/**
 * @description The blocks of a test file under their ledger ids, as the classifier reads them and
 *   `blockRows` names them, each with the titles around it and the classifier's `bodyHash`.
 * @param {string} file Repository-relative.
 * @param {string} text
 * @returns {Block[]}
 */
export function blocksOf(file, text) {
  const classification = classifyFile(text, file);
  return blockRows(classification).flatMap((row, index) => {
    const block = classification.blocks[index];
    if (block === undefined) return [];
    return [
      { id: row.id, describe: [...block.describe], title: block.title, bodyHash: row.bodyHash },
    ];
  });
}

/**
 * @description Resolves a ledger id to the block a vitest report names it by. Two blocks with the
 *   same titles around them and the same title are one name in the report, so either id is
 *   ambiguous.
 * @param {readonly Block[]} blocks
 * @param {string} id
 * @returns {Resolution}
 */
export function resolveBlock(blocks, id) {
  const block = blocks.find((entry) => entry.id === id);
  if (block === undefined) return { state: "missing" };
  const name = [...block.describe, block.title].join("\u0000");
  const same = blocks.filter((entry) => [...entry.describe, entry.title].join("\u0000") === name);
  if (same.length > 1) return { state: "ambiguous" };
  return { state: "found", describe: [...block.describe], title: block.title };
}

/**
 * @description Each listed block's `bodyHash` on each side, `null` on a side where the file or the
 *   block does not exist.
 * @param {readonly string[]} ids
 * @param {Readonly<Record<Side, readonly Block[] | null>>} blocks
 * @returns {Record<string, Hashes>}
 */
export function bodyHashes(ids, blocks) {
  /** @type {(side: Side, id: string) => string | null} */
  const hashOf = (side, id) => blocks[side]?.find((block) => block.id === id)?.bodyHash ?? null;
  return Object.fromEntries(
    ids.map((id) => [id, { base: hashOf("base", id), head: hashOf("head", id) }])
  );
}

/**
 * @description Reads a vitest JSON report into each file's status and tests, keyed by the file's
 *   path relative to the repository.
 * @param {unknown} json The parsed report.
 * @param {string} root The repository root, absolute.
 * @param {Readonly<Record<string, string>>} [aliases] A copy's absolute path, run in place of a
 *   file the working tree lacks, to that file's repository-relative path.
 * @returns {Result<Map<string, FileReport>>}
 */
export function reportOf(json, root, aliases = {}) {
  const listed = isObject(json) ? json["testResults"] : undefined;
  if (!Array.isArray(listed)) return { error: "the vitest report holds no testResults" };
  /** @type {Map<string, FileReport>} */
  const report = new Map();
  for (const result of listed.filter(isObject)) {
    const name = result["name"];
    if (typeof name !== "string") continue;
    const file = aliases[name] ?? path.relative(root, name).split(path.sep).join("/");
    const assertions = Array.isArray(result["assertionResults"]) ? result["assertionResults"] : [];
    const message = result["message"];
    report.set(file, {
      status: String(result["status"]),
      tests: assertions.filter(isObject).map((test) => ({
        ancestors: Array.isArray(test["ancestorTitles"]) ? test["ancestorTitles"].map(String) : [],
        title: String(test["title"]),
        status: String(test["status"]),
      })),
      ...(typeof message === "string" && message !== "" ? { message } : {}),
    });
  }
  return { value: report };
}

/**
 * @description Why a run says nothing: its own failure, or a file it was given that its report
 *   does not name.
 * @param {Run} run
 * @param {readonly string[]} files
 * @returns {string | null}
 */
function failureOf(run, files) {
  if (run.failure !== null) return run.failure;
  return files.some((file) => !run.report.has(file)) ? "runner-failed" : null;
}

/**
 * @description Says whether a file's report is one of a file that did not load: it failed and
 *   holds no test at all.
 * @param {FileReport | undefined} report
 * @returns {boolean}
 */
function unloadedReport(report) {
  return report?.status === "failed" && report.tests.length === 0;
}

/**
 * @description The red entry of a file that failed with none of its tests failed,
 *   `<file>::(the file failed)`, followed by `: <line>` when the file did not load and vitest's
 *   message holds a non-empty line: its first, trimmed, cut at `MESSAGE_LIMIT` characters. A file
 *   whose own hook failed keeps the bare entry, so a record without a load failure does not move.
 * @param {string} file
 * @param {FileReport} report
 * @returns {string}
 */
function fileFailedEntry(file, report) {
  const entry = `${file}::${FILE_FAILED}`;
  if (!unloadedReport(report) || report.message === undefined) return entry;
  const line = report.message
    .split("\n")
    .map((each) => each.trim())
    .find((each) => each !== "");
  return line === undefined
    ? entry
    : `${entry}: ${Array.from(line).slice(0, MESSAGE_LIMIT).join("")}`;
}

/**
 * @description The red scope tests of a run, each named `<file>::<describe > … > title>`, and a
 *   file that failed with none of its tests failed named by `fileFailedEntry`.
 * @param {Run} run
 * @param {readonly string[]} files
 * @returns {string[]} Sorted.
 */
function redOf(run, files) {
  /** @type {string[]} */
  const red = [];
  for (const file of files) {
    const report = run.report.get(file);
    if (report === undefined) continue;
    const failed = report.tests.filter((test) => test.status === "failed");
    for (const test of failed) red.push(`${file}::${[...test.ancestors, test.title].join(" > ")}`);
    if (report.status === "failed" && failed.length === 0) red.push(fileFailedEntry(file, report));
  }
  return [...new Set(red)].sort(byCodeUnit);
}

/**
 * @description The red entries of a run's scope files that did not load, in the files' order.
 * @param {Run} run
 * @param {readonly string[]} files
 * @returns {string[]}
 */
function unloadedOf(run, files) {
  return files.flatMap((file) => {
    const report = run.report.get(file);
    return report !== undefined && unloadedReport(report) ? [fileFailedEntry(file, report)] : [];
  });
}

/**
 * @description The reason a case whose clean runs left scope files unloaded is undecided under,
 *   by the side or sides that hold one, or `null` when neither does.
 * @param {{ base: readonly string[], head: readonly string[] }} unloaded
 * @returns {string | null}
 */
function unreadableReason(unloaded) {
  if (unloaded.base.length > 0 && unloaded.head.length > 0) return BOTH_UNREADABLE;
  if (unloaded.base.length > 0) return BASE_UNREADABLE;
  return unloaded.head.length > 0 ? HEAD_UNREADABLE : null;
}

/**
 * @description A listed block's state in a run: red when a result its name matches failed, green
 *   when every matching result passed, absent when none ran.
 * @param {Run} run
 * @param {string} file
 * @param {Resolution} resolution A found block.
 * @returns {"red" | "green" | "absent"}
 */
function blockState(run, file, resolution) {
  if (resolution.state !== "found") return "absent";
  const matcher = new RegExp(testNamePattern(resolution.describe, resolution.title));
  const matched = (run.report.get(file)?.tests ?? []).filter((test) =>
    matcher.test([...test.ancestors, test.title].join(" "))
  );
  if (matched.some((test) => test.status === "failed")) return "red";
  if (matched.length > 0 && matched.every((test) => test.status === "passed")) return "green";
  return "absent";
}

/**
 * @description Says whether a run's red tests are the listed blocks alone: at least one listed
 *   block is red, every failed test of the run is one a listed block's name matches in the test
 *   file, and no file failed with none of its tests failed.
 * @param {Run} run
 * @param {readonly string[]} files
 * @param {string} test
 * @param {readonly (Resolution | undefined)[]} listed Each listed block's resolution on the run's side.
 * @returns {boolean}
 */
function onlyListedRed(run, files, test, listed) {
  const found = listed.filter((resolution) => resolution?.state === "found");
  if (!found.some((resolution) => resolution && blockState(run, test, resolution) === "red")) {
    return false;
  }
  const matchers = found.flatMap((resolution) =>
    resolution?.state === "found"
      ? [new RegExp(testNamePattern(resolution.describe, resolution.title))]
      : []
  );
  return files.every((file) => {
    const report = run.report.get(file);
    if (report === undefined) return true;
    const failed = report.tests.filter((result) => result.status === "failed");
    if (report.status === "failed" && failed.length === 0) return false;
    return failed.every(
      (result) =>
        file === test &&
        matchers.some((matcher) => matcher.test([...result.ancestors, result.title].join(" ")))
    );
  });
}

/**
 * @description Gives a case its verdict from its four runs, in the table's order: the search, the
 *   blocks, the clean runs and their precondition (or the measured behaviour change), the mutated
 *   runs, then the kind's verdict.
 * @param {DecideInput} input
 * @returns {Decided}
 */
export function decide({ kind, test, blocks, searchFound, resolutions, runs, files }) {
  /** @type {(reason: string, red?: { base: string[], head: string[] }) => Decided} */
  const undecided = (reason, red = { base: [], head: [] }) => ({
    verdict: "UNDECIDED",
    reason,
    red,
  });
  if (!searchFound) return undecided("search-absent");
  if (files.base.length === 0) return undecided("base-empty");
  /** @type {readonly Side[]} */
  const needed = kind === "rewrite" ? ["head", "base"] : ["base"];
  for (const id of blocks) {
    for (const each of needed) {
      const state = resolutions[id]?.[each]?.state;
      if (state === "ambiguous") return undecided("ambiguous-id");
      if (state !== "found") return undecided("block-missing");
    }
    if (kind === "deletion" && resolutions[id]?.head?.state !== "missing") {
      return undecided("block-present-at-head");
    }
  }
  /** @type {Side} */
  const side = kind === "rewrite" ? "head" : "base";
  for (const each of /** @type {const} */ (["base", "head"])) {
    const failure = failureOf(runs[each].clean, files[each]);
    if (failure !== null) return undecided(failure);
  }
  const unloaded = {
    base: unloadedOf(runs.base.clean, files.base),
    head: unloadedOf(runs.head.clean, files.head),
  };
  const unreadable = unreadableReason(unloaded);
  if (unreadable !== null) return undecided(unreadable, unloaded);
  const baseClean = redOf(runs.base.clean, files.base);
  const headClean = redOf(runs.head.clean, files.head);
  if (baseClean.length > 0) {
    const listed = blocks.map((id) => resolutions[id]?.base);
    if (headClean.length === 0 && onlyListedRed(runs.base.clean, files.base, test, listed)) {
      return { verdict: "BEHAVIOUR-CHANGED", reason: null, red: { base: baseClean, head: [] } };
    }
    return undecided("base-red-clean", { base: baseClean, head: [] });
  }
  if (headClean.length > 0) return undecided("head-red-clean", { base: [], head: headClean });
  for (const each of /** @type {const} */ (["base", "head"])) {
    const failure = failureOf(runs[each].mutated, files[each]);
    if (failure !== null) return undecided(failure);
  }
  const red = {
    base: redOf(runs.base.mutated, files.base),
    head: redOf(runs.head.mutated, files.head),
  };
  const states = blocks.map((id) => {
    const resolution = resolutions[id]?.[side];
    return resolution === undefined ? "absent" : blockState(runs[side].mutated, test, resolution);
  });
  if (states.includes("absent")) return undecided("block-missing", red);
  if (kind === "rewrite") {
    if (states.includes("green")) return { verdict: "BROKEN", reason: null, red };
    return { verdict: red.base.length > 0 ? "NO-GAIN" : "GAIN", reason: null, red };
  }
  if (states.includes("green")) return { verdict: "VACUOUS", reason: null, red };
  return { verdict: red.head.length > 0 ? "SAFE" : "LOST", reason: null, red };
}

/**
 * @description One case of the record: its id, kind, verdict, reason when undecided, scope, red
 *   tests on each side, its blocks with their `bodyHash` on each side, and its base when the case
 *   names its own.
 * @param {Case} spec
 * @param {Readonly<Record<Side, readonly string[]>>} scope The scope files each side holds.
 * @param {Decided} decided
 * @param {string | null} base The case's own base, resolved, or `null` for `--base`'s.
 * @param {Readonly<Record<string, Hashes>>} hashes
 * @returns {Record<string, unknown>}
 */
export function caseEntry(spec, scope, decided, base, hashes) {
  return {
    id: spec.id,
    kind: spec.kind,
    verdict: decided.verdict,
    ...(decided.reason === null ? {} : { reason: decided.reason }),
    scope: { base: [...scope.base].sort(byCodeUnit), head: [...scope.head].sort(byCodeUnit) },
    red: {
      base: [...decided.red.base].sort(byCodeUnit),
      head: [...decided.red.head].sort(byCodeUnit),
    },
    blocks: [...spec.blocks]
      .sort(byCodeUnit)
      .map((id) => ({ id, bodyHash: hashes[id] ?? { base: null, head: null } })),
    ...(base === null ? {} : { base }),
  };
}

/**
 * @description The record: its version, the head (a sha, or `worktree`), the base and the cases by
 *   id, every key in code-unit order.
 * @param {{ head: string, base: string, cases: readonly Record<string, unknown>[] }} input
 * @returns {unknown}
 */
export function recordOf({ head, base, cases }) {
  const ordered = [...cases].sort((left, right) =>
    byCodeUnit(String(left["id"]), String(right["id"]))
  );
  return sortedKeys({ version: RECORD_VERSION, head, base, cases: ordered });
}

/**
 * @description The exit code of the verdicts: 1 on any BROKEN or UNDECIDED, on any NO-GAIN or
 *   BEHAVIOUR-CHANGED under `--require gain`, on any LOST, VACUOUS or BEHAVIOUR-CHANGED under
 *   `--require safe`; else 0. BEHAVIOUR-CHANGED is decided, so it alone exits 0.
 * @param {readonly Decided[]} results
 * @param {"gain" | "safe" | null} requirement
 * @returns {number}
 */
export function exitOf(results, requirement) {
  const failing = new Set(["BROKEN", "UNDECIDED"]);
  if (requirement !== null) failing.add("BEHAVIOUR-CHANGED");
  if (requirement === "gain") failing.add("NO-GAIN");
  if (requirement === "safe") ["LOST", "VACUOUS"].forEach((verdict) => failing.add(verdict));
  return results.some((result) => failing.has(result.verdict)) ? 1 : 0;
}
