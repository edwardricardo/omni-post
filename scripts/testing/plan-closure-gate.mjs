// @ts-check
/**
 * @file plan-closure-gate.mjs
 * @description Fitness check #56: a feature whose state in the chain table of
 *   `docs/product/PLAN.md` is `closed` holds no open item under its record.
 *
 *   WHY IT EXISTS, measured: F-01 closed with pull request #916 while 24 rows of its record were
 *   open, and F-02 came within one change of closing with 22. An item under a closed feature has no
 *   date and no owner: no slice opens the feature again, so nothing schedules the item and nothing
 *   says it is waiting. The Product Owner's rule of 2026-11-20 is that no feature closes with an
 *   open item, and this gate holds it (ADR-0046).
 *
 *   WHAT IT READS. Fenced code blocks are never read, in the plan or in the records. The chain table
 *   is the first Markdown table of the section `## The chain` of the plan; its columns are found by
 *   their header, `#` for the feature's id and `State` for its state, which is one of `open`,
 *   `in progress` and `closed`. A feature's record is the one heading, in
 *   `docs/product/plan/chain.md` or `docs/product/plan/areas.md`, whose text is the id alone or the
 *   id followed by a space, and it runs to the next heading of its level or above. Its item lists
 *   are its top-level bullets whose bold label, colon inside the bold, is `Attached (<n>)` or starts
 *   with `Findings`; every other bullet of the record, the prose lists `Wrong as read` and
 *   `To build` included, is prose. An entry of an item list is a line indented two spaces, then
 *   `- `: either an item, `**<id>**: <text>` with an optional `(<reference>)` after the id, or a
 *   note, `Note: <text>`. A line indented four spaces or more that opens no list continues the entry
 *   above it. Only the chain table has a state: the table of the areas outside the chain in the plan
 *   has no `State` column, so no area is ever judged closed.
 *
 *   WHAT CLOSES AN ITEM: its text starts with one of two forms, each with no punctuation of its own;
 *   what follows the form is the rest of the item's text. `Closed by #<n>`, the pull request that
 *   resolved it, its number written from 1 with no leading zero and ending the word; or
 *   `Closed by decision of the <Product Owner|Maintainer> on <YYYY-MM-DD>: <the decision>`, the date
 *   a calendar date no later than the day the check runs (UTC), and the decision after the colon
 *   holding at least one word of three letters or more. Every other item is open, and an item whose
 *   text starts `Closed by`, in any case, in neither form is named as such.
 *
 *   WHAT FAILS, exit 1, each on stderr: an open item under the record of a closed feature, named
 *   with the feature, the table's line, the item's id, its line and its list; then one line with
 *   the count. A feature that is `open` or `in progress` is never judged.
 *
 *   FAIL-CLOSED, exit 3, which wins over 1 and prints the open items too: the plan or a record file
 *   that cannot be read; no `## The chain` section, or two; a section with no table; a table with no
 *   `#` or no `State` column, a row whose cells are not the header's, a row with no id, an id listed
 *   twice, or no feature row at all; a state that is none of the three; a closed feature whose record
 *   no heading opens, or more than one does; a record with no `Attached (<n>)` list, or whose `<n>`
 *   is not the number of items read under it; an entry of an item list that is neither an item nor a
 *   note; a nested list entry under an entry of an item list, because an item written there could
 *   not be told from prose; a continuation of an entry whose text starts like an item (after its
 *   indentation, a bold id, an optional reference and a colon), because an open item written there
 *   would read as the entry above it; any line of the record shaped like an item (a bold text that
 *   ends with neither a colon nor a space, then `: `, anywhere on the line outside an inline code
 *   span, a span counting only when every backtick run of the line pairs with a later run of the
 *   same length) that is read neither as an entry of an item list nor as an entry's continuation:
 *   an item at the
 *   record's top level, after a line that ended its list, inside a note, on a label's line, in a
 *   prose list, or under a label whose colon is outside the bold; and a fenced code block that is
 *   still open at the end of its file, named in the record of the closed feature that opens it, else
 *   in its file, because every line after it would read as code. A scan that read nothing never
 *   renders as a plan with every item closed. A usage error exits 2.
 *
 *   RESIDUAL LIMITS, stated rather than implied. (1) Textual: the gate reads the plan's Markdown
 *   by its line shapes, not with a Markdown parser. (2) It proves the marker's form, never that pull
 *   request `#<n>` resolved the item or that the decision was taken. (3) An item attached to a
 *   closed feature from outside its record (a row of `cross-cutting.md` that names it, or a list
 *   placed after a heading that ends the record) is not read. (4) A record's prose lists
 *   (`Wrong as read`, `To build`) hold no item, so a defect they describe in prose is not judged.
 *   (5) The `Closed by` column of the table is not compared with the items. (6) The areas outside
 *   the chain have no state (`docs/product/PLAN.md`, the header of the table of section
 *   `## Areas outside the chain`), so an area's open rows are never judged; a feature of an area is
 *   judged once it joins the chain table. (7) An item-shaped text in the middle of a continuation
 *   line is that entry's text and is not read; only a continuation that starts like an item is
 *   refused. (8) The item-shape scan can still refuse valid prose: a line of a closed feature's
 *   record holding an unpaired backtick run, which is scanned whole, code text included, and a line
 *   outside a code span and not the continuation
 *   of an entry of an item list, that writes a bold text ending in a letter, a digit or a sign other
 *   than a colon, followed by `: ` (`the role **SUPER_ADMIN**: every permission`). Such a line is
 *   reworded or its bold text put in a code span.
 *
 *   ONE READER. This gate reads the plan through `scripts/plan/plan-text.mjs`, the reader the
 *   plan's records share, and that module's header states what it reads and what the two agree on.
 *
 *   Usage: `node scripts/testing/plan-closure-gate.mjs [--root <dir>]`. The root defaults to the
 *   repository this file lives in, located from the script's own URL: no git, and nothing read from
 *   the working directory. Exit 0 when no closed feature holds an open item, 1 when one does, 2 on
 *   a usage error, 3 when the plan cannot be read as above.
 * @layer infrastructure
 */
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLAN_FILE,
  PLAN_FILES,
  plural,
  readChainTable,
  readRecordSpan,
  recordsOf,
  textOf,
} from "../plan/plan-text.mjs";

