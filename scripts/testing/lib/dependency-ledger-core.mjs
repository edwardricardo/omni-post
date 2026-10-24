// @ts-check
/**
 * @file dependency-ledger-core.mjs
 * @description The core of the dependency-usage ledger: the rows the readers' outputs join into,
 *   one per declared name, with its declarations, its `bin` names, its sites by kind and path
 *   class and its real sites against the floor; the owner's decisions on the names under the
 *   floor and every rule they are held to; the summary; and the JSON the ledger renders to. It
 *   reads no file but the decisions file, through the legal inventories' `loadClassification`,
 *   and the Prettier configuration the record is rendered with.
 *
 *   Pessimistic by construction: a name is unjustified until its real sites reach the floor, a
 *   name under the floor with no entry is counted pending, and a reader result the core cannot
 *   classify (a catalog reference the catalogs lack, bins not read or an installed copy that
 *   cannot be read, unreadable stylesheets, a site of an undeclared name, a binary site of a name
 *   with no bins) stops the build instead of reading as zero.
 *
 *   One stage owns the order: `buildLedger` sorts the names, each name's declarations and each
 *   site list, so the record is the same bytes whatever order the readers hand their results in.
 *   No clock, no commit, no absolute path and no scan-size counter: the record moves only when a
 *   declaration, a verdict, a site of a name under the floor or a decision moves.
 * @layer infrastructure
 */
import { fileURLToPath } from "node:url";
import { loadClassification } from "../../legal/lib/inventory.mjs";
import { specifierKindOf } from "./dependency-manifests.mjs";
import {
  KIND_ORDER,
  PATH_CLASSES,
  SITE_KINDS,
  pathClassOf,
  typedTargetOf,
} from "./dependency-sites.mjs";
import { byCodeUnit, isObject, renderJson } from "./record-helpers.mjs";

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
 *   sorted: {@link buildLedger} owns the order. A reader result it cannot classify is an error,
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

/** The owner's three outcomes: debug and keep, destroy, or not decided yet. */
export const STATUSES = Object.freeze(/** @type {const} */ (["kept", "remove", "pending"]));

/**
 * @typedef {typeof STATUSES[number]} Status
 *
 * @typedef {object} Decisions The owner's decisions, as `loadDecisions` reads them.
 * @property {ReadonlyMap<string, unknown>} entries Each entry as written, by name.
 * @property {number} pendingBaseline
 * @property {unknown} floor The file's `floor`, `null` when it has none.
 * @property {readonly string[]} problems The reader's own refusals.
 *
 * @typedef {Row & { decision: Status | null }} JoinedRow A row with its decision: the entry's
 *   status or `pending` under the floor, `remove` or `null` above it.
 *
 * @typedef {object} Joined
 * @property {JoinedRow[]} rows In the order they were given.
 * @property {string[]} problems
 * @property {number} pending
 */

/**
 * Why a name under the floor is kept, one per entry: one adapter per SDK, a CLI scripts run, a
 * plugin a host loads by name, a type package, a peer range it satisfies, a CVE floor it holds, a
 * load from code the tree does not track, or a use the owner judges real.
 */
export const GROUNDS = Object.freeze([
  "single-adapter",
  "tool",
  "plugin",
  "types",
  "peer",
  "cve-floor",
  "generated",
  "in-use",
]);

/** The owner's decisions, beside the other machine-read records of `scripts/testing/`. */
export const DECISIONS_FILE = "scripts/testing/dependency-decisions.json";

/** The command that writes the ledger, which the decisions file names. */
const GENERATOR = "scripts/testing/dependency-ledger.mjs";

/** The keys a decisions file may hold at its top level. */
const DECISIONS_KEYS = Object.freeze(["generator", "floor", "pendingBaseline", "entries"]);

/** What `loadClassification` admits in an entry of the decisions file. */
export const ALLOWED = Object.freeze({
  statuses: STATUSES,
  categories: Object.freeze([]),
  subjects: Object.freeze([]),
  extraFields: Object.freeze({
    utility: false,
    replacement: false,
    decidedOn: false,
    grounds: false,
    slice: false,
  }),
  optionalNote: Object.freeze(["pending"]),
});

/**
 * The fields each status needs, and the ones it never carries: `kept` justifies the name and
 * says what could replace it, `remove` names what replaces it, `pending` holds a note and nothing
 * else.
 * @type {Readonly<Record<string, { needs: readonly string[], never: readonly string[] }>>}
 */
