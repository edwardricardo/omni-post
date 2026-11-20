// @ts-check
/**
 * @file error-scope.mjs
 * @description The one home of the scope of the `errors/` lint rules and of the configuration
 *   each rule is held to (ADR-0047). `eslint.config.ts` builds each rule's block from these
 *   constants, the sites gate checks ESLint's resolved configuration against them, and the
 *   registry gate reads "the rule's scope" through them, so the three cannot drift apart.
 *
 *   THE SCOPE is every tracked file with one of the four TypeScript extensions, so no source file
 *   leaves it by its extension, minus a named list per rule. Each entry of a list has a kind:
 *
 *   - `test-suffix`: a test file by the suffix a collector reads. Production cannot import one
 *     (the dependency rule `production-imports-no-test-code`), which is why this name, and no
 *     other, may take a file out of a source tree.
 *   - `declaration`: a declaration file, which holds no executable code.
 *   - `outside-src`: test code, configuration or scripts beside a source tree, each by its path.
 *     Such an entry never excludes a file under a `src` directory, whatever its glob matches: a
 *     configuration or a generated file inside a source tree is production code, and nothing stops
 *     production from importing it. The sites gate also refuses an entry of this kind whose glob
 *     matches a tracked file under a `src` directory, so the list says what it does.
 *   - `whole-root`: a root the rule does not reach at all (test and measurement code, the fronts,
 *     the tooling), its source tree included.
 *
 *   No entry excludes a file for being generated, and none excludes an `e2e` directory by its
 *   name: the generated contract and data hold nothing the rule reports, and the end-to-end suites
 *   live under an excluded `tests` directory or an excluded front.
 *
 *   THE GLOBS are read by one matcher, `matchesGlob`, with the semantics ESLint's own matcher
 *   gives them (minimatch with `dot: true`): `**` as a whole segment is zero or more segments, `*`
 *   is any run of characters inside one segment, a dot segment included, and `{a,b}` inside one
 *   segment is either alternative. Any other glob syntax is refused with an error rather than
 *   matched as text, so an entry can never mean less than it reads.
 * @layer infrastructure
 */

/** The kinds an entry of a list may have; the module header says what each may exclude. */
export const EXCLUSION_KIND = Object.freeze({
  TEST_SUFFIX: "test-suffix",
  DECLARATION: "declaration",
  OUTSIDE_SRC: "outside-src",
  WHOLE_ROOT: "whole-root",
});

/** The files of every `errors/` rule's block: the four TypeScript extensions. */
export const ERROR_SCOPE_FILES = Object.freeze(["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"]);

/**
 * @typedef {object} Exclusion One entry of a rule's list.
 * @property {string} glob What it excludes, relative to the repository root.
 * @property {"test-suffix" | "declaration" | "outside-src" | "whole-root"} kind
 * @property {string} reason Why the rule does not reach what it excludes.
 */

/**
 * @param {Exclusion["kind"]} kind
 * @param {string} reason
 * @param {readonly string[]} globs
 * @returns {readonly Exclusion[]}
 */
const entries = (kind, reason, globs) => globs.map((glob) => Object.freeze({ glob, kind, reason }));

const TESTS_BESIDE =
  "Test code beside a source tree; a tests directory inside a src tree is not excluded";
const TOOLING_BESIDE = "Configuration and scripts beside a source tree, each by its path";
const FRONTS =
  "A front: it gets its own rule, with its own id, scope and birth, so this rule's counts never rise when it joins";
const TOOLING = "Tooling: it answers no request and no operator";

