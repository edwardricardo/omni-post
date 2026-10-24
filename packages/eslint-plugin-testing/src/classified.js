// @ts-check
/**
 * @file classified.js
 * @description What the rules that report the classifier's classes share: `classifiedBlocks`, the
 *   blocks `classifyFile` finds in the file a rule is linting, and `blockLoc`, a block's location
 *   in ESLint's terms.
 *
 *   `classifyFile` returns a file it could not read (syntax nested deeper than the call stack)
 *   with its `RangeError` as `error` and no block. Read as a list of blocks, that file would pass
 *   every rule with nothing to report, so `classifiedBlocks` reports it once, at its first line,
 *   with the file and the error, and returns no block; a result with no `blocks` array is reported
 *   the same way. Any other failure of the classifier is a defect `classifyFile` throws, and it
 *   reaches ESLint as a crash naming the rule and the file.
 * @layer infrastructure
 */
import { classifyFile } from "./classify.js";

/**
 * @typedef {import("./classify.js").BlockFinding} BlockFinding
 */

/** The `classifierError` message of every rule built on `classifiedBlocks`. */
export const CLASSIFIER_ERROR_MESSAGE =
  "The test-block classifier could not read `{{file}}`: {{error}}. This rule checks none of " +
  "its blocks until the classifier can read it.";

/**
 * @description Classifies the linted file. A file the classifier could not read, and a result
 *   with no `blocks` array, get one `classifierError` report at the file's start.
 * @param {import("eslint").Rule.RuleContext} context The linting rule's context; its rule must
 *   declare the `classifierError` message.
 * @returns {BlockFinding[]} The file's blocks in source order, or none when it could not be read.
 */
export function classifiedBlocks(context) {
  const result = classifyFile(context.sourceCode.text, context.filename);
  if (result.error === null && Array.isArray(result.blocks)) return result.blocks;
  context.report({
    loc: { line: 1, column: 0 },
    messageId: "classifierError",
    data: { file: context.filename, error: result.error ?? "it returned no block list" },
  });
  return [];
}

/**
 * @description The span of a block's whole call, in ESLint's 0-based columns.
 * @param {BlockFinding} block
 * @returns {import("eslint").AST.SourceLocation}
 */
export function blockLoc({ loc }) {
  return {
    start: { line: loc.line, column: loc.col - 1 },
    end: { line: loc.endLine, column: loc.endCol - 1 },
  };
}
