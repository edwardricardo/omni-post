// @ts-check
/**
 * @file record-coverage-gate.mjs
 * @description Fitness #54, the record-coverage gate: a pull request that deletes or rewrites a
 *   test block lands only with a committed mutation-diff record that measured it. It does not run
 *   a mutation. It reads the base and head `ledger.json`, binds each block id the head lost (a
 *   deletion) and each id whose `bodyHash` changed (a rewrite), and gives each bound block one
 *   class, in this order:
 *
 *   1. moved: a deletion whose base `bodyHash` the head holds under an id the base did not hold,
 *      listed, never refused;
 *   2. live: a block of a ledger row whose collectors name node:test's live tier, which needs a
 *      running API the mutation tool does not start, counted and listed, never refused;
 *   3. no-collector: a block of a ledger row with `collectors: []`, which nothing runs, counted
 *      and listed, never refused;
 *   4. behaviour change: its test imports directly a changed source (a changed file that is no
 *      ledger row), read at the base for a deletion and at the head for a rewrite, by a relative
 *      specifier (with or without its extension, `.js` written for a `.ts` source, or a directory's
 *      index) or a bare specifier `tsconfig.base.json`'s `compilerOptions.paths` maps; listed with
 *      the files, never refused. A string literal that holds the source's path is not an import, but
 *      a test under `apps/api/tests/unit/scripts/` holding a string literal whose whole value is, or
 *      ends after a `/` with, the path of a changed source under `scripts/testing/` is a behaviour
 *      change too, listed with the files, and so is one whose consecutive string-literal arguments
 *      of a single `path.join(...)` call written in code (never text inside a string), joined with
 *      `/`, are or end after a `/` with that path (a non-literal argument ends a run;
 *      `path.resolve`, concatenation, a template literal, a call inside a template substitution and
 *      a bare `join` import stay unseen);
 *   5. covered: a case of a committed record under
 *      `docs/development/testing-refoundation/mutations/*.record.json` lists the id with
 *      `bodyHash.base` and `bodyHash.head` equal to the two ledgers (`null` at the head for a
 *      deletion), its kind, and SAFE for a deletion or GAIN for a rewrite; a BEHAVIOUR-CHANGED case
 *      (either kind) is counted and listed as a behaviour change instead;
 *   6. refused, named by its reason: `no-record`; `stale-record`, a hash differs, so mutation-diff
 *      is run again; `wrong-kind`; or `failing-verdict: <verdict>`.
 *
 *   RETIRES WHEN, held under `--retire-check`, which `pnpm check:record-coverage` passes, on the
 *   head `ledger.json`: the live class once no row's collectors name
 *   node:test's live tier (`the live class matches no ledger row: delete it (its tier left the
 *   tree)`), the no-collector class once no row has `collectors: []` (`the no-collector class
 *   matches no ledger row: delete it (its files left the quarantine)`); each is exit 1 until the
 *   class is deleted.
 *
 *   THE BASE is `FITNESS_BASE_REF`, `origin/main` when unset, resolved to its merge base with
 *   `HEAD`. The base ledger is `git show <merge base>:ledger.json`; the head is the working tree,
 *   which CI checks out at `HEAD`: its `ledger.json`, its records (the ones git tracks) and the
 *   changed files, `git diff --name-only <merge base>` against it.
 *
 *   EXIT CODES: 0 nothing refused; 1 a refused block, a record that is not the tool's shape, or, under
 *   `--retire-check`, a class that matches no row of the head ledger; 2 a
 *   usage error (the command takes no argument but `--summary <file>` and `--retire-check`); 3 the environment, failing
 *   closed: a base that does not resolve or shares no merge base with `HEAD`, `ledger.json`
 *   unreadable, not JSON or with no `files` array on either side, a `tsconfig.base.json` that is
 *   not JSON, or git failing. No `mutations/` directory with a refused block is 1, not 3.
 *
 *   RESIDUAL LIMITS, stated rather than implied: (1) it reads the committed ledgers, and that they
 *   match the tree is #52's part; (2) it proves a matching record exists, never that its mutation
 *   was realistic or the record genuine, which the verifier's re-run of mutation-diff proves; (3) a
 *   rename with a body edit reads as a deletion plus an addition, and a deletion whose body the head
 *   holds under a new id, a new copy included, reads as moved; (4) the import
 *   exclusion reads direct imports only and the script suites' rule a whole literal only, so a test
 *   that reaches a changed source through another module, a path built from fragments, a literal
 *   outside `apps/api/tests/unit/scripts/` or a changed file outside `scripts/testing/` needs the tool's measured BEHAVIOUR-CHANGED verdict in a committed record;
 *   (5) a file the ledger excludes is invisible; (6) a block's
 *   `bodyHash` covers its callback body only, so a row deleted from an `it.each` table, or an
 *   expected value weakened in one, changes no id and no hash and binds nothing (plan row
 *   RECORD-COVERAGE-EACH-TABLES); (7) a live-tier or no-collector block is listed, never measured.
 *
 *   Usage: `node scripts/testing/record-coverage-gate.mjs [--summary <file>] [--retire-check]`, or
 *   `pnpm check:record-coverage`. `--summary` appends the lines as a Markdown table, which is how
 *   the workflow step writes its job summary.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  boundBlocks,
  changedImports,
  changedLiterals,
  classify,
  countsOf,
  ledgerIndexOf,
  listedOf,
  parseRecord,
  pathAliasesOf,
  retiredClassesOf,
} from "./lib/record-coverage-core.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_BASE_REF = "origin/main";
const LEDGER = "ledger.json";
const RECORDS = "docs/development/testing-refoundation/mutations";
const RECORD_SUFFIX = ".record.json";
const TSCONFIG = "tsconfig.base.json";
const PREFIX = "record-coverage-gate: ";
const USAGE =
  "usage: node scripts/testing/record-coverage-gate.mjs [--summary <file>] [--retire-check]";
const EXIT = Object.freeze({ CLEAN: 0, VERDICT: 1, USAGE: 2, UNREAD: 3 });

/**
 * @typedef {{ value: string } | { error: string }} Read
 * @typedef {{ exitCode: number, lines: string[] }} Outcome
 * @typedef {Outcome & { markdown: string | null }} Evaluation
 * @typedef {import("./lib/record-coverage-core.mjs").LedgerIndex} LedgerIndex
 * @typedef {import("./lib/record-coverage-core.mjs").CommittedRecord} CommittedRecord
 */

