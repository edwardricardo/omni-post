// @ts-check
/**
 * @file plan-text.mjs
 * @description The reader of the plan's Markdown that the plan-closure gate
 *   (`scripts/testing/plan-closure-gate.mjs`, fitness #56) and the plan's records
 *   (`scripts/plan/plan-records.mjs`) both import: the plan's file paths, the fenced code blocks
 *   no other function reads, headings, tables and their cells, the chain table of `## The chain`,
 *   a record's span from its heading, inline code spans, the two forms that close an item, and
 *   {@link readRecordSpan}, the one walker of a chain record's span. The walker gives each line of
 *   the span its kind (a label, an item, a note, a continuation, prose or refused), reads the
 *   record's item lists, names each line its grammar refuses, and scans every line no list reads
 *   for an item's shape; the gate judges a closed feature with it and the records read every
 *   chain record with it, so a line inside a chain record that the gate refuses the records
 *   refuse too, and a line the gate reads as an item, a note or a continuation is read the same
 *   way by both. The records add rules of their own on top of it, which their header states.
 *
 *   It reads the plan by its line shapes, not with a Markdown parser, writes nothing, and imports
 *   nothing beyond Node's own modules: the fitness job that runs the gate installs no package.
 * @layer infrastructure
 */

/** The plan whose chain table holds every feature's state, relative to the root. */
export const PLAN_FILE = "docs/product/PLAN.md";

/**
 * The plan's files, relative to the root, by the short name a query selects them with. The order
 * is the order they are read in.
 */
export const PLAN_FILES = Object.freeze({
  plan: PLAN_FILE,
  chain: "docs/product/plan/chain.md",
  areas: "docs/product/plan/areas.md",
  "cross-cutting": "docs/product/plan/cross-cutting.md",
  "off-the-map": "docs/product/plan/off-the-map.md",
  parking: "docs/product/plan/parking.md",
});

const CHAIN_SECTION = "The chain";
const STATES = ["open", "in progress", "closed"];

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
/** An ATX heading: its run of `#`, then its text. */
export const HEADING = /^(#{1,6})\s+(.*?)\s*$/;
/** A line of a Markdown table: optional indentation, then a pipe. */
export const TABLE_ROW = /^\s*\|/;
/** A cell of a table's separator row: `---`, aligned or not. */
const SEPARATOR_CELL = /^:?-{3,}:?$/;
/** A top-level bullet whose bold label ends with a colon: `- **Attached (20):**`. */
export const LABEL = /^- \*\*([^*]+?):\*\*/;
/** The label of a record's attached list, with the count it states. */
const ATTACHED = /^Attached \((\d+)\)$/;
/** The label of a record's findings list. */
const FINDINGS = /^Findings(?:\s|$)/;
/** An entry of an item list: exactly two spaces, then the list marker. */
const ENTRY = /^ {2}- (.*)$/;
/** A list entry nested under an entry: four spaces or more, then a bullet or an ordered marker. */
const NESTED = /^\s{4,}(?:[-*+]|\d+[.)])(?:\s|$)/;
/** A line that continues the entry above it, indented four spaces or more. */
const CONTINUATION = /^ {4,}\S/;
/** A continuation whose text starts like an item: a bold id, an optional reference, a colon. */
const CONTINUATION_ITEM = /^ {4,}\*\*[^*]*[^*:\s]\*\*(?: \([^)]*\))?:(?:\s|$)/;
/** An item: a bold id, an optional `(<reference>)`, a colon, then its text. */
export const ITEM = /^\*\*([^*]+)\*\*(?: \(([^)]*)\))?: (\S.*)$/;
/**
 * Anything shaped like an item, anywhere on a line: a bold text that does not end with a colon or
 * a space, an optional reference, then `: `. A label (`**Who:**`) does not match.
 */
