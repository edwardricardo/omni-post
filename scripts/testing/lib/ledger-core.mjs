// @ts-check
/**
 * @file ledger-core.mjs
 * @description The pure core of the test ledger: the shape a path takes, one row per classified
 *   block, the machine verdict of each file, the summary derived from the rows and the
 *   deterministic JSON they render to. It spawns nothing, writes nothing and reads no file but
 *   the Prettier configuration `render` formats with; the command that lists the tree, runs the
 *   reach engine and the classifier and writes `ledger.json` builds on these functions.
 *
 *   Deterministic by construction: every object is built from a literal, so its keys come in the
 *   order written here and never in the order a Map or a caller filled them; files are sorted by
 *   path; blocks stay in source order; and nothing carries a timestamp, a commit or an absolute
 *   path, so a clean checkout renders the same bytes.
 * @layer infrastructure
 */
import { fileURLToPath } from "node:url";
import { BLOCK_CLASS } from "@packages/eslint-plugin-testing";
import { byCodeUnit, renderJson } from "./record-helpers.mjs";

/** @typedef {import("../../../packages/eslint-plugin-testing/src/classify.js").FileClassification} FileClassification */

/** The version of the ledger's JSON; a change of a row's shape raises it. */
export const LEDGER_VERSION = 1;

/**
 * The paths a decision keeps out of every delete slice, each mapped to the decision's id. D17
 * (`docs/development/TESTING_REFOUNDATION.md:360`, `TESTING_REFOUNDATION_PLAN.md:946-947`): the two
 * seed scripts are command-line tools with no importer, which is normal for them, and wait on a
 * product classification; their verdict is ADJUDICATE whatever their blocks, never DELETE.
 * @type {Readonly<Record<string, string>>}
 */
export const EXCLUDED_BY_DECISION = Object.freeze({
  "apps/api/scripts/seed-demo-data.ts": "D17",
  "apps/api/scripts/seed-large-dataset.ts": "D17",
});

/**
 * A basename that names a test by convention, `.k6.js` being a tier of its own. It must stay
 * byte-equal to `CANONICAL_TEST_SHAPED` in `scripts/testing/metrics.mjs`, which defines metric
 * M1, and in `packages/test-contracts/src/lib/disk.ts:23`, the reach engine's: the ledger's
 * test-shaped population is M1's by construction. `ledger.test.ts` reads all three and fails on a
 * drift. Anchored at the end, so a `.disabled`, `.old` or `.bak` tail is not test-shaped.
 */
export const CANONICAL_TEST_SHAPED = /(\.(test|spec)\.[cm]?[jt]sx?|\.k6\.js)$/;

/**
 * The shapes a row may take, in the order the summary counts them. The first five are
 * test-shaped; `runner` is `tests/run*.ts`; `helper` is a `.ts`, `.tsx` or `.js` file under a
 * `tests/`, `__tests__/` or `test/` directory, or under `security/` or `performance/`, that is
 * none of the others; `disabled` is any of them with a `.disabled`, `.old` or `.bak` tail.
 */
const SHAPES = Object.freeze(
  /** @type {const} */ ([
    "test",
    "integration-test",
    "live-test",
    "spec",
    "k6",
    "runner",
    "helper",
    "disabled",
  ])
);

/** @typedef {typeof SHAPES[number]} Shape */

/** @type {readonly Shape[]} */
const TEST_SHAPED = Object.freeze(["test", "integration-test", "live-test", "spec", "k6"]);

/** The summary's key for the rows with no shape: the paths a decision excludes. */
const NO_SHAPE = "none";

/** A machine verdict; `null` on a row stands for a verdict no scan measures yet. */
const VERDICT = Object.freeze(
  /** @type {const} */ ({
    DELETE: "DELETE",
    REWRITE: "REWRITE",
    KEEP: "KEEP",
    ADJUDICATE: "ADJUDICATE",
  })
);

/** @typedef {typeof VERDICT[keyof typeof VERDICT]} Verdict */

/** The summary's key for the rows whose verdict is `null`. */
const UNMEASURED = "unmeasured";

