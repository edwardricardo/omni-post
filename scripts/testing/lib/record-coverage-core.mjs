// @ts-check
/**
 * @file record-coverage-core.mjs
 * @description The pure core of the record-coverage gate, fitness #54, and the direct-import read
 *   it shares with the differential mutation tool's scope: which test blocks a pull request binds
 *   (a ledger id the head lost, or one whose `bodyHash` changed), the class each one falls in, the
 *   shape of a mutation-diff record, and the files a module names directly. It reads no file and
 *   spawns nothing, and it imports Node's own modules only, so the gate runs in a job that installs
 *   nothing; `scripts/testing/record-coverage-gate.mjs` reads git and the tree and hands it here.
 *
 *   THE CLASSES, in order: moved (a deleted block whose base `bodyHash` the head holds under
 *   an id the base did not hold), node (a block of a node:test row, counted until the node:test adapter exists), behaviour
 *   change (its test names a changed source directly, or its record says BEHAVIOUR-CHANGED),
 *   covered (a record case lists it with both hashes equal to the ledgers and SAFE for a deletion
 *   or GAIN for a rewrite), and refused, named by its reason: `no-record`, `stale-record`,
 *   `wrong-kind` or `failing-verdict: <verdict>`.
 * @layer infrastructure
 */
import path from "node:path";

/**
 * A module specifier of an `import … from`, an `export … from`, a bare `import "…"` or an
 * `import("…")`: the cheap static read both callers make.
 */
const SPECIFIER =
  /\b(?:import|export)\b[^'"`;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** The extensions a specifier without one, or with a JavaScript one, may resolve to. */
const RESOLVED_EXTENSIONS = Object.freeze([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".jsx"]);

/** The verdicts that cover each kind of bound block. */
const ACCEPTED = Object.freeze({
  deletion: Object.freeze(["SAFE", "BEHAVIOUR-CHANGED"]),
  rewrite: Object.freeze(["GAIN", "BEHAVIOUR-CHANGED"]),
});

/** The order the gate prints its listed and refused blocks in. */
const CLASS_ORDER = Object.freeze(["refused", "behaviour change", "node", "moved"]);

/**
 * @typedef {"deletion" | "rewrite"} Kind
 * @typedef {{ pattern: string, targets: string[] }} Alias
 * @typedef {{ base: string | null, head: string | null }} Hashes
 * @typedef {{ id: string, path: string, framework: string, bodyHash: string }} LedgerBlock
 * @typedef {{ blocks: Map<string, LedgerBlock>, paths: Set<string> }} LedgerIndex
 * @typedef {{ id: string, path: string, headPath: string, framework: string, kind: Kind, hashes: Hashes, movedTo: string | null }} Bound
 * @typedef {{ cls: string, id: string, kind: Kind, detail: string }} Entry
 * @typedef {{ id: string, kind: string, verdict: string, blocks: { id: string, bodyHash: Hashes }[] }} RecordCase
 * @typedef {{ file: string, cases: RecordCase[] }} CommittedRecord
 */

/**
 * @description Says whether a value is a plain object.
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @description Compares two strings by code unit, the order every list here is printed in.
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function byCodeUnit(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * @description The repository-relative paths one resolved base may name: itself, the TypeScript
 *   source a JavaScript name stands for, the name with each extension, and a directory's index.
 * @param {string} joined
 * @returns {string[]}
 */
function formsOf(joined) {
  return [
    joined,
    joined.replace(/\.(m|c)?js$/, ".$1ts"),
    joined.replace(/\.jsx$/, ".tsx"),
    ...RESOLVED_EXTENSIONS.map((extension) => `${joined}${extension}`),
    ...RESOLVED_EXTENSIONS.map((extension) => `${joined}/index${extension}`),
  ];
}

/**
 * @description Reads the path mappings of a parsed `tsconfig.base.json`: each `compilerOptions.paths`
 *   pattern with its targets, resolved against `baseUrl` (the repository root when unset).
 * @param {unknown} tsconfig
 * @returns {Alias[]}
 */
export function pathAliasesOf(tsconfig) {
  const options = isObject(tsconfig) ? tsconfig["compilerOptions"] : undefined;
  const paths = isObject(options) ? options["paths"] : undefined;
  if (!isObject(options) || !isObject(paths)) return [];
  const baseUrl = typeof options["baseUrl"] === "string" ? options["baseUrl"] : ".";
  return Object.entries(paths).flatMap(([pattern, targets]) =>
    Array.isArray(targets)
      ? [
          {
            pattern,
            targets: targets
              .filter((target) => typeof target === "string")
              .map((target) => path.posix.normalize(path.posix.join(baseUrl, target))),
          },
        ]
      : []
  );
}

/**
 * @description The bases a bare specifier names through the path mappings: an exact pattern's
 *   targets, or a `*` pattern's targets with the captured part in place of their `*`.
 * @param {string} specifier
 * @param {readonly Alias[]} aliases
 * @returns {string[]}
 */
function aliasTargets(specifier, aliases) {
  return aliases.flatMap(({ pattern, targets }) => {
    const star = pattern.indexOf("*");
    if (star === -1) return pattern === specifier ? targets : [];
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    const fits =
      specifier.length >= prefix.length + suffix.length &&
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix);
    if (!fits) return [];
    const captured = specifier.slice(prefix.length, specifier.length - suffix.length);
    return targets.map((target) => target.replace("*", captured));
  });
}