export const ITEM_SHAPED = /\*\*[^*]*[^*:\s]\*\*(?: \([^)]*\))?: /;
/** A note of an item list, which is not an item. */
const NOTE = /^Note: \S/;
/** The first form that closes an item: the pull request that resolved it. */
const CLOSED_BY_PULL_REQUEST = /^Closed by #[1-9]\d*(?!\w)/;
/** The second form that closes an item: a decision, its role, its date and its words. */
const CLOSED_BY_DECISION =
  /^Closed by (decision of the (?:Product Owner|Maintainer) on (\d{4})-(\d{2})-(\d{2})): (.*)$/;
const BACKTICK_RUN = /`+/g;
/** A word the decision must hold: three letters or more, so `a.` or `x` records no decision. */
const WORD = /\p{L}{3,}/u;
const CLOSURE_LOOKALIKE = /^closed by\b/i;

/**
 * @typedef {object} Text
 * @property {string} file The file, relative to the root.
 * @property {string[]} lines
 * @property {boolean[]} fenced Per line: inside a fenced code block, its fences included.
 * @property {number | null} unclosed The index of a fence's opening line when the fence is still
 *   open at the end of the file, else `null`.
 */

/**
 * @typedef {object} Heading
 * @property {number} index Zero-based line index.
 * @property {number} level The number of `#`.
 * @property {string} text
 */

/**
 * @typedef {object} RecordSpan
 * @property {Text} text The file that holds the record.
 * @property {number} start The index of the record's heading.
 * @property {number} end The index of the next heading of its level or above, or the line count.
 */

/**
 * @typedef {object} Row
 * @property {string} id
 * @property {string} state
 * @property {number} line One-based line in the plan.
 * @property {Record<string, string>} cells The row's cells by the header's column names.
 */

/**
 * @description A count and its noun, plural unless the count is one.
 * @param {number} count
 * @param {string} noun
 * @returns {string}
 */
