// @ts-check
/**
 * @file error-sites-gate.mjs
 * @description The sites gate, half of `pnpm check:errors` (fitness #57, ADR-0047): the list of
 *   existing error sites only shrinks, and it is verified to.
 *
 *   THE BASELINE is every entry of a rule whose id starts with `errors/` in
 *   `eslint-suppressions.json`, which ESLint writes and holds in both directions for every file it
 *   lints. This gate holds what ESLint does not look at. THE HISTORY,
 *   `scripts/testing/error-sites-history/`, holds one row per file: the birth of a rule with its
 *   count per context, or the sites a change fixed per context and the moves it made. The state is
 *   the births minus everything fixed, each move taking its count from the context of its source
 *   and giving it to the context of its target; the rows add up in any order.
 *
 *   ALWAYS:
 *   - S1: every path of the baseline is a regular file git tracks.
 *   - S2: every path of the baseline is in its rule's scope (`lib/error-scope.mjs`).
 *   - S3: the history exists exactly while the baseline holds an `errors/` entry; every row is a
 *     birth or a row of fixed and moved sites; every rule born is one the gate holds, born once;
 *     every rule with entries is born; the state equals, per context, what the baseline yields.
 *   - S4: the list of each rule names only what exists, never takes a file under a `src`
 *     directory out by an entry of kind `outside-src`, and every entry carries what its kind
 *     claims; no JavaScript file lies under a `src` directory outside an excluded root; the
 *     plugin's package exports its `src`, and its `src` imports only relative paths inside itself
 *     and the built-ins the scope allows; and for every tracked file of a rule's scope, ESLint does
 *     not ignore it, the rule is at `error` with exactly the held options, and the plugin ESLint
 *     resolves is the package's own object.
 *   - S5: no file of the scope holds an `eslint-disable` directive that names an `errors/` rule or
 *     names no rule; no tracked `package.json`, hook under `.husky/` or workflow holds
 *     `pass-on-unpruned-suppressions`; the root `lint` script is the one the gate holds.
 *
 *   AGAINST A BASE, the head being `HEAD`. Every comparison reads the base's paths through the
 *   renames git reports, so a count travels with its file:
 *   - S6a: the renames, `git diff -z --name-status -M <base> HEAD`, map each path of the base's
 *     baseline to its new path.
 *   - S6: no count of a rule the base's history bore rises, and no path the mapped base does not
 *     hold gains an entry, but by the birth of a rule or by a recorded move into it.
 *   - S7: a count falls only where git reports a change of the file's content, or its deletion.
 *   - S8: a file of the base's baseline renamed by the head stays in its rule's scope, and a portal
 *     whose catalogs hold `errorCodes` on the base holds it in every catalog on the head.
 *   - S9: when the rule's package, this gate or the scope module differs from the base, no count of
 *     a rule the base's history bore differs from the mapped base.
 *   - S10: every row of the base is on the head unchanged; the head adds exactly one row when a
 *     count, a context's total or a birth differs from the base, and none otherwise; and that row is
 *     what the difference yields: a birth alone, or `fixed` per context as what fell there minus
 *     what moved out of it, with one move across contexts per renamed file that crossed one, and
 *     moves between two files only inside one context.
 *
 *   `--record` writes one row and never rewrites one. With no base it writes the birth of the one
 *   rule that has entries and no birth; against a base it writes the row the difference yields,
 *   with the moves between two files given as `--moved <from>:<to>:<count>`. It refuses when
 *   nothing differs.
 *
 *   `--stalled --days <n>`, the scheduled half (`error-sites-stall.yml`, the Maintainer's decision
 *   of 2026-11-20): whether the list stopped shrinking. It reads the `errors/` entries of the
 *   baseline and the rows of the history from the root's disk, which on the runner is the checkout
 *   of tracked files, and nothing else: no git, no base (`FITNESS_BASE_REF` is not read), no ESLint,
 *   no package at all, and none of S1 to S10, which fitness #57 holds on every pull request. A row
 *   is any row, a birth included, and its date is the one in its name; the newest row is the one
 *   with the latest date. Today is the UTC date of the instant the run reads as now. The list is
 *   stalled when it is above zero and the newest row is dated `<n>` or more days before today, so
 *   the window counts from the birth until a row follows it. Exit 0 when the list is empty, or the
 *   newest row is inside the window; exit 1 when it stalled, writing the total, the count per
 *   context and the newest row's date. `--remind` then keeps one issue (label
 *   `error-sites-stalled`) through the reminder the patched-dependencies gate shares
 *   (`lib/issue-reminder.mjs`): opened when none exists, commented on once a day while it stays
 *   open, reopened when it is closed while the list still stalls, with no second issue and no
 *   second comment on the same day; while the list does not stall it calls no GitHub API.
 *
 *   FAIL-CLOSED, exit 3, which wins over 1 and prints the verdicts too: `git ls-files` failing or
 *   listing no file; `eslint-suppressions.json`, on the head or the base, that cannot be read, is
 *   not JSON or is not ESLint's shape for an `errors/` entry (a missing file is no entry, as ESLint
 *   reads it); a history entry, on the head or the base, that is no row file, is not JSON or is not
 *   a row; a held rule with no list or no options; a glob the scope's matcher does not read;
 *   ESLint's configuration that cannot be resolved; the plugin's manifest, a source file or a
 *   catalog that cannot be read; a base that cannot be resolved; a `git` call against the base that
 *   fails for another reason than a path absent there. Under `--stalled`: the baseline or a history
 *   entry that cannot be read as above; a list above zero whose history does not exist or holds no
 *   row, since nothing dates it; a newest row dated after today, which is no day a row was recorded
 *   on; and, under `--remind`, a GitHub call that fails or answers with no list. A usage error exits
 *   2.
 *
 *   RESIDUAL LIMITS: the directive scan reads text, so a string that spells a directive is reported
 *   as one; the plugin's imports are read from its syntax, so code that loads a module with no
 *   import and no `require` call (`process.getBuiltinModule`) is not seen; a count is not a line,
 *   so a file that fixes one site and adds another keeps its count; a change of the rule that moves
 *   no count passes S9, and a later change that prunes a file it edited passes S7; S1 to S10 and
 *   `--record` never read the clock, so a row's date is what its author wrote, and `--stalled`
 *   trusts it: a row dated later than the day it was recorded, but not after today, holds the
 *   window open; the day's comment is found by its text, which holds the counts, so two runs of one
 *   day that read different counts both comment, which takes a change of the list with no row dated
 *   inside the window (a back-dated row, or a push with no pull request); `--stalled` says the list
 *   moved inside the window, not that its pace is enough, and it blocks no merge.
 *
 *   Usage: `node scripts/testing/error-sites-gate.mjs [--base <ref>] [--root <dir>]`,
 *   `node scripts/testing/error-sites-gate.mjs --record --date <YYYY-MM-DD> --slug <slug>
 *   [--base <ref>] [--moved <from>:<to>:<count>]... [--root <dir>]`, and
 *   `node scripts/testing/error-sites-gate.mjs --stalled --days <n> [--remind] [--root <dir>]`. The
 *   base is `--base`, else the variable `FITNESS_BASE_REF`; `--stalled` takes neither `--base` nor
 *   `--record`, `--days` is a positive integer and belongs to it, and so does `--remind`. Exit 0
 *   clean (under `--stalled`, not stalled), 1 a verdict (stalled), 2 a usage error, 3 an input that
 *   could not be read.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  ERROR_PLUGIN_BUILTINS,
  ERROR_RULE_OPTIONS,
  ERROR_SCOPE_EXCLUSIONS,
  ERROR_SCOPE_FILES,
  EXCLUSION_KIND,
  exclusionOf,
  isInErrorScope,
  isUnderSource,
  matchesGlob,
} from "./lib/error-scope.mjs";
import { createGh, remindIssues } from "./lib/issue-reminder.mjs";

/** ESLint's suppressions file, relative to the root. */
export const BASELINE = "eslint-suppressions.json";
/** The history's directory, relative to the root. */
export const HISTORY = "scripts/testing/error-sites-history";
/** The root `lint` script, which must keep reaching the whole tree. */
export const LINT_SCRIPT = "eslint . --ext .ts,.tsx --max-warnings 0";
/** The package of the `errors/` rules, and the entry point it must export. */
export const PLUGIN = Object.freeze({
  namespace: "errors",
  packageName: "@packages/eslint-plugin-errors",
  directory: "packages/eslint-plugin-errors",
  exports: Object.freeze({ ".": "./src/index.js" }),
});
/** The files whose change is a change of the rule, for S9: a directory ends with `/`. */
export const RULE_SOURCES = Object.freeze([
  `${PLUGIN.directory}/`,
  "scripts/testing/error-sites-gate.mjs",
  "scripts/testing/lib/error-scope.mjs",
]);

const EXIT = Object.freeze({ CLEAN: 0, VERDICT: 1, USAGE: 2, UNREAD: 3 });
const PREFIX = "error-sites-gate: ";
const DEFAULT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const USAGE = [
  "usage: node scripts/testing/error-sites-gate.mjs [--base <ref>] [--root <dir>]",
  "       node scripts/testing/error-sites-gate.mjs --record --date <YYYY-MM-DD> --slug <slug> [--base <ref>] [--moved <from>:<to>:<count>]... [--root <dir>]",
  "       node scripts/testing/error-sites-gate.mjs --stalled --days <n> [--remind] [--root <dir>]",
].join("\n");
/** The issue `--stalled --remind` keeps while the list stalls, and the label that finds it. */
const STALL_ISSUE = Object.freeze({
  title: "Error sites stalled: the list of existing error sites stopped shrinking",
  label: Object.freeze({
    name: "error-sites-stalled",
    color: "b60205",
    description: "The list of existing error sites stopped shrinking",
  }),
});
const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS = /^[1-9]\d*$/;
const PRUNE = "pnpm exec eslint . --prune-suppressions";
const RECORD =
  "node scripts/testing/error-sites-gate.mjs --record --date <YYYY-MM-DD> --slug <slug>";
const SHOWN_PER_PROBLEM = 20;
const ROW_NAME = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.json$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MOVE_ARGUMENT = /^([^:]+):([^:]+):([1-9]\d*)$/;
const GROUPED = new Set(["core", "providers", "adapters", "monitoring", "observability"]);
const TEST_SUFFIX = /\.(?:test|spec)\.(?:ts|tsx|mts|cts)$/;
const DECLARATION = /\.d\.(?:ts|mts|cts)$/;
const JAVASCRIPT = /\.(?:js|mjs|cjs|jsx)$/;
const SOURCE = /\.(?:js|mjs|cjs|jsx|ts|tsx|mts|cts)$/;
const WHOLE_ROOT = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/\*\*$/;
/** A catalog of a portal: `apps/<portal>/messages/<locale>.json`. */
const CATALOG = /^apps\/([^/]+)\/messages\/[^/]+\.json$/;
/** The opener of a disable directive, in a line or a block comment, and its keyword. */
const DIRECTIVE = /(\/\/|\/\*)[\s*]*eslint-disable(?:-next-line|-line)?(?=[\s*]|$)/g;
const PASS_UNPRUNED = "pass-on-unpruned-suppressions";
const KINDS = Object.values(EXCLUSION_KIND);
const SEVERITY_NAMES = new Map([
  [0, "off"],
  [1, "warn"],
  [2, "error"],
]);
const SEVERITY_VALUES = new Map([
  ["off", 0],
  ["warn", 1],
  ["error", 2],
]);

