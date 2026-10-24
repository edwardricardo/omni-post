// @ts-check
/**
 * @file dependency-sites.mjs
 * @description The mapping helpers of the dependency-usage ledger's site reader: the package a
 *   module specifier names, the target an `@types/*` package types, and the path class of a
 *   tracked file, with the constants the reader is built on. They read no file and spawn nothing.
 * @layer infrastructure
 */
import { builtinModules } from "node:module";

/** The extensions of the modules the reader parses. */
export const SOURCE_EXTENSIONS = Object.freeze([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

/**
 * The kinds a site takes, a closed set with one detector each: the first four are read from a
 * module's syntax tree, `css` from stylesheets and `binary` from the command lines of manifests,
 * hooks and workflows.
 */
export const SITE_KINDS = Object.freeze(
  /** @type {const} */ ({
    RUNTIME_IMPORT: "runtime-import",
    TYPE_ONLY: "type-only",
    TEST_MOCK: "test-mock",
    CONFIG_STRING: "config-string",
    CSS: "css",
    BINARY: "binary",
  })
);

/** @typedef {typeof SITE_KINDS[keyof typeof SITE_KINDS]} SiteKind */

/** The class of a tracked file, which decides whether a site there counts for its name. */
export const PATH_CLASSES = Object.freeze(
  /** @type {const} */ ({
    PRODUCTION: "production",
    TEST: "test",
    CONFIG: "config",
  })
);

/** @typedef {typeof PATH_CLASSES[keyof typeof PATH_CLASSES]} PathClass */

/**
 * The one target every Node built-in module maps to, `node:fs` and `fs` alike, and the target
 * `@types/node` types. No npm name holds a colon, so it never equals a declared name.
 */
export const BUILTINS_TARGET = "node:builtins";

/**
 * The `vi` calls whose first argument, a string or an `import()` of one, vitest resolves as a
 * module specifier. Its twin is `VI_MODULE_CALLS` in
 * `packages/test-contracts/src/lib/source-resolution.ts`, which reads the same calls for the
 * source-resolution contract; the suite fails when the two drift apart.
 */
export const VI_MODULE_CALLS = Object.freeze([
  "mock",
  "doMock",
  "unmock",
  "doUnmock",
  "importActual",
  "importMock",
]);

/** A URL scheme such as `data:` or `https:`; `node:` is read before it. */
const PROTOCOL = /^[A-Za-z][A-Za-z0-9+.-]*:/;
/** A relative or absolute path, or a subpath import: none names a package. */
const LOCAL = /^[./#]/;
const NODE_PROTOCOL = "node:";
const TYPES_SCOPE = "@types/";

const TEST_DIRECTORY = /(^|\/)(tests|__tests__|test|e2e)\//;
const TEST_SUFFIX = /\.(test|spec|stories)\.[cm]?[jt]sx?$|\.k6\.js$/;
const SUITE_ROOT = /^(security|performance)\//;

/** The first directories below a workspace that hold its tooling rather than its code. */
const TOOLING_DIRECTORIES = Object.freeze(["scripts", ".storybook", "stories", "public"]);

/**
 * @description Names the package a module specifier starts with, by npm's naming alone: two
 *   segments for a scoped name, one otherwise.
 * @param {string} text A module specifier.
 * @returns {string | null} The name, or `null` when the text cannot start with one.
 */
function leadingName(text) {
  const [first = "", second = ""] = text.split("/");
  if (!first.startsWith("@")) return first === "" ? null : first;
  return first.length > 1 && second !== "" ? `${first}/${second}` : null;
}

/**
 * @description Reads the package a module specifier names. A relative or absolute path, a
 *   subpath import (`#x`) and a URL name none; a Node built-in, with or without `node:`, names
 *   {@link BUILTINS_TARGET}; a subpath names its package.
 * @param {string} specifier A module specifier as written in the source.
 * @returns {string | null} The package name, {@link BUILTINS_TARGET}, or `null`.
 */
export function packageOf(specifier) {
  if (specifier.startsWith(NODE_PROTOCOL) || builtinModules.includes(specifier)) {
    return BUILTINS_TARGET;
  }
  if (LOCAL.test(specifier) || PROTOCOL.test(specifier)) return null;
  return leadingName(specifier);
}

/**
 * @description Reads the target an `@types/*` package types, undoing DefinitelyTyped's
 *   mangling of a scoped name (`@types/babel__core` types `@babel/core`).
 * @param {string} name A declared package name.
 * @returns {string | null} The typed package, {@link BUILTINS_TARGET} for `@types/node`, or
 *   `null` for a name outside `@types/`.
 */
export function typedTargetOf(name) {
  if (!name.startsWith(TYPES_SCOPE)) return null;
  const typed = name.slice(TYPES_SCOPE.length);
  if (typed === "") return null;
  if (typed === "node") return BUILTINS_TARGET;
  const separator = typed.indexOf("__");
  return separator === -1 ? typed : `@${typed.slice(0, separator)}/${typed.slice(separator + 2)}`;
}

/**
 * @description Reads the path class of a tracked file. A test directory, a test, spec, story or
 *   k6 suffix, or the `security/` and `performance/` suites make it `test`. A file at least one
 *   directory deep below a workspace, outside that workspace's `scripts`, `.storybook`,
 *   `stories` and `public`, is `production`; its workspace is the longest directory that holds
 *   it. Every other file is `config`: the root, `scripts/`, workflows, and a workspace's own
 *   configuration files.
 * @param {string} file Repository-relative, with `/` separators.
 * @param {readonly string[]} workspaceDirs The directories of the workspace manifests,
 *   repository-relative; the root, `.` or empty, holds no production file and is passed over.
 * @returns {PathClass} The file's class.
 */
export function pathClassOf(file, workspaceDirs) {
  if (TEST_DIRECTORY.test(file) || TEST_SUFFIX.test(file) || SUITE_ROOT.test(file)) {
    return PATH_CLASSES.TEST;
  }
  const workspace = workspaceDirs
    .filter((dir) => dir !== "" && dir !== "." && file.startsWith(`${dir}/`))
    .reduce((longest, dir) => (dir.length > longest.length ? dir : longest), "");
  if (workspace === "") return PATH_CLASSES.CONFIG;
  const [first = "", ...rest] = file.slice(workspace.length + 1).split("/");
  return rest.length > 0 && !TOOLING_DIRECTORIES.includes(first)
    ? PATH_CLASSES.PRODUCTION
    : PATH_CLASSES.CONFIG;
}