/**
 * @description Every repository-relative path a module imports directly: its relative specifiers
 *   resolved against its own directory, and its path-mapped bare specifiers when `aliases` are
 *   given. A string literal that holds a path is not an import, and is not read.
 * @param {string} file The module, repository-relative.
 * @param {string} text
 * @param {readonly Alias[]} [aliases]
 * @returns {Set<string>}
 */
function namedFiles(file, text, aliases = []) {
  /** @type {Set<string>} */
  const named = new Set();
  for (const match of text.matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? "";
    const bases = specifier.startsWith(".")
      ? [path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))]
      : aliasTargets(specifier, aliases);
    for (const base of bases) for (const form of formsOf(base)) named.add(form);
  }
  return named;
}

/**
 * @description Says whether a module imports the subject directly by a relative specifier: the
 *   rule the mutation tool's default scope uses.
 * @param {string} file The module, repository-relative.
 * @param {string} text
 * @param {string} subject Repository-relative.
 * @returns {boolean}
 */
export function importsSubject(file, text, subject) {
  return namedFiles(file, text).has(subject);
}

/**
 * @description The changed sources a test imports directly, by a relative specifier or a
 *   path-mapped one.
 * @param {string} file The test, repository-relative.
 * @param {string} text Its text on the side the block is read at.
 * @param {readonly string[]} sources The changed files that are no ledger row.
 * @param {readonly Alias[]} aliases
 * @returns {string[]} Sorted.
 */
export function changedImports(file, text, sources, aliases) {
  const named = namedFiles(file, text, aliases);
  return sources.filter((source) => named.has(source)).sort(byCodeUnit);
}

/**
 * @description Indexes a parsed `ledger.json`: every block by id with its row's path and framework,
 *   and every row's path.
 * @param {unknown} ledger
 * @returns {{ value: LedgerIndex } | { error: string }}
 */
export function ledgerIndexOf(ledger) {
  const files = isObject(ledger) ? ledger["files"] : undefined;
  if (!Array.isArray(files)) return { error: "has no files array" };
  /** @type {LedgerIndex} */
  const index = { blocks: new Map(), paths: new Set() };
  for (const row of files.filter(isObject)) {
    if (typeof row["path"] !== "string") continue;
    const file = row["path"];
    index.paths.add(file);
    const blocks = Array.isArray(row["blocks"]) ? row["blocks"] : [];
    for (const block of blocks.filter(isObject)) {
      const { id, bodyHash } = block;
      if (typeof id !== "string" || typeof bodyHash !== "string") continue;
      index.blocks.set(id, { id, path: file, framework: String(row["framework"]), bodyHash });
    }
  }
  return { value: index };
}