const STATUS_FIELDS = Object.freeze({
  kept: { needs: ["grounds", "utility", "replacement", "decidedOn"], never: ["slice"] },
  remove: { needs: ["utility", "replacement", "decidedOn"], never: ["grounds"] },
  pending: { needs: [], never: ["grounds", "utility", "replacement", "decidedOn", "slice"] },
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @description Reads the owner's decisions, `{ generator, floor, pendingBaseline, entries }`,
 *   through `loadClassification`, which refuses an entry with an unknown key, a status outside
 *   {@link STATUSES} or, for `kept` and `remove`, no note. A file that is missing, empty or no
 *   JSON is an error, never an empty set of decisions. The file is parsed here too, because the
 *   loader returns no top-level field but the baseline and the entries: an unknown top-level key,
 *   a generator that is not the ledger's command and a top level that is no object are problems.
 * @param {string} root Absolute repository root.
 * @returns {Result<Decisions>} The entries as written, the baseline, the floor and the problems.
 */
export function loadDecisions(root) {
  const loaded = loadClassification(root, DECISIONS_FILE, ALLOWED);
  if (loaded.text.trim() === "") return { error: `${DECISIONS_FILE} is missing or empty` };
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(loaded.text);
  } catch (error) {
    return { error: `${DECISIONS_FILE} is not JSON: ${String(error)}` };
  }
  const top = isObject(data) ? data : {};
  const problems = [...loaded.problems];
  const unknown = Object.keys(top).filter((key) => !DECISIONS_KEYS.includes(key));
  if (unknown.length > 0) problems.push(`${DECISIONS_FILE} has unknown keys ${unknown.join(", ")}`);
  if (top.generator !== GENERATOR) {
    const written = JSON.stringify(top.generator ?? null);
    problems.push(`${DECISIONS_FILE}: generator ${written} is not ${GENERATOR}`);
  }
  const { entries, pendingBaseline } = loaded;
  return { value: { entries, pendingBaseline, floor: top.floor ?? null, problems } };
}

/**
 * @description Says whether a value names a calendar day as `YYYY-MM-DD`. Kept a named predicate
 *   because the round trip through `Date` is the rule: the pattern alone admits `2026-02-30`.
 * @param {unknown} value Any value.
 * @returns {boolean} `true` for a real date in that form.
 */
function isDate(value) {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(value);
}

/**
 * @description Holds one entry to the rules of its status: the fields it needs and the ones it
 *   never carries, grounds one of {@link GROUNDS}, a decision date that is a calendar day, and no
 *   `manual` flag, which belongs to the legal inventory. A status the reader refused has no rules
 *   to hold; the reader already reported it.
 * @param {string} name The entry's name.
 * @param {Record<string, unknown>} entry The entry as written.
 * @returns {string[]} One problem per rule it breaks.
 */
function entryProblems(name, entry) {
  /** @type {string[]} */
  const problems = [];
  if (entry.manual !== undefined) problems.push(`${name}: manual belongs to the legal inventory`);
  const status = String(entry.status);
  const rules = Object.hasOwn(STATUS_FIELDS, status) ? STATUS_FIELDS[status] : undefined;
  if (rules === undefined) return problems;
  for (const field of rules.needs) {
    if (entry[field] === undefined) problems.push(`${name}: a ${status} entry needs ${field}`);
  }
  for (const field of rules.never) {
    if (entry[field] !== undefined) {
      problems.push(`${name}: a ${status} entry never carries ${field}`);
    }
  }
  const { grounds, decidedOn } = entry;
  if (status === "kept" && grounds !== undefined && !GROUNDS.includes(String(grounds))) {
    problems.push(`${name} has grounds ${JSON.stringify(grounds)}, not ${GROUNDS.join("|")}`);
  }
  if (rules.needs.includes("decidedOn") && decidedOn !== undefined && !isDate(decidedOn)) {
    problems.push(`${name} has decidedOn ${JSON.stringify(decidedOn)}, not a YYYY-MM-DD date`);
  }
  return problems;
}

/**
 * @description Reads the status of an entry as written, when it is one of {@link STATUSES}.
 * @param {Record<string, unknown>} entry The entry, an empty object for one that is no object.
 * @returns {Status | null} The status, or `null` for none or one the reader refused.
 */
function statusOf(entry) {
  const { status } = entry;
  return STATUSES.find((known) => known === status) ?? null;
}

/**
 * @description Joins the rows with the owner's decisions. A name under the floor takes its
 *   entry's status, or `pending` without one; a name at or above it takes `remove` from an entry
 *   or nothing. An entry that breaks its status's rules, an entry above the floor that is not
 *   `remove`, an entry no manifest declares and a floor other than {@link REAL_SITE_FLOOR} are
 *   problems. The pending names must number exactly `pendingBaseline`, so a new name under the
 *   floor fails until it is decided, and a decision lowers the baseline in the same change.
 * @param {readonly Row[]} rows The rows.
 * @param {Decisions} decisions What {@link loadDecisions} read.
 * @returns {Joined} The rows with their decisions, every problem with the reader's first, and the
 *   pending count.
 */
export function joinDecisions(rows, decisions) {
  const problems = [...decisions.problems];
  if (decisions.floor !== REAL_SITE_FLOOR) {
    const written = JSON.stringify(decisions.floor);
    problems.push(
      `${DECISIONS_FILE}: floor ${written} is not the real-site floor ${REAL_SITE_FLOOR}`
    );
  }
  const verdicts = new Map(rows.map((row) => [row.name, row.verdict]));
  /** @type {Map<string, Status>} */
  const statuses = new Map();
  for (const [name, raw] of decisions.entries) {
    const entry = isObject(raw) ? raw : {};
    problems.push(...entryProblems(name, entry));
    const status = statusOf(entry);
    if (status !== null) statuses.set(name, status);
    const verdict = verdicts.get(name);
    if (verdict === undefined) {
      problems.push(`${name}: no manifest declares it: delete the entry with its declaration`);
    } else if (verdict === VERDICTS.ABOVE && status !== "remove") {
      const label = status === null ? "an entry with no status" : `a ${status} entry`;
      problems.push(`${name}: ${label} above the floor, which justifies it: delete the entry`);
    }
  }
  /** @type {JoinedRow[]} */
  const joined = rows.map((row) => {
    const status = statuses.get(row.name) ?? null;
    const under = row.verdict === VERDICTS.UNDER;
    const decision = under ? (status ?? "pending") : status === "remove" ? status : null;
    return { ...row, decision };
  });
  const pendingNames = joined.filter((row) => row.decision === "pending").map((row) => row.name);
  const pending = pendingNames.length;
  const baseline = decisions.pendingBaseline;
  if (pending > baseline) {
    const names = [...pendingNames].sort(byCodeUnit).join(", ");
    problems.push(
      `${pending} pending exceed pendingBaseline ${baseline}: decide ${names} or raise the baseline visibly`
    );
  }
  if (pending < baseline)
    problems.push(`stale pendingBaseline ${baseline}: lower it to ${pending}`);
  return { rows: joined, problems, pending };
}

/**
 * @typedef {object} LedgerRow One name of the rendered ledger.
 * @property {string} name
 * @property {Scope} scope
 * @property {string | null} typedTarget
 * @property {RowDeclaration[]} declarations By manifest, then block.
 * @property {string[] | null} bins
 * @property {Verdict} verdict
 * @property {number | null} real The real sites of a name under the floor, else `null`.
 * @property {Status | null} decision
 * @property {Sites | null} sites The sites of a name under the floor, ordered, else `null`.
 *
 * @typedef {object} Summary The counts of the ledger, a fixed set of keys.
 * @property {number} names
 * @property {number} production
 * @property {number} devOnly
 * @property {number} types The `@types/*` rows.
 * @property {number} aboveFloor
 * @property {number} underFloor
 * @property {number} atZero The names under the floor with no real site.
 * @property {number} underFloorWithSites
 * @property {number} kept
 * @property {number} remove
 * @property {number} pending
 *
 * @typedef {object} Ledger
 * @property {number} version
 * @property {number} floor
 * @property {Summary} summary
 * @property {LedgerRow[]} names
 */

/** The version of the ledger's JSON; a change of a row's shape raises it. */
export const LEDGER_VERSION = 1;

/** The file the record is committed as, at the repository root. */
export const RECORD_FILE = "dependency-ledger.json";

/** This repository's record, whose Prettier configuration every record is rendered with. */
const RECORD_PATH = fileURLToPath(new URL(`../../../${RECORD_FILE}`, import.meta.url));

/**
 * @description Copies a row's sites into their canonical order: kinds as `SITE_KINDS` lists
 *   them, classes as `PATH_CLASSES` does, each list of files sorted; empty kinds left out.
 * @param {Sites} sites Sites in any order.
 * @returns {Sites} The same sites, ordered.
 */
function orderedSites(sites) {
  /** @type {Sites} */
  const ordered = {};
  for (const kind of KIND_ORDER) {
    const byClass = sites[kind];
    if (byClass === undefined) continue;
    /** @type {Partial<Record<PathClass, string[]>>} */
    const sorted = {};
    for (const pathClass of CLASS_ORDER) {
      const files = byClass[pathClass];
      if (files !== undefined) sorted[pathClass] = [...files].sort(byCodeUnit);
    }
    ordered[kind] = sorted;
  }
  return ordered;
}

/**
 * @description Shapes a joined row into the ledger's: declarations by manifest and block, and the
 *   real sites and ordered sites of a name under the floor only, so a site added to a name above
 *   it never moves the record.
 * @param {JoinedRow} row A joined row.
 * @returns {LedgerRow} The ledger's row, in its key order.
 */
function ledgerRow(row) {
  const under = row.verdict === VERDICTS.UNDER;
  return {
    name: row.name,
    scope: row.scope,
    typedTarget: row.typedTarget,
    declarations: [...row.declarations].sort(
      (left, right) =>
        byCodeUnit(left.manifest, right.manifest) || byCodeUnit(left.block, right.block)
    ),
    bins: row.bins,
    verdict: row.verdict,
    real: under ? row.real : null,
    decision: row.decision,
    sites: under ? orderedSites(row.sites) : null,
  };
}

/**
 * @description Counts the ledger's rows: names, scopes, `@types/*` rows, verdicts, the names
 *   under the floor with no site and with some, and each decision. No count of manifests or files
 *   scanned: the record moves only on a fact a decision depends on.
 * @param {readonly LedgerRow[]} rows The ledger's rows.
 * @returns {Summary} The counts, in a fixed key order.
 */
export function summarize(rows) {
  /** @param {(row: LedgerRow) => boolean} test */
  const count = (test) => rows.filter(test).length;
  return {
    names: rows.length,
    production: count((row) => row.scope === SCOPES.PRODUCTION),
    devOnly: count((row) => row.scope === SCOPES.DEV_ONLY),
    types: count((row) => row.typedTarget !== null),
    aboveFloor: count((row) => row.verdict === VERDICTS.ABOVE),
    underFloor: count((row) => row.verdict === VERDICTS.UNDER),
    atZero: count((row) => row.real === 0),
    underFloorWithSites: count((row) => row.real !== null && row.real > 0),
    kept: count((row) => row.decision === "kept"),
    remove: count((row) => row.decision === "remove"),
    pending: count((row) => row.decision === "pending"),
  };
}

/**
 * @description Assembles the ledger, the one stage that orders it: the names in code-unit order,
 *   joined with the decisions, each shaped by `ledgerRow`, and the summary derived from them. The
 *   decisions' problems are returned beside the ledger, which is still written so the owner sees
 *   the record the problems are about.
 * @param {readonly Row[]} rows The rows, in any order.
 * @param {Decisions} decisions What {@link loadDecisions} read.
 * @returns {{ ledger: Ledger, problems: string[] }} The ledger and its problems.
 */
export function buildLedger(rows, decisions) {
  const sorted = [...rows].sort((left, right) => byCodeUnit(left.name, right.name));
  const joined = joinDecisions(sorted, decisions);
  const names = joined.rows.map(ledgerRow);
  const ledger = {
    version: LEDGER_VERSION,
    floor: REAL_SITE_FLOOR,
    summary: summarize(names),
    names,
  };
  return { ledger, problems: joined.problems };
}

/**
 * @description Renders the ledger as the JSON text that is committed, with the Prettier
 *   configuration of {@link RECORD_FILE} in this repository, the rule the test ledger follows too,
 *   so `pnpm format:check` passes over the committed file and a planted tree renders the same
 *   bytes on every host. It orders nothing: {@link buildLedger} did.
 * @param {Ledger} ledger What {@link buildLedger} returned.
 * @returns {Promise<string>} The text, ending in a newline.
 */
export function render(ledger) {
  return renderJson(RECORD_PATH, ledger);
}
