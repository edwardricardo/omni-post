// @ts-check
/**
 * @file mutation-diff-plugin.mjs
 * @description The Vite plugin of the differential mutation tool, prepended to a package's vitest
 *   config by the config `scripts/testing/mutation-diff.mjs` generates for each run. It runs first
 *   (`enforce: "pre"`), so it sees each module's text as read from disk, before the TypeScript
 *   transform. A test file whose content the run serves (its text at the base, or at `--head`) is
 *   replaced by that text, and its id is logged, so the command proves each served file was
 *   transformed; the subject, on a mutated run, has its search replaced at the first occurrence,
 *   literally (a `$` in the replacement is not a pattern), and the run's marker is written, so a
 *   mutated run whose subject no test loaded is never a verdict. A subject that lacks the search
 *   throws. A test file the working tree lacks runs from a copy under the run's scratch directory:
 *   the plugin resolves the copy's imports from the file's own path, so its relative imports and
 *   mocks reach the modules they name. Every other module passes through untouched.
 * @layer infrastructure
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** This module's absolute path, which each generated config imports. */
export const PLUGIN_FILE = fileURLToPath(import.meta.url);

/**
 * @typedef {object} MutationOptions What one run's plugin does.
 * @property {string | null} subject The subject's absolute path on a mutated run, else `null`.
 * @property {string} search
 * @property {string} replace
 * @property {string | null} marker The file written once the mutation is applied.
 * @property {Readonly<Record<string, string>>} served Each served test file's text, by absolute path.
 * @property {string | null} servedLog The file each served id is appended to.
 * @property {Readonly<Record<string, string>>} aliases Each copy's absolute path to the absolute
 *   path of the file it stands for.
 */

/**
 * @typedef {object} MutationPlugin The plugin, as Vite calls it.
 * @property {string} name
 * @property {"pre"} enforce
 * @property {(code: string, id: string) => { code: string, map: null } | null} transform
 * @property {(this: { resolve: (source: string, importer: string, options: object) => Promise<unknown> }, source: string, importer: string | undefined, options: object) => Promise<unknown>} resolveId
 */

/**
 * @description Builds the plugin of one run: it serves the run's test file contents and mutates
 *   its subject.
 * @param {MutationOptions} options
 * @returns {MutationPlugin}
 */
export function mutationPlugin({ subject, search, replace, marker, served, servedLog, aliases }) {
  const contents = new Map(Object.entries(served));
  const originals = new Map(Object.entries(aliases ?? {}));
  return {
    name: "mutation-diff",
    enforce: "pre",
    async resolveId(source, importer, options) {
      const original =
        importer === undefined ? undefined : originals.get(importer.split("?")[0] ?? importer);
      if (original === undefined) return null;
      return this.resolve(source, original, { ...options, skipSelf: true });
    },
    transform(code, id) {
      const file = id.split("?")[0] ?? id;
      const text = contents.get(file);
      if (text !== undefined) {
        if (servedLog !== null) appendFileSync(servedLog, `${file}\n`);
        return { code: text, map: null };
      }
      if (subject === null || file !== subject) return null;
      if (!code.includes(search)) {
        throw new Error(`mutation-diff: the search is absent from ${subject}`);
      }
      if (marker !== null) writeFileSync(marker, "applied\n");
      return { code: code.replace(search, () => replace), map: null };
    },
  };
}