/** @typedef {import("./lib/error-scope.mjs").Exclusion} Exclusion */
/** @typedef {Readonly<Record<string, readonly Exclusion[]>>} Exclusions */
/** @typedef {Readonly<Record<string, readonly unknown[]>>} RuleOptions */
/** @typedef {{ exitCode: number, stdout: string[], stderr: string[] }} Outcome */
/** @typedef {{ status: number, stdout: string, stderr: string }} GitResult */
/** @typedef {(args: readonly string[]) => GitResult} Git */
/** @typedef {import("./lib/issue-reminder.mjs").Gh} Gh */
/** @typedef {{ severity: number, options: unknown[] }} RuleState */
/**
 * @typedef {object} Resolution What ESLint resolves for one path.
 * @property {boolean} ignored True when ESLint ignores the path or no block applies to it.
 * @property {Record<string, RuleState>} rules Each rule of the plugin's namespace on the path.
 * @property {boolean} pluginIsPackage True when the plugin of the namespace is the very object
 *   the plugin's package exports.
 */
/** @typedef {(file: string) => Promise<Resolution>} ResolveRule */
/** @typedef {Map<string, Map<string, number>>} Baseline Path, then rule id, then count. */
/** @typedef {{ from: string, to: string, count: number }} Move */
/**
 * @typedef {object} Row A row of the history.
 * @property {1} version
 * @property {{ rule: string, contexts: Record<string, number> }} [born]
 * @property {Record<string, number>} [fixed]
 * @property {Move[]} [moved]
 */
/** @typedef {{ file: string, row: Row, text: string }} HistoryRow */
/**
 * @typedef {object} History
 * @property {boolean} exists Whether the history's directory exists.
 * @property {HistoryRow[]} rows Its rows, sorted by file.
 * @property {string[]} problems Why an entry of the directory is no row; empty when every one is.
 */
/**
 * @typedef {object} Change One entry of `git diff --name-status -M <base> HEAD`.
 * @property {string} status `A`, `M`, `D`, `T` or `R`.
 * @property {number} score A rename's similarity, 100 when the content is unchanged; 0 otherwise.
 * @property {string} from The path on the base.
 * @property {string} to The path on the head.
 */
/**
 * @typedef {object} BaseState What the gate reads of the base.
 * @property {string} ref
 * @property {Baseline} baseline
 * @property {HistoryRow[]} rows
 * @property {Change[]} changes
 * @property {string[]} portals The portals whose catalogs hold `errorCodes` on the base.
 */
/**
 * @typedef {object} Difference The head's baseline against the base's, through the renames.
 * @property {Map<string, { to: string, unchanged: boolean }>} renames Base path to head path.
 * @property {Map<string, string>} sourceOf Head path to the base path it comes from.
 * @property {Baseline} mapped The base's baseline keyed by head path.
 * @property {Set<string>} bornOnBase The rules the base's history bore.
 * @property {string[]} newRules The rules the head's baseline holds that the base's history did not bear.
 * @property {{ file: string, rule: string, base: number, head: number }[]} rises
 * @property {{ file: string, rule: string, base: number, head: number }[]} falls
 * @property {Map<string, number>} risesOf Each head path's rises, over the rules born on the base.
 * @property {Map<string, number>} fallsOf Each head path's falls, over the rules born on the base.
 * @property {string[]} totalsDiffer The contexts whose total, over those rules, differs.
 * @property {Move[]} renameMoves One move per renamed file that crossed two contexts.
 */

/** @type {(error: unknown) => string} */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/** @type {(count: number, singular: string, plural?: string) => string} */
const counted = (count, singular, plural = `${singular}s`) =>
  `${String(count)} ${count === 1 ? singular : plural}`;

/** @type {(value: unknown) => value is Record<string, unknown>} */
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** @type {(value: unknown) => value is number} */
const isPositiveInteger = (value) => Number.isSafeInteger(value) && Number(value) > 0;

/** @type {(error: unknown) => boolean} */
const isMissing = (error) =>
  error instanceof Error &&
  "code" in error &&
  (error.code === "ENOENT" || error.code === "ENOTDIR");

/** @type {(names: readonly string[]) => string} */
const joinAnd = (names) =>
  names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;

/** @type {(left: string, right: string) => number} */
const byText = (left, right) => (left < right ? -1 : Number(left > right));

/** @type {(moves: readonly Move[]) => Move[]} */
const sortedMoves = (moves) =>
  [...moves].sort((left, right) => byText(left.from, right.from) || byText(left.to, right.to));

/** @type {(counts: Map<string, number>) => Record<string, number>} */
const sortedObject = (counts) =>
  Object.fromEntries(
    [...counts].filter(([, count]) => count !== 0).sort(([left], [right]) => byText(left, right))
  );

/**
 * @param {string} text
 * @returns {boolean} True for a `YYYY-MM-DD` that is a calendar date.
 */
function isCalendarDate(text) {
  const match = DATE.exec(text);
  if (match === null) return false;
  const [year, month, day] = [match[1], match[2], match[3]].map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
  );
}

/**
 * @description The context of a path: the part of the tree a row of the history counts it in.
 * @param {string} file A repository-relative path.
 * @returns {string} `core/<name>`, `api/<name>` (`api/src` for a file directly under
 *   `apps/api/src/`, `api` elsewhere under `apps/api/`), the application's name for any other
 *   application, `<group>/<name>` for a package of a group, `packages/<name>`, `infra/<name>`, the
 *   first directory's name otherwise, and `(root)` for a file at the root.
 */
export function contextOf(file) {
  const segments = file.split("/");
  const directories = segments.length - 1;
  const [first = "", second = "", third = "", fourth = ""] = segments;
  if (first === "packages" && GROUPED.has(second) && directories >= 3) return `${second}/${third}`;
  if (first === "packages" && directories >= 2) return `packages/${second}`;
  if (first === "apps" && second === "api" && third === "src") {
    return directories >= 4 ? `api/${fourth}` : "api/src";
  }
  if (first === "apps" && directories >= 2) return second;
  if (first === "infra" && directories >= 2) return `infra/${second}`;
  return directories >= 1 ? first : "(root)";
}

/**
 * @description The `git` the gate runs: a synchronous call in the root that never throws.
 * @param {string} root The repository root.
 * @returns {Git} A function from git's arguments to its exit status and output.
 */
export function createGit(root) {
  return (args) => {
    const result = spawnSync("git", [...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (result.error !== undefined) return { status: -1, stdout: "", stderr: result.error.message };
    return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr.trim() };
  };
}

/**
 * @param {unknown} value A rule's entry in a resolved configuration.
 * @returns {RuleState}
 */
function ruleStateOf(value) {
  const [severity, ...options] = Array.isArray(value) ? value : [value];
  const number =
    typeof severity === "number" ? severity : (SEVERITY_VALUES.get(String(severity)) ?? -1);
  return { severity: number, options };
}

/**
 * @description The `resolveRule` the command runs: ESLint's Node API, loaded from the root, asked
 *   whether it ignores a path and which rules of a namespace it resolves there, with the identity
 *   of the plugin it resolves compared to the object the plugin's package exports.
 * @param {{ root: string, namespace: string, packageName: string }} input The root whose
 *   `eslint.config.ts` is read, the plugin's namespace, and its package's name.
 * @returns {Promise<ResolveRule>} The resolver.
 * @throws {Error} When ESLint or the plugin's package cannot be loaded from the root.
 */
export async function createEslintResolver({ root, namespace, packageName }) {
  const load = createRequire(path.join(root, "package.json"));
  const { ESLint } = /** @type {typeof import("eslint")} */ (load("eslint"));
  const loaded = /** @type {unknown} */ (load(packageName));
  const plugin = isObject(loaded) && "default" in loaded ? loaded["default"] : loaded;
  const eslint = new ESLint({ cwd: root });
  const prefix = `${namespace}/`;
  return async (file) => {
    const absolute = path.join(root, file);
    const config = (await eslint.isPathIgnored(absolute))
      ? undefined
      : /** @type {{ rules?: Record<string, unknown>, plugins?: Record<string, unknown> } | undefined} */ (
          await eslint.calculateConfigForFile(absolute)
        );
    if (config === undefined || config === null) {
      return { ignored: true, rules: {}, pluginIsPackage: false };
    }
    /** @type {Record<string, RuleState>} */
    const rules = {};
    for (const [id, value] of Object.entries(config.rules ?? {})) {
      if (id.startsWith(prefix)) rules[id] = ruleStateOf(value);
    }
    return { ignored: false, rules, pluginIsPackage: config.plugins?.[namespace] === plugin };
  };
}

/**
 * @param {Git} git
 * @returns {{ files: string[] } | { error: string }} The regular files git tracks, sorted, so a
 *   symbolic link or a submodule is never read through.
 */
function listTracked(git) {
  const listed = git(["ls-files", "--stage", "-z"]);
  if (listed.status !== 0) {
    return { error: `git ls-files failed: ${listed.stderr || `exit ${String(listed.status)}`}` };
  }
  const files = listed.stdout
    .split("\0")
    .filter((record) => /^100(?:644|755) /u.test(record))
    .map((record) => record.slice(record.indexOf("\t") + 1))
    .sort(byText);
  if (files.length === 0)
    return { error: "git tracks no file: a scan that read nothing is not clean" };
  return { files };
}

/**
 * @param {string} text The file's text.
 * @param {string} where How the file is named in a message.
 * @returns {{ baseline: Baseline } | { error: string }} The `errors/` entries, or why not.
 */
function parseBaseline(text, where) {
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { error: `${where} is not JSON: ${messageOf(error)}` };
  }
  if (!isObject(data)) return { error: `${where} is not an object of paths, each of rule ids` };
  /** @type {Baseline} */
  const baseline = new Map();
  for (const [file, rules] of Object.entries(data)) {
    if (!isObject(rules)) return { error: `${where}: "${file}" is not an object of rule ids` };
    for (const [rule, entry] of Object.entries(rules)) {
      if (!rule.startsWith("errors/")) continue;
      const count = isObject(entry) ? entry["count"] : undefined;
      if (!isObject(entry) || Object.keys(entry).join() !== "count" || !isPositiveInteger(count)) {
        return { error: `${where}: "${file}" > "${rule}" is not { "count": <positive integer> }` };
      }
      const rulesOfFile = baseline.get(file) ?? new Map();
      rulesOfFile.set(rule, count);
      baseline.set(file, rulesOfFile);
    }
  }
  return { baseline };
}

/**
 * @param {string} root
 * @returns {{ baseline: Baseline } | { error: string }} The head's `errors/` entries, or why not.
 */
function readBaseline(root) {
  try {
    return parseBaseline(readFileSync(path.join(root, BASELINE), "utf8"), BASELINE);
  } catch (error) {
    // ESLint's suppressions service reads a missing file as no suppression at all.
    if (isMissing(error)) return { baseline: new Map() };
    return { error: `${BASELINE} could not be read: ${messageOf(error)}` };
  }
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string | null} Why the value is not an object of contexts with positive counts.
 */
