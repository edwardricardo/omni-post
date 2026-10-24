// @ts-check
/**
 * @file dependency-manifests.mjs
 * @description The manifest side of the dependency-usage ledger: the workspace manifests the
 *   `packages:` globs of `pnpm-workspace.yaml` reach, checked against the set the legal scan of
 *   `scripts/legal/subprocessors.mjs` reads; the catalogs a `catalog:` specifier resolves against;
 *   the `bin` names of an installed package; the command lines a binary runs from; and the binary
 *   and stylesheet sites of a declared name. A reader that cannot read its whole input returns an
 *   error value, never an empty answer, so the command fails closed instead of counting a
 *   dependency unused from a partial read. Versions are never read: the lockfile and
 *   `pnpm-workspace.yaml` stay their source.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { readTopLevelBlock } from "../workspace-block-reader.mjs";
import { SITE_KINDS, packageOf } from "./dependency-sites.mjs";

/**
 * @template T
 * @typedef {{ value: T } | { error: string }} Result
 */

/**
 * @typedef {object} Catalogs The catalogs of a workspace manifest.
 * @property {Set<string>} default The names the `catalog:` block holds.
 * @property {Map<string, Set<string>>} named The names each catalog of the `catalogs:` block holds.
 */

const WORKSPACE_FILE = "pnpm-workspace.yaml";
const ROOT_MANIFEST = "package.json";
const CATALOG_PROTOCOL = "catalog:";