/**
 * @description The message of a thrown value.
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  return error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
}

/**
 * @description Runs git in a root and returns its stdout, or the error it failed with.
 * @param {string} root
 * @returns {(args: readonly string[]) => Read}
 */
function gitIn(root) {
  return (args) => {
    try {
      const value = execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 512 * 1024 * 1024,
      });
      return { value };
    } catch (error) {
      return { error: messageOf(error) };
    }
  };
}

/**
 * @description Reads a working-tree file, or the error it failed with.
 * @param {string} root
 * @param {string} file Repository-relative.
 * @returns {Read}
 */
function readTree(root, file) {
  try {
    return { value: readFileSync(path.join(root, file), "utf8") };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

/**
 * @description Parses and indexes one side's `ledger.json`.
 * @param {Read} read
 * @param {string} side How the error names the side.
 * @returns {{ value: LedgerIndex } | { error: string }}
 */
function ledgerOf(read, side) {
  if ("error" in read) return { error: `${LEDGER} at ${side} cannot be read: failing closed` };
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(read.value);
  } catch {
    return { error: `${LEDGER} at ${side} is not JSON: failing closed` };
  }
  const index = ledgerIndexOf(parsed);
  return "error" in index
    ? { error: `${LEDGER} at ${side} ${index.error}: failing closed` }
    : index;
}

/**
 * @description Splits git's NUL-separated output into its paths.
 * @param {string} output
 * @returns {string[]}
 */
function pathsOf(output) {
  return output.split("\u0000").filter((entry) => entry !== "");
}

/**
 * @description Escapes a Markdown table cell.
 * @param {string} text
 * @returns {string}
 */
function cell(text) {
  return text.replaceAll("|", "\\|");
}

/**
 * @description Runs the rule over a root and a base, and renders the job summary beside the lines.
 * @param {{ root: string, baseRef: string, retireCheck: boolean }} input `retireCheck` adds the
 *   check that each counted class still matches a row of the head ledger.
 * @returns {Evaluation}
 */
function evaluate({ root, baseRef, retireCheck }) {
  const git = gitIn(root);
  /** @type {(message: string) => Evaluation} */
  const unread = (message) => ({
    exitCode: EXIT.UNREAD,
    lines: [`${PREFIX}${message}`],
    markdown: null,
  });
  const resolved = git(["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]);
  if ("error" in resolved || resolved.value.trim() === "") {
    return unread(`the base ${baseRef} does not resolve to a commit: failing closed`);
  }
  const merged = git(["merge-base", resolved.value.trim(), "HEAD"]);
  if ("error" in merged || merged.value.trim() === "") {
    return unread(`the base ${baseRef} shares no merge base with HEAD: failing closed`);
  }
  const sha = merged.value.trim();
  const base = ledgerOf(git(["show", `${sha}:${LEDGER}`]), `the base (${sha})`);
  if ("error" in base) return unread(base.error);
  const head = ledgerOf(readTree(root, LEDGER), "the head (the working tree)");
  if ("error" in head) return unread(head.error);
  const changed = git(["diff", "--name-only", "-z", sha, "--"]);
  const tracked = git(["ls-files", "-z", "--", RECORDS]);
  if ("error" in changed) return unread(`git diff against ${sha} failed: ${changed.error}`);
  if ("error" in tracked) return unread(`git ls-files ${RECORDS} failed: ${tracked.error}`);
  const tsconfig = readTree(root, TSCONFIG);
  /** @type {unknown} */
  let parsedConfig = null;
  try {
    parsedConfig = "error" in tsconfig ? null : JSON.parse(tsconfig.value);
  } catch {
    return unread(`${TSCONFIG} is not JSON: failing closed`);
  }
  const aliases = pathAliasesOf(parsedConfig);
  const rows = new Set([...base.value.paths, ...head.value.paths]);
  const sources = pathsOf(changed.value).filter((file) => !rows.has(file));

  /** @type {string[]} */
  const problems = retireCheck ? [...retiredClassesOf(head.value)] : [];
  /** @type {CommittedRecord[]} */
  const records = [];
  const recordFiles = pathsOf(tracked.value).filter(
    (file) => path.posix.dirname(file) === RECORDS && file.endsWith(RECORD_SUFFIX)
  );
  for (const file of recordFiles.sort()) {
    const text = readTree(root, file);
    const parsed = "error" in text ? { error: "it cannot be read" } : parseRecord(text.value);
    if ("error" in parsed) problems.push(`${file} is not a mutation-diff record: ${parsed.error}`);
    else records.push({ file, cases: parsed.value });
  }

  const bound = boundBlocks(base.value, head.value);
  /** @type {Map<string, string>} */
  const texts = new Map();
  /** @type {(side: "base" | "head", file: string) => string} */
  const textAt = (side, file) => {
    const key = `${side}\u0000${file}`;
    if (!texts.has(key)) {
      const read = side === "base" ? git(["show", `${sha}:${file}`]) : readTree(root, file);
      texts.set(key, "error" in read ? "" : read.value);
    }
    return texts.get(key) ?? "";
  };
  /** @type {Map<string, string[]>} */
  const imports = new Map();
  /** @type {Map<string, string[]>} */
  const literals = new Map();
  if (sources.length > 0) {
    for (const block of bound) {
      if (block.movedTo !== null) continue;
      const [side, file] =
        block.kind === "deletion" ? ["base", block.path] : ["head", block.headPath];
      const text = textAt(/** @type {"base" | "head"} */ (side), file);
      imports.set(block.id, changedImports(file, text, sources, aliases));
      literals.set(block.id, changedLiterals(file, text, sources));
    }
  }
  const entries = classify(bound, { imports, literals, records });
  const counts = countsOf(entries);
  const summary =
    `${bound.length} bound blocks against ${baseRef} (${sha}): ${counts.covered} covered, ` +
    `${counts.moved} moved, ${counts.live} live, ${counts.noCollector} no-collector, ` +
    `${counts.behaviour} behaviour change, ` +
    `${counts.refused} refused`;
  const listed = listedOf(entries);
  const lines = [
    summary,
    ...listed.map((entry) => `${entry.cls}: ${entry.id} (${entry.kind}): ${entry.detail}`),
    ...problems,
  ].map((text) => `${PREFIX}${text}`);
  const table =
    listed.length === 0
      ? []
      : [
          "| Class | Block | Kind | Detail |",
          "| --- | --- | --- | --- |",
          ...listed.map(
            (entry) =>
              `| ${entry.cls} | \`${cell(entry.id)}\` | ${entry.kind} | ${cell(entry.detail)} |`
          ),
          "",
        ];
  const markdown = [
    "### Fitness #54: record coverage",
    "",
    summary,
    "",
    ...table,
    ...problems.map((problem) => `- ${cell(problem)}`),
  ].join("\n");
  return {
    exitCode: counts.refused > 0 || problems.length > 0 ? EXIT.VERDICT : EXIT.CLEAN,
    lines,
    markdown: problems.length > 0 ? `${markdown}\n` : markdown,
  };
}

/**
 * @description Runs the gate over a repository root against a base ref. Everything it reads lives
 *   under `root` and in its git history, so the suite drives the rule on scratch repositories.
 * @param {{ root?: string, baseRef?: string, retireCheck?: boolean }} [input]
 * @returns {Outcome} The exit code and the lines to print.
 */
export function runGate({ root = ROOT, baseRef = DEFAULT_BASE_REF, retireCheck = false } = {}) {
  const { exitCode, lines } = evaluate({ root, baseRef, retireCheck });
  return { exitCode, lines };
}

/**
 * @description The command: reads `--summary <file>`, `--retire-check` and the base from `FITNESS_BASE_REF`, runs
 *   the gate, appends the job summary and returns what to print; the entry point prints it.
 * @param {readonly string[]} argv The arguments after the script.
 * @param {{ root?: string, env?: Readonly<Record<string, string | undefined>> }} [seams] The root
 *   and the environment, replaced by the suite.
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
export function main(argv, seams = {}) {
  const rest = argv.filter((arg) => arg !== "--retire-check");
  const retireCheck = rest.length < argv.length;
  const summaryFile = rest.length === 2 && rest[0] === "--summary" ? (rest[1] ?? "") : null;
  if (
    (rest.length > 0 && summaryFile === null) ||
    summaryFile === "" ||
    argv.length - rest.length > 1
  ) {
    return { code: EXIT.USAGE, stdout: "", stderr: `${USAGE}\n` };
  }
  const env = seams.env ?? process.env;
  const baseRef = env["FITNESS_BASE_REF"] || DEFAULT_BASE_REF;
  /** @type {Evaluation} */
  let result;
  try {
    result = evaluate({ root: seams.root ?? ROOT, baseRef, retireCheck });
  } catch (error) {
    result = {
      exitCode: EXIT.UNREAD,
      lines: [`${PREFIX}the gate failed: ${messageOf(error)}`],
      markdown: null,
    };
  }
  const text = result.lines.map((entry) => `${entry}\n`).join("");
  if (summaryFile !== null && result.markdown !== null) {
    try {
      appendFileSync(summaryFile, result.markdown);
    } catch (error) {
      return {
        code: EXIT.UNREAD,
        stdout: "",
        stderr: `${text}${PREFIX}the summary could not be written to ${summaryFile}: ${messageOf(error)}\n`,
      };
    }
  }
  return result.exitCode === EXIT.UNREAD
    ? { code: result.exitCode, stdout: "", stderr: text }
    : { code: result.exitCode, stdout: text, stderr: "" };
}

/**
 * True only when this file is the process entry point, so importing it for the suite does not run
 * the command.
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
  const run = main(process.argv.slice(2));
  process.stdout.write(run.stdout);
  process.stderr.write(run.stderr);
  process.exitCode = run.code;
}