/** The named list of exclusions of each `errors/` rule, keyed by the rule's id. */
export const ERROR_SCOPE_EXCLUSIONS = Object.freeze({
  "errors/no-inline-error": Object.freeze([
    ...entries(EXCLUSION_KIND.TEST_SUFFIX, "Test files, by the suffix a collector reads", [
      "**/*.test.{ts,tsx,mts,cts}",
      "**/*.spec.{ts,tsx,mts,cts}",
    ]),
    ...entries(EXCLUSION_KIND.DECLARATION, "Declaration files hold no executable code", [
      "**/*.d.{ts,mts,cts}",
    ]),
    ...entries(EXCLUSION_KIND.OUTSIDE_SRC, TESTS_BESIDE, [
      "apps/*/tests/**",
      "packages/*/tests/**",
      "packages/*/*/tests/**",
    ]),
    ...entries(EXCLUSION_KIND.OUTSIDE_SRC, TOOLING_BESIDE, [
      "eslint.config.ts",
      "eslint.jsdoc.config.ts",
      "openapi-ts.config.ts",
      "apps/*/vitest*.config.ts",
      "packages/**/vitest*.config.ts",
      "apps/api/scripts/**",
    ]),
    ...entries(EXCLUSION_KIND.WHOLE_ROOT, "Test and measurement code", [
      "security/**",
      "performance/**",
    ]),
    ...entries(EXCLUSION_KIND.WHOLE_ROOT, FRONTS, [
      "apps/admin/**",
      "apps/client/**",
      "packages/ui/**",
      "packages/api-errors/**",
      "packages/i18n/**",
      "packages/query-client/**",
      "packages/observability/browser-logger/**",
    ]),
    ...entries(EXCLUSION_KIND.WHOLE_ROOT, TOOLING, [
      "scripts/**",
      "docs/**",
      "packages/eslint-plugin-testing/**",
      "packages/eslint-plugin-errors/**",
      "packages/test-contracts/**",
      "packages/vitest-shared/**",
    ]),
  ]),
});

/**
 * The options each `errors/` rule is held to, keyed by the rule's id, as ESLint's list of a
 * rule's options after its severity. Every option is written out: ESLint merges a rule's own
 * `defaultOptions` into the options it resolves, so a list that left one to its default would
 * hold the rule to a value that lives in the rule's source instead of here. `bodyWriter` is the
 * one file whose function writes the error body: the rule does not report its reply there.
 */
export const ERROR_RULE_OPTIONS = Object.freeze({
  "errors/no-inline-error": Object.freeze([
    Object.freeze({
      runtimeErrors: Object.freeze([
        "Error",
        "TypeError",
        "RangeError",
        "SyntaxError",
        "ReferenceError",
        "EvalError",
        "URIError",
        "AggregateError",
      ]),
      baseClasses: Object.freeze(["DomainError", "UseCaseError", "RegisteredError"]),
      replyHelpers: Object.freeze([
        "sendError",
        "handleUnexpectedError",
        "handleOAuthError",
        "sendValidationError",
        "sendMfaLoginError",
        "sendMappedError",
      ]),
      bodyWriter: "apps/api/src/lib/errors/sendProblem.ts",
    }),
  ]),
});

/**
 * The Node built-ins the rule package's `src` may import, each by its exact specifier: modules of
 * pure functions that load no code and read no file, so no import of them can reach a copy of the
 * rules. Every other built-in (`node:module`, `node:vm`, `node:fs`, `node:child_process`,
 * `node:worker_threads`, ...) and a built-in written without its `node:` prefix is refused; a new
 * one enters only by a change of this list, which the sites gate reads as a change of the rule.
 */
export const ERROR_PLUGIN_BUILTINS = Object.freeze(["node:path"]);

