// @ts-check
/**
 * @file ledger-core.mjs
 * @description The pure core of the test ledger: the shape a path takes, one row per classified
 *   block, the machine verdict of each file and the row that carries it. It spawns nothing,
 *   writes nothing and reads no file; the command that lists the tree, runs the reach engine and
 *   the classifier and writes `ledger.json` builds on these functions.
 * @layer infrastructure
 */
import { BLOCK_CLASS } from "@packages/eslint-plugin-testing";

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
 * byte-equal to `CANONICAL_TEST_SHAPED` in `scripts/testing/metrics.mjs:45`, which defines metric
 * M1, and in `packages/test-contracts/src/lib/disk.ts:23`, the reach engine's: the ledger's
 * test-shaped population is M1's by construction. `ledger.test.ts` reads all three and fails on a
 * drift. Anchored at the end, so a `.disabled`, `.old` or `.bak` tail is not test-shaped.
 */
export const CANONICAL_TEST_SHAPED = /(\.(test|spec)\.[cm]?[jt]sx?|\.k6\.js)$/;

/**
 * The shapes a row may take. The first five are test-shaped; `runner` is `tests/run*.ts`;
 * `helper` is a `.ts`, `.tsx` or `.js` file under a `tests/`, `__tests__/` or `test/` directory,
 * or under `security/` or `performance/`, that is none of the others; `disabled` is any of them
 * with a `.disabled`, `.old` or `.bak` tail.
 * @typedef {"test" | "integration-test" | "live-test" | "spec" | "k6" | "runner" | "helper" | "disabled"} Shape
 */

/** @type {readonly Shape[]} */
const TEST_SHAPED = Object.freeze(["test", "integration-test", "live-test", "spec", "k6"]);

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
 * @property {null} subject `null` until the subject-import scan exists.
 * @property {null} duplicate `null` until the duplicate scan exists.
 * @property {number | null} importers `null` until the importer scan exists.
 *
 * @typedef {object} RowInput What `fileRow` builds a row from.
 * @property {string} path Repository-relative.
 * @property {FileClassification | null} classification `classifyFile`'s result for the path,
 *   `null` when the file was not classified.
 * @property {readonly string[]} collectors Reach's labels for the path, `[]` when it lists none.
 * @property {string | null} quarantined The owner of the path's quarantine entry, else `null`.
 *
 * @typedef {object} VerdictInput What `verdictOf` decides from.
 * @property {string} path Repository-relative.
 * @property {FileClassification | null} classification
 *
 * @typedef {object} MachineVerdict
 * @property {Verdict | null} verdict
 * @property {Basis} basis
 * @property {string | null} excluded
 */

/**
 * @template T
 * @typedef {{ value: T } | { error: string }} Result
 */

/**
 * @description Orders two strings by UTF-16 code unit. `localeCompare` would follow the ICU
 *   collation of the Node that runs it, which folds case and punctuation (`post` before `Post`)
 *   and may change with the ICU version or the locale; `<` is the same on every machine and, for
 *   the ASCII paths git lists here, is byte order, the order `git ls-files` prints.
 * @param {string} left
 * @param {string} right
 * @returns {number} Negative, zero or positive, as `Array.prototype.sort` expects.
 */
function byCodeUnit(left, right) {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/**
 * @description Reads the decision that excludes a path.
 * @param {string} file Repository-relative.
 * @returns {string | null} The decision's id, or `null` when none excludes the path.
 */
function decisionOf(file) {
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
    subject: row.subject,
    duplicate: row.duplicate,
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
 * @description Decides a ledger candidate's machine verdict by the first rule of the table that
 *   applies, and names that rule as the basis: (1) a decision excludes the path: ADJUDICATE, never
 *   DELETE; (2) a dead suffix: DELETE; (3) a runner or a helper: no verdict until its importers are
 *   counted; (4) no classification, or one that could not read the file: ADJUDICATE; (5) no
 *   block: ADJUDICATE; (6) a TITLE-CONTRADICTION block, or an opaque helper: ADJUDICATE; (7)
 *   every block falls under a criterion: DELETE; (8) some do: REWRITE; (9) else KEEP. D55's
 *   narrowings of the plan's rules live in the classifier, which has already applied them to the
 *   blocks read here; this table adds none.
 * @param {VerdictInput} input
 * @returns {MachineVerdict}
 */
export function verdictOf({ path: file, classification }) {
  const decision = decisionOf(file);
  if (decision !== null) return decided(VERDICT.ADJUDICATE, BASIS.EXCLUDED, decision);
  const shape = shapeOf(file);
  if (shape === "disabled") return decided(VERDICT.DELETE, BASIS.DEAD_SUFFIX);
  if (shape === "runner" || shape === "helper") return decided(null, BASIS.NOT_MEASURED);
  if (classification === null || classification.framework === null) {
    return decided(VERDICT.ADJUDICATE, BASIS.UNREADABLE);
  }
  const { blocks, opaqueHelpers } = classification;
  if (blocks.length === 0) return decided(VERDICT.ADJUDICATE, BASIS.NO_BLOCKS);
  if (blocks.some((block) => block.blockClass === BLOCK_CLASS.TITLE_CONTRADICTION)) {
    return decided(VERDICT.ADJUDICATE, BASIS.TITLE_CONTRADICTION);
  }
  if (opaqueHelpers.length > 0 || blocks.some((block) => block.opaque)) {
    return decided(VERDICT.ADJUDICATE, BASIS.OPAQUE);
  }
  const decorative = blocks.filter((block) => block.criteria.length > 0).length;
  if (decorative === blocks.length) return decided(VERDICT.DELETE, BASIS.ALL_DECORATIVE);
  if (decorative > 0) return decided(VERDICT.REWRITE, BASIS.SOME_DECORATIVE);
  return decided(VERDICT.KEEP, BASIS.BEHAVIOURAL);
}

/**
 * @description Builds one file's row. A row's collectors are reach's labels sorted by code unit
 *   when the file is test-shaped, and `null` otherwise. It fails closed on a path that is no
 *   ledger candidate, on a classification of another path, and on reach labels for a file that is
 *   not test-shaped, each a caller's defect that a row would hide.
 * @param {RowInput} input
 * @returns {Result<FileRow>} The row, or the reason it cannot be built.
 */
export function fileRow({ path: file, classification, collectors, quarantined }) {
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
  const blocks = classification === null ? [] : blockRows(classification);
  const { verdict, basis, excluded } = verdictOf({ path: file, classification });
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
      subject: null,
      duplicate: null,
      importers: null,
    }),
  };
}
