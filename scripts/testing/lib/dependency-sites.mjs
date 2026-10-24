// @ts-check
/**
 * @file dependency-sites.mjs
 * @description The site reader of the dependency-usage ledger: the package a module specifier
 *   names, the target an `@types/*` package types, the path class of a tracked file, and the
 *   sites a JavaScript or TypeScript module holds, each with its kind, read from the module's
 *   syntax tree by the `typescript` package. It reads no file and spawns nothing: the command
 *   that lists the tree hands it each file's text.
 *
 *   A site is what it is and nothing more. A `vi` module call is a test mock, never a use: a mock
 *   replaces the package. A type import, an import type node, a module declaration, a
 *   `/// <reference types>` directive and every import of a declaration file are type-only. Any
 *   other string literal is a config string, and the literal that names a module in an import or
 *   a call is never also read as one. Whether the sites of a name are enough to keep it is the
 *   ledger core's rule; the reader only says where they are and what they are.
 * @layer infrastructure
 */
import { builtinModules } from "node:module";
import ts from "typescript";

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

const TEST_DIRECTORY = /(^|\/)(tests|__tests__|test|e2e|test-utils)\//;
const TEST_SUFFIX = /\.(test|spec|stories)\.[cm]?[jt]sx?$|\.k6\.js$/;
const SUITE_ROOT = /^(security|performance)\//;

/** The first directories below a workspace that hold its tooling rather than its code. */
const TOOLING_DIRECTORIES = Object.freeze(["scripts", ".storybook", "stories", "public"]);

/**
 * @description Names the package a specifier or a config string starts with, by npm's naming
 *   alone: two segments for a scoped name, one otherwise.
 * @param {string} text A module specifier or a string literal's text.
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
 *   k6 suffix, or the `security/` and `performance/` suites make it `test`. A `test-utils/`
 *   directory is test code wherever it sits, under a workspace's `src/` too: a workspace exports
 *   its test doubles from there for other workspaces' suites (`@providers/shared/test-utils`), and
 *   the test-rule blocks of `eslint.config.ts` hold the directory as test code as well. A file at
 *   least one directory deep below a workspace, outside that workspace's `scripts`, `.storybook`,
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

/**
 * @typedef {object} Specifier One candidate site of a module, before it is matched to a declared
 *   name: a module the module names, or the text of one of its string literals.
 * @property {string} specifier The module specifier, the type package a reference directive
 *   names, or a config string's text.
 * @property {SiteKind} kind
 * @property {true} [reference] Present on a `/// <reference types>` directive, whose text names
 *   a type package rather than a module.
 *
 * @typedef {object} Site One site of a declared name in one file.
 * @property {string} name The declared name.
 * @property {SiteKind} kind
 * @property {string} file Repository-relative.
 *
 * @typedef {object} ModuleName A syntax node's literal that names a module, and its site kind.
 * @property {ts.StringLiteralLike} literal
 * @property {SiteKind} kind
 */

const { RUNTIME_IMPORT, TYPE_ONLY, TEST_MOCK, CONFIG_STRING } = SITE_KINDS;

/** The order the sites of one name are returned in: the order of the kinds above. */
const KIND_ORDER = Object.values(SITE_KINDS);

/** The files whose imports TypeScript resolves types for, declaration files among them. */
const TYPESCRIPT_FILE = /\.[cm]?tsx?$/;

/**
 * @description Says whether an import clause binds a value. A clause marked `type`, or one whose
 *   every named binding is marked `type` with no default, is erased before the module runs.
 * @param {ts.ImportClause | undefined} clause The clause; absent on a side-effect import.
 * @returns {boolean} `true` when the import loads the module at run time.
 */
function importsValue(clause) {
  if (clause === undefined) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name !== undefined) return true;
  const bindings = clause.namedBindings;
  if (bindings === undefined) return false;
  return ts.isNamespaceImport(bindings) || bindings.elements.some((item) => !item.isTypeOnly);
}

/**
 * @description Says whether a re-export loads its module: `export *`, a namespace re-export, or
 *   one named re-export not marked `type`.
 * @param {ts.ExportDeclaration} node A re-export.
 * @returns {boolean} `true` when the re-export loads the module at run time.
 */