function countsProblem(value, label) {
  if (!isObject(value) || Object.keys(value).length === 0) {
    return `${label} is not an object of at least one context`;
  }
  for (const [context, count] of Object.entries(value)) {
    if (context === "" || !isPositiveInteger(count)) {
      return `${label} counts "${context}" with ${JSON.stringify(count)}, not a positive integer`;
    }
  }
  return null;
}

/**
 * @description Why a parsed file is not a row of the history, or `null` when it is one.
 * @param {unknown} row
 * @returns {string | null}
 */
function rowProblem(row) {
  if (!isObject(row)) return "it is not an object";
  if (row["version"] !== 1) return '"version" is not 1';
  const keys = Object.keys(row).filter((key) => key !== "version");
  if (keys.includes("born")) {
    if (keys.length !== 1) return "a birth holds nothing but its version and its birth";
    const born = row["born"];
    if (!isObject(born) || Object.keys(born).sort().join() !== "contexts,rule") {
      return '"born" is not { "rule", "contexts" }';
    }
    if (typeof born["rule"] !== "string" || !born["rule"].startsWith("errors/")) {
      return 'the rule born is no "errors/" rule id';
    }
    return countsProblem(born["contexts"], '"born.contexts"');
  }
  if (keys.length === 0 || keys.some((key) => key !== "fixed" && key !== "moved")) {
    return 'it is neither a birth ("born") nor a row of fixed and moved sites ("fixed", "moved")';
  }
  if (keys.includes("fixed")) {
    const problem = countsProblem(row["fixed"], '"fixed"');
    if (problem !== null) return problem;
  }
  if (keys.includes("moved")) {
    const moved = row["moved"];
    if (!Array.isArray(moved) || moved.length === 0)
      return '"moved" is not a list of at least one move';
    for (const move of moved) {
      const valid =
        isObject(move) &&
        Object.keys(move).sort().join() === "count,from,to" &&
        typeof move["from"] === "string" &&
        typeof move["to"] === "string" &&
        move["from"] !== "" &&
        move["to"] !== "" &&
        move["from"] !== move["to"] &&
        isPositiveInteger(move["count"]);
      if (!valid) {
        return 'a move is not { "from", "to", "count" } with two different paths and a positive count';
      }
    }
  }
  return null;
}

/**
 * @param {string} file The row's path, relative to the root.
 * @param {string} text Its text.
 * @param {string} where How the row is named in a message.
 * @returns {{ row: HistoryRow } | { problem: string }}
 */
function parseRow(file, text, where) {
  const name = ROW_NAME.exec(path.posix.basename(file));
  if (name === null || !isCalendarDate(name[1] ?? "")) {
    return {
      problem: `${where}: is not named <YYYY-MM-DD>-<slug>.json, so it is no row of the history`,
    };
  }
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { problem: `${where}: is not JSON: ${messageOf(error)}` };
  }
  const problem = rowProblem(data);
  if (problem !== null) return { problem: `${where}: is not a row of the history: ${problem}` };
  return { row: { file, row: /** @type {Row} */ (data), text } };
}

/**
 * @description Reads the history from the root's disk: the one reader of the row format, which the
 *   registry gate's reference page reads too. Every entry of the directory must be a file named
 *   `<YYYY-MM-DD>-<slug>.json` that holds a birth (`{ "version": 1, "born": { "rule", "contexts" } }`)
 *   or a row of fixed and moved sites (`{ "version": 1, "fixed"?, "moved"? }`, one of the two at
 *   least, every count a positive integer, every move between two different paths).
 * @param {string} root The repository root.
 * @returns {History} Whether the directory exists, its rows sorted by file, and why any entry of it
 *   is no row; a caller fails closed while `problems` is not empty.
 */
