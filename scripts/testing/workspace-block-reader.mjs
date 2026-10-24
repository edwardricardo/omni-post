// @ts-check
/**
 * @file workspace-block-reader.mjs
 * @description The one reader of a top-level block mapping in `pnpm-workspace.yaml`, shared by the
 *   scripts that read that manifest as text: `engines-node-gate.mjs` reads its `catalog:` block,
 *   `override-bands-gate.mjs` its `overrides:` block, `patched-dependencies-gate.mjs` its
 *   `patchedDependencies:` block and the dependency-usage ledger's manifest side its catalogs. The
 *   `packages:` globs have one reader here too, `readPackageGlobs`, which the test ledger and the
 *   dependency-usage ledger both read them through.
 *
 *   WHY ONE READER: each gate carried its own copy of the loop, and the copies drifted. One ended the
 *   block at ANY column-0 line, a comment included; the other ended it only at a column-0 key. A
 *   column-0 comment does not end a YAML mapping — yaml 2.9.0 and js-yaml 4.3.2 both parse the
 *   entries after it into the same mapping — so the first copy stopped short of every entry written
 *   after such a comment. In a gate that ENUMERATES the block, a dropped entry is a violation nobody
 *   reads, which is how a gate fails open. Two copies of a terminator are two chances for that
 *   defect; one copy is one place to hold the rule.
 *
 *   TEXT, NOT A YAML PARSER, deliberately: neither `yaml` nor `js-yaml` resolves from this
 *   repository's root, and a gate that runs in the dependency-consistency job must not need the tree
 *   it measures. The rule this reader holds is therefore small and stated: a block starts at the
 *   column-0 line `<key>:` and ends at the next column-0 line that is neither whitespace nor a
 *   comment. Blank lines and comment lines, at any indentation, are dropped; every other line is
 *   returned with its indentation, so each gate keeps judging its own entry shape and reports a line
 *   it cannot read rather than this reader guessing at it. The `packages:` list is the one shape
 *   judged here, because two ledgers share it: `readPackageGlobs` returns an entry it cannot read as
 *   an error value naming the line. This module imports nothing, so a gate's suite can copy it
 *   beside the gate alone.
 * @layer infrastructure
 */

/**
 * @template T
 * @typedef {{ value: T } | { error: string }} Result
 */

/** The workspace manifest, at the repository root. */
export const WORKSPACE_FILE = "pnpm-workspace.yaml";

/**
 * A line that opens a top-level key, or a document marker: its first byte is neither whitespace nor
 * the `#` that opens a comment.
 */
const TOP_LEVEL = /^[^\s#]/;

/** One entry of the workspace manifest's `packages:` list: a glob, quoted or plain. */
const PACKAGE_GLOB = /^\s+-\s+["']?([^"'\s]+)["']?\s*$/;

/**
 * The content lines of the top-level block mapping opened by `<key>:`.
 *
 * @param {string} text The manifest's full text.
 * @param {string} key The top-level key, without its colon.
 * @returns {string[] | null} The block's lines that are neither blank nor comments, indentation kept,
 *   in file order; `null` when no column-0 line opens the key, so a caller can tell a missing block
 *   from an empty one.
 */
export function readTopLevelBlock(text, key) {
  const opener = `${key}:`;
  /** @type {string[]} */
  const lines = [];
  let inside = false;
  let found = false;
  for (const line of text.split("\n")) {
    if (TOP_LEVEL.test(line)) {
      if (inside) break;
      inside = line.startsWith(opener);
      found = found || inside;
      continue;
    }
    const trimmed = line.trim();
    if (!inside || trimmed.length === 0 || trimmed.startsWith("#")) continue;
    lines.push(line);
  }
  return found ? lines : null;
}

/**
 * @typedef {object} PackageGlobs The `packages:` globs of a workspace manifest.
 * @property {string[]} positive The globs that add workspaces, in the manifest's order.
 * @property {string[]} negated The globs that take workspaces out, their `!` dropped.
 */

/**
 * @description Reads the `packages:` block of a workspace manifest: each entry a glob, quoted or
 *   plain, a negated one starting with `!`. A manifest with no such block, or an entry the reader
 *   cannot read, is an error, never an empty or partial list.
 * @param {string} text The text of {@link WORKSPACE_FILE}.
 * @returns {Result<PackageGlobs>} The globs, positive and negated.
 */
export function readPackageGlobs(text) {
  const lines = readTopLevelBlock(text, "packages");
  if (lines === null) return { error: `${WORKSPACE_FILE} has no packages: block` };
  /** @type {PackageGlobs} */
  const globs = { positive: [], negated: [] };
  for (const line of lines) {
    const glob = PACKAGE_GLOB.exec(line)?.[1];
    if (glob === undefined) return { error: `${WORKSPACE_FILE}: cannot read "${line.trim()}"` };
    if (glob.startsWith("!")) globs.negated.push(glob.slice(1));
    else globs.positive.push(glob);
  }
  return { value: globs };
}