/** The rule of the verdict table each row was decided by. */
const BASIS = Object.freeze(
  /** @type {const} */ ({
    EXCLUDED: "excluded-by-decision",
    DEAD_SUFFIX: "dead-suffix",
    NOT_MEASURED: "importers-not-measured",
    UNREADABLE: "unreadable",
    NO_BLOCKS: "no-blocks",
    TITLE_CONTRADICTION: "title-contradiction",
    OPAQUE: "opaque",
    ALL_DECORATIVE: "all-decorative",
    SOME_DECORATIVE: "some-decorative",
    BEHAVIOURAL: "behavioural",
    DEAD_HELPER: "dead-helper",
    IMPORTED: "imported",
    EXACT_DUPLICATE: "exact-duplicate",
    SUBJECT_NOT_IMPORTED: "subject-not-imported",
    DUPLICATE_UNION: "duplicate-union",
  })
);

/** @typedef {typeof BASIS[keyof typeof BASIS]} Basis */

const DEAD_TAIL = /\.(disabled|old|bak)$/;
const INTEGRATION = /\.integration\.test\.[cm]?[jt]sx?$/;
const LIVE = /\.live\.test\.[cm]?[jt]sx?$/;
const SPEC = /\.spec\.[cm]?[jt]sx?$/;
const K6 = /\.k6\.js$/;
const RUNNER = /(^|\/)tests\/run[^/]*\.ts$/;
const HELPER_EXTENSION = /\.(ts|tsx|js)$/;
const TEST_DIRECTORY = /(^|\/)(tests|__tests__|test)\//;
const SUITE_ROOT = /^(security|performance)\//;

/** The fewest titles a file must share with its siblings' union to be a union duplicate. */
const UNION_FLOOR = 5;

/**
 * The coverage metrics a deleted slice may record a floor descent of, in the order fitness #37
 * reads them from `apps/api/vitest.config.ts`: the floors a `decorative-demolition` marker lowers.
 */
export const FLOOR_METRICS = Object.freeze(
  /** @type {const} */ (["lines", "functions", "branches", "statements"])
);

/** The file the rendered JSON is committed as, whose Prettier configuration `render` applies. */
const LEDGER_FILE = fileURLToPath(new URL("../../../ledger.json", import.meta.url));