/** The plan whose chain table holds every feature's state, relative to the root. */
export const PLAN = PLAN_FILE;
/** The files that hold the features' records, relative to the root, in the order they are read. */
export const RECORDS = [PLAN_FILES.chain, PLAN_FILES.areas];

const DEFAULT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PREFIX = "plan-closure-gate: ";
const USAGE = "usage: node scripts/testing/plan-closure-gate.mjs [--root <dir>]";
const CLOSED = "closed";
const HINT =
  'start its text with "Closed by #<n>" or "Closed by decision of the <Product Owner|Maintainer> ' +
  'on <YYYY-MM-DD>: <the decision>", or set the feature back to "in progress"';

/** @typedef {import("../plan/plan-text.mjs").Text} Text */
/** @typedef {import("../plan/plan-text.mjs").RecordSpan} RecordSpan */

/**
 * @typedef {object} Item
 * @property {string} id
 * @property {"closed" | "open" | "lookalike"} status
 * @property {number} line One-based line in its file.
 * @property {string} list The label of the list that holds it.
 */

/**
 * The message for a line of a record the walker refuses, from its file, index, list, feature and
 * text.
 *
 * @typedef {(file: string, index: number, label: string, id: string, line: string) => string} Refusal
 */

/**
 * @typedef {object} Outcome
 * @property {number} exitCode
 * @property {string[]} stdout The lines written to standard output.
 * @property {string[]} stderr The lines written to standard error.
 */

/**
 * @param {string} file
 * @param {number} index
 * @param {string} label
 * @param {string} id
 * @param {string} line
 * @returns {string}
 */
function unreadableEntry(file, index, label, id, line) {
  return (
    `${file}:${String(index + 1)}, in "${label}" of ${id}, reads "${line}", which is neither an ` +
    'item ("  - **<id>**: <text>", with an optional "(<reference>)" after the id) nor a note ' +
    '("  - Note: <text>")'
  );
}

/**
 * @param {string} file
 * @param {number} index
 * @param {string} label
 * @param {string} id
 * @param {string} line
 * @returns {string}
 */
function nestedEntry(file, index, label, id, line) {
  return (
    `${file}:${String(index + 1)}, in "${label}" of ${id}, reads "${line}", a nested list entry: ` +
    "an item list holds no nested list, so an item written there cannot be told from prose; write " +
    'each item as its own entry ("  - **<id>**: <text>")'
  );
}

