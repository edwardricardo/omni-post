// @ts-check
/**
 * @file mutation-diff-core.mjs
 * @description The pure core of the differential mutation tool: the case file and its refusals,
 *   the scope a case runs, the block a ledger id resolves to and the classifier's hash of it, the
 *   reading of a vitest JSON report, the verdict table, the record and the exit code. It spawns
 *   nothing and writes nothing; `scripts/testing/mutation-diff.mjs` runs the four vitest runs of
 *   each case and hands their reports here.
 *
 *   THE TABLE. "Red" is a test the JSON report marks failed, or a file that failed with none of its
 *   tests failed (it did not load, or a hook of its own failed); a test that did not run is never
 *   green. Precondition, for every kind: on both clean runs every scope test that exists on that
 *   side is green, else UNDECIDED `base-red-clean` or `head-red-clean`; a base file that fails to
 *   load with no test at all is `base-unreadable`, the base content not loading against today's
 *   subject. A rewrite needs its listed block on both sides and a deletion its block at the base
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
 *   never GAIN or SAFE.
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

/**
 * A relative module specifier of an `import … from`, an `export … from`, a bare `import "…"` or an
 * `import("…")`: the cheap static read the default scope makes.
 */
const SPECIFIER =
  /\b(?:import|export)\b[^'"`;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** The extensions a specifier without one, or with a JavaScript one, may resolve to. */
const RESOLVED_EXTENSIONS = Object.freeze([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".jsx"]);

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
 */

/**
 * @typedef {object} Run What one vitest run gave.
 * @property {string | null} failure Why the run says nothing: `runner-failed`, `timeout`,
 *   `not-applied` (no marker of the mutation), `not-served` (a served file never reached
 *   the plugin) or `base-unreadable`.
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
 * @description Says whether a module imports the subject directly: one of its relative specifiers,
 *   resolved against its own directory, names the subject with its extension, with a JavaScript
 *   extension standing for a TypeScript one, with none, or as a directory's index.
 * @param {string} file The module, repository-relative.
 * @param {string} text
 * @param {string} subject Repository-relative.
 * @returns {boolean}
 */
function importsSubject(file, text, subject) {
  for (const match of text.matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? "";
    if (!specifier.startsWith(".")) continue;
    const joined = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    const forms = [
      joined,
      joined.replace(/\.(m|c)?js$/, ".$1ts"),
      joined.replace(/\.jsx$/, ".tsx"),
      ...RESOLVED_EXTENSIONS.map((extension) => `${joined}${extension}`),
      ...RESOLVED_EXTENSIONS.map((extension) => `${joined}/index${extension}`),
    ];
    if (forms.includes(subject)) return true;
  }
  return false;
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
    report.set(file, {
      status: String(result["status"]),
      tests: assertions.filter(isObject).map((test) => ({
        ancestors: Array.isArray(test["ancestorTitles"]) ? test["ancestorTitles"].map(String) : [],
        title: String(test["title"]),
        status: String(test["status"]),
      })),
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
 * @description The red scope tests of a run, each named `<file>::<describe > … > title>`, and a
 *   file that failed with none of its tests failed named `<file>::(the file failed)`.
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
    if (report.status === "failed" && failed.length === 0) red.push(`${file}::${FILE_FAILED}`);
  }
  return [...new Set(red)].sort(byCodeUnit);
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
 * @description Gives a case its verdict from its four runs, in the table's order: the search, the
 *   blocks, the clean runs and their precondition, the mutated runs, then the kind's verdict.
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
  const unloaded = files.base.filter((file) => {
    const report = runs.base.clean.report.get(file);
    return report?.status === "failed" && report.tests.length === 0;
  });
  if (unloaded.length > 0) {
    return undecided("base-unreadable", {
      base: unloaded.map((file) => `${file}::${FILE_FAILED}`),
      head: [],
    });
  }
  const baseClean = redOf(runs.base.clean, files.base);
  if (baseClean.length > 0) return undecided("base-red-clean", { base: baseClean, head: [] });
  const headClean = redOf(runs.head.clean, files.head);
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
 * @description The exit code of the verdicts: 1 on any BROKEN or UNDECIDED, on any NO-GAIN under
 *   `--require gain`, on any LOST or VACUOUS under `--require safe`; else 0.
 * @param {readonly Decided[]} results
 * @param {"gain" | "safe" | null} requirement
 * @returns {number}
 */
export function exitOf(results, requirement) {
  const failing = new Set(["BROKEN", "UNDECIDED"]);
  if (requirement === "gain") failing.add("NO-GAIN");
  if (requirement === "safe") ["LOST", "VACUOUS"].forEach((verdict) => failing.add(verdict));
  return results.some((result) => failing.has(result.verdict)) ? 1 : 0;
}