/**
 * @typedef {object} BlockRow One classified block.
 * @property {string} id `path::title`; a repeated title gets ` #2`, ` #3` in source order.
 * @property {number} line 1-based, where the block starts.
 * @property {string} blockClass The classifier's class.
 * @property {string[]} criteria The demolition criteria the class falls under, empty when none.
 * @property {string} bodyHash The classifier's sha256 of the block's body tokens.
 *
 * @typedef {object} FileRow One file of the ledger.
 * @property {string} path Repository-relative.
 * @property {Shape | null} shape `null` only for a path a decision excludes.
 * @property {string | null} framework The classifier's, `null` when the file was not read.
 * @property {string[] | null} collectors Reach's `collector:source` labels, `[]` for an orphan,
 *   `null` for a file that is not test-shaped.
 * @property {string | null} quarantined The owner of the file's quarantine entry, else `null`.
 * @property {number} blockCount
 * @property {BlockRow[]} blocks In source order.
 * @property {Verdict | null} verdict
 * @property {Basis} basis
 * @property {string | null} excluded The id of the decision that excludes the path, else `null`.
 * @property {"machine" | "confirmed"} status `machine` until a human confirms the verdict.
 * @property {string | null} sliceId The demolition slice the file belongs to, `null` until assigned.
 * @property {Subject | null} subject The module the test's stem names, `null` when it names none.
 * @property {Duplicate | null} duplicate The siblings the file's blocks copy, else `null`.
 * @property {number | null} importers A helper's or runner's live referencing files, `null` for
 *   any other row or when the references could not all be read.
 *
 * @typedef {object} Subject The module a test's stem names.
 * @property {string} stem The test's file name before its first dot.
 * @property {string} module Repository-relative.
 * @property {boolean} imported Whether the test loads it at run time.
 *
 * @typedef {object} Duplicate The siblings of one workspace whose blocks a file's blocks copy,
 *   title and body hash alike.
 * @property {"EXACT" | "UNION"} kind EXACT: every block, of one sibling that stays; UNION: at least
 *   {@link UNION_FLOOR} titles, across the siblings named.
 * @property {string[]} of Sorted.
 *
 * @typedef {object} DuplicateInput One classified test-shaped file, as `duplicatesOf` reads it.
 * @property {string} path Repository-relative.
 * @property {string} group The workspace directory or suite root that makes files siblings.
 * @property {boolean} collected Whether reach lists a source that collects it.
 * @property {ReadonlyArray<{ readonly title: string, readonly bodyHash: string }>} blocks
 *
 * @typedef {object} Signals What the scans beyond the classifier found for a path.
 * @property {Subject | null} [subject]
 * @property {Duplicate | null} [duplicate]
 * @property {number | null} [importers]
 *
 * @typedef {object} RowFields What `fileRow` builds a row from.
 * @property {string} path Repository-relative.
 * @property {FileClassification | null} classification `classifyFile`'s result for the path,
 *   `null` when the file was not classified.
 * @property {readonly string[]} collectors Reach's labels for the path, `[]` when it lists none.
 * @property {string | null} quarantined The owner of the path's quarantine entry, else `null`.
 *
 * @typedef {RowFields & Signals} RowInput
 *
 * @typedef {object} VerdictFields What `verdictOf` decides from.
 * @property {string} path Repository-relative.
 * @property {FileClassification | null} classification
 *
 * @typedef {VerdictFields & Signals} VerdictInput
 *
 * @typedef {object} MachineVerdict
 * @property {Verdict | null} verdict
 * @property {Basis} basis
 * @property {string | null} excluded
 *
 * @typedef {object} FileCounts
 * @property {number} total
 * @property {Record<string, number>} byShape Every shape, then `none`.
 * @property {Record<string, number>} byVerdict Every verdict, then `unmeasured`.
 *
 * @typedef {object} RowCounts
 * @property {number} machine
 * @property {number} confirmed
 * @property {number} total
 *
 * @typedef {object} BlockCounts
 * @property {number} total
 * @property {number} decorative The blocks with at least one criterion.
 * @property {Record<string, number>} byClass Every block class, in the classifier's order.
 *
 * @typedef {object} DeletedCounts
 * @property {number} files
 * @property {number} blocks
 *
 * @typedef {object} Summary
 * @property {FileCounts} files
 * @property {RowCounts} rows
 * @property {BlockCounts} blocks
 * @property {DeletedCounts} deleted The sum of every deleted slice's recorded drop, zero while no
 *   slice records one.
 * @property {string[]} excluded `<path>: <decision>` per excluded row, sorted by path.
 *
 * @typedef {object} Drop What deleting a set of rows removes.
 * @property {number} files
 * @property {number} blocks
 *
 * @typedef {object} Floor One coverage floor a deleted slice lowered.
 * @property {number} from The floor before the slice's pull request.
 * @property {number} to The floor after it, below `from`.
 *
 * @typedef {object} LiveSlice A demolition slice whose files are still rows, as `slices.json`
 *   assigns it.
 * @property {string[]} files Its rows' paths, sorted.
 * @property {Drop} expectedDrop What deleting its DELETE rows removes.
 *
 * @typedef {object} DeletedSlice A demolition slice `slices.json` records deleted.
 * @property {string[]} files Its paths, sorted: those that left the tree and the rows it keeps.
 * @property {Drop} deleted Its drop as `slices.json` records it, frozen: never recomputed from
 *   rows, which a deleted file no longer has.
 * @property {Record<string, Floor>} floors Its floor descents by metric, in the order of
 *   {@link FLOOR_METRICS}, empty when it lowered none.
 *
 * @typedef {LiveSlice | DeletedSlice} LedgerSlice One demolition slice: live until `slices.json`
 *   records its deletion.
 *
 * @typedef {object} Ledger
 * @property {number} version
 * @property {Summary} summary
 * @property {Record<string, LedgerSlice>} slices By id, in code-unit order; empty until assigned.
 * @property {FileRow[]} files Sorted by path.
 */

/**
 * @template T
 * @typedef {{ value: T } | { error: string }} Result
 */

/**
 * @description Reads the decision that excludes a path, whether the tree still holds it or not:
 *   the verdict table reads it for a row, the slice assignment for a path a slice records deleted.
 * @param {string} file Repository-relative.
 * @returns {string | null} The decision's id, or `null` when none excludes the path.
 */
export function decisionOf(file) {
  return Object.hasOwn(EXCLUDED_BY_DECISION, file) ? (EXCLUDED_BY_DECISION[file] ?? null) : null;
}