function exportsValue(node) {
  if (node.isTypeOnly) return false;
  const clause = node.exportClause;
  if (clause === undefined || ts.isNamespaceExport(clause)) return true;
  return clause.elements.some((item) => !item.isTypeOnly);
}

/**
 * @description Reads the string literal an `import()` call names.
 * @param {ts.Node} node Any node.
 * @returns {ts.StringLiteralLike | null} The literal, or `null` when the node is no `import()`
 *   of a string literal.
 */
function importedLiteral(node) {
  if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword) {
    return null;
  }
  const [first] = node.arguments;
  return first !== undefined && ts.isStringLiteralLike(first) ? first : null;
}

/**
 * @description Says whether a callee is one of the `vi` module calls.
 * @param {ts.Expression} callee A call's callee.
 * @returns {boolean} `true` for `vi.<name>` with a name in {@link VI_MODULE_CALLS}.
 */
function isViModuleCall(callee) {
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "vi" &&
    VI_MODULE_CALLS.includes(callee.name.text)
  );
}

/**
 * @description Reads the module a call names: `import()` and `require()` with a string-literal
 *   first argument, and the `vi` module calls with a string literal or an `import()` of one. The
 *   `import()` a `vi` call wraps is part of the mock: vitest resolves its path and never loads it.
 * @param {ts.CallExpression} call A call expression.
 * @returns {ModuleName | null} The literal and its kind, or `null` for any other call.
 */
function calledModule(call) {
  const [first] = call.arguments;
  if (first === undefined) return null;
  const callee = call.expression;
  if (isViModuleCall(callee)) {
    const literal = ts.isStringLiteralLike(first) ? first : importedLiteral(first);
    return literal === null ? null : { literal, kind: TEST_MOCK };
  }
  if (!ts.isStringLiteralLike(first)) return null;
  const loads =
    callee.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(callee) && callee.text === "require");
  return loads ? { literal: first, kind: RUNTIME_IMPORT } : null;
}

/**
 * The node shapes that name a module, one reader each: given a node, it returns the literal that
 * names the module and the kind of site it makes, or `null` when the node is not its shape.
 * @type {ReadonlyArray<(node: ts.Node) => ModuleName | null>}
 */
const MODULE_NAMERS = Object.freeze([
  (node) =>
    ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      ? {
          literal: node.moduleSpecifier,
          kind: importsValue(node.importClause) ? RUNTIME_IMPORT : TYPE_ONLY,
        }
      : null,
  (node) =>
    ts.isExportDeclaration(node) &&
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteral(node.moduleSpecifier)
      ? { literal: node.moduleSpecifier, kind: exportsValue(node) ? RUNTIME_IMPORT : TYPE_ONLY }
      : null,
  (node) =>
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    ts.isStringLiteralLike(node.moduleReference.expression)
      ? {
          literal: node.moduleReference.expression,
          kind: node.isTypeOnly ? TYPE_ONLY : RUNTIME_IMPORT,
        }
      : null,
  (node) =>
    ts.isImportTypeNode(node) &&
    ts.isLiteralTypeNode(node.argument) &&
    ts.isStringLiteral(node.argument.literal)
      ? { literal: node.argument.literal, kind: TYPE_ONLY }
      : null,
  (node) =>
    ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)
      ? { literal: node.name, kind: TYPE_ONLY }
      : null,
  (node) => (ts.isCallExpression(node) ? calledModule(node) : null),
]);

/**
 * @description Reads the module a syntax node names, through the first shape that matches it.
 * @param {ts.Node} node Any node of the tree.
 * @returns {ModuleName | null} The literal and its kind, or `null` when the node names none.
 */
function moduleNamedBy(node) {
  for (const read of MODULE_NAMERS) {
    const named = read(node);
    if (named !== null) return named;
  }
  return null;
}

/**
 * @description Reads every candidate site of one module from its syntax tree: the type
 *   references first, then the module names and the other string literals in source order. A
 *   literal makes one site, the one its outermost node gives it, so the `import()` inside a
 *   `vi.mock` stays a mock. In a declaration file every import is type-only. The grammar follows
 *   the file's extension, so JSX parses in `.tsx` and `.jsx`. A file that nests deeper than the
 *   call stack throws the parser's `RangeError`, for the caller to report the file unread.
 * @param {string} file The module's path; its extension selects the grammar.
 * @param {string} text The module's text.
 * @returns {Specifier[]} The candidates, one per node, repeats included.
 */
