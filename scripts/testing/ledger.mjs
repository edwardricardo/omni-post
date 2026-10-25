// @ts-check
/**
 * @file ledger.mjs
 * @description The test ledger's command: one row per test-shaped file, runner, helper and
 *   dead-suffix file under the workspaces, `security/` and `performance/`, each test-shaped file
 *   joined to the reach engine's sources and its quarantine owner and its blocks classified,
 *   written as `ledger.json` at the repository root or checked against it. The rows, the verdict
 *   table, the summary and the rendering are `lib/ledger-core.mjs`'s; the reach report and the
 *   quarantine are read through `lib/reach-report.mjs`, which `metrics.mjs` M5 shares.
 *
 *   MODES. Without `--check` it writes the ledger to `--out`, by default `ledger.json` at the root.
 *   With `--check` it compares the rendered ledger's bytes with that file and names each row that
 *   differs. `--reach <file>` reads a saved `reach --json` report instead of running the engine.
 *   Deterministic: no clock, no commit and no absolute path, so two runs over one tree write the
 *   same bytes.
 *
 *   EXIT CODES, fitness #48's: 0 written, or no drift; 1 drift; 2 a usage error; 3 an input could
 *   not be read (`git ls-files` failed or listed no test-shaped file, the workspace manifest, the
 *   quarantine or a listed file could not be read, the engine printed no report or reported an
 *   input of its own unread, `--check` found no committed ledger or could not read it, the Prettier
 *   configuration could not be read) or the ledger could not be written. 3 wins over 1: an unread
 *   input stops the run before anything is written or compared, so no drift is ever named from a
 *   partial read. A file the classifier cannot read is a row (`framework: null`, verdict
 *   ADJUDICATE) and a note, not an unread input.
 *
 *   Usage: `node scripts/testing/ledger.mjs [--root <dir>] [--out <file>] [--reach <file>]
 *   [--check]`, or `pnpm ledger` and `pnpm check:ledger`.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { classifyFile } from "@packages/eslint-plugin-testing";
import {
  CANONICAL_TEST_SHAPED,
  EXCLUDED_BY_DECISION,
  buildLedger,
  fileRow,
  render,
  shapeOf,
} from "./lib/ledger-core.mjs";
import {
  parseReachReport,
  quarantineOwners,
  reachLabels,
  reachReport,
} from "./lib/reach-report.mjs";
import {
  EXIT,
  checkRecord,
  cliResult,
  isEntryPoint,
  listTrackedFiles,
  messageOf,
  readText,
  writeRecord,
} from "./lib/record-helpers.mjs";
import { WORKSPACE_FILE, readPackageGlobs } from "./workspace-block-reader.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const LEDGER_FILE = "ledger.json";
/** The directories outside the workspaces that hold test-shaped files of their own. */
const SUITE_ROOTS = Object.freeze(["security/", "performance/"]);
const USAGE =
  "usage: node scripts/testing/ledger.mjs [--root <dir>] [--out <file>] [--reach <file>] [--check]";
/** How the command names its ledger in what it prints, and how the ledger lists its rows. */
const SPEC = Object.freeze({
  label: "ledger",
  noun: "ledger",
  command: "pnpm ledger",
  list: "files",
  id: "path",
});

/**
 * @template T
 * @typedef {import("./lib/record-helpers.mjs").Result<T>} Result
 */

