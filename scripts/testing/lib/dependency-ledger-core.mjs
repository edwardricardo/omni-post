// @ts-check
/**
 * @file dependency-ledger-core.mjs
 * @description The core of the dependency-usage ledger: the rows the readers' outputs join into,
 *   one per declared name, with its declarations, its `bin` names, its sites by kind and path
 *   class and its real sites against the floor. It reads no file.
 *
 *   Pessimistic by construction: a name is unjustified until its real sites reach the floor, and a
 *   reader result the core cannot classify (a catalog reference the catalogs lack, bins not read or
 *   an installed copy that cannot be read, unreadable stylesheets, a site of an undeclared name, a
 *   binary site of a name with no bins) stops the build instead of reading as zero.
 *
 *   Nothing here sorts: rows, declarations and sites keep the order the readers hand them in.
 * @layer infrastructure
 */
import { specifierKindOf } from "./dependency-manifests.mjs";
import { PATH_CLASSES, SITE_KINDS, pathClassOf, typedTargetOf } from "./dependency-sites.mjs";

/**
 * @template T
 * @typedef {{ value: T } | { error: string }} Result
 */

/**
 * @typedef {import("./dependency-sites.mjs").SiteKind} SiteKind
 * @typedef {import("./dependency-sites.mjs").PathClass} PathClass
 * @typedef {import("./dependency-sites.mjs").Site} Site
 * @typedef {import("./dependency-manifests.mjs").Catalogs} Catalogs
 * @typedef {import("./dependency-manifests.mjs").Declaration} Declaration
 */

/**
 * The fewest real sites, distinct files counted by the rule of {@link realSitesOf}, that justify a
 * name without an owner's entry. One floor for every kind: lowering it is a decision, recorded.
 */
export const REAL_SITE_FLOOR = 3;

/** A name's scope, the legal scan's: production when a non-tooling manifest needs it to run. */
const SCOPES = Object.freeze(
  /** @type {const} */ ({ PRODUCTION: "production", DEV_ONLY: "dev-only" })
);

/** Whether a name's real sites reach the floor. */
const VERDICTS = Object.freeze(
  /** @type {const} */ ({ ABOVE: "above-floor", UNDER: "under-floor" })
);

/**
 * @typedef {typeof SCOPES[keyof typeof SCOPES]} Scope
 * @typedef {typeof VERDICTS[keyof typeof VERDICTS]} Verdict
 *
 * @typedef {Partial<Record<SiteKind, Partial<Record<PathClass, string[]>>>>} Sites A name's sites:
 *   kind, then path class, then the files.
 *
 * @typedef {object} RowDeclaration One declaration of a row.
 * @property {string} manifest The declaring manifest, repository-relative.
 * @property {string} block The manifest block that declares it.
 * @property {string} specifier `catalog`, `catalog:<name>` or `literal`.
 *
 * @typedef {object} Counted What the real-site rule reads of a row.
 * @property {Scope} scope
 * @property {string | null} typedTarget What an `@types/*` row types, else `null`.
 * @property {Sites} sites
 *
 * @typedef {object} Row One declared name with everything the readers found for it.
 * @property {string} name
 * @property {Scope} scope
 * @property {string | null} typedTarget
 * @property {RowDeclaration[]} declarations In the order the scan lists them.
 * @property {string[] | null} bins Its `bin` names; `null` for a name declared only as a peer.
 * @property {Sites} sites In the order the readers found them.
 * @property {number} real Its real sites.
 * @property {Verdict} verdict
 *
 * @typedef {object} Scan The legal scan's names and declarations.
 * @property {ReadonlyMap<string, { production: boolean }>} names
 * @property {readonly Declaration[]} declarations
 *
 * @typedef {object} RowsInput What the readers hand the core.
 * @property {Scan} scan
 * @property {Catalogs} catalogs
 * @property {readonly Site[]} sites The module and binary sites.
 * @property {Result<Site[]>} css The stylesheet sites, as `cssSites` returned them.
 * @property {ReadonlyMap<string, Result<string[] | null>>} bins Each name's `declaredBins` result.
 * @property {readonly string[]} workspaceDirs The directories of the workspace manifests.
 */

const { RUNTIME_IMPORT, TYPE_ONLY, CONFIG_STRING, CSS, BINARY } = SITE_KINDS;
/** @type {readonly PathClass[]} */
const CLASS_ORDER = Object.values(PATH_CLASSES);

/** @typedef {ReadonlyArray<readonly [SiteKind, readonly PathClass[]]>} Rule */

/**
 * An `@types/*` row counts the type-only files of its target, in any class.
 * @type {Rule}
 */
