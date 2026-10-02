// @ts-check
/**
 * @file workspace-block-reader.mjs
 * @description The one reader of a top-level block mapping in `pnpm-workspace.yaml`, shared by the
 *   gates that read that manifest as text: `engines-node-gate.mjs` reads its `catalog:` block and
 *   `override-bands-gate.mjs` its `overrides:` block.
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
 *   it cannot read rather than this reader guessing at it.
 * @layer infrastructure
 */

/**
 * A line that opens a top-level key, or a document marker: its first byte is neither whitespace nor
 * the `#` that opens a comment.
 */
const TOP_LEVEL = /^[^\s#]/;

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