/**
 * @typedef {import("./lib/reach-report.mjs").ReachReport} ReachReport
 * @typedef {import("./lib/ledger-core.mjs").FileRow} FileRow
 * @typedef {import("./lib/ledger-core.mjs").Ledger} Ledger
 * @typedef {import("../../packages/eslint-plugin-testing/src/classify.js").FileClassification} FileClassification
 *
 * @typedef {object} LedgerSeams What the suite replaces; the command passes none.
 * @property {(root: string) => Result<string[]>} [listFiles] Replaces `git ls-files`.
 * @property {(root: string) => ReachReport | string} [runReach] Replaces the reach engine's run.
 * @property {(ledger: Ledger) => Promise<string>} [render] Replaces the rendering of the ledger.
 *
 * @typedef {object} Read One file's classification.
 * @property {FileClassification | null} classification
 * @property {string | null} note Why the classifier could not read the file, else `null`.
 *
 * @typedef {object} Built
 * @property {Ledger} ledger
 * @property {string[]} notes One per file the classifier could not read.
 *
 * @typedef {object} Options
 * @property {string} root Absolute.
 * @property {string} out Absolute: the ledger written, or checked.
 * @property {string | null} reach A saved reach report, as given, or `null` to run the engine.
 * @property {boolean} check
 *
 * @typedef {import("./lib/record-helpers.mjs").CliResult} CliResult
 */

/**
 * @description The directories the ledger lists: the first segment of every `packages:` glob of
 *   the workspace manifest (a negated glob narrows and adds none), then `security/` and
 *   `performance/`. Derived, so a workspace root added to the manifest is listed with no edit; a
 *   line the reader cannot read fails rather than being skipped.
 * @param {string} root
 * @returns {Result<string[]>} Sorted, each ending in `/`.
 */
function scopePrefixes(root) {
  const text = readText(root, WORKSPACE_FILE);
  if ("error" in text) return text;
  const globs = readPackageGlobs(text.value);
  if ("error" in globs) return globs;
  /** @type {Set<string>} */
  const prefixes = new Set(SUITE_ROOTS);
  for (const glob of globs.value.positive) {
    const first = glob.split("/").find((part) => part.length > 0);
    if (first !== undefined) prefixes.add(`${first}/`);
  }
  return { value: [...prefixes].sort() };
}

/** A runner, a helper or a dead-suffix file: listed, not classified. */
const UNCLASSIFIED = Object.freeze({ value: { classification: null, note: null } });

/**
 * @description Classifies one test-shaped file. A file that cannot be read is an unread input; a
 *   file the classifier cannot read, by its own `error` or by a throw, is a row with no framework
 *   and a note.
 * @param {string} root
 * @param {string} file Repository-relative.
 * @returns {Result<Read>}
 */
function classified(root, file) {
  const text = readText(root, file);
  if ("error" in text) return text;
  try {
    const classification = classifyFile(text.value, file);
    const { error } = classification;
    const note = error === null ? null : `${file}: the classifier could not read it: ${error}`;
    return { value: { classification, note } };
  } catch (error) {
    const note = `${file}: the classifier failed: ${messageOf(error)}`;
    return { value: { classification: null, note } };
  }
}

/**
 * @description Builds the ledger of a repository: lists its tracked paths, keeps the candidates
 *   under the listed directories (a path `shapeOf` names, or one a decision excludes), reads the
 *   quarantine and the reach report, classifies every test-shaped file and assembles the rows. Any
 *   input that cannot be read in full, the reach engine's own included, is the error.
 * @param {string} root The repository root.
 * @param {LedgerSeams} [seams] Replacements for the suite; the command passes none.
 * @returns {Result<Built>}
 */
export function build(root, seams = {}) {
  const listed = (seams.listFiles ?? listTrackedFiles)(root);
  if ("error" in listed) return listed;
  const prefixes = scopePrefixes(root);
  if ("error" in prefixes) return prefixes;
  const candidates = listed.value.filter(
    (file) =>
      prefixes.value.some((prefix) => file.startsWith(prefix)) &&
      (shapeOf(file) !== null || Object.hasOwn(EXCLUDED_BY_DECISION, file))
  );
  if (!candidates.some((file) => CANONICAL_TEST_SHAPED.test(file))) {
    return { error: `git ls-files listed no test-shaped file under ${prefixes.value.join(", ")}` };
  }
  const owners = quarantineOwners(root);
  if (typeof owners === "string") return { error: owners };
  const report = (seams.runReach ?? reachReport)(root);
  if (typeof report === "string") return { error: report };
  const labels = reachLabels(report);
  if (typeof labels === "string") return { error: labels };
  /** @type {string[]} */
  const notes = [];
  /** @type {FileRow[]} */
  const rows = [];
  for (const file of candidates) {
    const testShaped = CANONICAL_TEST_SHAPED.test(file);
    const read = testShaped ? classified(root, file) : UNCLASSIFIED;
    if ("error" in read) return read;
    if (read.value.note !== null) notes.push(read.value.note);
    const row = fileRow({
      path: file,
      classification: read.value.classification,
      collectors: testShaped ? (labels.get(file) ?? []) : [],
      quarantined: owners.get(file) ?? null,
    });
    if ("error" in row) return row;
    rows.push(row.value);
  }
  const ledger = buildLedger(rows);
  return "error" in ledger ? ledger : { value: { ledger: ledger.value, notes } };
}