/**
 * @description Names the shape of a ledger candidate. Test-shaped is `CANONICAL_TEST_SHAPED`; a
 *   `.disabled`, `.old` or `.bak` tail is `disabled` when the path without it has a shape. Which
 *   directories are listed at all (the workspaces, `security/`, `performance/`) is the listing's
 *   choice, not this function's.
 * @param {string} file Repository-relative, with `/` separators.
 * @returns {Shape | null} The shape, or `null` when the path is not a ledger candidate.
 */
export function shapeOf(file) {
  const tail = DEAD_TAIL.exec(file);
  if (tail !== null) return shapeOf(file.slice(0, tail.index)) === null ? null : "disabled";
  if (CANONICAL_TEST_SHAPED.test(file)) {
    if (INTEGRATION.test(file)) return "integration-test";
    if (LIVE.test(file)) return "live-test";
    if (SPEC.test(file)) return "spec";
    if (K6.test(file)) return "k6";
    return "test";
  }
  if (RUNNER.test(file)) return "runner";
  const underTests = TEST_DIRECTORY.test(file) || SUITE_ROOT.test(file);
  return underTests && HELPER_EXTENSION.test(file) ? "helper" : null;
}

/**
 * @description Copies a block row into the ledger's key order.
 * @param {BlockRow} block
 * @returns {BlockRow}
 */
function orderedBlock(block) {
  return {
    id: block.id,
    line: block.line,
    blockClass: block.blockClass,
    criteria: [...block.criteria],
    bodyHash: block.bodyHash,
  };
}

/**
 * @description Copies a file row into the ledger's key order, its blocks too, so the order of the
 *   rendered keys is this literal's whatever object a caller passes.
 * @param {FileRow} row
 * @returns {FileRow}
 */
function orderedRow(row) {
  return {
    path: row.path,
    shape: row.shape,
    framework: row.framework,
    collectors: row.collectors === null ? null : [...row.collectors],
    quarantined: row.quarantined,
    blockCount: row.blockCount,
    blocks: row.blocks.map(orderedBlock),
    verdict: row.verdict,
    basis: row.basis,
    excluded: row.excluded,
    status: row.status,
    sliceId: row.sliceId,
    subject:
      row.subject === null
        ? null
        : { stem: row.subject.stem, module: row.subject.module, imported: row.subject.imported },
    duplicate:
      row.duplicate === null ? null : { kind: row.duplicate.kind, of: [...row.duplicate.of] },
    importers: row.importers,
  };
}

/**
 * @description Turns a file's classified blocks into ledger rows, in source order. A block's id
 *   is `path::title`; the second block with a title gets ` #2`, the third ` #3`, and a number is
 *   skipped when a literal title already holds that id, so every id of the file is distinct.
 * @param {FileClassification} classification `classifyFile`'s result.
 * @returns {BlockRow[]}
 */
export function blockRows(classification) {
  /** @type {Set<string>} */
  const used = new Set();
  /** @type {Map<string, number>} */
  const seen = new Map();
  /** @type {(base: string, count: number) => string} */
  const numbered = (base, count) => (count === 1 ? base : `${base} #${count}`);
  return classification.blocks.map((block) => {
    const base = `${classification.path}::${block.title}`;
    let count = (seen.get(base) ?? 0) + 1;
    while (used.has(numbered(base, count))) count += 1;
    const id = numbered(base, count);
    seen.set(base, count);
    used.add(id);
    return orderedBlock({
      id,
      line: block.loc.line,
      blockClass: block.blockClass,
      criteria: [...block.criteria],
      bodyHash: block.bodyHash,
    });
  });
}

/**
 * @description Builds a machine verdict.
 * @param {Verdict | null} verdict
 * @param {Basis} basis
 * @param {string | null} [excluded]
 * @returns {MachineVerdict}
 */
function decided(verdict, basis, excluded = null) {
  return { verdict, basis, excluded };
}

/**
 * @description Decides a runner's or a helper's verdict from its live referencing files.
 * @param {number | null} importers `null` when the references were not all read.
 * @returns {MachineVerdict}
 */
function helperVerdict(importers) {
  if (importers === null) return decided(null, BASIS.NOT_MEASURED);
  return importers === 0
    ? decided(VERDICT.DELETE, BASIS.DEAD_HELPER)
    : decided(VERDICT.KEEP, BASIS.IMPORTED);
}

