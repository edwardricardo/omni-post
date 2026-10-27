// @ts-check
/**
 * @file ledger-imports.mjs
 * @description The import graph of the test ledger: where a module specifier, a path a module
 *   names as a string or a path a command line runs lands among the tracked files; how many live
 *   files reference each helper and runner; and the module a test's stem names. It reads no file
 *   and spawns nothing: the command that lists the tree hands it each file's text, and the
 *   specifiers are read by `readSpecifiers` of `dependency-sites.mjs`, the dependency ledger's
 *   reader.
 *
 *   A specifier resolves as the tree's tooling resolves it, to the first tracked file of: a
 *   relative path from the importing file; `@/` from the importing file's workspace, both Next
 *   apps' alias; a workspace package by name, its root at `src/` first and then the package
 *   directory, a subpath below either. Each base tries the TypeScript twin of a `.js`, `.jsx`,
 *   `.mjs` or `.cjs` name first, then the name as written, then every source extension, then an
 *   `index` below it.
 * @layer infrastructure
 */
import path from "node:path";
import ts from "typescript";
import { SITE_KINDS, SOURCE_EXTENSIONS, readSpecifiers } from "./dependency-sites.mjs";
import { byCodeUnit, isObject } from "./record-helpers.mjs";

/** The TypeScript source each JavaScript name is compiled from, tried before the name itself. */
const TWINS = Object.freeze({
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
});

/**
 * A string a module holds that names a file: `./x` or `../x` from the module; a bare file name with
 * a source extension, as `path.join(__dirname, "global-setup.ts")` writes it, next to the module;
 * or a path with a source extension from the module's workspace, as a test that spawns from its
 * package root writes it. A path from the repository root, in a module outside every workspace,
 * is a lint scope or a gate's list, never a load, so it names nothing.
 */
const RELATIVE_STRING = /^\.\.?\//;
const BARE_FILE = /^[^/]+\.[cm]?[jt]sx?$/;

/**
 * The last segment of an `include` pattern that names a suffix narrower than an extension, as
 * `*.type-test.ts` does: a TypeScript project that collects files by such a name runs them. A
 * pattern that names an extension alone compiles helpers without running any.
 */
const COLLECTING_PATTERN = /^\*\.[^*/]+\.[cm]?[jt]sx?$/;