export function plural(count, noun) {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * @description The lines of a text, each marked when a fenced code block holds it: an example
 *   written in a fence is never a table, a heading or an item.
 * @param {string} file
 * @param {string} text
 * @returns {Text}
 */
export function textOf(file, text) {
  const lines = text.split(/\r?\n/);
  /** @type {string | null} */
  let fence = null;
  let opened = 0;
  const fenced = lines.map((line, index) => {
    if (fence !== null) {
      const close = FENCE_CLOSE.exec(line)?.[1] ?? "";
      if (close.startsWith(fence[0] ?? "") && close.length >= fence.length) fence = null;
      return true;
    }
    const open = FENCE_OPEN.exec(line);
    if (open !== null) {
      fence = open[1] ?? "";
      opened = index;
    }
    return open !== null;
  });
  return { file, lines, fenced, unclosed: fence === null ? null : opened };
}

/**
 * @description The headings of a text outside its fenced code blocks, each with its level and its
 *   line index.
 * @param {Text} text
 * @returns {Heading[]}
 */
function headingsOf({ lines, fenced }) {
  return lines.flatMap((line, index) => {
    const heading = fenced[index] === true ? null : HEADING.exec(line);
    return heading === null
      ? []
      : [{ index, level: (heading[1] ?? "").length, text: heading[2] ?? "" }];
  });
}

/**
 * @description The cells of a Markdown table row, split on every pipe not escaped by a backslash.
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
 * @description Where a heading's record ends: the index of the next heading of its level or
 *   above, or the line count.
 * @param {Heading[]} headings The headings of the text, in order.
 * @param {Heading} heading
 * @param {number} lineCount
 * @returns {number}
 */
function spanEnd(headings, heading, lineCount) {
  return (
    headings.find((next) => next.index > heading.index && next.level <= heading.level)?.index ??
    lineCount
  );
}

/**
 * @typedef {object} TableRow
 * @property {number} index Zero-based line index.
 * @property {string[]} cells
 */

/**
 * @typedef {object} Table
 * @property {number} headerIndex Zero-based line index of the header.
 * @property {string[]} header The header's cells.
 * @property {string[] | null} separator The cells of the separator row under the header, or
 *   `null` when the line under it is not a table line whose every cell is `---`, aligned or not:
 *   without a separator row the lines are not a table.
 * @property {TableRow[]} rows The table lines after the separator, to the first line that is not
 *   one, a fenced line or `end`; empty when there is no separator.
 * @property {number} end The index after the table's last line: the header's next line when there
 *   is no separator.
 */

/**
 * @description The table whose header is the given line: its header, its separator row and its
 *   rows. It judges no cell count: each reader decides what a row that is not its header's
 *   width means.
 * @param {Text} text
 * @param {number} headerIndex The line of the header, a table line outside fenced code.
 * @param {number} [end] The index the table cannot reach, the line count by default.
 * @returns {Table}
 */
export function readTable({ lines, fenced }, headerIndex, end = lines.length) {
  /** @type {(index: number) => boolean} */
  const tableRow = (index) =>
    index < end && fenced[index] !== true && TABLE_ROW.test(lines[index] ?? "");
  const header = cellsOf(lines[headerIndex] ?? "");
  const separatorCells = cellsOf(lines[headerIndex + 1] ?? "");
  const separator =
    tableRow(headerIndex + 1) && separatorCells.every((cell) => SEPARATOR_CELL.test(cell))
      ? separatorCells
      : null;
  /** @type {TableRow[]} */
  const rows = [];
  if (separator !== null) {
    for (let index = headerIndex + 2; tableRow(index); index += 1) {
      rows.push({ index, cells: cellsOf(lines[index] ?? "") });
    }
  }
  return {
    headerIndex,
    header,
    separator,
    rows,
    end: separator === null ? headerIndex + 1 : headerIndex + 2 + rows.length,
  };
}

/**
 * @description The rows of the chain table, or the reasons it cannot be read.
 * @param {Text} plan
 * @returns {{ rows: Row[], failures: string[] }}
 */
export function readChainTable(plan) {
  const { lines, fenced } = plan;
  /** @type {(index: number) => boolean} */
  const tableRow = (index) => fenced[index] !== true && TABLE_ROW.test(lines[index] ?? "");
  const headings = headingsOf(plan);
  const sections = headings.filter((h) => h.level === 2 && h.text === CHAIN_SECTION);
  const none = { rows: [], failures: [] };
  if (sections.length !== 1) {
    return {
      ...none,
      failures: [
        sections.length === 0
          ? `${PLAN_FILE} has no "## ${CHAIN_SECTION}" section, so no feature's state was read`
          : `${PLAN_FILE} opens "## ${CHAIN_SECTION}" ${String(sections.length)} times (lines ` +
            `${sections.map((h) => String(h.index + 1)).join(", ")}), so which one holds the ` +
            "chain table is ambiguous",
      ],
    };
  }
  const start = (sections[0]?.index ?? 0) + 1;
  const end = headings.find((h) => h.index >= start && h.level <= 2)?.index ?? lines.length;
  const noTable = {
    ...none,
    failures: [
      `the "## ${CHAIN_SECTION}" section of ${PLAN_FILE} holds no table, so no feature's state was read`,
    ],
  };
  let headerIndex = start;
  while (headerIndex < end && !tableRow(headerIndex)) headerIndex += 1;
  if (headerIndex >= end) return noTable;
  const table = readTable(plan, headerIndex, end);
  if (table.separator === null) return noTable;

  const header = table.header;
  const missing = ["#", "State"].filter((column) => !header.includes(column));
  if (missing.length > 0) {
    return {
      ...none,
      failures: missing.map(
        (column) =>
          `the chain table of ${PLAN_FILE}:${String(headerIndex + 1)} has no "${column}" column, so ` +
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
  for (const { index, cells } of table.rows) {
    const at = `${PLAN_FILE}:${String(index + 1)}`;
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
    rows.push({
      id,
      state,
      line: index + 1,
      cells: Object.fromEntries(header.map((column, at) => [column, cells[at] ?? ""])),
    });
  }
  if (rows.length === 0 && failures.length === 0) {
    failures.push(
      `the chain table of ${PLAN_FILE} holds no feature row, so no feature's state was read`
    );
  }
  return { rows, failures };
}

/**
 * @description Where the record of a feature is opened: every heading, in every record file,
 *   whose text is the id alone or the id followed by a space.
 * @param {string} id
 * @param {Text[]} records
 * @returns {RecordSpan[]}
 */
export function recordsOf(id, records) {
  return records.flatMap((text) => {
    const headings = headingsOf(text);
    return headings
      .filter((h) => h.text === id || h.text.startsWith(`${id} `))
      .map((h) => ({ text, start: h.index, end: spanEnd(headings, h, text.lines.length) }));
  });
}

/**
 * @description The span of the record a heading opens, to the next heading of its level or above,
 *   as {@link recordsOf} reads it.
 * @param {Text} text
 * @param {number} index The line of the heading, outside fenced code.
 * @returns {RecordSpan}
 */
export function recordSpanAt(text, index) {
  const headings = headingsOf(text);
  const heading = headings.find((h) => h.index === index);
  return {
    text,
    start: index,
    end: heading === undefined ? index + 1 : spanEnd(headings, heading, text.lines.length),
  };
}

/**
 * @typedef {object} Closure
 * @property {"closed" | "open" | "lookalike"} status
 * @property {"pull-request" | "decision" | null} form The form that closes the item, `null`
 *   unless it is closed.
 * @property {string} marker The text of that form at the start of the item, the decision's
 *   colon and space included; empty unless it is closed.
 * @property {string | null} by `#<n>` for a pull request, `decision of the <role> on <date>` for
 *   a decision, `null` unless it is closed.
 */

/**
 * @description Whether an item's text closes it, opens it, or starts like a closure in neither
 *   form, with the form that closes it. A decision's date must be a calendar date no later than
 *   `today`, so `2026-02-30` and a date to come close nothing, and its decision must hold a word
 *   of three letters or more, so `: .` and `: a.` close nothing.
 * @param {string} text The item's text, after its id.
 * @param {string} today The day the check runs, `YYYY-MM-DD` in UTC.
 * @returns {Closure}
 */
export function closureOf(text, today) {
  const pullRequest = CLOSED_BY_PULL_REQUEST.exec(text);
  if (pullRequest !== null) {
    return {
      status: "closed",
      form: "pull-request",
      marker: pullRequest[0],
      by: pullRequest[0].slice("Closed by ".length),
    };
  }
  const decision = CLOSED_BY_DECISION.exec(text);
  if (decision !== null) {
    const [year, month, day] = [decision[2], decision[3], decision[4]].map(Number);
    const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0));
    const calendar =
      date.getUTCFullYear() === year &&
      date.getUTCMonth() + 1 === month &&
      date.getUTCDate() === day;
    const written = `${decision[2] ?? ""}-${decision[3] ?? ""}-${decision[4] ?? ""}`;
    const words = decision[5] ?? "";
    if (calendar && written <= today && WORD.test(words)) {
      return {
        status: "closed",
        form: "decision",
        marker: text.slice(0, text.length - words.length),
        by: decision[1] ?? "",
      };
    }
  }
  return {
    status: CLOSURE_LOOKALIKE.test(text) ? "lookalike" : "open",
    form: null,
    marker: "",
    by: null,
  };
}

/**
 * @description Whether an item's text closes it, opens it, or starts like a closure in neither
 *   form, by {@link closureOf}.
 * @param {string} text The item's text, after its id.
 * @param {string} today The day the check runs, `YYYY-MM-DD` in UTC.
 * @returns {"closed" | "open" | "lookalike"}
 */
function statusOf(text, today) {
  return closureOf(text, today).status;
}

/**
 * @typedef {object} ItemList
 * @property {string} label
 * @property {number} line One-based line of the label.
 * @property {number | null} count The count an `Attached (<n>)` label states, else `null`.
 * @property {number} items
 * @property {number} unreadable Entries of the list that were refused.
 */

/**
 * @typedef {object} SpanItem
 * @property {string} id The bold id, trimmed.
 * @property {string | null} reference The text of the parenthesis after the id.
 * @property {string} text The entry's text after its id, on the entry's own line.
 * @property {string[]} continuations Each line that continues the entry, trimmed.
 * @property {"closed" | "open" | "lookalike"} status By the entry's own line, never its
 *   continuations.
 * @property {number} line One-based line of the entry.
 * @property {string} list The label of the list that holds it.
 */

/**
 * Why a line of a record's span is refused: an entry of an item list that is neither an item nor
 * a note, or a line of the list indented as neither; a nested list entry under an entry; a
 * continuation that starts like an item; an item-shaped text read by no item list.
 *
 * @typedef {"unreadable-entry" | "nested-entry" | "item-as-continuation" | "unlisted-item"} RefusalRule
 */

/**
 * @typedef {object} SpanRefusal
 * @property {number} index Zero-based line index.
 * @property {RefusalRule} rule
 * @property {string | null} list The label of the item list the line was read in, `null` for an
 *   item-shaped text no list reads.
 */

/**
 * The kind of a line of a record's span: a blank or fenced line; a label (a top-level bullet whose
 * bold label ends with a colon); an item or a note of an item list; a line that continues an
 * entry of an item list; prose, every other line the grammar reads; or refused.
 *
 * @typedef {"blank" | "fenced" | "label" | "item" | "note" | "continuation" | "prose" | "refused"} SpanLineKind
 */

/**
 * @typedef {object} SpanLine
 * @property {number} index Zero-based line index.
 * @property {SpanLineKind} kind
 * @property {string | null} label The name of the label a line opens: set on a label line, and
 *   kept when the item-shape scan refuses that line, so a line of kind `refused` may carry one;
 *   `null` on every other line.
 */

/**
 * @typedef {object} SpanReading
 * @property {SpanLine[]} lines One per line after the heading, in order.
 * @property {SpanItem[]} items
 * @property {ItemList[]} attached The record's `Attached (<n>)` lists, in order.
 * @property {ItemList[]} miscounted The attached lists with no refused entry whose stated count
 *   is not the number of items read under them.
 * @property {SpanRefusal[]} refusals The lines the walk refused, in order, then the item-shaped
 *   lines no list reads, in order.
 * @property {boolean} opensUnclosedFence The record opens its file's fenced code block that
 *   nothing closes.
 */

/**
 * @description Walks the span of a feature's record. Its item lists are its top-level bullets
 *   whose bold label, colon inside the bold, is `Attached (<n>)` or starts with `Findings`; every
 *   other bullet of the record is prose. An entry of an item list is a line indented two spaces,
 *   then `- `: an item, `**<id>**: <text>` with an optional `(<reference>)` after the id, or a
 *   note, `Note: <text>`. A line indented four spaces or more that opens no list continues the
 *   entry above it, across blank lines too; a line at the left margin ends the list. Fenced and
 *   blank lines change nothing. A line read neither as an item nor as an entry's continuation, nor
 *   refused by the walk, is refused when it holds an item-shaped text outside its code spans.
 * @param {RecordSpan} record
 * @param {string} today The day the check runs, `YYYY-MM-DD` in UTC.
 * @returns {SpanReading}
 */
export function readRecordSpan(record, today) {
  const { lines, fenced, unclosed } = record.text;
  /** @type {SpanLine[]} */
  const read = [];
  /** @type {SpanItem[]} */
  const items = [];
  /** @type {ItemList[]} */
  const attached = [];
  /** @type {SpanRefusal[]} */
  const refusals = [];
  /** The lines read as items or as an entry's text, or refused, which the item-shape scan skips. */
  const accounted = new Set();
  /** @type {ItemList | null} */
  let list = null;
  let entryOpen = false;
  /** @type {SpanItem | null} */
  let current = null;
  /** @type {(index: number, kind: SpanLineKind, label?: string) => void} */
  const mark = (index, kind, label) => {
    read.push({ index, kind, label: label ?? null });
  };
  /** @type {(index: number, open: ItemList, rule: RefusalRule) => void} */
  const refuse = (index, open, rule) => {
    refusals.push({ index, rule, list: open.label });
    accounted.add(index);
    open.unreadable += 1;
    mark(index, "refused");
    current = null;
  };

  for (let index = record.start + 1; index < record.end; index += 1) {
    const line = lines[index] ?? "";
    if (fenced[index] === true || line.trim() === "") {
      mark(index, fenced[index] === true ? "fenced" : "blank");
      continue;
    }
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
      current = null;
      mark(index, "label", name);
      continue;
    }
    if (!/^\s/.test(line)) {
      list = null;
      entryOpen = false;
      current = null;
      mark(index, "prose");
      continue;
    }
    if (list === null) {
      mark(index, "prose");
      continue;
    }
    const entry = ENTRY.exec(line);
    if (entry === null) {
      // A continuation is the entry's own text, unless it starts like an item: written there, an
      // open item would read as the closed entry above it.
      if (NESTED.test(line)) refuse(index, list, "nested-entry");
      else if (!entryOpen || !CONTINUATION.test(line)) refuse(index, list, "unreadable-entry");
      else if (CONTINUATION_ITEM.test(line)) refuse(index, list, "item-as-continuation");
      else {
        accounted.add(index);
        current?.continuations.push(line.trim());
        mark(index, "continuation");
      }
      continue;
    }
    const content = entry[1] ?? "";
    const item = ITEM.exec(content);
    if (item !== null) {
      current = {
        id: (item[1] ?? "").trim(),
        reference: item[2] ?? null,
        text: item[3] ?? "",
        continuations: [],
        status: statusOf(item[3] ?? "", today),
        line: index + 1,
        list: list.label,
      };
      items.push(current);
      accounted.add(index);
      list.items += 1;
      entryOpen = true;
      mark(index, "item");
    } else if (NOTE.test(content)) {
      entryOpen = true;
      current = null;
      mark(index, "note");
    } else {
      refuse(index, list, "unreadable-entry");
      entryOpen = false;
    }
  }

  // An item written where no list reads it would otherwise pass unseen, open or not. A code span
  // quotes the grammar rather than writes an item, so its contents are not scanned. A refused line
  // keeps the label it had: a label line written like an item still opens its list.
  for (const at of read) {
    const line = lines[at.index] ?? "";
    if (
      at.kind !== "fenced" &&
      !accounted.has(at.index) &&
      ITEM_SHAPED.test(withoutCodeSpans(line))
    ) {
      refusals.push({ index: at.index, rule: "unlisted-item", list: null });
      at.kind = "refused";
    }
  }

  return {
    lines: read,
    items,
    attached,
    // A list that holds an unreadable entry is already named by it; its count would only repeat it.
    miscounted: attached.filter(
      (stated) => stated.unreadable === 0 && stated.count !== stated.items
    ),
    refusals,
    opensUnclosedFence: unclosed !== null && unclosed > record.start && unclosed < record.end,
  };
}

/**
 * @description The line without its inline code spans, whose contents quote text rather than
 *   write it. A span counts only when every backtick run of the line pairs with a later run of the
 *   same length; a line with a run left unpaired is returned whole, so a stray backtick cannot
 *   take an item-shaped text out of the scan.
 * @param {string} line
 * @returns {string}
 */
export function withoutCodeSpans(line) {
  const runs = [...line.matchAll(BACKTICK_RUN)];
  let kept = "";
  let from = 0;
  for (let open = 0; open < runs.length;) {
    const opening = runs[open];
    const close = runs.findIndex(
      (run, at) => at > open && run[0].length === (opening?.[0] ?? "").length
    );
    const closing = runs[close];
    if (opening === undefined || closing === undefined) return line;
    kept += line.slice(from, opening.index);
    from = closing.index + closing[0].length;
    open = close + 1;
  }
  return kept + line.slice(from);
}