export function readHistory(root) {
  /** @type {import("node:fs").Dirent[]} */
  let entries;
  try {
    entries = readdirSync(path.join(root, HISTORY), { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return { exists: false, rows: [], problems: [] };
    return {
      exists: true,
      rows: [],
      problems: [`${HISTORY} could not be read: ${messageOf(error)}`],
    };
  }
  /** @type {HistoryRow[]} */
  const rows = [];
  /** @type {string[]} */
  const problems = [];
  for (const entry of entries.sort((left, right) => byText(left.name, right.name))) {
    const file = `${HISTORY}/${entry.name}`;
    if (!entry.isFile()) {
      problems.push(
        `${file}: is not named <YYYY-MM-DD>-<slug>.json, so it is no row of the history`
      );
      continue;
    }
    /** @type {string} */
    let text;
    try {
      text = readFileSync(path.join(root, file), "utf8");
    } catch (error) {
      problems.push(`${file}: could not be read: ${messageOf(error)}`);
      continue;
    }
    const parsed = parseRow(file, text, file);
    if ("problem" in parsed) problems.push(parsed.problem);
    else rows.push(parsed.row);
  }
  return { exists: true, rows, problems };
}

/**
 * @param {Map<string, number>} counts
 * @param {string} context
 * @param {number} delta
 */
function add(counts, context, delta) {
  counts.set(context, (counts.get(context) ?? 0) + delta);
}

/**
 * @description The state the history yields per context: the births, minus what was fixed, with
 *   each move taking its count from the context of its source and giving it to the context of its
 *   target. Rows add up in any order.
 * @param {readonly { row: Row }[]} rows The rows, as `readHistory` returns them.
 * @returns {Map<string, number>} The count per context; a context no row names is absent.
 */
export function stateOf(rows) {
  /** @type {Map<string, number>} */
  const state = new Map();
  for (const { row } of rows) {
    for (const [context, count] of Object.entries(row.born?.contexts ?? {}))
      add(state, context, count);
    for (const [context, count] of Object.entries(row.fixed ?? {})) add(state, context, -count);
    for (const move of row.moved ?? []) {
      add(state, contextOf(move.from), -move.count);
      add(state, contextOf(move.to), move.count);
    }
  }
  return state;
}

/**
 * @param {Baseline} baseline
 * @param {(rule: string) => boolean} [include] Which rules to count; every rule by default.
 * @returns {Map<string, number>} The baseline's count per context.
 */
function baselineContexts(baseline, include = () => true) {
  /** @type {Map<string, number>} */
  const contexts = new Map();
  for (const [file, rules] of baseline) {
    for (const [rule, count] of rules) if (include(rule)) add(contexts, contextOf(file), count);
  }
  return contexts;
}

/**
 * @param {Map<string, number>} left
 * @param {Map<string, number>} right
 * @returns {string[]} The contexts whose counts differ, sorted.
 */
function differingContexts(left, right) {
  return [...new Set([...left.keys(), ...right.keys()])]
    .filter((context) => (left.get(context) ?? 0) !== (right.get(context) ?? 0))
    .sort(byText);
}

/**
 * @param {Baseline} baseline
 * @returns {string[]} The rule ids the baseline holds entries of, sorted.
 */
function baselineRules(baseline) {
  return [...new Set([...baseline.values()].flatMap((rules) => [...rules.keys()]))].sort(byText);
}

/** @type {(rows: readonly HistoryRow[]) => Set<string>} */
const rulesBorn = (rows) =>
  new Set(rows.flatMap(({ row }) => (row.born === undefined ? [] : [row.born.rule])));

/**
 * @description S1 and S2: every path of the baseline is tracked, and in its rule's scope.
 * @param {Baseline} baseline
 * @param {ReadonlySet<string>} tracked
 * @param {Exclusions} exclusions
 * @returns {string[]} The verdicts.
 */
function checkBaselinePaths(baseline, tracked, exclusions) {
  /** @type {string[]} */
  const verdicts = [];
  for (const file of [...baseline.keys()].sort(byText)) {
    for (const [rule, count] of baseline.get(file) ?? new Map()) {
      const holds = `${file}: ${BASELINE} counts ${counted(count, `${rule} site`)} in it`;
      const list = exclusions[rule];
      if (!tracked.has(file)) {
        verdicts.push(`${holds}, and git tracks no such file: run "${PRUNE}"`);
      } else if (list === undefined) {
        verdicts.push(`${holds}, a rule the gate holds no scope for`);
      } else if (!ERROR_SCOPE_FILES.some((glob) => matchesGlob(file, glob))) {
        verdicts.push(
          `${holds}, and it has none of the scope's extensions (.ts, .tsx, .mts, .cts)`
        );
      } else {
        const entry = exclusionOf(file, list);
        if (entry !== undefined) {
          verdicts.push(
            `${holds}, and the rule's scope excludes it ("${entry.glob}", ${entry.kind})`
          );
        }
      }
    }
  }
  return verdicts;
}

/**
 * @description S3: the history exists exactly while the baseline holds an `errors/` entry, bears
 *   one birth of each rule with entries and of no rule the gate does not hold, and adds up to the
 *   baseline per context.
 * @param {History} history
 * @param {Baseline} baseline
 * @param {Exclusions} exclusions
 * @returns {string[]} The verdicts.
 */
function checkHistory(history, baseline, exclusions) {
  const entries = [...baseline.values()].reduce((sum, rules) => sum + rules.size, 0);
  if (entries > 0 && !history.exists) {
    return [
      `${HISTORY}: ${BASELINE} holds ${counted(entries, "errors/ entry", "errors/ entries")} and there is no history: record the birth with "${RECORD}"`,
    ];
  }
  if (entries === 0 && history.exists) {
    return [
      `${HISTORY}: the history exists and ${BASELINE} holds no errors/ entry: delete the history in this change`,
    ];
  }
  /** @type {string[]} */
  const verdicts = [];
  /** @type {Map<string, string>} */
  const births = new Map();
  for (const { file, row } of history.rows) {
    if (row.born === undefined) continue;
    const { rule } = row.born;
    const earlier = births.get(rule);
    if (exclusions[rule] === undefined) {
      verdicts.push(`${file}: bears the birth of ${rule}, a rule the gate holds no scope for`);
    } else if (earlier !== undefined) {
      verdicts.push(`${file}: bears the birth of ${rule}, which ${earlier} bears too`);
    } else {
      births.set(rule, file);
    }
  }
  for (const rule of baselineRules(baseline)) {
    if (exclusions[rule] !== undefined && !births.has(rule)) {
      verdicts.push(
        `${rule}: ${BASELINE} holds its entries and no row of the history bears its birth`
      );
    }
  }
  const state = stateOf(history.rows);
  const yielded = baselineContexts(baseline);
  for (const context of differingContexts(state, yielded)) {
    verdicts.push(
      `${context}: the history yields ${counted(state.get(context) ?? 0, "site")} and ${BASELINE} ${String(yielded.get(context) ?? 0)}`
    );
  }
  return verdicts;
}

/**
 * @description S4's rules of a list: every entry matches a tracked file, carries what its kind
 *   claims, and an entry of kind `outside-src` matches no file under a `src` directory.
 * @param {string} rule
 * @param {readonly Exclusion[]} list
 * @param {readonly string[]} tracked
 * @returns {{ verdicts: string[], unread: string[] }}
 */
function checkList(rule, list, tracked) {
  /** @type {string[]} */
  const verdicts = [];
  /** @type {string[]} */
  const unread = [];
  for (const entry of list) {
    const label = `${rule}: the exclusion "${entry.glob}"`;
    /** @type {string[]} */
    let matched;
    try {
      matched = tracked.filter((file) => matchesGlob(file, entry.glob));
    } catch (error) {
      unread.push(`${rule}: ${messageOf(error)}`);
      continue;
    }
    if (matched.length === 0) {
      verdicts.push(`${label} (${entry.kind}) matches no tracked file: remove it`);
      continue;
    }
    if (entry.kind === EXCLUSION_KIND.OUTSIDE_SRC) {
      const inSource = matched.find(isUnderSource);
      if (inSource !== undefined) {
        verdicts.push(
          `${label} is of kind outside-src and matches ${inSource}, a file under a src directory: only a test suffix, a declaration or a whole root may exclude one`
        );
      }
    } else if (entry.kind === EXCLUSION_KIND.TEST_SUFFIX) {
      const plain = matched.find((file) => !TEST_SUFFIX.test(file));
      if (plain !== undefined) {
        verdicts.push(
          `${label} is of kind test-suffix and matches ${plain}, which carries no test suffix`
        );
      }
    } else if (entry.kind === EXCLUSION_KIND.DECLARATION) {
      const plain = matched.find((file) => !DECLARATION.test(file));
      if (plain !== undefined) {
        verdicts.push(
          `${label} is of kind declaration and matches ${plain}, which is no declaration file`
        );
      }
    } else if (entry.kind === EXCLUSION_KIND.WHOLE_ROOT) {
      if (!WHOLE_ROOT.test(entry.glob)) {
        verdicts.push(`${label} is of kind whole-root and is not a root followed by "/**"`);
      }
    } else {
      verdicts.push(
        `${label} has the kind "${String(entry.kind)}", which is none of ${KINDS.join(", ")}`
      );
    }
  }
  return { verdicts, unread };
}

/**
 * @description S4: no JavaScript file lies under a `src` directory outside a root every held
 *   rule's list excludes whole, so no production code hides from the rules by its language.
 * @param {readonly string[]} tracked
 * @param {Exclusions} exclusions
 * @returns {string[]} The verdicts.
 */
function checkJavaScript(tracked, exclusions) {
  const lists = Object.values(exclusions);
  return tracked
    .filter(
      (file) =>
        JAVASCRIPT.test(file) &&
        isUnderSource(file) &&
        lists.some(
          (list) =>
            !list.some(
              (entry) => entry.kind === EXCLUSION_KIND.WHOLE_ROOT && matchesGlob(file, entry.glob)
            )
        )
    )
    .map(
      (file) =>
        `${file}: a JavaScript file under a src directory, which the rule does not read: write it in TypeScript, or exclude its whole root`
    );
}

/**
 * @param {string} file
 * @param {typeof import("typescript")} ts
 * @returns {import("typescript").ScriptKind}
 */
function scriptKindOf(file, ts) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return /\.[mc]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}

/**
 * @description Every module a source file loads by its syntax: static imports and re-exports, an
 *   import-equals of a module, `import(...)` and `require(...)`. A type written in a comment is no
 *   import, since the parser reads comments as comments.
 * @param {typeof import("typescript")} ts
 * @param {string} file
 * @param {string} text
 * @returns {{ line: number, specifier: string | null }[]} Each load with its line; `null` when its
 *   specifier is no string literal.
 */
function importsOf(ts, file, text) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(file, ts)
  );
  /** @type {{ line: number, specifier: string | null }[]} */
  const found = [];
  /** @type {(node: import("typescript").Node) => number} */
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  /** @type {(node: import("typescript").Node | undefined) => string | null} */
  const literalOf = (node) =>
    node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      ? node.text
      : null;
  /** @type {(node: import("typescript").Node) => void} */
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      found.push({ line: lineOf(node), specifier: literalOf(node.moduleSpecifier) });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      found.push({ line: lineOf(node), specifier: literalOf(node.moduleReference.expression) });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      found.push({ line: lineOf(node), specifier: literalOf(node.arguments[0]) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * @description S4: the plugin's package exports its `src`, and every module its `src` loads is a
 *   relative path inside that `src` or one of the built-ins the scope allows
 *   (`ERROR_PLUGIN_BUILTINS`), so no block of the configuration and no entry point reaches a copy
 *   of the rules outside the paths the gate watches.
 * @param {string} root
 * @param {readonly string[]} tracked
 * @returns {{ verdicts: string[], unread: string[] }}
 */
function checkPluginPackage(root, tracked) {
  /** @type {string[]} */
  const verdicts = [];
  /** @type {string[]} */
  const unread = [];
  const manifest = `${PLUGIN.directory}/package.json`;
  try {
    const data = /** @type {unknown} */ (
      JSON.parse(readFileSync(path.join(root, manifest), "utf8"))
    );
    const exported = isObject(data) ? data["exports"] : undefined;
    if (!isDeepStrictEqual(exported, PLUGIN.exports)) {
      verdicts.push(
        `${manifest}: its "exports" is ${JSON.stringify(exported) ?? "absent"}, not ${JSON.stringify(PLUGIN.exports)}`
      );
    }
  } catch (error) {
    unread.push(
      `${manifest} could not be read, so the plugin's entry point was not checked: ${messageOf(error)}`
    );
  }
  const sourceDirectory = `${PLUGIN.directory}/src/`;
  const sources = tracked.filter((file) => file.startsWith(sourceDirectory) && SOURCE.test(file));
  if (sources.length === 0) {
    unread.push(
      `${sourceDirectory} holds no tracked source file, so the plugin's imports were not read`
    );
    return { verdicts, unread };
  }
  /** @type {typeof import("typescript")} */
  let ts;
  try {
    ts = /** @type {typeof import("typescript")} */ (createRequire(import.meta.url)("typescript"));
  } catch (error) {
    unread.push(
      `typescript could not be loaded, so the plugin's imports were not read: ${messageOf(error)}`
    );
    return { verdicts, unread };
  }
  const builtins = ERROR_PLUGIN_BUILTINS.join(", ");
  for (const file of sources) {
    /** @type {string} */
    let text;
    try {
      text = readFileSync(path.join(root, file), "utf8");
    } catch (error) {
      unread.push(`${file} could not be read, so its imports were not read: ${messageOf(error)}`);
      continue;
    }
    for (const { line, specifier } of importsOf(ts, file, text)) {
      const at = `${file}:${String(line)}`;
      if (specifier === null) {
        verdicts.push(
          `${at}: imports a module whose specifier is no string literal, so where it leads cannot be read`
        );
        continue;
      }
      if (ERROR_PLUGIN_BUILTINS.includes(specifier)) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      if (!relative || !target.startsWith(sourceDirectory)) {
        verdicts.push(
          `${at}: imports "${specifier}", which is neither a relative path inside ${PLUGIN.directory}/src nor a built-in the scope allows (${builtins})`
        );
      }
    }
  }
  return { verdicts, unread };
}

/**
 * @param {string} rule
 * @param {Resolution} resolution
 * @param {readonly unknown[]} held
 * @returns {{ kind: string, text: string }[]} Each way the resolution misses the held rule.
 */
function resolutionProblems(rule, resolution, held) {
  if (resolution.ignored) return [{ kind: "ESLint ignores it", text: "ESLint ignores it" }];
  /** @type {{ kind: string, text: string }[]} */
  const problems = [];
  const state = Object.hasOwn(resolution.rules, rule) ? resolution.rules[rule] : undefined;
  if (state === undefined) {
    problems.push({ kind: "the rule is not on", text: "the rule is not on" });
  } else {
    if (state.severity !== 2) {
      const name = SEVERITY_NAMES.get(state.severity) ?? `severity ${String(state.severity)}`;
      problems.push({
        kind: "the rule is not at error",
        text: `the rule is at ${name}, not error`,
      });
    }
    if (!isDeepStrictEqual(state.options, [...held])) {
      problems.push({
        kind: "the rule's options are not the held ones",
        text: `the rule's options are ${JSON.stringify(state.options)}, not the held ${JSON.stringify(held)}`,
      });
    }
  }
  if (!resolution.pluginIsPackage) {
    const text = `the ${PLUGIN.namespace} plugin ESLint resolves is not the object ${PLUGIN.packageName} exports`;
    problems.push({ kind: text, text });
  }
  return problems;
}

/**
 * @description S4: for every tracked file of a rule's scope, ESLint does not ignore it, the rule
 *   is at `error` with exactly the held options, and the plugin is the package's own object. Each
 *   problem names at most twenty files, then counts the rest.
 * @param {readonly string[]} rules
 * @param {Map<string, Set<string>>} scopes Each rule's tracked files of its scope.
 * @param {ResolveRule} resolveRule
 * @param {RuleOptions} options
 * @returns {Promise<{ verdicts: string[], unread: string[] }>}
 */
async function checkResolution(rules, scopes, resolveRule, options) {
  /** @type {Map<string, { rule: string, kind: string, lines: string[] }>} */
  const groups = new Map();
  /** @type {string[]} */
  const unread = [];
  const files = [...new Set([...scopes.values()].flatMap((scope) => [...scope]))].sort(byText);
  for (const file of files) {
    /** @type {Resolution} */
    let resolution;
    try {
      resolution = await resolveRule(file);
    } catch (error) {
      unread.push(`ESLint's configuration could not be resolved for ${file}: ${messageOf(error)}`);
      break;
    }
    for (const rule of rules) {
      if (!(scopes.get(rule)?.has(file) ?? false)) continue;
      for (const { kind, text } of resolutionProblems(rule, resolution, options[rule] ?? [])) {
        const key = `${rule}\0${kind}`;
        const group = groups.get(key) ?? { rule, kind, lines: [] };
        group.lines.push(`${file}: ${rule}: ${text}`);
        groups.set(key, group);
      }
    }
  }
  const verdicts = [...groups.values()].flatMap(({ rule, kind, lines }) =>
    lines.length <= SHOWN_PER_PROBLEM
      ? lines
      : [
          ...lines.slice(0, SHOWN_PER_PROBLEM),
          `${rule}: ${kind} in ${counted(lines.length - SHOWN_PER_PROBLEM, "more file")} of the scope`,
        ]
  );
  return { verdicts, unread };
}

/**
 * @description S5: no file of a scope holds a disable directive that names an `errors/` rule or
 *   names no rule. The scan reads text: a directive in a line or a block comment, its rule list up
 *   to the end of the line or of the block, before ESLint's `--` description separator.
 * @param {string} root
 * @param {readonly string[]} files
 * @returns {{ verdicts: string[], unread: string[] }}
 */
function checkDirectives(root, files) {
  /** @type {string[]} */
  const verdicts = [];
  /** @type {string[]} */
  const unread = [];
  for (const file of files) {
    /** @type {string} */
    let text;
    try {
      text = readFileSync(path.join(root, file), "utf8");
    } catch (error) {
      unread.push(
        `${file} could not be read, so its directives were not read: ${messageOf(error)}`
      );
      continue;
    }
    for (const match of text.matchAll(DIRECTIVE)) {
      const after = match.index + match[0].length;
      const close = match[1] === "//" ? text.indexOf("\n", after) : text.indexOf("*/", after);
      const list = (
        text.slice(after, close === -1 ? text.length : close).split(/\s-{2,}\s/)[0] ?? ""
      )
        .split(/[\s,]+/)
        .map((name) => name.replace(/^\*+|\*+$/g, ""))
        .filter((name) => name !== "");
      const named = list.filter((name) => name.startsWith("errors/"));
      if (list.length > 0 && named.length === 0) continue;
      const line = text.slice(0, match.index).split("\n").length;
      const what = list.length === 0 ? "names no rule" : `names ${named.join(", ")}`;
      verdicts.push(
        `${file}:${String(line)}: an eslint-disable directive that ${what}: no directive turns an errors/ rule off in a file of its scope`
      );
    }
  }
  return { verdicts, unread };
}

/**
 * @description S5: no manifest, hook or workflow lets an unused entry of the baseline pass, and
 *   the root `lint` script is the one the gate holds.
 * @param {string} root
 * @param {readonly string[]} tracked
 * @returns {{ verdicts: string[], unread: string[] }}
 */
function checkLintRun(root, tracked) {
  /** @type {string[]} */
  const verdicts = [];
  /** @type {string[]} */
  const unread = [];
  const carriers = tracked.filter(
    (file) =>
      path.posix.basename(file) === "package.json" ||
      file.startsWith(".husky/") ||
      file.startsWith(".github/workflows/")
  );
  for (const file of carriers) {
    try {
      readFileSync(path.join(root, file), "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (line.includes(PASS_UNPRUNED)) {
            verdicts.push(
              `${file}:${String(index + 1)}: holds "${PASS_UNPRUNED}", which lets an unused entry of ${BASELINE} pass`
            );
          }
        });
    } catch (error) {
      unread.push(`${file} could not be read: ${messageOf(error)}`);
    }
  }
  try {
    const manifest = /** @type {unknown} */ (
      JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
    );
    const scripts = isObject(manifest) ? manifest["scripts"] : undefined;
    const lint = isObject(scripts) ? scripts["lint"] : undefined;
    if (lint !== LINT_SCRIPT) {
      verdicts.push(
        `package.json: its "lint" script is ${JSON.stringify(lint) ?? "absent"}, not "${LINT_SCRIPT}": the lint run must reach the whole tree`
      );
    }
  } catch (error) {
    unread.push(
      `package.json could not be read, so its "lint" script was not checked: ${messageOf(error)}`
    );
  }
  return { verdicts, unread };
}