/** One entry of the workspace manifest's `packages:` list: a glob, quoted or plain. */
const PACKAGE_GLOB = /^\s+-\s+["']?([^"'\s]+)["']?\s*$/;
/** One entry of the `catalog:` block, at column 2, its key quoted or plain. */
const DEFAULT_ENTRY = /^ {2}("?)([^"\s:]+)\1:\s*[^\s#]+/;
/** The key that opens a named catalog inside the `catalogs:` block, at column 2. */
const NAMED_CATALOG = /^ {2}([^\s"#:]+):\s*(#.*)?$/;
/** One entry of a named catalog, at column 4. */
const NAMED_ENTRY = /^ {4}("?)([^"\s:]+)\1:\s*[^\s#]+/;

/**
 * @description Words a thrown value.
 * @param {unknown} error What was thrown.
 * @returns {string} Its message.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @description Orders two strings by code unit.
 * @param {string} left One string.
 * @param {string} right The other.
 * @returns {number} Negative, zero or positive, as `Array.prototype.sort` reads it.
 */
function byCodeUnit(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

/**
 * @description Reads one file of the tree.
 * @param {string} root Absolute repository root.
 * @param {string} file Repository-relative.
 * @returns {Result<string>} Its text, or an error naming the file.
 */
function readText(root, file) {
  try {
    return { value: readFileSync(path.join(root, file), "utf8") };
  } catch (error) {
    return { error: `${file} could not be read: ${messageOf(error)}` };
  }
}

/**
 * @description Lists the workspace manifests: the root `package.json` and every tracked
 *   `package.json` whose directory a positive `packages:` glob of `pnpm-workspace.yaml` matches
 *   and no negated one does. Derived from the globs pnpm itself reads, so a workspace is read the
 *   day its manifest is tracked; a glob line the reader cannot read is an error, never a skip.
 * @param {string} root Absolute repository root.
 * @param {readonly string[]} tracked Every tracked file, repository-relative.
 * @returns {Result<string[]>} The root manifest first, then the others in code-unit order.
 */
export function workspaceManifests(root, tracked) {
  const text = readText(root, WORKSPACE_FILE);
  if ("error" in text) return text;
  const lines = readTopLevelBlock(text.value, "packages");
  if (lines === null) return { error: `${WORKSPACE_FILE} has no packages: block` };
  /** @type {string[]} */
  const positive = [];
  /** @type {string[]} */
  const negated = [];
  for (const line of lines) {
    const glob = PACKAGE_GLOB.exec(line)?.[1];
    if (glob === undefined) return { error: `${WORKSPACE_FILE}: cannot read "${line.trim()}"` };
    if (glob.startsWith("!")) negated.push(glob.slice(1));
    else positive.push(glob);
  }
  /** @param {string} dir */
  const reached = (dir) =>
    positive.some((glob) => path.posix.matchesGlob(dir, glob)) &&
    !negated.some((glob) => path.posix.matchesGlob(dir, glob));
  const workspaces = tracked
    .filter((file) => file.endsWith("/package.json") && reached(path.posix.dirname(file)))
    .sort(byCodeUnit);
  return { value: [...tracked.filter((file) => file === ROOT_MANIFEST), ...workspaces] };
}

/**
 * @description Compares the manifests the workspace globs reach with the ones the legal scan
 *   reads. The two inventories must count the same declarations, so a manifest one side holds
 *   alone is a scope the other never opened.
 * @param {readonly string[]} derived What {@link workspaceManifests} returned.
 * @param {readonly string[]} legal The `manifests` of the legal scan.
 * @returns {string | null} The manifests each side holds alone, or `null` when the sets agree.
 */
export function manifestDisagreement(derived, legal) {
  const globsOnly = derived.filter((file) => !legal.includes(file));
  const legalOnly = legal.filter((file) => !derived.includes(file));
  if (globsOnly.length === 0 && legalOnly.length === 0) return null;
  const sides = [
    ...(globsOnly.length > 0 ? [`only the workspace globs reach ${globsOnly.join(", ")}`] : []),
    ...(legalOnly.length > 0 ? [`only the legal scan reads ${legalOnly.join(", ")}`] : []),
  ];
  return `the workspace manifests and the legal scan disagree: ${sides.join("; ")}`;
}

/**
 * @description Reads the catalogs of a workspace manifest: the `catalog:` block, its entries at
 *   column 2, and the `catalogs:` block, where a column-2 key opens a named catalog and its
 *   entries follow at column 4. Comments and blank lines are passed over; any other line is an
 *   error, since an entry the reader skipped would make a declaration's catalog reference fail,
 *   or a stray line pass as an entry.
 * @param {string} text The workspace manifest's text.
 * @returns {Result<Catalogs>} The names each catalog holds; empty catalogs when the manifest
 *   declares none.
 */
export function readCatalogs(text) {
  /** @param {string} line */
  const unreadable = (line) => ({ error: `${WORKSPACE_FILE}: cannot read "${line.trim()}"` });
  /** @type {Set<string>} */
  const defaults = new Set();
  for (const line of readTopLevelBlock(text, "catalog") ?? []) {
    const name = DEFAULT_ENTRY.exec(line)?.[2];
    if (name === undefined) return unreadable(line);
    defaults.add(name);
  }
  /** @type {Map<string, Set<string>>} */
  const named = new Map();
  /** @type {Set<string> | null} */
  let current = null;
  for (const line of readTopLevelBlock(text, "catalogs") ?? []) {
    const header = NAMED_CATALOG.exec(line)?.[1];
    if (header !== undefined) {
      current = new Set();
      named.set(header, current);
      continue;
    }
    const name = NAMED_ENTRY.exec(line)?.[2];
    if (name === undefined || current === null) return unreadable(line);
    current.add(name);
  }
  return { value: { default: defaults, named } };
}

/**
 * @description Reads the kind of a declaration's specifier: `catalog` for the default catalog
 *   (`catalog:` or `catalog:default`), `catalog:<name>` for a named one, `literal` for any other.
 *   A catalog reference resolves against the catalogs, as `catalogMode: strict` makes pnpm do at
 *   install, so a reference the catalogs do not hold means the reader misread them.
 * @param {string} spec The specifier as written.
 * @param {Catalogs} catalogs What {@link readCatalogs} returned.
 * @param {string} name The declared name.
 * @returns {Result<string>} The kind, or an error naming the reference the catalogs lack.
 */
export function specifierKindOf(spec, catalogs, name) {
  if (!spec.startsWith(CATALOG_PROTOCOL)) return { value: "literal" };
  const catalog = spec.slice(CATALOG_PROTOCOL.length);
  if (catalog === "" || catalog === "default") {
    const holds = catalogs.default.has(name) || catalogs.named.get("default")?.has(name) === true;
    return holds
      ? { value: "catalog" }
      : { error: `${name} is declared ${spec}, but the default catalog holds no ${name}` };
  }
  const named = catalogs.named.get(catalog);
  if (named === undefined) {
    return { error: `${spec} names a catalog ${WORKSPACE_FILE} does not hold (declaring ${name})` };
  }
  return named.has(name)
    ? { value: spec }
    : { error: `${name} is declared ${spec}, but the ${catalog} catalog holds no ${name}` };
}

/**
 * @typedef {import("./dependency-sites.mjs").Site} Site
 *
 * @typedef {object} Declaration One third-party declaration, as the legal scan returns it.
 * @property {string} file The declaring manifest, repository-relative.
 * @property {string} block `dependencies`, `devDependencies`, `optionalDependencies` or
 *   `peerDependencies`.
 * @property {string} name
 * @property {string} spec The specifier as written.
 */

const MANIFEST = /(^|\/)package\.json$/;
const HOOK = /^\.husky\/[^/]+$/;
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const ACTION = /^\.github\/actions\/(.+\/)?action\.ya?ml$/;
const SHELL_SCRIPT = /\.sh$/;
/** A line that is nothing but a `#` comment, in a shell script or a YAML file. */
const COMMENT_LINE = /^\s*#/;

const STYLESHEET = /\.s?css$/;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
/** A whole-line `//` comment, which only SCSS allows. */
const LINE_COMMENT = /^\s*\/\/.*$/gm;
/** `@import`, `@plugin` or `@config` with a quoted specifier, `url("…")` included. */
const STYLESHEET_LOAD = /@(?:import|plugin|config)\s+(?:url\(\s*)?(["'])([^"']+)\1/g;

/**
 * @description Says whether a value is a plain object.
 * @param {unknown} value Any value.
 * @returns {value is Record<string, unknown>} `true` for an object that is not an array.
 */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @description Reads the `bin` names of the copy of a package a manifest's directory installs,
 *   `<manifestDir>/node_modules/<name>/package.json`, where pnpm links each workspace's own
 *   dependencies. A string `bin` is named after the package, its scope dropped; an object's keys
 *   are the names. A copy that cannot be read is an error, never an empty list: a tree that is not
 *   installed would otherwise read every binary as unused.
 * @param {string} root Absolute repository root.
 * @param {string} manifestDir The declaring manifest's directory, repository-relative (`.` for
 *   the root).
 * @param {string} name The declared name.
 * @returns {Result<string[]>} The bin names in code-unit order, `[]` for a package with none.
 */
export function readBins(root, manifestDir, name) {
  const manifest = path.posix.join(manifestDir, "package.json");
  const copy = path.join(root, manifestDir, "node_modules", name, "package.json");
  /** @param {string} why */
  const unread = (why) => ({
    error: `${manifest} declares ${name}, and its installed copy cannot be read (${why}): run pnpm install --frozen-lockfile --offline`,
  });
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(readFileSync(copy, "utf8"));
  } catch (error) {
    return unread(messageOf(error));
  }
  if (!isObject(data)) return unread("its package.json is not a JSON object");
  const { bin } = data;
  if (bin === undefined) return { value: [] };
  if (typeof bin === "string") {
    const packageName = typeof data.name === "string" ? data.name : name;
    return { value: [packageName.replace(/^@[^/]+\//, "")] };
  }
  if (isObject(bin)) return { value: Object.keys(bin).sort(byCodeUnit) };
  return unread("its bin is neither a string nor an object");
}

/**
 * @description Reads the `bin` names of a declared package from the copy the first manifest that
 *   declares it outside `peerDependencies` installs. A peer is satisfied by a copy someone else
 *   installs, so a name declared only as a peer has no bins of its own to read.
 * @param {string} root Absolute repository root.
 * @param {readonly Declaration[]} declarations The legal scan's declarations.
 * @param {string} name The declared name.
 * @returns {Result<string[] | null>} The bin names, or `null` for a name no manifest declares
 *   outside `peerDependencies`.
 */
export function declaredBins(root, declarations, name) {
  const declaring = declarations.find(
    (declaration) => declaration.name === name && declaration.block !== "peerDependencies"
  );
  if (declaring === undefined) return { value: null };
  return readBins(root, path.posix.dirname(declaring.file), name);
}

/**
 * @description Reads the command lines of one manifest: its `scripts` values and, in the root
 *   manifest, its `lint-staged` commands.
 * @param {string} root Absolute repository root.
 * @param {string} file The manifest, repository-relative.
 * @returns {Result<string>} One command per line, empty for a manifest that runs none.
 */
function manifestCommands(root, file) {
  const text = readText(root, file);
  if ("error" in text) return text;
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text.value);
  } catch {
    return { error: `${file} is not JSON` };
  }
  if (!isObject(data)) return { error: `${file} is not a JSON object` };
  const scripts = isObject(data.scripts) ? Object.values(data.scripts) : [];
  const staged = data["lint-staged"];
  const lintStaged = file === ROOT_MANIFEST && isObject(staged) ? Object.values(staged).flat() : [];
  const commands = [...scripts, ...lintStaged].filter((command) => typeof command === "string");
  return { value: commands.join("\n") };
}

/**
 * @description Reads the command lines of a hook, a workflow, an action or a shell script: its
 *   text without the whole-line `#` comments, the shebang among them. A binary a comment names
 *   is not run, and a workflow's comments name tools far more often than its steps run them.
 * @param {string} root Absolute repository root.
 * @param {string} file The source, repository-relative.
 * @returns {Result<string>} The lines that are not comments.
 */
function scriptCommands(root, file) {
  const text = readText(root, file);
  if ("error" in text) return text;
  return {
    value: text.value
      .split("\n")
      .filter((line) => !COMMENT_LINE.test(line))
      .join("\n"),
  };
}

/**
 * @description Reads every command line a binary can run from: the `scripts` of each tracked
 *   manifest and the root manifest's `lint-staged`, the hooks directly under `.husky/`, the
 *   workflows under `.github/workflows/`, the composite actions under `.github/actions/` and
 *   every tracked shell script, the last four without their comment lines. A tracked source that
 *   cannot be read is an error.
 * @param {string} root Absolute repository root.
 * @param {readonly string[]} tracked Every tracked file, repository-relative.
 * @returns {Result<Array<[string, string]>>} Each source with its command lines, in code-unit
 *   order of the file; a manifest that runs no command is left out.
 */
export function binaryTexts(root, tracked) {
  /** @type {Array<[string, string]>} */
  const texts = [];
  for (const file of [...tracked].sort(byCodeUnit)) {
    const script = [HOOK, WORKFLOW, ACTION, SHELL_SCRIPT].some((shape) => shape.test(file));
    const read = MANIFEST.test(file)
      ? manifestCommands(root, file)
      : script
        ? scriptCommands(root, file)
        : null;
    if (read === null) continue;
    if ("error" in read) return read;
    if (read.value !== "") texts.push([file, read.value]);
  }
  return { value: texts };
}

/**
 * @description Escapes a string for use inside a regular expression.
 * @param {string} text Any text.
 * @returns {string} The text with every regular-expression metacharacter escaped.
 */
function escapeForPattern(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @description Finds the files whose command lines run one of a package's binaries. A bin name
 *   is a whole token: it starts a line or follows whitespace, a quote, `(`, `;`, `&`, `|` or `=`,
 *   and ends a line or precedes whitespace, a quote, `)`, `;`, `&` or `|`. So `prisma` is not read
 *   in `prisma-client`, `schema.prisma` or `./prisma/seed`, and `tsx` is not read in `tsxfoo`.
 * @param {string} name The declared package.
 * @param {readonly string[]} bins Its bin names.
 * @param {ReadonlyArray<readonly [string, string]>} texts What {@link binaryTexts} returned.
 * @returns {Site[]} One binary site per file, in code-unit order of the file.
 */
export function binarySites(name, bins, texts) {
  if (bins.length === 0) return [];
  const names = bins.map(escapeForPattern).join("|");
  const token = new RegExp(`(^|[\\s"'(;&|=])(?:${names})(?=$|[\\s"');&|])`, "m");
  return texts
    .filter(([, text]) => token.test(text))
    .map(([file]) => file)
    .sort(byCodeUnit)
    .map((file) => ({ name, kind: SITE_KINDS.BINARY, file }));
}

/**
 * @description Finds the declared packages each tracked stylesheet loads: `@import`, `@plugin` and
 *   `@config` with a quoted specifier, `url("…")` included, mapped to its package as a module
 *   specifier is. Comments are not read, and `@source`, which names files to scan rather than a
 *   module to load, is no site.
 * @param {string} root Absolute repository root.
 * @param {readonly string[]} tracked Every tracked file, repository-relative.
 * @param {ReadonlySet<string>} declared Every declared name.
 * @returns {Result<Site[]>} One stylesheet site per name and file, sorted by name and then file;
 *   an error for a tracked stylesheet that cannot be read.
 */
export function cssSites(root, tracked, declared) {
  /** @type {Site[]} */
  const sites = [];
  for (const file of tracked.filter((candidate) => STYLESHEET.test(candidate))) {
    const text = readText(root, file);
    if ("error" in text) return text;
    const uncommented = text.value.replace(BLOCK_COMMENT, "");
    const body = file.endsWith(".scss") ? uncommented.replace(LINE_COMMENT, "") : uncommented;
    /** @type {Set<string>} */
    const names = new Set();
    for (const match of body.matchAll(STYLESHEET_LOAD)) {
      const name = packageOf(match[2] ?? "");
      if (name !== null && declared.has(name)) names.add(name);
    }
    for (const name of names) sites.push({ name, kind: SITE_KINDS.CSS, file });
  }
  const byNameThenFile = (/** @type {Site} */ left, /** @type {Site} */ right) =>
    byCodeUnit(left.name, right.name) || byCodeUnit(left.file, right.file);
  return { value: sites.sort(byNameThenFile) };
}
