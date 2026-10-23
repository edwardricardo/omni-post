// @ts-check
/**
 * @file ledger.mjs
 * @description The test ledger, built from the tree: `build` lists every candidate under the
 *   workspaces, `security/` and `performance/` (a test-shaped file, a runner, a helper, a
 *   dead-suffix file, or a path a decision excludes), joins each test-shaped file to the reach
 *   engine's sources and its quarantine owner, classifies its blocks and assembles the rows. The
 *   rows, the verdict table, the summary and the rendering are `lib/ledger-core.mjs`'s; the reach
 *   report and the quarantine are read through `lib/reach-report.mjs`, which `metrics.mjs` M5
 *   shares. An input that cannot be read in full stops the build; a file the classifier cannot
 *   read is a row (`framework: null`, verdict ADJUDICATE) and a note.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { classifyFile } from "@packages/eslint-plugin-testing";
import {
  CANONICAL_TEST_SHAPED,
  EXCLUDED_BY_DECISION,
  buildLedger,
  fileRow,
  shapeOf,
} from "./lib/ledger-core.mjs";
import { quarantineOwners, reachLabels, reachReport } from "./lib/reach-report.mjs";
import { readTopLevelBlock } from "./workspace-block-reader.mjs";

const WORKSPACE_FILE = "pnpm-workspace.yaml";
/** The directories outside the workspaces that hold test-shaped files of their own. */
const SUITE_ROOTS = Object.freeze(["security/", "performance/"]);
/** One entry of the workspace manifest's `packages:` list: a glob, quoted or plain. */
const PACKAGE_GLOB = /^\s+-\s+["']?([^"'\s]+)["']?\s*$/;

/**
 * @template T
 * @typedef {{ value: T } | { error: string }} Result
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
 *
 * @typedef {object} Read One file's classification.
 * @property {FileClassification | null} classification
 * @property {string | null} note Why the classifier could not read the file, else `null`.
 *
 * @typedef {object} Built
 * @property {Ledger} ledger
 * @property {string[]} notes One per file the classifier could not read.

 */

/**
 * @description Words a thrown value.
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @description Lists the paths git tracks in a repository.
 * @param {string} root
 * @returns {Result<string[]>} Repository-relative paths, in git's order.
 */
function listTrackedFiles(root) {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { value: out.split("\0").filter((file) => file.length > 0) };
  } catch (error) {
    return { error: `git ls-files failed in ${root}: ${messageOf(error)}` };
  }
}

/**
 * @description The directories the ledger lists: the first segment of every `packages:` glob of
 *   the workspace manifest (a negated glob narrows and adds none), then `security/` and
 *   `performance/`. Derived, so a workspace root added to the manifest is listed with no edit; a
 *   line the reader cannot read fails rather than being skipped.
 * @param {string} root
 * @returns {Result<string[]>} Sorted, each ending in `/`.
 */
function scopePrefixes(root) {
  /** @type {string} */
  let text;
  try {
    text = readFileSync(path.join(root, WORKSPACE_FILE), "utf8");
  } catch (error) {
    return { error: `${WORKSPACE_FILE} could not be read: ${messageOf(error)}` };
  }
  const lines = readTopLevelBlock(text, "packages");
  if (lines === null) return { error: `${WORKSPACE_FILE} has no packages: block` };
  /** @type {Set<string>} */
  const prefixes = new Set(SUITE_ROOTS);
  for (const line of lines) {
    const glob = PACKAGE_GLOB.exec(line)?.[1];
    if (glob === undefined) return { error: `${WORKSPACE_FILE}: cannot read "${line.trim()}"` };
    const first = glob.split("/").find((part) => part.length > 0);
    if (!glob.startsWith("!") && first !== undefined) prefixes.add(`${first}/`);
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
  /** @type {string} */
  let text;
  try {
    text = readFileSync(path.join(root, file), "utf8");
  } catch (error) {
    return { error: `${file} could not be read: ${messageOf(error)}` };
  }
  try {
    const classification = classifyFile(text, file);
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