/**
 * @param {Exclusions} exclusions
 * @param {RuleOptions | undefined} options
 * @returns {string[]} Why the held configuration is not whole.
 */
function heldProblems(exclusions, options) {
  const rules = Object.keys(exclusions);
  /** @type {string[]} */
  const problems = rules
    .filter((rule) => !rule.startsWith("errors/"))
    .map((rule) => `the gate holds a list for ${rule}, which is no errors/ rule`);
  if (options !== undefined) {
    for (const rule of rules) {
      if (options[rule] === undefined)
        problems.push(`the gate holds a list for ${rule} and no options`);
    }
    for (const rule of Object.keys(options)) {
      if (exclusions[rule] === undefined)
        problems.push(`the gate holds options for ${rule} and no list`);
    }
  }
  return problems;
}

/**
 * @param {Git} git
 * @param {readonly string[]} args
 * @returns {{ stdout: string } | { error: string }}
 */
function run(git, args) {
  const result = git(args);
  if (result.status === 0) return { stdout: result.stdout };
  return {
    error: `git ${args.join(" ")} failed: ${result.stderr || `exit ${String(result.status)}`}`,
  };
}

/**
 * @description A file of the base, read through git: `null` when the base does not hold the path,
 *   which is no failure, so an absent file never reads as a broken one.
 * @param {Git} git
 * @param {string} base
 * @param {string} file
 * @returns {{ text: string | null } | { error: string }}
 */
function showAtBase(git, base, file) {
  const listed = run(git, ["ls-tree", "-z", base, "--", file]);
  if ("error" in listed) return listed;
  if (listed.stdout === "") return { text: null };
  const shown = run(git, ["show", `${base}:${file}`]);
  return "error" in shown ? shown : { text: shown.stdout };
}

/**
 * @param {Git} git
 * @param {string} base
 * @param {string} directory
 * @returns {{ files: string[] } | { error: string }} The files the base holds under a directory.
 */
function filesAtBase(git, base, directory) {
  const listed = run(git, ["ls-tree", "-r", "-z", "--name-only", base, "--", `${directory}/`]);
  if ("error" in listed) return listed;
  return {
    files: listed.stdout
      .split("\0")
      .filter((file) => file !== "")
      .sort(byText),
  };
}

/**
 * @param {string} output The output of `git diff -z --name-status -M`.
 * @returns {Change[]}
 */
function parseChanges(output) {
  const tokens = output.split("\0");
  /** @type {Change[]} */
  const changes = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index] ?? "";
    if (status === "") {
      index += 1;
      continue;
    }
    if (status.startsWith("R") || status.startsWith("C")) {
      changes.push({
        status: status[0] ?? "",
        score: Number(status.slice(1)),
        from: tokens[index + 1] ?? "",
        to: tokens[index + 2] ?? "",
      });
      index += 3;
    } else {
      const file = tokens[index + 1] ?? "";
      changes.push({ status: status[0] ?? "", score: 0, from: file, to: file });
      index += 2;
    }
  }
  return changes;
}

/**
 * @description The portals whose catalogs hold `errorCodes` on the base: a directory under `apps/`
 *   with `i18n/routing.ts` and at least one `messages/<locale>.json`, as fitness #51 reads them.
 * @param {Git} git
 * @param {string} base
 * @returns {{ portals: string[] } | { problems: string[] }}
 */
function portalsAtBase(git, base) {
  const listed = filesAtBase(git, base, "apps");
  if ("error" in listed) return { problems: [listed.error] };
  const routed = new Set(
    listed.files.flatMap(
      (file) => /^apps\/([^/]+)\/i18n\/routing\.ts$/.exec(file)?.slice(1, 2) ?? []
    )
  );
  /** @type {Set<string>} */
  const portals = new Set();
  /** @type {string[]} */
  const problems = [];
  for (const file of listed.files) {
    const portal = CATALOG.exec(file)?.[1];
    if (portal === undefined || !routed.has(portal) || portals.has(portal)) continue;
    const shown = showAtBase(git, base, file);
    if ("error" in shown) {
      problems.push(shown.error);
      continue;
    }
    try {
      const catalog = /** @type {unknown} */ (JSON.parse(shown.text ?? ""));
      if (isObject(catalog) && Object.hasOwn(catalog, "errorCodes")) portals.add(portal);
    } catch (error) {
      problems.push(`${base}:${file} is not JSON: ${messageOf(error)}`);
    }
  }
  return problems.length > 0 ? { problems } : { portals: [...portals].sort(byText) };
}

/**
 * @description Reads what the gate compares against: the base's baseline, its history, the
 *   changes git reports from it to `HEAD`, and the portals enrolled on it.
 * @param {Git} git
 * @param {string} base
 * @returns {BaseState | { problems: string[] }}
 */
function readBase(git, base) {
  const suppressions = showAtBase(git, base, BASELINE);
  if ("error" in suppressions) return { problems: [suppressions.error] };
  const parsed =
    suppressions.text === null
      ? { baseline: /** @type {Baseline} */ (new Map()) }
      : parseBaseline(suppressions.text, `${base}:${BASELINE}`);
  if ("error" in parsed) return { problems: [parsed.error] };
  const listed = filesAtBase(git, base, HISTORY);
  if ("error" in listed) return { problems: [listed.error] };
  /** @type {HistoryRow[]} */
  const rows = [];
  /** @type {string[]} */
  const problems = [];
  for (const file of listed.files) {
    const shown = showAtBase(git, base, file);
    if ("error" in shown) {
      problems.push(shown.error);
      continue;
    }
    const row = parseRow(file, shown.text ?? "", `${base}:${file}`);
    if ("problem" in row) problems.push(row.problem);
    else rows.push(row.row);
  }
  const diffed = run(git, ["diff", "-z", "--name-status", "-M", base, "HEAD"]);
  if ("error" in diffed) problems.push(diffed.error);
  const portals = portalsAtBase(git, base);
  if ("problems" in portals) problems.push(...portals.problems);
  if (problems.length > 0 || "error" in diffed || "problems" in portals) return { problems };
  return {
    ref: base,
    baseline: parsed.baseline,
    rows,
    changes: parseChanges(diffed.stdout),
    portals: portals.portals,
  };
}

/**
 * @description S6a and the measures every later check reads: the base's baseline mapped through
 *   the renames to head paths, and, over the rules the base's history bore, each path's rises and
 *   falls, each context's total, and the move each renamed file owes when it crossed two contexts.
 * @param {BaseState} baseState
 * @param {Baseline} head The head's baseline.
 * @returns {Difference}
 */
function differenceOf(baseState, head) {
  /** @type {Map<string, { to: string, unchanged: boolean }>} */
  const renames = new Map(
    baseState.changes
      .filter((change) => change.status === "R")
      .map((change) => [change.from, { to: change.to, unchanged: change.score === 100 }])
  );
  /** @type {Baseline} */
  const mapped = new Map();
  /** @type {Map<string, string>} */
  const sourceOf = new Map();
  for (const [file, rules] of baseState.baseline) {
    const to = renames.get(file)?.to ?? file;
    const into = mapped.get(to) ?? new Map();
    for (const [rule, count] of rules) into.set(rule, (into.get(rule) ?? 0) + count);
    mapped.set(to, into);
    sourceOf.set(to, file);
  }
  const bornOnBase = rulesBorn(baseState.rows);
  const newRules = baselineRules(head).filter((rule) => !bornOnBase.has(rule));
  /** @type {Difference["rises"]} */
  const rises = [];
  /** @type {Difference["falls"]} */
  const falls = [];
  /** @type {Map<string, number>} */
  const risesOf = new Map();
  /** @type {Map<string, number>} */
  const fallsOf = new Map();
  const paths = [...new Set([...mapped.keys(), ...head.keys()])].sort(byText);
  for (const file of paths) {
    for (const rule of [...bornOnBase].sort(byText)) {
      const base = mapped.get(file)?.get(rule) ?? 0;
      const now = head.get(file)?.get(rule) ?? 0;
      if (now > base) {
        rises.push({ file, rule, base, head: now });
        add(risesOf, file, now - base);
      } else if (base > now) {
        falls.push({ file, rule, base, head: now });
        add(fallsOf, file, base - now);
      }
    }
  }
  const born = (/** @type {string} */ rule) => bornOnBase.has(rule);
  const totalsDiffer = differingContexts(
    baselineContexts(baseState.baseline, born),
    baselineContexts(head, born)
  );
  /** @type {Move[]} */
  const renameMoves = [];
  for (const [from, { to }] of renames) {
    if (contextOf(from) === contextOf(to)) continue;
    let count = 0;
    for (const [rule, sites] of baseState.baseline.get(from) ?? new Map())
      if (born(rule)) count += sites;
    if (count > 0) renameMoves.push({ from, to, count });
  }
  return {
    renames,
    sourceOf,
    mapped,
    bornOnBase,
    newRules,
    rises,
    falls,
    risesOf,
    fallsOf,
    totalsDiffer,
    renameMoves: sortedMoves(renameMoves),
  };
}

/** @type {(difference: Difference) => boolean} */
const differs = (difference) =>
  difference.rises.length > 0 ||
  difference.falls.length > 0 ||
  difference.totalsDiffer.length > 0 ||
  difference.newRules.length > 0;