export function readSpecifiers(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  /** @type {Specifier[]} */
  const found = source.typeReferenceDirectives.map((directive) => ({
    specifier: directive.fileName,
    kind: TYPE_ONLY,
    reference: true,
  }));
  /** @type {Set<ts.Node>} */
  const moduleLiterals = new Set();
  /** @param {ts.Node} node */
  const visit = (node) => {
    const named = moduleNamedBy(node);
    if (named !== null) {
      if (!moduleLiterals.has(named.literal)) {
        moduleLiterals.add(named.literal);
        const erased = source.isDeclarationFile && named.kind === RUNTIME_IMPORT;
        found.push({ specifier: named.literal.text, kind: erased ? TYPE_ONLY : named.kind });
      }
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !moduleLiterals.has(node)
    ) {
      found.push({ specifier: node.text, kind: CONFIG_STRING });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

/**
 * @description Reads the declared name a `/// <reference types>` directive loads types from, the
 *   way TypeScript resolves it: the `@types/*` package first, then the package itself when it
 *   ships its own types.
 * @param {string} reference The directive's `types` value.
 * @param {ReadonlySet<string>} declared The declared names.
 * @returns {string | null} The declared name, or `null` when neither is declared.
 */
function referencedName(reference, declared) {
  const name = leadingName(reference);
  if (name === null) return null;
  const mangled = name.startsWith("@") ? name.slice(1).replace("/", "__") : name;
  const typesName = `${TYPES_SCOPE}${mangled}`;
  if (declared.has(typesName)) return typesName;
  return declared.has(name) ? name : null;
}

/**
 * @description Orders two sites by name, in code-unit order, then by kind.
 * @param {Site} left One site.
 * @param {Site} right The other.
 * @returns {number} Negative, zero or positive, as `Array.prototype.sort` reads it.
 */
function bySite(left, right) {
  if (left.name !== right.name) return left.name < right.name ? -1 : 1;
  return KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind);
}

/**
 * @description Attributes one module's candidates to the declared names. A module specifier is a
 *   site of the package it names; in a TypeScript file a runtime or type-only import is also a
 *   type-only site of the `@types/*` row that types its package, Node's built-ins included. A
 *   test mock is a site of the mocked package alone. A config string is a site of the declared
 *   name it equals or whose subpath it is. A type reference is a site of the package TypeScript
 *   loads its types from. Anything else, and every undeclared name, is no site.
 * @param {string} file The module's repository-relative path, carried on every site.
 * @param {readonly Specifier[]} specifiers What {@link readSpecifiers} read from it.
 * @param {ReadonlySet<string>} declared Every declared name, the `@types/*` ones included.
 * @param {ReadonlyMap<string, string>} typesRows Each declared `@types/*` name, keyed by the
 *   target {@link typedTargetOf} returns for it.
 * @returns {Site[]} One site per name and kind, sorted by name and then kind.
 */
export function attributeSites(file, specifiers, declared, typesRows) {
  const typed = TYPESCRIPT_FILE.test(file);
  /** @type {Map<string, Site>} */
  const sites = new Map();
  /**
   * @param {string} name The declared name.
   * @param {SiteKind} kind The site's kind.
   */
  const add = (name, kind) => {
    sites.set(`${name}\0${kind}`, { name, kind, file });
  };
  for (const { specifier, kind, reference } of specifiers) {
    if (reference === true) {
      const name = referencedName(specifier, declared);
      if (name !== null) add(name, TYPE_ONLY);
      continue;
    }
    if (kind === CONFIG_STRING) {
      const name = leadingName(specifier);
      if (name !== null && declared.has(name)) add(name, CONFIG_STRING);
      continue;
    }
    const name = packageOf(specifier);
    if (name === null) continue;
    if (declared.has(name)) add(name, kind);
    const typesRow = typesRows.get(name);
    if (typed && typesRow !== undefined && (kind === RUNTIME_IMPORT || kind === TYPE_ONLY)) {
      add(typesRow, TYPE_ONLY);
    }
  }
  return [...sites.values()].sort(bySite);
}
