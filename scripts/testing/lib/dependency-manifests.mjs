// @ts-check
/**
 * @file dependency-manifests.mjs
 * @description The manifest side of the dependency-usage ledger: the workspace manifests the
 *   `packages:` globs of `pnpm-workspace.yaml` reach, checked against the set the legal scan of
 *   `scripts/legal/subprocessors.mjs` reads, and the catalogs a `catalog:` specifier resolves
 *   against. A reader that cannot read its whole input returns an error value, never an empty
 *   answer, so the command fails closed instead of counting a dependency unused from a partial
 *   read. Versions are never read: the lockfile and `pnpm-workspace.yaml` stay their source.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { readTopLevelBlock } from "../workspace-block-reader.mjs";

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
