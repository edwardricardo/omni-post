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
 *   WHAT IT READS. The chain table is the first Markdown table of the section `## The chain` of
 *   the plan; its columns are found by their header, `#` for the feature's id and `State` for its
 *   state, which is one of `open`, `in progress` and `closed`. A feature's record is the one
 *   heading, in `docs/product/plan/chain.md` or `docs/product/plan/areas.md`, whose text is the id
 *   or starts with the id and a space, and it runs to the next heading of its level or above. Its
 *   item lists are its top-level bullets whose bold label is `Attached (<n>)` or starts with
 *   `Findings`; every other bullet of the record, the prose lists `Wrong as read` and `To build`
 *   included, is prose. An entry of an item list is a line indented two spaces, then `- `: either
 *   an item, `**<id>**: <text>` with an optional `(<reference>)` after the id, or a note,
 *   `Note: <text>`. A line indented four spaces or more continues the entry above it.
 *
 *   WHAT CLOSES AN ITEM: its text starts with one of two forms. `Closed by #<n>`, the pull request
 *   that resolved it, its number written from 1 with no leading zero; or `Closed by decision of the
 *   <role> on <YYYY-MM-DD>: <the decision>`, where the role is `Product Owner` or `Maintainer`, the
 *   date is a calendar date, and the decision follows the colon. Every other item is open, and an
 *   item whose text starts `Closed by` in neither form is named as such.
 *
 *   WHAT FAILS, exit 1, each on stderr: an open item under the record of a closed feature, named
 *   with the feature, the table's line, the item's id, its line and its list; then one line with
 *   the count. A feature that is `open` or `in progress` is never judged.
 *
 *   FAIL-CLOSED, exit 3: the plan or a record file that cannot be read; no `## The chain` section,
 *   or two; a section with no table; a table with no `#` or no `State` column, a row whose cells
 *   are not the header's, a row with no id, an id listed twice, or no feature row at all; a state
 *   that is none of the three; a closed feature whose record no heading opens, or more than one
 *   does; a record with no `Attached (<n>)` list, or whose `<n>` is not the number of items read
 *   under it; and an entry of an item list that is neither an item nor a note. A scan that read
 *   nothing never renders as a plan with every item closed. A usage error exits 2.
 *
 *   RESIDUAL LIMITS, stated rather than implied. (1) Textual: the gate reads the plan's Markdown
 *   by its line shapes, not with a Markdown parser. (2) It proves the marker's form, never that pull
 *   request `#<n>` resolved the item or that the decision was taken. (3) An item attached to a
 *   closed feature from outside its record (a row of `cross-cutting.md` that names it) is not read.
 *   (4) The prose lists of a record (`Wrong as read`, `To build`) are not items, so a defect they
 *   describe is not judged. (5) The `Closed by` column of the table is not compared with the items.
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

/** The plan whose chain table holds every feature's state, relative to the root. */
export const PLAN = "docs/product/PLAN.md";
/** The files that hold the features' records, relative to the root, in the order they are read. */
export const RECORDS = ["docs/product/plan/chain.md", "docs/product/plan/areas.md"];

const DEFAULT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PREFIX = "plan-closure-gate: ";
const USAGE = "usage: node scripts/testing/plan-closure-gate.mjs [--root <dir>]";
const CHAIN_SECTION = "The chain";
const STATES = ["open", "in progress", "closed"];
const CLOSED = "closed";
const HINT =
  'close it with "Closed by #<n>." or "Closed by decision of the <Product Owner|Maintainer> on ' +
  '<YYYY-MM-DD>: <the decision>.", or set the feature back to "in progress"';

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s+(.*?)\s*$/;
const TABLE_ROW = /^\s*\|/;
const SEPARATOR_CELL = /^:?-{3,}:?$/;
/** A top-level bullet whose bold label ends with a colon: `- **Attached (20):**`. */
const LABEL = /^- \*\*([^*]+?):\*\*/;
const ATTACHED = /^Attached \((\d+)\)$/;
const FINDINGS = /^Findings(?:\s|$)/;
/** An entry of an item list: exactly two spaces, then the list marker. */
const ENTRY = /^ {2}- (.*)$/;
/** A line that continues the entry above it, indented four spaces or more. */
const CONTINUATION = /^ {4,}\S/;
const ITEM = /^\*\*([^*]+)\*\*(?: \([^)]*\))?: (\S.*)$/;
const NOTE = /^Note: \S/;
const CLOSED_BY_PULL_REQUEST = /^Closed by #[1-9]\d*(?!\w)/;
const CLOSED_BY_DECISION =
  /^Closed by decision of the (?:Product Owner|Maintainer) on (\d{4})-(\d{2})-(\d{2}): \S/;