/**
 * @param {string} file
 * @param {number} index
 * @param {string} id
 * @param {string} line
 * @returns {string}
 */
function unlistedItem(file, index, id, line) {
  return (
    `${file}:${String(index + 1)}, in the record of ${id}, reads "${line}", which is shaped like ` +
    'an item ("**<id>**: ") and is not an entry of an "Attached (<n>)" or "Findings" list, so ' +
    'whether it is open cannot be read; write it as "  - **<id>**: <text>" under one of them'
  );
}

/**
 * @param {string} file
 * @param {number} index
 * @param {string} label
 * @param {string} id
 * @param {string} line
 * @returns {string}
 */
function itemAsContinuation(file, index, label, id, line) {
  return (
    `${file}:${String(index + 1)}, in "${label}" of ${id}, reads "${line}", the continuation of an ` +
    "entry that starts like an item: an item written as another entry's text cannot be told from " +
    'that text; write it as its own entry ("  - **<id>**: <text>")'
  );
}

/**
 * The message for each line the walker of a record's span refuses, by the rule that refused it.
 *
 * @type {Record<import("../plan/plan-text.mjs").RefusalRule, Refusal>}
 */
const REFUSALS = {
  "unreadable-entry": unreadableEntry,
  "nested-entry": nestedEntry,
  "item-as-continuation": itemAsContinuation,
  "unlisted-item": (file, index, _label, id, line) => unlistedItem(file, index, id, line),
};

/**
 * @description The items of a record's item lists, or the reasons the record cannot be read.
 * @param {string} id The feature's id.
 * @param {RecordSpan} record
 * @param {string} today The day the check runs, `YYYY-MM-DD` in UTC.
 * @returns {{ items: Item[], failures: string[], fenceReported: boolean }} `fenceReported` is
 *   true when the record opens the file's unclosed fence and has named it.
 */
function readItems(id, record, today) {
  const { file, lines, unclosed } = record.text;
  const span = readRecordSpan(record, today);
  /** @type {Item[]} */
  const items = span.items.map((item) => ({
    id: item.id,
    status: item.status,
    line: item.line,
    list: item.list,
  }));
  /** @type {string[]} */
  const failures = span.refusals.map(({ index, rule, list }) =>
    REFUSALS[rule](file, index, list ?? "", id, lines[index] ?? "")
  );
  const attached = span.attached;

  // A fence the record opens and nothing closes hides every line after it, a list included.
  const fenceReported = span.opensUnclosedFence;
  if (fenceReported) {
    failures.push(
      `the record of ${id} (${file}:${String(record.start + 1)}) opens a fenced code block at ` +
        `line ${String((unclosed ?? 0) + 1)} that is still open at the record's end, so no line ` +
        "after it is read; close the block"
    );
  }

  if (attached.length === 0) {
    failures.push(
      `the record of ${id} (${file}:${String(record.start + 1)}) holds no "Attached (<n>)" ` +
        "list, so whether it holds an open item cannot be read"
    );
  }
  for (const stated of span.miscounted) {
    failures.push(
      `the record of ${id} (${file}:${String(stated.line)}) states "${stated.label}" and ` +
        `${plural(stated.items, "item")} ${stated.items === 1 ? "was" : "were"} read under it, so ` +
        "an item is written where the gate cannot read it"
    );
  }
  return { items, failures, fenceReported };
}

/**
 * @description Judges a plan tree: every feature the chain table marks closed must hold no open
 *   item under its record. Reads the plan and the record files under `root`, never git.
 * @param {{ root: string, now?: Date }} input `root` holds `docs/product/`; `now`, the moment
 *   the check runs, decides which decision dates are still to come (the current time by default).
 * @returns {Outcome} The exit code and the lines for each stream, each prefixed with the gate's
 *   name: 0 when no closed feature holds an open item, 1 when one does, 3 when the plan cannot be
 *   read as the gate's header states.
 */