/**
 * @description Splits a row's moves into the moves of renamed files, which follow from what git
 *   reports, and the moves between two files, which only the row's author can state.
 * @param {readonly Move[]} moves
 * @param {Difference} difference
 * @returns {{ renameMoves: Move[], fileMoves: Move[] }}
 */
function splitMoves(moves, difference) {
  /** @type {(move: Move) => boolean} */
  const isRename = (move) => difference.renames.get(move.from)?.to === move.to;
  return {
    renameMoves: sortedMoves(moves.filter(isRename)),
    fileMoves: sortedMoves(moves.filter((move) => !isRename(move))),
  };
}

/*
 * A move between two files of one context is the only way a count changes files without a rename
 * git reports. The three functions below are everything that reads one: without them, every move
 * that is not a rename is refused and nothing else changes.
 */

/**
 * @description The ways the moves between two files break their rules: each is inside one context,
 *   between two files that are no rename, out of files that fell by at least what moves out of
 *   them, and into files whose rise is exactly what moves in.
 * @param {readonly Move[]} fileMoves
 * @param {Difference} difference
 * @returns {string[]} The problems, each naming the move.
 */
function fileMoveProblems(fileMoves, difference) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, number>} */
  const outOf = new Map();
  for (const move of fileMoves) {
    const what = `the move of ${counted(move.count, "site")} from ${move.from} to ${move.to}`;
    if (contextOf(move.from) !== contextOf(move.to)) {
      problems.push(
        `${what} crosses two contexts (${contextOf(move.from)}, ${contextOf(move.to)}): only a rename git reports moves sites across contexts`
      );
    }
    add(outOf, move.from, move.count);
  }
  for (const [from, count] of outOf) {
    const fell = difference.fallsOf.get(from) ?? 0;
    if (count > fell) {
      problems.push(
        `${counted(count, "site")} move out of ${from}, whose count fell by ${String(fell)} against the base`
      );
    }
  }
  // A target that rose by less than moves into it; one that rose by more is a rise S6 names.
  for (const [to, moved] of [...fileMovesInto(fileMoves)].sort(([left], [right]) =>
    byText(left, right)
  )) {
    const rose = difference.risesOf.get(to) ?? 0;
    if (moved > rose) {
      problems.push(
        `${counted(moved, "site")} move into ${to}, whose count rose by ${String(rose)} against the base`
      );
    }
  }
  return problems;
}

/**
 * @param {readonly Move[]} fileMoves
 * @returns {Map<string, number>} Each target's count moved in.
 */
function fileMovesInto(fileMoves) {
  /** @type {Map<string, number>} */
  const into = new Map();
  for (const move of fileMoves) add(into, move.to, move.count);
  return into;
}

/**
 * @param {readonly Move[]} fileMoves
 * @returns {Map<string, number>} Each context's count moved out of a file of it.
 */
function fileMovesOut(fileMoves) {
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const move of fileMoves) add(out, contextOf(move.from), move.count);
  return out;
}

/**
 * @description The row the difference yields, given the moves between two files its author
 *   states: `fixed` per context is what fell there minus what moved out of a file of it, and
 *   `moved` holds one move per renamed file that crossed two contexts, with the file's whole count,
 *   and the stated moves. A stated move that breaks its rules is a problem; a rise no stated move
 *   explains is S6's. Since no file moves out more than fell in it, no context's `fixed` is
 *   negative.
 * @param {Difference} difference
 * @param {readonly Move[]} fileMoves
 * @returns {{ row: Row | null, problems: string[] }} The row, `null` when it would hold nothing,
 *   and why it cannot be the row.
 */
function expectedRow(difference, fileMoves) {
  const problems = fileMoveProblems(fileMoves, difference);
  /** @type {Map<string, number>} */
  const fixed = new Map();
  for (const [file, count] of difference.fallsOf) add(fixed, contextOf(file), count);
  for (const [context, count] of fileMovesOut(fileMoves)) add(fixed, context, -count);
  const moved = sortedMoves([...difference.renameMoves, ...fileMoves]);
  const fixedObject = sortedObject(new Map([...fixed].filter(([, count]) => count > 0)));
  /** @type {Row} */
  const row = { version: 1 };
  if (Object.keys(fixedObject).length > 0) row.fixed = fixedObject;
  if (moved.length > 0) row.moved = moved;
  return { row: row.fixed === undefined && row.moved === undefined ? null : row, problems };
}

/**
 * @param {Difference} difference
 * @param {readonly Move[]} fileMoves
 * @returns {string[]} S6: each rise that is neither a birth nor exactly what the moves between
 *   two files bring into its path.
 */
function unexplainedRises(difference, fileMoves) {
  const into = fileMovesInto(fileMoves);
  return difference.rises
    .filter((rise) => (into.get(rise.file) ?? 0) !== (difference.risesOf.get(rise.file) ?? 0))
    .map(riseLine);
}

/**
 * @param {{ file: string, rule: string, base: number, head: number }} rise
 * @returns {string} The verdict on a count that rose against the base.
 */
function riseLine({ file, rule, base, head }) {
  return (
    `${file}: ${rule} counts ${counted(head, "site")}, and the base counts ${String(base)}: a count never rises against the base; ` +
    `fix the sites the change added and run "${PRUNE}", or record their move from another file of its context with --moved <from>:${file}:<count>`
  );
}

/**
 * @description S6 to S10 against a base: no count rises, a count falls only where its file
 *   changed, a renamed file stays in scope and an enrolled portal stays enrolled, a change of the
 *   rule moves no count, and the history gains exactly the row the difference yields.
 * @param {object} input
 * @param {string} input.root
 * @param {readonly string[]} input.tracked
 * @param {Baseline} input.baseline The head's baseline.
 * @param {History} input.history The head's history.
 * @param {BaseState} input.baseState
 * @param {Exclusions} input.exclusions
 * @returns {{ verdicts: string[], unread: string[] }}
 */
function checkAgainstBase({ root, tracked, baseline, history, baseState, exclusions }) {
  /** @type {string[]} */
  const verdicts = [];
  /** @type {string[]} */
  const unread = [];
  const difference = differenceOf(baseState, baseline);
  const baseRows = new Map(baseState.rows.map((row) => [row.file, row]));
  const newRows = history.rows.filter((row) => !baseRows.has(row.file));
  const { fileMoves } = splitMoves(
    newRows.flatMap(({ row }) => row.moved ?? []),
    difference
  );

  // S6: a rise is the birth of a rule, or exactly what the row's moves between two files bring in.
  verdicts.push(...unexplainedRises(difference, fileMoves));

  // S7: a count falls where git reports a change of the file's content, or its deletion.
  const changed = new Set(
    baseState.changes
      .filter(
        (change) =>
          change.status === "M" ||
          change.status === "T" ||
          (change.status === "R" && change.score < 100)
      )
      .map((change) => change.to)
  );
  const deleted = new Set(
    baseState.changes.filter((change) => change.status === "D").map((change) => change.from)
  );
  for (const fall of difference.falls) {
    const source = difference.sourceOf.get(fall.file) ?? fall.file;
    if (changed.has(fall.file) || deleted.has(source)) continue;
    const how =
      source === fall.file
        ? "git reports no change of its content"
        : `git reports ${source} renamed to it with its content unchanged`;
    verdicts.push(
      `${fall.file}: ${fall.rule} fell from ${String(fall.base)} to ${String(fall.head)} against the base, and ${how}: a count falls only when its file changes`
    );
  }

  // S8: a renamed file of the base's baseline stays in its rule's scope.
  for (const [from, { to }] of difference.renames) {
    for (const [rule, count] of baseState.baseline.get(from) ?? new Map()) {
      const list = exclusions[rule];
      if (list === undefined || isInErrorScope(to, list)) continue;
      const entry = exclusionOf(to, list);
      const why = entry === undefined ? "" : ` ("${entry.glob}", ${entry.kind})`;
      verdicts.push(
        `${from}: renamed to ${to}, which the scope of ${rule} excludes${why}, while the base counts ${counted(count, "site")} in it`
      );
    }
  }
  // S8: a portal enrolled on the base stays enrolled in every catalog it holds on the head.
  for (const portal of baseState.portals) {
    const catalogs = tracked.filter((file) => CATALOG.exec(file)?.[1] === portal);
    if (catalogs.length === 0) {
      verdicts.push(
        `apps/${portal}: its catalogs hold "errorCodes" on the base, and the head holds none of its catalogs`
      );
    }
    for (const file of catalogs) {
      try {
        const catalog = /** @type {unknown} */ (
          JSON.parse(readFileSync(path.join(root, file), "utf8"))
        );
        if (!isObject(catalog) || !Object.hasOwn(catalog, "errorCodes")) {
          verdicts.push(
            `${file}: holds no "errorCodes" while the portal's catalogs hold it on the base: a portal never leaves the registry's check by removing its namespace`
          );
        }
      } catch (error) {
        unread.push(`${file} could not be read as JSON: ${messageOf(error)}`);
      }
    }
  }

  // S9: a change of the rule's sources and a change of a count never share a change.
  const ruleChange = [...new Set(baseState.changes.flatMap((change) => [change.from, change.to]))]
    .filter((file) =>
      RULE_SOURCES.some((source) =>
        source.endsWith("/") ? file.startsWith(source) : file === source
      )
    )
    .sort(byText)[0];
  if (ruleChange !== undefined) {
    for (const entry of [...difference.rises, ...difference.falls]) {
      verdicts.push(
        `${entry.file}: ${entry.rule} counts ${String(entry.head)} against the base's ${String(entry.base)}, in a change that also changes ${ruleChange}: a change of the rule and a change of a count never share a change`
      );
    }
  }

  // S10: the base's rows stay as they are, and the head adds the one row the difference yields.
  for (const [file, baseRow] of baseRows) {
    /** @type {string | null} */
    let text = null;
    try {
      text = readFileSync(path.join(root, file), "utf8");
    } catch (error) {
      if (!isMissing(error)) unread.push(`${file} could not be read: ${messageOf(error)}`);
    }
    if (text === null)
      verdicts.push(
        `${file}: a row of the base's history, deleted on the head: a row is never deleted`
      );
    else if (text !== baseRow.text)
      verdicts.push(
        `${file}: a row of the base's history, edited on the head: a row is never rewritten`
      );
  }
  verdicts.push(...newRowProblems(newRows, difference, baseline, baseState.ref));
  return { verdicts, unread };
}

/**
 * @description S10's judgment of the rows the head adds: exactly one when anything differs, none
 *   otherwise, and that one what the difference yields.
 * @param {readonly HistoryRow[]} newRows
 * @param {Difference} difference
 * @param {Baseline} head
 * @param {string} base
 * @returns {string[]} The verdicts.
 */