/**
 * @description Reads the command line. Every flag takes its value but `--check`; an unknown flag,
 *   a positional argument and an empty value are usage errors.
 * @param {readonly string[]} argv The arguments after the script path.
 * @returns {Result<Options>}
 */
function parseArguments(argv) {
  /** @type {{ root?: string, out?: string, reach?: string, check?: boolean }} */
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        root: { type: "string" },
        out: { type: "string" },
        reach: { type: "string" },
        check: { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    return { error: messageOf(error) };
  }
  for (const flag of /** @type {const} */ (["root", "out", "reach"])) {
    if (values[flag] === "") return { error: `--${flag} takes a non-empty value` };
  }
  const root = path.resolve(values.root ?? ROOT);
  return {
    value: {
      root,
      out: path.resolve(values.out ?? path.join(root, LEDGER_FILE)),
      reach: values.reach ?? null,
      check: values.check === true,
    },
  };
}

/**
 * @description Reads the saved report `--reach` names, in place of a run of the engine.
 * @param {string} file As given on the command line, resolved against the working directory.
 * @returns {ReachReport | string} The report, or why there is none.
 */
function savedReach(file) {
  try {
    return parseReachReport(readFileSync(path.resolve(file), "utf8"));
  } catch (error) {
    return `--reach ${file} could not be read: ${messageOf(error)}`;
  }
}

/**
 * @description The counts a written ledger is reported with.
 * @param {Ledger} ledger
 * @returns {string}
 */
function counts(ledger) {
  const testShaped = ledger.files.filter((row) => row.collectors !== null).length;
  const { total, decorative } = ledger.summary.blocks;
  return (
    `${ledger.summary.files.total} files, ${testShaped} test-shaped, ${total} blocks, ` +
    `${decorative} with a criterion`
  );
}

/**
 * @description The command line, as a function: parse, build, then write or check.
 * @param {readonly string[]} argv The arguments after the script path.
 * @param {LedgerSeams} [seams] Replacements for the suite; the command passes none.
 * @returns {Promise<CliResult>} The text to print and the exit code.
 */
export async function main(argv, seams = {}) {
  const parsed = parseArguments(argv);
  if ("error" in parsed) return cliResult(EXIT.USAGE, [`ledger: ${parsed.error}`, USAGE]);
  const options = parsed.value;
  const { reach } = options;
  const built = build(
    options.root,
    reach === null ? seams : { ...seams, runReach: () => savedReach(reach) }
  );
  if ("error" in built) return cliResult(EXIT.UNREAD, [`ledger: unread: ${built.error}`]);
  const { ledger } = built.value;
  const run = {
    root: options.root,
    out: options.out,
    record: ledger,
    render: seams.render ?? render,
    lines: built.value.notes.map((note) => `ledger: note: ${note}`),
    failing: false,
  };
  return options.check ? checkRecord(SPEC, run) : writeRecord(SPEC, run, counts(ledger));
}

if (isEntryPoint(import.meta.url)) {
  const { code, output } = await main(process.argv.slice(2));
  (code === EXIT.CLEAN ? process.stdout : process.stderr).write(output);
  process.exitCode = code;
}
