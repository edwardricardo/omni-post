// @ts-check
/**
 * @file mutation-diff-hooks.mjs
 * @description The module customization hooks of a node:test run of the differential mutation
 *   tool, registered by `mutation-diff-register.mjs`: the Vite plugin's rules
 *   (`mutation-diff-plugin.mjs`), one for one, as Node's `resolve` and `load` hooks. A test file
 *   whose content the run serves (its text at the base, or at `--head`) loads with that text, and
 *   its path is appended to the run's served log, so the command proves each served file loaded;
 *   the subject, on a mutated run, has its search replaced at the first occurrence, literally (a
 *   `$` in the replacement is not a pattern), and the run's marker is written; a subject that lacks
 *   the search throws. Each keeps the format the rest of the chain gives the file, so tsx, whose
 *   hooks run before these, transforms the TypeScript they return. A test file the working tree
 *   lacks runs from a copy under the run's scratch directory, and its imports resolve from the
 *   original's path. Every other module passes through. Any role may run it: it writes only the
 *   marker and the served log the run's options name.
 * @layer infrastructure
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** @typedef {import("./mutation-diff-plugin.mjs").MutationOptions} MutationOptions */

/** This module's URL, which the register shim registers. */
export const HOOKS_URL = import.meta.url;

/**
 * @typedef {object} LoadResult What a `load` hook returns.
 * @property {string} [format]
 * @property {string | ArrayBuffer | NodeJS.TypedArray | null} [source]
 * @property {boolean} [shortCircuit]
 */

/** The run's options, read once per process by `initialize`; `null` passes everything through. */
/** @type {MutationOptions | null} */
let options = null;

/**
 * @description Reads the run's options JSON, whose path the register shim hands over.
 * @param {{ options?: string } | undefined} data
 * @public Node's module customization API calls it by name.
 */
export function initialize(data) {
  const file = data?.options;
  options =
    typeof file === "string" && file !== ""
      ? /** @type {MutationOptions} */ (JSON.parse(readFileSync(file, "utf8")))
      : null;
}

/**
 * @description The path a `file:` URL names, its query and fragment dropped, or `null` for any
 *   other URL.
 * @param {string | undefined} url
 * @returns {string | null}
 */
function pathOf(url) {
  return typeof url === "string" && url.startsWith("file:")
    ? fileURLToPath(url.split(/[?#]/)[0] ?? url)
    : null;
}

/**
 * @description A value of a record by key, own keys only.
 * @param {Readonly<Record<string, string>> | undefined} record
 * @param {string} key
 * @returns {string | undefined}
 */
function own(record, key) {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * @description Resolves a copy's imports from the path of the file it stands for, and every other
 *   importer's as they are.
 * @param {string} specifier
 * @param {{ parentURL?: string }} context
 * @param {(specifier: string, context: { parentURL?: string }) => Promise<unknown>} nextResolve
 * @returns {Promise<unknown>}
 * @public Node's module customization API calls it by name.
 */
export async function resolve(specifier, context, nextResolve) {
  const parent = pathOf(context.parentURL);
  const original = parent === null ? undefined : own(options?.aliases, parent);
  if (original === undefined) return nextResolve(specifier, context);
  return nextResolve(specifier, { ...context, parentURL: pathToFileURL(original).href });
}

/**
 * @description Serves a served file's text, mutates the subject on a mutated run, and hands every
 *   other module to the next hook.
 * @param {string} url
 * @param {object} context
 * @param {(url: string, context: object) => Promise<LoadResult>} nextLoad
 * @returns {Promise<LoadResult>}
 * @throws {Error} When the subject lacks the search.
 * @public Node's module customization API calls it by name.
 */
export async function load(url, context, nextLoad) {
  const file = pathOf(url);
  if (options === null || file === null) return nextLoad(url, context);
  const served = own(options.served, file);
  if (served !== undefined) {
    const loaded = await nextLoad(url, context);
    if (options.servedLog !== null) appendFileSync(options.servedLog, `${file}\n`);
    return { ...loaded, source: served, shortCircuit: true };
  }
  if (options.subject === null || file !== options.subject) return nextLoad(url, context);
  const loaded = await nextLoad(url, context);
  const code =
    loaded.source == null ? "" : Buffer.from(/** @type {never} */ (loaded.source)).toString("utf8");
  const { search, replace, marker, subject } = options;
  if (!code.includes(search))
    throw new Error(`mutation-diff: the search is absent from ${subject}`);
  if (marker !== null) writeFileSync(marker, "applied\n");
  return { ...loaded, source: code.replace(search, () => replace), shortCircuit: true };
}