function newRowProblems(newRows, difference, head, base) {
  const files = newRows.map((row) => row.file);
  if (!differs(difference)) {
    return files.map(
      (file) => `${file}: a row the head adds while no count differs from the base: delete it`
    );
  }
  if (newRows.length === 0) {
    return [
      `${HISTORY}: the counts differ from the base and the head adds no row: record it with "${RECORD} --base ${base}"`,
    ];
  }
  if (newRows.length > 1) {
    return [
      `${HISTORY}: the head adds ${String(newRows.length)} rows against the base (${files.join(", ")}): a change adds one`,
    ];
  }
  const [{ file, row }] = /** @type {[HistoryRow]} */ (newRows);
  const yielded = rowYielded(difference, head, splitMoves(row.moved ?? [], difference).fileMoves);
  if ("problem" in yielded) return [`${file}: ${yielded.problem}`];
  const problems = yielded.problems.map((problem) => `${file}: ${problem}`);
  if (problems.length > 0) return problems;
  if (yielded.row.born !== undefined) {
    if (!isDeepStrictEqual(row, yielded.row)) {
      return [
        `${file}: is ${JSON.stringify(row)}, and the birth the head's baseline yields is ${JSON.stringify(yielded.row)}`,
      ];
    }
    return [];
  }
  /** @type {string[]} */
  const verdicts = [];
  if (!isDeepStrictEqual(row.fixed ?? {}, yielded.row.fixed ?? {})) {
    verdicts.push(
      `${file}: its "fixed" is ${JSON.stringify(row.fixed ?? {})}, and the difference with the base yields ${JSON.stringify(yielded.row.fixed ?? {})}`
    );
  }
  const stated = splitMoves(row.moved ?? [], difference).renameMoves;
  if (!isDeepStrictEqual(stated, difference.renameMoves)) {
    verdicts.push(
      `${file}: its moves of renamed files are ${JSON.stringify(stated)}, and the renames across contexts git reports yield ${JSON.stringify(difference.renameMoves)}`
    );
  }
  return verdicts;
}

/**
 * @description The one row a difference yields: the birth of the one rule born, alone, or the row
 *   of fixed and moved sites.
 * @param {Difference} difference
 * @param {Baseline} head The head's baseline.
 * @param {readonly Move[]} fileMoves The moves between two files the row's author states.
 * @returns {{ row: Row, problems: string[] } | { problem: string }}
 */
function rowYielded(difference, head, fileMoves) {
  const [rule, second] = difference.newRules;
  if (second !== undefined) {
    return {
      problem: `${joinAnd(difference.newRules)} are each born against the base: a row bears one birth, so each rule is born by its own change`,
    };
  }
  if (rule !== undefined) {
    const others =
      difference.rises.length +
      difference.falls.length +
      difference.totalsDiffer.length +
      difference.renameMoves.length;
    if (others > 0 || fileMoves.length > 0) {
      return {
        problem: `${rule} is born against the base beside other changes of counts: a rule is born by its own change`,
      };
    }
    const contexts = sortedObject(baselineContexts(head, (id) => id === rule));
    return { row: { version: 1, born: { rule, contexts } }, problems: [] };
  }
  const expected = expectedRow(difference, fileMoves);
  return { row: expected.row ?? { version: 1 }, problems: expected.problems };
}

/** @type {(lines: readonly string[]) => Outcome} */
const unreadOutcome = (lines) => ({
  exitCode: EXIT.UNREAD,
  stdout: [],
  stderr: lines.map((line) => PREFIX + line),
});

/**
 * @param {Git} git
 * @param {string} base
 * @returns {string | null} Why the base cannot be resolved, or `null`.
 */
function baseProblem(git, base) {
  const resolved = git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  if (resolved.status === 0) return null;
  return `the base "${base}" could not be resolved: ${resolved.stderr || `git rev-parse exited ${String(resolved.status)}`}`;
}

/**
 * @typedef {object} Inputs What every mode reads before it judges.
 * @property {Baseline} baseline
 * @property {History} history
 * @property {BaseState | undefined} baseState
 */

/**
 * @param {string} root
 * @param {Git} git
 * @param {string | undefined} base
 * @returns {Inputs | { problems: string[] }}
 */
function readInputs(root, git, base) {
  const read = readBaseline(root);
  if ("error" in read) return { problems: [read.error] };
  const history = readHistory(root);
  if (history.problems.length > 0) return { problems: history.problems };
  if (base === undefined) return { baseline: read.baseline, history, baseState: undefined };
  const unresolved = baseProblem(git, base);
  if (unresolved !== null) return { problems: [unresolved] };
  const baseState = readBase(git, base);
  if ("problems" in baseState) return { problems: baseState.problems };
  return { baseline: read.baseline, history, baseState };
}

/**
 * @description Runs every check over a repository root. Everything it reads lives under `root`,
 *   in what `git` lists and in what `resolveRule` answers, so a suite drives it on planted trees.
 * @param {object} input
 * @param {string} input.root The repository root.
 * @param {Git} input.git Runs git in the root.
 * @param {ResolveRule} input.resolveRule Answers what ESLint resolves for a path.
 * @param {Exclusions} [input.exclusions] Each held rule's list; the scope module's by default.
 * @param {RuleOptions} [input.options] Each held rule's options; the scope module's by default.
 * @param {string} [input.base] The base S6 to S10 compare against; with none they are skipped.
 * @returns {Promise<Outcome>} 0 clean, 1 a verdict, 3 an input that could not be read.
 */
export async function runGate({
  root,
  git,
  resolveRule,
  exclusions = ERROR_SCOPE_EXCLUSIONS,
  options = ERROR_RULE_OPTIONS,
  base,
}) {
  const listed = listTracked(git);
  if ("error" in listed) return unreadOutcome([listed.error]);
  const held = heldProblems(exclusions, options);
  if (held.length > 0) return unreadOutcome(held);
  const inputs = readInputs(root, git, base);
  if ("problems" in inputs) return unreadOutcome(inputs.problems);
  const { baseline, history, baseState } = inputs;
  const tracked = listed.files;
  const rules = Object.keys(exclusions).sort(byText);

  /** @type {string[]} */
  const verdicts = [
    ...checkBaselinePaths(baseline, new Set(tracked), exclusions),
    ...checkHistory(history, baseline, exclusions),
  ];
  /** @type {string[]} */
  const unread = [];
  /** @type {(outcome: { verdicts: string[], unread: string[] }) => void} */
  const collect = (outcome) => {
    verdicts.push(...outcome.verdicts);
    unread.push(...outcome.unread);
  };
  for (const rule of rules) collect(checkList(rule, exclusions[rule] ?? [], tracked));
  if (unread.length > 0) return unreadOutcome([...unread, ...verdicts]);
  verdicts.push(...checkJavaScript(tracked, exclusions));
  collect(checkPluginPackage(root, tracked));

  /** @type {Map<string, Set<string>>} */
  const scopes = new Map(
    rules.map((rule) => [
      rule,
      new Set(tracked.filter((file) => isInErrorScope(file, exclusions[rule] ?? []))),
    ])
  );
  collect(await checkResolution(rules, scopes, resolveRule, options));
  const scoped = [...new Set([...scopes.values()].flatMap((scope) => [...scope]))].sort(byText);
  collect(checkDirectives(root, scoped));
  collect(checkLintRun(root, tracked));
  if (baseState !== undefined) {
    collect(checkAgainstBase({ root, tracked, baseline, history, baseState, exclusions }));
  }

  if (unread.length > 0) return unreadOutcome([...unread, ...verdicts]);
  if (verdicts.length > 0) {
    return { exitCode: EXIT.VERDICT, stdout: [], stderr: verdicts.map((line) => PREFIX + line) };
  }
  const contexts = [...baselineContexts(baseline).values()].filter((count) => count > 0);
  const total = contexts.reduce((sum, count) => sum + count, 0);
  return {
    exitCode: EXIT.CLEAN,
    stdout: [
      `${PREFIX}PASS`,
      `${PREFIX}${counted(total, "site")} in ${counted(contexts.length, "context")}`,
      `${PREFIX}base: ${base ?? "none (S6 to S10 skipped)"}`,
    ],
    stderr: [],
  };
}

/**
 * @description Writes the one row of the history a change yields, and never rewrites a row. With
 *   no base it is the birth of the one rule that has entries and no birth, when that birth is all
 *   that differs between the history and the baseline. Against a base it is what the difference
 *   yields (S10): the birth of the one rule born, alone, or `fixed` per context with the moves of
 *   renamed files that crossed two contexts and the moves between two files given in `moves`. It
 *   refuses when nothing differs, when the head already adds a row against the base, when two
 *   rules await their birth, when a rule of the baseline is not held, and when the row would break
 *   a rule of S6 or S10.
 * @param {object} input
 * @param {string} input.root The repository root.
 * @param {Git} input.git Runs git in the root.
 * @param {string} input.date The row's date, `YYYY-MM-DD`; the gate never reads the clock.
 * @param {string} input.slug The row's slug.
 * @param {Exclusions} [input.exclusions] Each held rule's list; the scope module's by default.
 * @param {string} [input.base] The base the row is the difference with.
 * @param {readonly Move[]} [input.moves] The moves between two files of one context.
 * @returns {Outcome} 0 when the row was written, 1 a refusal, 3 an input that could not be read.
 */
export function recordRow({
  root,
  git,
  date,
  slug,
  exclusions = ERROR_SCOPE_EXCLUSIONS,
  base,
  moves = [],
}) {
  const held = heldProblems(exclusions, undefined);
  if (held.length > 0) return unreadOutcome(held);
  const inputs = readInputs(root, git, base);
  if ("problems" in inputs) return unreadOutcome(inputs.problems);
  const { baseline, history, baseState } = inputs;
  /** @type {(lines: readonly string[]) => Outcome} */
  const refuse = (lines) => ({
    exitCode: EXIT.VERDICT,
    stdout: [],
    stderr: lines.map((line) => PREFIX + line),
  });
  const target = `${HISTORY}/${date}-${slug}.json`;
  if (existsSync(path.join(root, target))) {
    return refuse([`${target} already exists: a row is never rewritten, so choose another slug`]);
  }
  const rules = baselineRules(baseline);
  const unheld = rules.filter((rule) => exclusions[rule] === undefined);
  if (unheld.length > 0) {
    return refuse([
      `${BASELINE} counts sites of ${joinAnd(unheld)}, a rule the gate holds no scope for, so its birth cannot be recorded`,
    ]);
  }
  /** @type {Row} */
  let row;
  if (baseState === undefined) {
    if (moves.length > 0)
      return refuse(["a move is recorded against a base: give --base, or FITNESS_BASE_REF"]);
    const yielded = birthWithoutBase(baseline, history);
    if ("refusal" in yielded) return refuse([yielded.refusal]);
    row = yielded.row;
  } else {
    const added = history.rows.filter(
      (entry) => !baseState.rows.some((baseRow) => baseRow.file === entry.file)
    );
    if (added.length > 0) {
      return refuse([
        `the head already adds ${added.map((entry) => entry.file).join(", ")} against the base: a change adds one row, so delete it and record again`,
      ]);
    }
    const difference = differenceOf(baseState, baseline);
    if (!differs(difference)) {
      return refuse([
        `nothing differs from the base ${baseState.ref}, so there is no row to record`,
      ]);
    }
    const { renameMoves, fileMoves } = splitMoves(moves, difference);
    if (renameMoves.length > 0) {
      return refuse(
        renameMoves.map(
          (move) =>
            `${move.from} is renamed to ${move.to}: the move of a renamed file is read from git, so it is not given`
        )
      );
    }
    const yielded = rowYielded(difference, baseline, fileMoves);
    if ("problem" in yielded) return refuse([yielded.problem]);
    const problems = [...unexplainedRises(difference, fileMoves), ...yielded.problems];
    if (problems.length > 0) return refuse(problems);
    row = yielded.row;
  }
  mkdirSync(path.join(root, HISTORY), { recursive: true });
  writeFileSync(path.join(root, target), `${JSON.stringify(row, null, 2)}\n`, { flag: "wx" });
  return {
    exitCode: EXIT.CLEAN,
    stdout: [`${PREFIX}recorded ${target}: ${describeRow(row)}`],
    stderr: [],
  };
}