const TYPES_RULE = [[TYPE_ONLY, CLASS_ORDER]];

/**
 * What each scope counts. A production name counts what production code loads, so a production
 * dependency only tests, configs or scripts use reads as misdeclared or dead. A dev-only name
 * counts every load, every binary run and the config strings of configuration files. A type-only
 * import, a mock and a string in code count for nothing.
 * @type {Readonly<Record<Scope, Rule>>}
 */
const SCOPE_RULES = Object.freeze({
  [SCOPES.PRODUCTION]: [
    [RUNTIME_IMPORT, [PATH_CLASSES.PRODUCTION]],
    [CSS, [PATH_CLASSES.PRODUCTION]],
  ],
  [SCOPES.DEV_ONLY]: [
    [RUNTIME_IMPORT, CLASS_ORDER],
    [CSS, CLASS_ORDER],
    [BINARY, CLASS_ORDER],
    [CONFIG_STRING, [PATH_CLASSES.CONFIG]],
  ],
});

/**
 * @description Counts the real sites of a row: the distinct files that hold a site of a kind and
 *   class its row counts, `TYPES_RULE` for an `@types/*` row and `SCOPE_RULES` otherwise. A file
 *   is one site however many of its lines load the name and through however many kinds, so a
 *   barrel or a long script cannot inflate the count.
 * @param {Counted} row The row's scope, typed target and sites.
 * @returns {number} The real sites.
 */
export function realSitesOf(row) {
  const rule = row.typedTarget !== null ? TYPES_RULE : SCOPE_RULES[row.scope];
  /** @type {Set<string>} */
  const files = new Set();
  for (const [kind, classes] of rule) {
    for (const pathClass of classes) {
      for (const file of row.sites[kind]?.[pathClass] ?? []) files.add(file);
    }
  }
  return files.size;
}

/**
 * @description Says whether a count of real sites reaches the floor.
 * @param {number} real A row's real sites.
 * @returns {Verdict} `above-floor` at or above {@link REAL_SITE_FLOOR}, else `under-floor`.
 */
export function verdictOf(real) {
  return real >= REAL_SITE_FLOOR ? VERDICTS.ABOVE : VERDICTS.UNDER;
}

/**
 * @description Joins the readers' outputs into one row per declared name: its scope, the target
 *   it types, its declarations with each specifier read as a kind, its `bin` names, its sites
 *   grouped by kind and path class, and its real sites and verdict, counted once here. Nothing is
 *   sorted. A reader result it cannot classify is an error,
 *   which the command reports as an unread input: a catalog reference the catalogs do not hold, a
 *   name whose bins were not read or could not be, stylesheets that could not be read, a site of a
 *   name no manifest declares, and a binary site of a name with no bins.
 * @param {RowsInput} input The readers' outputs.
 * @returns {Result<Row[]>} One row per name, in the scan's order, or the first error.
 */
export function buildRows({ scan, catalogs, sites, css, bins, workspaceDirs }) {
  if ("error" in css) return css;
  /** @type {Map<string, Sites>} */
  const grouped = new Map();
  for (const { name, kind, file } of [...sites, ...css.value]) {
    if (!scan.names.has(name)) {
      return { error: `${file} holds a ${kind} site of ${name}, which no manifest declares` };
    }
    const named = grouped.get(name) ?? {};
    const byClass = (named[kind] ??= {});
    (byClass[pathClassOf(file, workspaceDirs)] ??= []).push(file);
    grouped.set(name, named);
  }
  /** @type {Row[]} */
  const rows = [];
  for (const [name, { production }] of scan.names) {
    /** @type {RowDeclaration[]} */
    const declarations = [];
    for (const declaration of scan.declarations.filter((item) => item.name === name)) {
      const kind = specifierKindOf(declaration.spec, catalogs, name);
      if ("error" in kind) return kind;
      const { file: manifest, block } = declaration;
      declarations.push({ manifest, block, specifier: kind.value });
    }
    const read = bins.get(name);
    if (read === undefined) return { error: `no bins were read for ${name}` };
    if ("error" in read) return read;
    const named = grouped.get(name) ?? {};
    if (named[BINARY] !== undefined && (read.value === null || read.value.length === 0)) {
      return { error: `${name} has binary sites but no bins` };
    }
    const scope = production ? SCOPES.PRODUCTION : SCOPES.DEV_ONLY;
    const typedTarget = typedTargetOf(name);
    const real = realSitesOf({ scope, typedTarget, sites: named });
    rows.push({
      name,
      scope,
      typedTarget,
      declarations,
      bins: read.value,
      sites: named,
      real,
      verdict: verdictOf(real),
    });
  }
  return { value: rows };
}