/**
 * @description The blocks a pull request binds: each base id the head lacks (a deletion, with the
 *   new id the head holds its `bodyHash` under, when one does: an id the base did not hold, so a
 *   copy that both sides hold is never a move) and each id whose `bodyHash` changed (a
 *   rewrite), sorted by id.
 * @param {LedgerIndex} base
 * @param {LedgerIndex} head
 * @returns {Bound[]}
 */
export function boundBlocks(base, head) {
  /** @type {Map<string, string>} */
  const holders = new Map();
  for (const block of head.blocks.values()) {
    if (base.blocks.has(block.id)) continue;
    const held = holders.get(block.bodyHash);
    if (held === undefined || byCodeUnit(block.id, held) < 0) holders.set(block.bodyHash, block.id);
  }
  /** @type {Bound[]} */
  const bound = [];
  for (const block of base.blocks.values()) {
    const now = head.blocks.get(block.id);
    if (now === undefined) {
      bound.push({
        ...block,
        headPath: block.path,
        kind: "deletion",
        hashes: { base: block.bodyHash, head: null },
        movedTo: holders.get(block.bodyHash) ?? null,
      });
    } else if (now.bodyHash !== block.bodyHash) {
      bound.push({
        ...block,
        headPath: now.path,
        kind: "rewrite",
        hashes: { base: block.bodyHash, head: now.bodyHash },
        movedTo: null,
      });
    }
  }
  return bound.sort((left, right) => byCodeUnit(left.id, right.id));
}

/**
 * @description Says whether a value is `{ base, head }` with a list of strings on each side.
 * @param {unknown} value
 * @returns {boolean}
 */
function isSideLists(value) {
  return (
    isObject(value) &&
    ["base", "head"].every(
      (side) =>
        Array.isArray(value[side]) &&
        /** @type {unknown[]} */ (value[side]).every((entry) => typeof entry === "string")
    )
  );
}

/**
 * @description Says whether a value is a case's block list: a non-empty list of `{ id, bodyHash:
 *   { base, head } }`, each hash a string or `null`.
 * @param {unknown} value
 * @returns {boolean}
 */
function isBlockList(value) {
  const hash = (/** @type {unknown} */ entry) => entry === null || typeof entry === "string";
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (block) =>
        isObject(block) &&
        typeof block["id"] === "string" &&
        isObject(block["bodyHash"]) &&
        hash(block["bodyHash"]["base"]) &&
        hash(block["bodyHash"]["head"])
    )
  );
}

/**
 * @description Says why one case of a record is not the tool's shape, or `null` when it is.
 * @param {unknown} entry
 * @param {number} index
 * @returns {string | null}
 */
function caseProblem(entry, index) {
  const label = isObject(entry) && typeof entry["id"] === "string" ? ` (${entry["id"]})` : "";
  const name = `case ${index + 1}${label}`;
  if (!isObject(entry)) return `${name} is not an object`;
  if (typeof entry["id"] !== "string" || entry["id"] === "") {
    return `${name}: "id" is not a non-empty string`;
  }
  if (!Object.keys(ACCEPTED).includes(String(entry["kind"]))) {
    return `${name}: "kind" is not rewrite or deletion`;
  }
  if (typeof entry["verdict"] !== "string") return `${name}: "verdict" is not a string`;
  if (!isSideLists(entry["scope"])) return `${name}: "scope" is not { base, head } lists`;
  if (!isSideLists(entry["red"])) return `${name}: "red" is not { base, head } lists`;
  if (!isBlockList(entry["blocks"])) {
    return `${name}: "blocks" is not a list of { id, bodyHash: { base, head } }`;
  }
  return null;
}

/**
 * @description Reads a record's text as the tool writes it: version 1, a `head`, a `base` and
 *   `cases`, each case with its id, kind, verdict, scope, red tests and blocks.
 * @param {string} text
 * @returns {{ value: RecordCase[] } | { error: string }}
 */
export function parseRecord(text) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "it is not JSON" };
  }
  if (!isObject(parsed)) return { error: "it is not a JSON object" };
  if (parsed["version"] !== 1) return { error: '"version" is not 1' };
  for (const key of ["head", "base"]) {
    if (typeof parsed[key] !== "string") return { error: `"${key}" is not a string` };
  }
  const cases = parsed["cases"];
  if (!Array.isArray(cases)) return { error: '"cases" is not an array' };
  for (const [index, entry] of cases.entries()) {
    const problem = caseProblem(entry, index);
    if (problem !== null) return { error: problem };
  }
  return { value: /** @type {RecordCase[]} */ (cases) };
}

