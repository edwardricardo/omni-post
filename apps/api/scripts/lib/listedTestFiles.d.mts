/**
 * @file listedTestFiles.d.mts
 * @description Hand-written types for the `--listFiles` scope counter. The module
 *   is `.mjs` because the ratchet runs under plain node with no transpiler, and
 *   `tsconfig.tests.json` includes `tests/**\/*.ts` only — so a test importing it
 *   would otherwise resolve to an untyped module and manufacture a ratchet entry
 *   for a file the ratchet itself depends on. Declaring the types is the way to
 *   avoid that without suppressing anything.
 * @layer infrastructure
 */

/** Matches a whole line that IS one absolute path to a compilable file. */
export declare const LISTED_FILE: RegExp;

/**
 * Returns the distinct paths a `tsc --listFiles` run opened under `directory`.
 *
 * @param output - Raw compiler output with ANSI escapes already stripped.
 * @param directory - Slash-normalised fragment the path must contain.
 */
export declare function listedFilesUnder(output: string, directory: string): Set<string>;