/**
 * @description Decides a ledger candidate's machine verdict by the first rule of the table that
 *   applies, and names that rule as the basis: (1) a decision excludes the path: ADJUDICATE, never
 *   DELETE; (2) a dead suffix: DELETE; (3) a runner or a helper: DELETE when no live file
 *   references it, KEEP when one does, no verdict when the references were not all read; (4) no
 *   classification, or one that could not read the file: ADJUDICATE; (5) no block: ADJUDICATE;
 *   (6) an exact duplicate of a sibling that stays: DELETE; (7) a TITLE-CONTRADICTION block, or
 *   an opaque helper: ADJUDICATE; (8) every block falls under a criterion: DELETE; (9) a stem
 *   module the test never imports, or (10) a union duplicate: ADJUDICATE, the plan's mixed
 *   signals, which no rule of its DELETE list names; (11) some blocks fall under a criterion:
 *   REWRITE; (12) else KEEP. D55's narrowings of the plan's rules live in the classifier, which
 *   has already applied them to the blocks read here; this table adds none.
 * @param {VerdictInput} input
 * @returns {MachineVerdict}
 */
export function verdictOf({
  path: file,
  classification,
  subject = null,
  duplicate = null,
  importers = null,
}) {
  const decision = decisionOf(file);
  if (decision !== null) return decided(VERDICT.ADJUDICATE, BASIS.EXCLUDED, decision);
  const shape = shapeOf(file);
  if (shape === "disabled") return decided(VERDICT.DELETE, BASIS.DEAD_SUFFIX);
  if (shape === "runner" || shape === "helper") return helperVerdict(importers);
  if (classification === null || classification.framework === null) {
    return decided(VERDICT.ADJUDICATE, BASIS.UNREADABLE);
  }
  const { blocks, opaqueHelpers } = classification;
  if (blocks.length === 0) return decided(VERDICT.ADJUDICATE, BASIS.NO_BLOCKS);
  if (duplicate?.kind === "EXACT") return decided(VERDICT.DELETE, BASIS.EXACT_DUPLICATE);
  if (blocks.some((block) => block.blockClass === BLOCK_CLASS.TITLE_CONTRADICTION)) {
    return decided(VERDICT.ADJUDICATE, BASIS.TITLE_CONTRADICTION);
  }
  if (opaqueHelpers.length > 0 || blocks.some((block) => block.opaque)) {
    return decided(VERDICT.ADJUDICATE, BASIS.OPAQUE);
  }
  const decorative = blocks.filter((block) => block.criteria.length > 0).length;
  if (decorative === blocks.length) return decided(VERDICT.DELETE, BASIS.ALL_DECORATIVE);
  if (subject?.imported === false) {
    return decided(VERDICT.ADJUDICATE, BASIS.SUBJECT_NOT_IMPORTED);
  }
  if (duplicate?.kind === "UNION") return decided(VERDICT.ADJUDICATE, BASIS.DUPLICATE_UNION);
  if (decorative > 0) return decided(VERDICT.REWRITE, BASIS.SOME_DECORATIVE);
  return decided(VERDICT.KEEP, BASIS.BEHAVIOURAL);
}

/**
 * @description Builds one file's row. A row's collectors are reach's labels sorted by code unit
 *   when the file is test-shaped, and `null` otherwise. It fails closed on a path that is no
 *   ledger candidate, on a classification of another path, on reach labels, a subject or a
 *   duplicate for a file that is not test-shaped, and on an importer count for one that is no
 *   runner or helper, each a caller's defect that a row would hide.
 * @param {RowInput} input
 * @returns {Result<FileRow>} The row, or the reason it cannot be built.
 */
export function fileRow({
  path: file,
  classification,
  collectors,
  quarantined,
  subject = null,
  duplicate = null,
  importers = null,
}) {
  const shape = shapeOf(file);
  if (shape === null && decisionOf(file) === null) {
    return { error: `${file} is not a ledger candidate: no shape and no decision admits it` };
  }
  if (classification !== null && classification.path !== file) {
    return { error: `${file} carries the classification of ${classification.path}` };
  }
  const testShaped = shape !== null && TEST_SHAPED.includes(shape);
  if (!testShaped && collectors.length > 0) {
    return {
      error: `${file} is not test-shaped, yet reach lists it under ${collectors.join(", ")}`,
    };
  }
  if (!testShaped && (subject !== null || duplicate !== null)) {
    return { error: `${file} is not test-shaped, yet carries a subject or a duplicate` };
  }
  if (shape !== "runner" && shape !== "helper" && importers !== null) {
    return { error: `${file} is no runner or helper, yet carries an importer count` };
  }
  const blocks = classification === null ? [] : blockRows(classification);
  const signals = { subject, duplicate, importers };
  const { verdict, basis, excluded } = verdictOf({ path: file, classification, ...signals });
  return {
    value: orderedRow({
      path: file,
      shape,
      framework: classification?.framework ?? null,
      collectors: testShaped ? [...collectors].sort(byCodeUnit) : null,
      quarantined,
      blockCount: blocks.length,
      blocks,
      verdict,
      basis,
      excluded,
      status: "machine",
      sliceId: null,
      ...signals,
    }),
  };
}