/** The characters a glob may hold: anything else is syntax the matcher refuses. */
const GLOB_CHARACTERS = /^[A-Za-z0-9._\-/*{},]+$/;
/** One brace group inside a segment, with two alternatives or more and no wildcard in them. */
const BRACE = /\{([A-Za-z0-9._-]+(?:,[A-Za-z0-9._-]+)+)\}/g;

/** @type {Map<string, RegExp>} */
const compiled = new Map();

/**
 * @param {string} text
 * @returns {string} The text as a regular expression that matches it literally.
 */
const literal = (text) => text.replace(/[.\\^$+?()[\]|]/g, "\\$&");

/**
 * The regular expression of one segment that is not a globstar.
 *
 * @param {string} segment
 * @param {string} glob The whole glob, for the error.
 * @returns {string}
 */
function segmentSource(segment, glob) {
  let source = "";
  let from = 0;
  for (const brace of segment.matchAll(BRACE)) {
    source += starsOf(segment.slice(from, brace.index), glob);
    source += `(?:${(brace[1] ?? "").split(",").map(literal).join("|")})`;
    from = brace.index + brace[0].length;
  }
  return source + starsOf(segment.slice(from), glob);
}

/**
 * @param {string} text A run of a segment outside its brace groups.
 * @param {string} glob The whole glob, for the error.
 * @returns {string}
 */
function starsOf(text, glob) {
  if (/[{},]/.test(text)) throw unread(glob);
  return text.split("*").map(literal).join("[^/]*");
}

/**
 * @param {string} glob
 * @returns {Error}
 */
const unread = (glob) =>
  new Error(
    `the glob "${glob}" holds syntax the scope's matcher does not read: only literal text, "*", ` +
      'a whole-segment "**" and a "{a,b}" group inside one segment are read'
  );

/**
 * @param {string} glob
 * @returns {RegExp}
 */
function compile(glob) {
  const known = compiled.get(glob);
  if (known !== undefined) return known;
  if (!GLOB_CHARACTERS.test(glob) || glob.startsWith("/") || glob.endsWith("/")) {
    throw unread(glob);
  }
  const segments = glob.split("/");
  let source = "";
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === "") throw unread(glob);
    if (segment === "**") {
      source += last ? "(?:[^/]+(?:/[^/]+)*)?" : "(?:[^/]+/)*";
    } else {
      source += segmentSource(segment, glob) + (last ? "" : "/");
    }
  });
  const expression = new RegExp(`^${source}$`, "u");
  compiled.set(glob, expression);
  return expression;
}

/**
 * @description Whether a repository-relative path, with forward slashes, matches a glob, read as
 *   ESLint reads the same glob in a block's `files` or `ignores`.
 * @param {string} file The path.
 * @param {string} glob The glob.
 * @returns {boolean} True when the glob matches the whole path.
 * @throws {Error} When the glob holds syntax the matcher does not read.
 */
export function matchesGlob(file, glob) {
  return compile(glob).test(file);
}

/**
 * @description Whether a path lies under a `src` directory: one of its directories, at any depth,
 *   is named `src`.
 * @param {string} file A repository-relative path.
 * @returns {boolean} True when a directory of the path is `src`.
 */
export function isUnderSource(file) {
  return file.split("/").slice(0, -1).includes("src");
}

/**
 * @description The entry of a list that excludes a path, read by its kind: an entry of kind
 *   `outside-src` never excludes a file under a `src` directory.
 * @param {string} file A repository-relative path.
 * @param {readonly Exclusion[]} list A rule's list.
 * @returns {Exclusion | undefined} The first entry that excludes the path, or none.
 */
export function exclusionOf(file, list) {
  const underSource = isUnderSource(file);
  return list.find(
    (entry) =>
      !(underSource && entry.kind === EXCLUSION_KIND.OUTSIDE_SRC) && matchesGlob(file, entry.glob)
  );
}

/**
 * @description Whether a path is in the scope a list leaves: it has one of the four TypeScript
 *   extensions and no entry of the list excludes it.
 * @param {string} file A repository-relative path.
 * @param {readonly Exclusion[]} list A rule's list; the gates pass `ERROR_SCOPE_EXCLUSIONS[id]`.
 * @returns {boolean} True when the rule must reach the path.
 */
export function isInErrorScope(file, list) {
  return (
    ERROR_SCOPE_FILES.some((glob) => matchesGlob(file, glob)) &&
    exclusionOf(file, list) === undefined
  );
}