/**
 * @description Gives each bound block its class, in the order the header states; `imports` holds,
 *   per block id, the changed sources its test names directly.
 * @param {readonly Bound[]} bound
 * @param {{ imports: ReadonlyMap<string, readonly string[]>, records: readonly CommittedRecord[] }} input
 * @returns {Entry[]}
 */
export function classify(bound, { imports, records }) {
  /** @type {Map<string, { file: string, kase: RecordCase, hashes: Hashes }[]>} */
  const listed = new Map();
  for (const { file, cases } of records) {
    for (const kase of cases) {
      for (const block of kase.blocks) {
        listed.set(block.id, [
          ...(listed.get(block.id) ?? []),
          { file, kase, hashes: block.bodyHash },
        ]);
      }
    }
  }
  return bound.map((block) => {
    /** @type {(cls: string, detail: string) => Entry} */
    const entry = (cls, detail) => ({ cls, id: block.id, kind: block.kind, detail });
    if (block.movedTo !== null) {
      return entry("moved", `its bodyHash reappears as ${block.movedTo}`);
    }
    if (block.framework === "node") {
      return entry("node", "counted, not refused, until the node:test adapter exists");
    }
    const changed = imports.get(block.id) ?? [];
    if (changed.length > 0) {
      return entry(
        "behaviour change",
        `its test imports ${changed.join(", ")}, which this pull request changes`
      );
    }
    const candidates = listed.get(block.id) ?? [];
    /** @type {{ rank: number, detail: string } | null} */
    let refusal = null;
    /** @type {Entry | null} */
    let changedBehaviour = null;
    /** @type {(rank: number, detail: string) => void} */
    const consider = (rank, detail) => {
      if (refusal === null || rank > refusal.rank) refusal = { rank, detail };
    };
    for (const { file, kase, hashes } of candidates) {
      if (hashes.base !== block.hashes.base || hashes.head !== block.hashes.head) {
        consider(
          1,
          `stale-record (${file}): a bodyHash differs from the ledgers, re-run mutation-diff`
        );
      } else if (kase.kind !== block.kind) {
        consider(2, `wrong-kind (${file}): recorded as a ${kase.kind}`);
      } else if (!ACCEPTED[block.kind].includes(kase.verdict)) {
        consider(3, `failing-verdict: ${kase.verdict} (${file})`);
      } else if (kase.verdict === "BEHAVIOUR-CHANGED") {
        changedBehaviour ??= entry("behaviour change", `BEHAVIOUR-CHANGED in ${file}`);
      } else {
        return entry("covered", `${kase.verdict} in ${file}`);
      }
    }
    if (changedBehaviour !== null) return changedBehaviour;
    return entry(
      "refused",
      refusal === null ? "no-record" : /** @type {{ detail: string }} */ (refusal).detail
    );
  });
}

/**
 * @description Counts the entries of each class.
 * @param {readonly Entry[]} entries
 * @returns {{ covered: number, moved: number, node: number, behaviour: number, refused: number }}
 */
export function countsOf(entries) {
  /** @type {(cls: string) => number} */
  const count = (cls) => entries.filter((entry) => entry.cls === cls).length;
  return {
    covered: count("covered"),
    moved: count("moved"),
    node: count("node"),
    behaviour: count("behaviour change"),
    refused: count("refused"),
  };
}

/**
 * @description The entries the gate lists, every class but covered, refused first, each class by
 *   id.
 * @param {readonly Entry[]} entries
 * @returns {Entry[]}
 */
export function listedOf(entries) {
  return entries
    .filter((entry) => entry.cls !== "covered")
    .sort(
      (left, right) =>
        CLASS_ORDER.indexOf(left.cls) - CLASS_ORDER.indexOf(right.cls) ||
        byCodeUnit(left.id, right.id)
    );
}