/**
 * @param {Baseline} baseline
 * @param {History} history
 * @returns {{ row: Row } | { refusal: string }} The birth the history and the baseline yield.
 */
function birthWithoutBase(baseline, history) {
  const born = rulesBorn(history.rows);
  const awaiting = baselineRules(baseline).filter((rule) => !born.has(rule));
  if (awaiting.length > 1) {
    return {
      refusal: `${joinAnd(awaiting)} each await their birth: a row bears one birth, so each rule is born by its own change`,
    };
  }
  const [rule] = awaiting;
  const birth = rule === undefined ? new Map() : baselineContexts(baseline, (id) => id === rule);
  const state = stateOf(history.rows);
  for (const [context, count] of birth) add(state, context, count);
  const differing = differingContexts(state, baselineContexts(baseline));
  if (differing.length > 0) {
    const beyond =
      rule === undefined ? "and no rule awaits its birth" : `beyond the birth of ${rule}`;
    return {
      refusal: `the history and ${BASELINE} differ (${differing.join(", ")}) ${beyond}, so the row is no birth: it is written against a base`,
    };
  }
  if (rule === undefined) {
    return {
      refusal: `nothing differs: the history yields what ${BASELINE} holds, so there is no row to record`,
    };
  }
  return { row: { version: 1, born: { rule, contexts: sortedObject(birth) } } };
}

/**
 * @param {Row} row
 * @returns {string} What a row records, in a line.
 */
function describeRow(row) {
  if (row.born !== undefined) {
    const counts = Object.values(row.born.contexts);
    const total = counts.reduce((sum, count) => sum + count, 0);
    return `the birth of ${row.born.rule}, ${counted(total, "site")} in ${counted(counts.length, "context")}`;
  }
  const fixed = Object.values(row.fixed ?? {}).reduce((sum, count) => sum + count, 0);
  return `${counted(fixed, "site")} fixed in ${counted(Object.keys(row.fixed ?? {}).length, "context")}, ${counted((row.moved ?? []).length, "move")}`;
}

/**
 * @description The `--stalled` mode: whether the list of existing error sites stopped shrinking. It
 *   reads the baseline and the history from the root's disk and nothing else. The list stalls when
 *   it is above zero and its newest row, by the date in the row's name, is dated `days` or more days
 *   before today, the UTC date of `now`; a stalled list is then reminded through `gh`, when given.
 * @param {object} input
 * @param {string} input.root The repository root.
 * @param {number} input.days The window, in whole days.
 * @param {Date} input.now The instant the run reads as now.
 * @param {Gh} [input.gh] Runs GitHub's CLI. Given (`--remind`), a stalled list keeps its issue
 *   through it; absent, the mode calls no GitHub API.
 * @returns {Outcome} 0 not stalled, 1 stalled, 3 an input that could not be read.
 */
export function checkStall({ root, days, now, gh }) {
  const read = readBaseline(root);
  if ("error" in read) return unreadOutcome([read.error]);
  const history = readHistory(root);
  if (history.problems.length > 0) return unreadOutcome(history.problems);
  const contexts = [...baselineContexts(read.baseline)].sort(([left], [right]) =>
    byText(left, right)
  );
  const total = contexts.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) {
    return {
      exitCode: EXIT.CLEAN,
      stdout: [`${PREFIX}not stalled: the list of existing error sites is empty`],
      stderr: [],
    };
  }
  const summary = `${counted(total, "site")} in ${counted(contexts.length, "context")}`;
  // The rows are sorted by file, and a row's name starts with its date: the last is the newest.
  const newest = history.rows.at(-1);
  if (newest === undefined) {
    return unreadOutcome([
      `${HISTORY} ${history.exists ? "holds no row" : "does not exist"}, so the list of ${counted(total, "site")} cannot be dated: a list above zero is dated by the rows of its history`,
    ]);
  }
  const date = path.posix.basename(newest.file).slice(0, "YYYY-MM-DD".length);
  const today = now.toISOString().slice(0, "YYYY-MM-DD".length);
  const elapsed = (Date.parse(today) - Date.parse(date)) / DAY_MS;
  if (elapsed < 0) {
    return unreadOutcome([
      `the newest history row, ${newest.file}, is dated ${date}, after today, ${today} (UTC): a row is dated the day it is recorded, so the window cannot be read from it`,
    ]);
  }
  if (elapsed < days) {
    return {
      exitCode: EXIT.CLEAN,
      stdout: [
        `${PREFIX}not stalled: the newest history row, ${newest.file}, is dated ${date}, ${counted(elapsed, "day")} before today, ${today} (UTC), inside the ${String(days)}-day window`,
        `${PREFIX}${summary}`,
      ],
      stderr: [],
    };
  }
  const verdicts = [
    `STALLED: no history row was added in the last ${counted(days, "day")}: the newest, ${newest.file}, is dated ${date}, ${counted(elapsed, "day")} before today, ${today} (UTC)`,
    summary,
    ...contexts.map(([context, count]) => `${context}: ${counted(count, "site")}`),
  ];
  /** @type {string[]} */
  const log = [];
  /** @type {string[]} */
  const unread = [];
  if (gh !== undefined) {
    const counts = contexts.map(([context, count]) => `${context}: ${String(count)}`).join(", ");
    const facts = `The list of existing error sites holds ${summary} (${counts}), and the newest row of ${HISTORY}/ is dated ${date}: no row was added in the last ${counted(days, "day")} (today is ${today}, UTC).`;
    const body =
      `${facts}\n\nSweep the next context: convert its sites to the registry, prune ` +
      `\`${BASELINE}\` with \`${PRUNE}\` and record the change with \`${RECORD}\`; or record the ` +
      `Maintainer's decision on the pace in this issue.\n\nOpened by ` +
      `scripts/testing/error-sites-gate.mjs --stalled (workflow error-sites-stall.yml, daily). It ` +
      `comments here once a day while the list stalls, and reopens this issue if it is closed ` +
      `while the list still stalls. The decision: \`docs/technical/ADR-0047-central-error-system.md\`.`;
    const reminder = {
      title: STALL_ISSUE.title,
      body,
      comment: `Still stalled on ${today}: ${facts}`,
    };
    try {
      remindIssues({ gh, label: STALL_ISSUE.label, reminders: [reminder], today, log });
    } catch (error) {
      unread.push(`GitHub: ${messageOf(error)}`);
    }
  }
  return {
    exitCode: unread.length > 0 ? EXIT.UNREAD : EXIT.VERDICT,
    stdout: log.map((entry) => `${PREFIX}remind: ${entry}`),
    stderr: [...verdicts, ...unread].map((line) => PREFIX + line),
  };
}

/**
 * @typedef {object} Arguments
 * @property {boolean} record
 * @property {boolean} remind
 * @property {string} [root]
 * @property {string} [base]
 * @property {string} [date]
 * @property {string} [slug]
 * @property {number} [days] The window of `--stalled`, present exactly when it is given.
 * @property {Move[]} moves
 */

/**
 * @param {readonly string[]} argv The arguments after the script.
 * @returns {Arguments | null} The arguments, or `null` on a usage error.
 */
function parseArguments(argv) {
  /** @type {Arguments} */
  const options = { record: false, remind: false, moves: [] };
  let stalled = false;
  /** @type {Record<string, "root" | "base" | "date" | "slug">} */
  const valued = { "--root": "root", "--base": "base", "--date": "date", "--slug": "slug" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    const key = valued[argument];
    const value = argv[index + 1];
    if (argument === "--record" && !options.record) {
      options.record = true;
      continue;
    }
    if (argument === "--stalled" && !stalled) {
      stalled = true;
      continue;
    }
    if (argument === "--remind" && !options.remind) {
      options.remind = true;
      continue;
    }
    if (
      (key === undefined && argument !== "--moved" && argument !== "--days") ||
      value === undefined ||
      value === "" ||
      value.startsWith("--")
    ) {
      return null;
    }
    index += 1;
    if (argument === "--moved") {
      const move = MOVE_ARGUMENT.exec(value);
      if (move === null || move[1] === move[2]) return null;
      options.moves.push({ from: move[1] ?? "", to: move[2] ?? "", count: Number(move[3]) });
    } else if (argument === "--days") {
      if (options.days !== undefined || !DAYS.test(value) || !isPositiveInteger(Number(value))) {
        return null;
      }
      options.days = Number(value);
    } else if (key !== undefined && options[key] === undefined) {
      options[key] = key === "root" ? path.resolve(value) : value;
    } else {
      return null;
    }
  }
  const dated =
    options.date !== undefined || options.slug !== undefined || options.moves.length > 0;
  if (
    options.record !== dated ||
    (options.record && (options.date === undefined || options.slug === undefined))
  ) {
    return null;
  }
  if (options.date !== undefined && !isCalendarDate(options.date)) return null;
  if (options.slug !== undefined && !SLUG.test(options.slug)) return null;
  // `--stalled` reads no base and writes no row; `--days` and `--remind` mean nothing without it.
  if (stalled !== (options.days !== undefined) || (options.remind && !stalled)) return null;
  if (stalled && (options.record || options.base !== undefined)) return null;
  return options;
}

/**
 * @param {readonly string[]} argv
 * @param {NodeJS.ProcessEnv} environment
 * @returns {Promise<Outcome>}
 */
async function main(argv, environment) {
  const options = parseArguments(argv);
  if (options === null) return { exitCode: EXIT.USAGE, stdout: [], stderr: [USAGE] };
  const root = options.root ?? DEFAULT_ROOT;
  if (options.days !== undefined) {
    const remind = options.remind ? { gh: createGh() } : {};
    return checkStall({ root, days: options.days, now: new Date(), ...remind });
  }
  const fromEnvironment = environment["FITNESS_BASE_REF"];
  const base =
    options.base ??
    (fromEnvironment === undefined || fromEnvironment === "" ? undefined : fromEnvironment);
  const git = createGit(root);
  const withBase = base === undefined ? {} : { base };
  if (options.record) {
    return recordRow({
      root,
      git,
      date: options.date ?? "",
      slug: options.slug ?? "",
      moves: options.moves,
      ...withBase,
    });
  }
  /** @type {ResolveRule} */
  let resolveRule;
  try {
    resolveRule = await createEslintResolver({
      root,
      namespace: PLUGIN.namespace,
      packageName: PLUGIN.packageName,
    });
  } catch (error) {
    return unreadOutcome([`ESLint's configuration could not be loaded: ${messageOf(error)}`]);
  }
  return runGate({ root, git, resolveRule, ...withBase });
}

/** True only when this file is the process entry point, so importing its exports runs nothing. */
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
  /** @type {Outcome} */
  let outcome;
  try {
    outcome = await main(process.argv.slice(2), process.env);
  } catch (error) {
    outcome = unreadOutcome([`the scan failed: ${messageOf(error)}`]);
  }
  for (const line of outcome.stdout) process.stdout.write(`${line}\n`);
  for (const line of outcome.stderr) process.stderr.write(`${line}\n`);
  process.exitCode = outcome.exitCode;
}