/**
 * @description Reads a block as a duplicate scan compares it: its title trimmed, its whitespace
 *   collapsed and in lower case, with the classifier's hash of its body, so a copied title over a
 *   different body is no copy.
 * @param {{ readonly title: string, readonly bodyHash: string }} block
 * @returns {string}
 */
function copyKey(block) {
  return `${block.title.trim().replace(/\s+/g, " ").toLowerCase()}\0${block.bodyHash}`;
}

/**
 * @description Finds the files whose blocks copy their siblings', the files of one group.
 *   EXACT: two or more files hold the same multiset of blocks, at least one each; the first that
 *   a source collects, then by path, stays, and each other one is an exact duplicate of it.
 *   UNION: a file that is no exact copy, at least {@link UNION_FLOOR} of whose blocks the other
 *   files of its group hold between them, exact copies left out.
 * @param {readonly DuplicateInput[]} inputs
 * @returns {Map<string, Duplicate>} Each duplicate's finding, by path; a file with none is absent.
 */
export function duplicatesOf(inputs) {
  /** @type {Map<string, Duplicate>} */
  const found = new Map();
  /** @type {Map<string, DuplicateInput[]>} */
  const same = new Map();
  for (const input of inputs.filter((file) => file.blocks.length > 0)) {
    const key = `${input.group}\0${input.blocks.map(copyKey).sort(byCodeUnit).join("\n")}`;
    same.set(key, [...(same.get(key) ?? []), input]);
  }
  for (const copies of same.values()) {
    const [kept, ...rest] = [...copies].sort(
      (left, right) =>
        Number(right.collected) - Number(left.collected) || byCodeUnit(left.path, right.path)
    );
    if (kept === undefined) continue;
    for (const copy of rest) found.set(copy.path, { kind: "EXACT", of: [kept.path] });
  }
  const siblings = inputs.filter((file) => !found.has(file.path));
  /** @type {Map<string, Set<string>>} */
  const holders = new Map();
  for (const input of siblings) {
    for (const key of input.blocks.map(copyKey)) {
      const holder = `${input.group}\0${key}`;
      holders.set(holder, (holders.get(holder) ?? new Set()).add(input.path));
    }
  }
  for (const input of siblings) {
    /** @type {Set<string>} */
    const shared = new Set();
    /** @type {Set<string>} */
    const of = new Set();
    for (const key of input.blocks.map(copyKey)) {
      const others = [...(holders.get(`${input.group}\0${key}`) ?? [])];
      for (const other of others.filter((holder) => holder !== input.path)) {
        shared.add(key);
        of.add(other);
      }
    }
    if (shared.size >= UNION_FLOOR) {
      found.set(input.path, { kind: "UNION", of: [...of].sort(byCodeUnit) });
    }
  }
  return found;
}

/**
 * @description Counts values under a fixed list of keys, every key present even at zero, in the
 *   list's order; a value outside the list is counted under its own key, after them.
 * @param {readonly string[]} keys
 * @param {readonly string[]} values
 * @returns {Record<string, number>}
 */
function countBy(keys, values) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const key of keys) counts[key] = 0;
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

/**
 * @description Adds up what the deleted slices recorded: the files and the blocks of every
 *   slice that carries `deleted`, a live slice adding nothing.
 * @param {Readonly<Record<string, LedgerSlice>>} slices
 * @returns {DeletedCounts}
 */
function deletedBy(slices) {
  let files = 0;
  let blocks = 0;
  for (const slice of Object.values(slices)) {
    if (!("deleted" in slice)) continue;
    files += slice.deleted.files;
    blocks += slice.deleted.blocks;
  }
  return { files, blocks };
}

