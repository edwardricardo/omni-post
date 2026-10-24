/**
 * @file unreadable.ts
 * @description The result `classifyFile` returns for a file it cannot read, and the report a rule
 *              built on `classifiedBlocks` gives that file, for the suites that stand in for the
 *              classifier. No ESLint input reaches the path on its own: measured on 2026-10-24,
 *              `@typescript-eslint/parser` overflows its stack at 1,000 nested array literals and
 *              the classifier only at 2,000, so ESLint reports a parsing error before any rule runs.
 * @layer infrastructure
 */
import type { FileClassification } from "../../src/classify.js";

export const CLASSIFIER_RANGE_ERROR = "RangeError: Maximum call stack size exceeded";

/**
 * @description What `classifyFile` returns for a file whose syntax nests deeper than the call stack:
 *              no framework, no block, no context hash, and the RangeError as its `error`.
 * @param path - The file path the classification names
 * @returns The unreadable-file classification the suites stub the classifier with
 */
export const unreadableFile = (path: string): FileClassification => ({
  path,
  framework: null,
  blocks: [],
  opaqueHelpers: [],
  fileContextHash: null,
  error: CLASSIFIER_RANGE_ERROR,
});

/**
 * @description The one report a rule built on `classifiedBlocks` gives an unreadable file, at its
 *              first line, in the shape RuleTester compares against.
 * @param file - The file name the message names
 * @returns The expected RuleTester error for that file
 */
export const classifierError = (file: string) => ({
  messageId: "classifierError",
  data: { file, error: CLASSIFIER_RANGE_ERROR },
  line: 1,
  column: 1,
});