/** The words a command line holds, split where no path character can stand. */
const COMMAND_WORD = /[\s"'`=(),;|&<>]+/;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

/** The shapes a stem's module is read for; the others drive a running system, never a module. */
const SUBJECT_SHAPES = Object.freeze(["test", "integration-test"]);

/**
 * @typedef {object} WorkspacePackage
 * @property {string} name The manifest's `name`.
 * @property {string} dir Repository-relative, with no trailing `/`.
 * @property {readonly string[]} depends The names its manifest declares, of every dependency
 *   field.
 *
 * @typedef {object} ImportContext What a specifier resolves against.
 * @property {ReadonlySet<string>} tracked Every tracked path.
 * @property {readonly WorkspacePackage[]} packages The workspace packages, the root's excluded.
 *
 * @typedef {object} ModuleReferences The tracked files one module names.
 * @property {string[]} imports The files it loads at run time, sorted.
 * @property {string[]} references Every file it names, by any specifier or by a string that
 *   names a file, sorted.
 *
 * @typedef {import("./ledger-core.mjs").Subject} Subject
 * @typedef {import("./ledger-core.mjs").Shape} Shape
 */

/**
 * @description Finds the workspace package a file belongs to: the one whose directory holds it
 *   most closely.
 * @param {string} file Repository-relative.
 * @param {readonly WorkspacePackage[]} packages
 * @returns {WorkspacePackage | null} The package, or `null` for a file outside every workspace.
 */
export function workspaceOf(file, packages) {
  /** @type {WorkspacePackage | null} */
  let owner = null;
  for (const pkg of packages) {
    const holds = file.startsWith(`${pkg.dir}/`);
    if (holds && (owner === null || pkg.dir.length > owner.dir.length)) owner = pkg;
  }
  return owner;
}

/**
 * @description Lists the paths one base may resolve to, in the order they are tried.
 * @param {string} base A repository-relative path, with or without an extension.
 * @returns {string[]}
 */
function candidatePaths(base) {
  const extension = path.posix.extname(base);
  const twins = Object.hasOwn(TWINS, extension)
    ? TWINS[/** @type {keyof typeof TWINS} */ (extension)]
    : [];
  const stem = base.slice(0, base.length - extension.length);
  return [
    ...twins.map((twin) => `${stem}${twin}`),
    base,
    ...SOURCE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...SOURCE_EXTENSIONS.map((ext) => `${base}/index${ext}`),
  ];
}

/**
 * @description Lists the bases a specifier names, before extensions are tried.
 * @param {string} specifier As written.
 * @param {string} from The importing file, repository-relative.
 * @param {readonly WorkspacePackage[]} packages
 * @returns {string[]}
 */
function basesOf(specifier, from, packages) {
  if (RELATIVE_STRING.test(specifier)) {
    return [path.posix.join(path.posix.dirname(from), specifier)];
  }
  if (specifier.startsWith("@/")) {
    const owner = workspaceOf(from, packages);
    return owner === null ? [] : [path.posix.join(owner.dir, specifier.slice(2))];
  }
  const named = packages.find(
    (pkg) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`)
  );
  if (named === undefined) return [];
  const subpath = specifier.slice(named.name.length + 1);
  return [path.posix.join(named.dir, "src", subpath), path.posix.join(named.dir, subpath)];
}

/**
 * @description Resolves a module specifier to the tracked file it loads.
 * @param {string} specifier As written in the importing file.
 * @param {string} from The importing file, repository-relative.
 * @param {ImportContext} context
 * @returns {string | null} The file, or `null` when the specifier names no tracked file.
 */
function resolveSpecifier(specifier, from, { tracked, packages }) {
  for (const base of basesOf(specifier, from, packages)) {
    const found = candidatePaths(base).find((candidate) => tracked.has(candidate));
    if (found !== undefined) return found;
  }
  return null;
}

/**
 * @description Resolves a string a module holds to the tracked file it names, by the forms
 *   {@link RELATIVE_STRING} describes.
 * @param {string} text The string.
 * @param {string} file The module, repository-relative.
 * @param {ImportContext} context
 * @returns {string | null} The file, or `null` when the string names none.
 */
function stringTarget(text, file, context) {
  if (RELATIVE_STRING.test(text)) return resolveSpecifier(text, file, context);
  if (BARE_FILE.test(text)) return resolveSpecifier(`./${text}`, file, context);
  const owner = workspaceOf(file, context.packages);
  if (owner === null || !SOURCE_FILE.test(text)) return null;
  const joined = path.posix.join(owner.dir, text);
  return context.tracked.has(joined) ? joined : null;
}

/**
 * @description Reads the tracked files one module names: every module specifier, of any kind,
 *   and every string that names a file by a form of {@link RELATIVE_STRING}. Only a specifier the module loads at run time
 *   is one of its imports. Its own path is never one of its references.
 * @param {string} file The module, repository-relative.
 * @param {string} text Its text.
 * @param {ImportContext} context
 * @returns {ModuleReferences} The files.
 * @throws {RangeError} The parser's, for a module that nests deeper than the call stack.
 */
export function moduleReferences(file, text, context) {
  /** @type {Set<string>} */
  const imports = new Set();
  /** @type {Set<string>} */
  const references = new Set();
  for (const { specifier, kind, reference } of readSpecifiers(file, text)) {
    if (reference === true) continue;
    const target =
      kind === SITE_KINDS.CONFIG_STRING
        ? stringTarget(specifier, file, context)
        : resolveSpecifier(specifier, file, context);
    if (target === null || target === file) continue;
    references.add(target);
    if (kind === SITE_KINDS.RUNTIME_IMPORT) imports.add(target);
  }
  return { imports: [...imports].sort(byCodeUnit), references: [...references].sort(byCodeUnit) };
}

/**
 * @description Reads the tracked source files a source's command lines run: every word ending in
 *   a source extension, from the directory the source is written in or from the root.
 * @param {string} file The manifest, hook, workflow or script holding the commands.
 * @param {string} commands Its command lines, as `binaryTexts` of `dependency-manifests.mjs`
 *   reads them.
 * @param {ReadonlySet<string>} tracked Every tracked path.
 * @returns {string[]} The files, sorted.
 */
export function commandReferences(file, commands, tracked) {
  const dir = path.posix.dirname(file);
  /** @type {Set<string>} */
  const found = new Set();
  for (const word of commands.split(COMMAND_WORD)) {
    if (!SOURCE_FILE.test(word)) continue;
    for (const base of [path.posix.join(dir, word), path.posix.normalize(word)]) {
      if (tracked.has(base) && base !== file) found.add(base);
    }
  }
  return [...found].sort(byCodeUnit);
}

/**
 * @description Reads the candidates a TypeScript project compiles by name: each entry of its
 *   `files`, and each `include` pattern whose last segment is a {@link COLLECTING_PATTERN}.
 * @param {string} file The project's `tsconfig*.json`, repository-relative.
 * @param {string} text Its text, comments allowed.
 * @param {readonly string[]} candidates The helpers and runners.
 * @returns {string[]} The candidates it collects, sorted.
 * @throws {Error} When the text is not a configuration TypeScript can read.
 */
export function projectReferences(file, text, candidates) {
  const { config, error } = ts.parseConfigFileTextToJson(file, text);
  if (error !== undefined || !isObject(config)) {
    throw new Error(`${file} is not a TypeScript configuration`);
  }
  /** @param {string} key */
  const entries = (key) => {
    const value = config[key];
    return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
  };
  const named = entries("include").filter((pattern) =>
    COLLECTING_PATTERN.test(path.posix.basename(pattern))
  );
  const patterns = [...entries("files"), ...named].map((pattern) =>
    path.posix.join(path.posix.dirname(file), pattern)
  );
  return candidates
    .filter((candidate) => patterns.some((pattern) => path.posix.matchesGlob(candidate, pattern)))
    .sort(byCodeUnit);
}

/**
 * @description Counts each candidate's live referencing files. Every file that is not a
 *   candidate is live; a candidate is live once a live file references it, so helpers that only
 *   reference each other stay dead together. A dead candidate counts 0.
 * @param {readonly string[]} candidates The helpers and runners.
 * @param {ReadonlyMap<string, readonly string[]>} references Each scanned file's references.
 * @returns {Map<string, number>} Each candidate's count of live referencing files.
 */
export function liveImporters(candidates, references) {
  const isCandidate = new Set(candidates);
  /** @type {Map<string, Set<string>>} */
  const importers = new Map(candidates.map((candidate) => [candidate, new Set()]));
  for (const [from, targets] of references) {
    for (const target of targets) importers.get(target)?.add(from);
  }
  /** @type {Set<string>} */
  const live = new Set();
  /** @param {string} from */
  const isLive = (from) => !isCandidate.has(from) || live.has(from);
  let grew = true;
  while (grew) {
    grew = false;
    for (const candidate of candidates) {
      if (live.has(candidate) || ![...(importers.get(candidate) ?? [])].some(isLive)) continue;
      live.add(candidate);
      grew = true;
    }
  }
  return new Map(
    candidates.map((candidate) => [
      candidate,
      [...(importers.get(candidate) ?? [])].filter(isLive).length,
    ])
  );
}

/**
 * @description Follows a test's run-time imports through the files that only carry them: its
 *   helpers and runners, and every `index` module, which re-exports what it gathers. What a test
 *   reaches through its own helper or a barrel is still the test's import.
 * @param {string} file The test, repository-relative.
 * @param {ReadonlyMap<string, readonly string[]>} imports Each scanned module's run-time imports.
 * @param {(file: string) => boolean} carries Whether a file is a helper or a runner.
 * @returns {string[]} Every file reached, sorted.
 */
export function importClosure(file, imports, carries) {
  /** @type {Set<string>} */
  const reached = new Set();
  const pending = [...(imports.get(file) ?? [])];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (reached.has(next) || next === file) continue;
    reached.add(next);
    const barrel = path.posix.basename(next).startsWith("index.");
    if (carries(next) || barrel) pending.push(...(imports.get(next) ?? []));
  }
  return [...reached].sort(byCodeUnit);
}

/**
 * @description Indexes the first-party modules a stem may name, by their file name without its
 *   extension.
 * @param {readonly string[]} modules Tracked source modules that are neither tests, helpers nor
 *   runners, repository-relative.
 * @returns {Map<string, string[]>} Each name's modules, sorted.
 */
export function modulesByStem(modules) {
  /** @type {Map<string, string[]>} */
  const index = new Map();
  for (const module of [...modules].sort(byCodeUnit)) {
    const name = path.posix.basename(module).replace(/\.[^.]+$/, "");
    index.set(name, [...(index.get(name) ?? []), module]);
  }
  return index;
}

/**
 * @description Reads the module a test's stem names, the part of its file name before the first
 *   dot, and whether the test imports it. A module the test imports is its subject; else the one
 *   module of that name in the test's own workspace, or else the one in the workspaces its
 *   manifest declares. A stem that names no module there, or several the test imports none of,
 *   has no subject; so has a shape that drives a running system rather than a module.
 * @param {string} file The test, repository-relative.
 * @param {Shape | null} shape Its shape.
 * @param {readonly string[]} imports What {@link importClosure} reached from it.
 * @param {ReadonlyMap<string, readonly string[]>} index What {@link modulesByStem} returned.
 * @param {readonly WorkspacePackage[]} packages
 * @returns {Subject | null}
 */
export function subjectOf(file, shape, imports, index, packages) {
  if (shape === null || !SUBJECT_SHAPES.includes(shape)) return null;
  const stem = path.posix.basename(file).split(".")[0] ?? "";
  const modules = index.get(stem) ?? [];
  const imported = modules.find((module) => imports.includes(module));
  if (imported !== undefined) return { stem, module: imported, imported: true };
  const owner = workspaceOf(file, packages);
  if (owner === null) return null;
  const local = modules.filter((module) => workspaceOf(module, packages) === owner);
  const declared = modules.filter((module) =>
    owner.depends.includes(workspaceOf(module, packages)?.name ?? "")
  );
  const pool = local.length > 0 ? local : declared;
  const [only] = pool;
  return pool.length === 1 && only !== undefined ? { stem, module: only, imported: false } : null;
}