/**
 * @description Derives the summary from the rows, so its counts can never disagree with them,
 *   and `deleted` from the slices, the sum of the drops the deleted ones record.
 * @param {readonly FileRow[]} rows
 * @param {Readonly<Record<string, LedgerSlice>>} [slices] The assigned slices, by id.
 * @returns {Summary}
 */
export function summarize(rows, slices = {}) {
  const blocks = rows.flatMap((row) => row.blocks);
  const verdicts = [...Object.values(VERDICT), UNMEASURED];
  const excluded = rows
    .filter((row) => row.excluded !== null)
    .sort((left, right) => byCodeUnit(left.path, right.path))
    .map((row) => `${row.path}: ${row.excluded}`);
  return {
    files: {
      total: rows.length,
      byShape: countBy(
        [...SHAPES, NO_SHAPE],
        rows.map((row) => row.shape ?? NO_SHAPE)
      ),
      byVerdict: countBy(
        verdicts,
        rows.map((row) => row.verdict ?? UNMEASURED)
      ),
    },
    rows: {
      machine: rows.filter((row) => row.status === "machine").length,
      confirmed: rows.filter((row) => row.status === "confirmed").length,
      total: rows.length,
    },
    blocks: {
      total: blocks.length,
      decorative: blocks.filter((block) => block.criteria.length > 0).length,
      byClass: countBy(
        Object.values(BLOCK_CLASS),
        blocks.map((block) => block.blockClass)
      ),
    },
    deleted: deletedBy(slices),
    excluded,
  };
}

/**
 * @description Copies a slice into the ledger's key order: a deleted slice as its paths, its
 *   recorded drop and its floor descents in the order of {@link FLOOR_METRICS}, a live slice as
 *   its paths and its expected drop, so the rendered keys are these literals' whatever a caller
 *   passes.
 * @param {LedgerSlice} slice
 * @returns {LedgerSlice}
 */
function orderedSlice(slice) {
  if (!("deleted" in slice)) {
    const { files: dropped, blocks } = slice.expectedDrop;
    return { files: [...slice.files], expectedDrop: { files: dropped, blocks } };
  }
  /** @type {Record<string, Floor>} */
  const floors = {};
  for (const metric of FLOOR_METRICS) {
    const floor = slice.floors[metric];
    if (floor !== undefined) floors[metric] = { from: floor.from, to: floor.to };
  }
  const { files: dropped, blocks } = slice.deleted;
  return { files: [...slice.files], deleted: { files: dropped, blocks }, floors };
}

/**
 * @description Assembles the ledger: its rows sorted by path, each copied into the key order of
 *   `orderedRow`, the summary derived from them and from the slices, and the slices in code-unit
 *   order of their ids, each copied into its key order. A path with two rows is refused.
 * @param {readonly FileRow[]} rows
 * @param {Readonly<Record<string, LedgerSlice>>} [slices] The assigned slices, by id.
 * @returns {Result<Ledger>} The ledger, or the path two rows share.
 */
export function buildLedger(rows, slices = {}) {
  const files = [...rows].sort((left, right) => byCodeUnit(left.path, right.path));
  const repeated = files.find((row, index) => index > 0 && files[index - 1]?.path === row.path);
  if (repeated !== undefined) {
    const count = files.filter((row) => row.path === repeated.path).length;
    return { error: `${repeated.path} has ${count} rows` };
  }
  const ordered = files.map(orderedRow);
  /** @type {Record<string, LedgerSlice>} */
  const sliced = {};
  for (const [id, slice] of Object.entries(slices).sort(([left], [right]) =>
    byCodeUnit(left, right)
  )) {
    sliced[id] = orderedSlice(slice);
  }
  return {
    value: {
      version: LEDGER_VERSION,
      summary: summarize(ordered, sliced),
      slices: sliced,
      files: ordered,
    },
  };
}

/**
 * @description Renders the ledger as the JSON text that is committed, through `renderJson`:
 *   `JSON.stringify` formatted by Prettier with the configuration that applies to `ledger.json`
 *   at the repository root (the `.prettierrc` and the `.editorconfig`, as the CLI reads them), so
 *   `pnpm format:check` passes over the committed file. Equal ledgers render equal bytes.
 * @param {Ledger} ledger
 * @returns {Promise<string>} The text, ending in a newline.
 */
export function render(ledger) {
  return renderJson(LEDGER_FILE, ledger);
}