export function runGate({ root, now = new Date() }) {
  const today = now.toISOString().slice(0, 10);
  /** @type {string[]} */
  const failures = [];
  /** @type {(file: string, what: string) => string | null} */
  const read = (file, what) => {
    try {
      return readFileSync(path.join(root, file), "utf8");
    } catch (error) {
      failures.push(
        `${file} could not be read, so ${what} was read: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  };
  const planText = read(PLAN, "no feature's state");
  const recordTexts = RECORDS.map((file) => ({ file, text: read(file, "no record") }));
  if (planText === null || recordTexts.some((record) => record.text === null)) {
    return { exitCode: 3, stdout: [], stderr: failures.map((line) => PREFIX + line) };
  }

  const plan = textOf(PLAN, planText);
  const table = readChainTable(plan);
  failures.push(...table.failures);
  const records = recordTexts.map(({ file, text }) => textOf(file, text ?? ""));
  /** The files whose unclosed fence a closed feature's record has already named. */
  const fencesNamed = new Set();
  const closed = table.rows.filter((row) => row.state === CLOSED);
  /** @type {string[]} */
  const violations = [];
  let itemCount = 0;
  const holding = new Set();

  for (const row of closed) {
    const at = `${PLAN}:${String(row.line)}`;
    const found = recordsOf(row.id, records);
    if (found.length !== 1) {
      failures.push(
        found.length === 0
          ? `${row.id} is closed (${at}) and no heading of ${RECORDS.join(" or ")} opens its ` +
              "record, so no item of it was read"
          : `${row.id} is closed (${at}) and its record is opened more than once ` +
              `(${found.map((r) => `${r.text.file}:${String(r.start + 1)}`).join(", ")}), so ` +
              "which one holds its items is ambiguous"
      );
      continue;
    }
    const record = found[0];
    if (record === undefined) continue;
    const { items, failures: unreadable, fenceReported } = readItems(row.id, record, today);
    failures.push(...unreadable);
    if (fenceReported) fencesNamed.add(record.text.file);
    itemCount += items.length;
    for (const item of items) {
      if (item.status === "closed") continue;
      holding.add(row.id);
      const what =
        item.status === "lookalike"
          ? 'an item that starts "Closed by" in neither form, so it is open'
          : "an open item";
      violations.push(
        `${row.id} is closed (${at}) and its record holds ${what}: ${item.id} ` +
          `(${record.text.file}:${String(item.line)}, in "${item.list}"); ${HINT}`
      );
    }
  }

  // A fence nothing closes turns the rest of its file into code: headings, the table and items
  // after it would be read as absent, so the file cannot be read as the rule needs.
  for (const text of [plan, ...records]) {
    if (text.unclosed !== null && !fencesNamed.has(text.file)) {
      failures.push(
        `${text.file}:${String(text.unclosed + 1)} opens a fenced code block that is still open at ` +
          "the end of the file, so no line after it is read as a heading, a table or an item; " +
          "close the block"
      );
    }
  }

  if (failures.length > 0) {
    return {
      exitCode: 3,
      stdout: [],
      stderr: [...failures, ...violations].map((line) => PREFIX + line),
    };
  }
  if (violations.length > 0) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: [
        ...violations,
        `${plural(violations.length, "open item")} under ${plural(holding.size, "closed feature")}`,
      ].map((line) => PREFIX + line),
    };
  }
  return {
    exitCode: 0,
    stdout: [
      `${PREFIX}${plural(table.rows.length, "feature")} in the chain table, ` +
        `${String(closed.length)} closed; ${plural(itemCount, "item")} under the records of the ` +
        "closed features, every one closed",
    ],
    stderr: [],
  };
}

/**
 * @param {string[]} argv
 * @returns {string | null} The root, or `null` on a usage error.
 */
function rootOf(argv) {
  if (argv.length === 0) return DEFAULT_ROOT;
  if (argv.length === 2 && argv[0] === "--root" && (argv[1] ?? "") !== "") return argv[1] ?? null;
  return null;
}

/**
 * True only when this file is the process entry point, so the suite's import runs nothing. It is
 * written here rather than imported from `lib/record-helpers.mjs`, whose `isEntryPoint` is the
 * same check: that module imports `prettier`, and the fitness job that runs this gate installs no
 * package, so the import would fail there before the gate read a line.
 *
 * @returns {boolean}
 */
function invokedAsScript() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedAsScript()) {
  const root = rootOf(process.argv.slice(2));
  if (root === null) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
  } else {
    const outcome = runGate({ root });
    for (const line of outcome.stdout) process.stdout.write(`${line}\n`);
    for (const line of outcome.stderr) process.stderr.write(`${line}\n`);
    process.exitCode = outcome.exitCode;
  }
}