const CLOSURE_LOOKALIKE = /^closed by\b/i;

/**
 * @typedef {object} Row
 * @property {string} id
 * @property {string} state
 * @property {number} line One-based line in the plan.
 */

/**
 * @typedef {object} Item
 * @property {string} id
 * @property {"closed" | "open" | "lookalike"} status
 * @property {number} line One-based line in its file.
 * @property {string} list The label of the list that holds it.
 */

/**
 * @typedef {object} Outcome
 * @property {number} exitCode
 * @property {string[]} stdout The lines written to standard output.
 * @property {string[]} stderr The lines written to standard error.
 */

/**
 * @param {number} count
 * @param {string} noun
 * @returns {string}
 */
function plural(count, noun) {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function linesOf(text) {
  return text.split(/\r?\n/);
}

/**
 * The headings of a Markdown text outside its code blocks, each with its level and its line index.
 *
 * @param {string[]} lines
 * @returns {{ index: number, level: number, text: string }[]}
 */
function headingsOf(lines) {
  /** @type {{ index: number, level: number, text: string }[]} */
  const headings = [];
  /** @type {string | null} */
  let fence = null;
  for (const [index, line] of lines.entries()) {
    const marker = FENCE.exec(line);
    if (fence !== null) {
      if (marker !== null && (marker[1] ?? "").startsWith(fence)) fence = null;
      continue;
    }
    if (marker !== null) {
      fence = marker[1] ?? "";
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      headings.push({ index, level: (heading[1] ?? "").length, text: heading[2] ?? "" });
    }
  }
  return headings;
}

/**
 * The cells of a Markdown table row, split on every pipe not escaped by a backslash.
 *
 * @param {string} line
 * @returns {string[]}
 */
function cellsOf(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

/**
 * @description The rows of the chain table, or the reasons it cannot be read.
 * @param {string} text The plan.
 * @returns {{ rows: Row[], failures: string[] }}
 */
function readChainTable(text) {
  const lines = linesOf(text);
  const headings = headingsOf(lines);
  const sections = headings.filter((h) => h.level === 2 && h.text === CHAIN_SECTION);
  const none = { rows: [], failures: [] };
  if (sections.length !== 1) {
    return {
      ...none,
      failures: [
        sections.length === 0
          ? `${PLAN} has no "## ${CHAIN_SECTION}" section, so no feature's state was read`
          : `${PLAN} opens "## ${CHAIN_SECTION}" ${String(sections.length)} times (lines ` +
            `${sections.map((h) => String(h.index + 1)).join(", ")}), so which one holds the ` +
            "chain table is ambiguous",
      ],
    };
  }
  const start = (sections[0]?.index ?? 0) + 1;
  const end = headings.find((h) => h.index >= start && h.level <= 2)?.index ?? lines.length;
  const first = lines.slice(start, end).findIndex((line) => TABLE_ROW.test(line));
  const headerIndex = start + first;
  const separator = cellsOf(lines[headerIndex + 1] ?? "");
  if (
    first === -1 ||
    !TABLE_ROW.test(lines[headerIndex + 1] ?? "") ||
    !separator.every((cell) => SEPARATOR_CELL.test(cell))
  ) {
    return {
      ...none,
      failures: [
        `the "## ${CHAIN_SECTION}" section of ${PLAN} holds no table, so no feature's state was read`,
      ],
    };
  }

  const header = cellsOf(lines[headerIndex] ?? "");
  const missing = ["#", "State"].filter((column) => !header.includes(column));
  if (missing.length > 0) {
    return {
      ...none,
      failures: missing.map(
        (column) =>
          `the chain table of ${PLAN}:${String(headerIndex + 1)} has no "${column}" column, so ` +
          "no feature's state was read"
      ),
    };
  }
  const idColumn = header.indexOf("#");
  const stateColumn = header.indexOf("State");

  /** @type {Row[]} */
  const rows = [];
  /** @type {string[]} */
  const failures = [];
  for (let index = headerIndex + 2; index < end && TABLE_ROW.test(lines[index] ?? ""); index += 1) {
    const at = `${PLAN}:${String(index + 1)}`;
    const cells = cellsOf(lines[index] ?? "");
    if (cells.length !== header.length) {
      failures.push(
        `${at} holds ${plural(cells.length, "cell")} where the chain table's header holds ` +
          `${String(header.length)}, so its state cannot be read`
      );
      continue;
    }
    const id = cells[idColumn] ?? "";
    const state = cells[stateColumn] ?? "";
    if (id === "") {
      failures.push(`${at} is a row of the chain table with no feature id`);
      continue;
    }
    if (!STATES.includes(state)) {
      failures.push(
        `${at} gives ${id} the state "${state}", which is none of open, in progress and closed`
      );
      continue;
    }
    const twin = rows.find((row) => row.id === id);
    if (twin !== undefined) {
      failures.push(
        `${at} lists ${id}, which line ${String(twin.line)} lists too, so its state is ambiguous`
      );
      continue;
    }
    rows.push({ id, state, line: index + 1 });
  }
  if (rows.length === 0 && failures.length === 0) {
    failures.push(
      `the chain table of ${PLAN} holds no feature row, so no feature's state was read`
    );
  }
  return { rows, failures };
}

/**
 * @description Where the record of a feature is opened: every heading, in every record file,
 *   whose text is the id or starts with the id and a space.
 * @param {string} id
 * @param {{ file: string, lines: string[] }[]} records
 * @returns {{ file: string, lines: string[], start: number, end: number }[]} `start` is the
 *   heading's index, `end` the index of the next heading of its level or above.
 */
function recordsOf(id, records) {
  return records.flatMap(({ file, lines }) => {
    const headings = headingsOf(lines);
    return headings
      .filter((h) => h.text === id || h.text.startsWith(`${id} `))
      .map((h) => ({
        file,
        lines,
        start: h.index,
        end:
          headings.find((next) => next.index > h.index && next.level <= h.level)?.index ??
          lines.length,
      }));
  });
}

/**
 * @description Whether an item's text closes it, opens it, or starts like a closure in neither
 *   form. A decision's date must be a calendar date, so `2026-02-30` closes nothing.
 * @param {string} text The item's text, after its id.
 * @returns {Item["status"]}
 */
function statusOf(text) {
  if (CLOSED_BY_PULL_REQUEST.test(text)) return "closed";
  const decision = CLOSED_BY_DECISION.exec(text);
  if (decision !== null) {
    const [year, month, day] = [decision[1], decision[2], decision[3]].map(Number);
    const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() + 1 === month &&
      date.getUTCDate() === day
    ) {
      return "closed";
    }
  }
  return CLOSURE_LOOKALIKE.test(text) ? "lookalike" : "open";
}

/**
 * @description The items of a record's item lists, or the reasons the record cannot be read.
 * @param {string} id The feature's id.
 * @param {{ file: string, lines: string[], start: number, end: number }} record
 * @returns {{ items: Item[], failures: string[] }}
 */
function readItems(id, record) {
  /** @type {Item[]} */
  const items = [];
  /** @type {string[]} */
  const failures = [];
  /** @type {{ label: string, line: number, count: number | null, items: number, unreadable: number } | null} */
  let list = null;
  /** @type {{ label: string, line: number, count: number | null, items: number, unreadable: number }[]} */
  const attached = [];
  let entryOpen = false;

  for (let index = record.start + 1; index < record.end; index += 1) {
    const line = record.lines[index] ?? "";
    if (line.trim() === "") continue;
    const label = LABEL.exec(line);
    if (label !== null) {
      const name = label[1] ?? "";
      const count = ATTACHED.exec(name);
      list =
        count !== null || FINDINGS.test(name)
          ? {
              label: name,
              line: index + 1,
              count: count === null ? null : Number(count[1]),
              items: 0,
              unreadable: 0,
            }
          : null;
      if (list !== null && list.count !== null) attached.push(list);
      entryOpen = false;
      continue;
    }
    if (!/^\s/.test(line)) {
      list = null;
      continue;
    }
    if (list === null) continue;
    const entry = ENTRY.exec(line);
    if (entry === null) {
      if (entryOpen && CONTINUATION.test(line)) continue;
      failures.push(unreadableEntry(record.file, index, list.label, id, line));
      list.unreadable += 1;
      continue;
    }
    const content = entry[1] ?? "";
    const item = ITEM.exec(content);
    if (item !== null) {
      items.push({
        id: (item[1] ?? "").trim(),
        status: statusOf(item[2] ?? ""),
        line: index + 1,
        list: list.label,
      });
      list.items += 1;
      entryOpen = true;
    } else if (NOTE.test(content)) {
      entryOpen = true;
    } else {
      failures.push(unreadableEntry(record.file, index, list.label, id, line));
      list.unreadable += 1;
      entryOpen = false;
    }
  }

  if (attached.length === 0) {
    failures.push(
      `the record of ${id} (${record.file}:${String(record.start + 1)}) holds no "Attached (<n>)" ` +
        "list, so whether it holds an open item cannot be read"
    );
  }
  // A list that holds an unreadable entry is already named by it; its count would only repeat it.
  for (const stated of attached) {
    if (stated.unreadable === 0 && stated.count !== stated.items) {
      failures.push(
        `the record of ${id} (${record.file}:${String(stated.line)}) states "${stated.label}" and ` +
          `${plural(stated.items, "item")} ${stated.items === 1 ? "was" : "were"} read under it, so ` +
          "an item is written where the gate cannot read it"
      );
    }
  }
  return { items, failures };
}

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
 * @description Judges a plan tree: every feature the chain table marks closed must hold no open
 *   item under its record. Reads the plan and the record files under `root`, never git.
 * @param {{ root: string }} input The directory that holds `docs/product/`.
 * @returns {Outcome} The exit code and the lines for each stream, each prefixed with the gate's
 *   name: 0 when no closed feature holds an open item, 1 when one does, 3 when the plan cannot be
 *   read as the gate's header states.
 */
export function runGate({ root }) {
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
  const plan = read(PLAN, "no feature's state");
  const records = RECORDS.map((file) => ({ file, text: read(file, "no record") }));
  if (plan === null || records.some((record) => record.text === null)) {
    return { exitCode: 3, stdout: [], stderr: failures.map((line) => PREFIX + line) };
  }

  const table = readChainTable(plan);
  failures.push(...table.failures);
  const parsed = records.map(({ file, text }) => ({ file, lines: linesOf(text ?? "") }));
  const closed = table.rows.filter((row) => row.state === CLOSED);
  /** @type {string[]} */
  const violations = [];
  let itemCount = 0;
  const holding = new Set();

  for (const row of closed) {
    const at = `${PLAN}:${String(row.line)}`;
    const found = recordsOf(row.id, parsed);
    if (found.length !== 1) {
      failures.push(
        found.length === 0
          ? `${row.id} is closed (${at}) and no heading of ${RECORDS.join(" or ")} opens its ` +
              "record, so no item of it was read"
          : `${row.id} is closed (${at}) and its record is opened more than once ` +
              `(${found.map((r) => `${r.file}:${String(r.start + 1)}`).join(", ")}), so which one ` +
              "holds its items is ambiguous"
      );
      continue;
    }
    const record = found[0];
    if (record === undefined) continue;
    const { items, failures: unreadable } = readItems(row.id, record);
    failures.push(...unreadable);
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
          `(${record.file}:${String(item.line)}, in "${item.list}"); ${HINT}`
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
 * True only when this file is the process entry point. The rule is exported for the suite, and
 * importing it must not run the CLI as a side effect.
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
