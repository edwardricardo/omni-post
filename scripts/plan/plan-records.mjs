// @ts-check
/**
 * @file plan-records.mjs
 * @description The plan as records, built on demand from the plan's six files and never stored.
 *   Every line outside fenced code gets one kind, and a line that fits no shape is returned as
 *   unclassified with its file, line and reason; what the plan's structure lacks is returned as a
 *   failure. Nothing is skipped in silence, and the grammar does not widen to swallow an odd line.
 *   The fences, headings, tables, the chain table, the closing forms and the walk of a chain
 *   record's span are those of `plan-text.mjs`, the reader the plan-closure gate imports: inside
 *   a chain record a line the gate reads as an item, a note or a continuation is read the same
 *   way by both, and every line the gate refuses there is unclassified here.
 *
 *   FEATURES. A chain feature is a `### F-<n> <title>` heading of `chain.md` and its record, to the
 *   next heading of level 3 or above: `who`, `today`, `dependsOn`, `need` and `done` are its
 *   `Who`, `Today`, `Depends on`, `Need` and `Proof of done` fields, and `state` and `closedBy`
 *   are the `State` and `Closed by` cells of its row in the chain table of `PLAN.md`. An area
 *   feature is a row of the feature table of a `## A-<AREA> <title>` heading of `areas.md`, whose
 *   header is `Feature | Who | Today | Depends on`, with an optional `Need` column last. Its id as
 *   written is the leading token of its `Feature` cell (`A-TEAM-03`, `C-07`, `A-ANALYTICS-04.`,
 *   `11.`), and its canonical id is `A-<AREA>-<n>`, `<n>` the token's number, or the row's
 *   position in the table when the row writes no id, zero-padded to two digits.
 *
 *   ITEMS. In a chain record, the items the walker reads in its `Attached (<n>)` and `Findings`
 *   lists, each with its continuations. In `areas.md`, the bullets under a paragraph that starts
 *   with `Items attached` or `Findings` and ends with a colon. In `cross-cutting.md`,
 *   `off-the-map.md` and `parking.md`, every top-level bullet. Outside a chain record a bullet
 *   continues on lines indented two spaces or more. An item's state is `open`,
 *   `closed-by-pull-request` or `closed-by-decision`, by the gate's two closing forms read on the
 *   item's own line; its title is its text before its first ` Where: `, ` Done: ` or
 *   ` Depends on: `, the closing form left out. `where` holds the path-shaped code spans of its
 *   `Where` segment (a `/` or a file extension, with an optional `:<line>` suffix); a span that
 *   is only a line suffix names that line of the nearest path span before it, and is left out
 *   when none precedes it. `doneState` is `absent` with no `Done` segment, `not-stated` when that
 *   segment starts with `not stated` in any case, and `stated` otherwise; a chain feature's is
 *   read the same way from its `Proof of done`. An item the plan writes as `**(no id)**` where its
 *   id would stand ({@link NO_ID_TEXT}) has a null `id` and keeps that text as its `writtenId`.
 *
 *   TAGS AND MENTIONS. A record's tags are its own: every `MP:<n>` and old id (`SMELL-<n>`,
 *   `FN-<n>`, `DEF-<n>`) of an item's id and of the parenthesis after it, or of the parenthesis
 *   after an area feature's id; the units of the testing refoundation tracker it carries (the
 *   leading token of each entry of a chain record's `Proof base`, and the id of an item under a
 *   heading that starts with `Testing refoundation units`). Its mentions are the `MP:<n>` and old
 *   ids its other text names, its fields and prose included, its tags left out.
 *
 *   UNCLASSIFIED. A line a chain record's walk refuses; an item-shaped text (a bold text, then
 *   `: `, outside a code span) on any line that is neither an item's own line nor its
 *   continuation; a blockquote line and a raw HTML line; an indented line that continues no
 *   bullet outside a chain record; a nested bullet under an item outside the chain; a table line
 *   with no separator row of its cell count under it, or a row whose cells are not its header's; a
 *   table of `areas.md` whose header is not the feature header, or a feature table outside any
 *   area; a `## ` heading of `areas.md` that names no area; a heading of `chain.md` or `areas.md`
 *   that names a chain feature (`F-<n>`) other than the `### F-<n>` heading of its record; a
 *   third-level heading of `chain.md` that is not a `### F-<n> <title>` record heading and either
 *   begins like a feature id (`F-` or `F`, then a digit) or sits in a second-level section that
 *   holds a feature record; the opening line of a fence nothing closes.
 *
 *   FAILURES. A file or the chain table that cannot be read; a row of the chain table that no
 *   chain record holds, and a chain record no row lists; a chain record with no `Attached (<n>)`
 *   list, or whose count is not the number of items read under it; an area with no feature table;
 *   a canonical id that two features carry.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  HEADING,
  ITEM,
  ITEM_SHAPED,
  LABEL,
  PLAN_FILES,
  TABLE_ROW,
  closureOf,
  readChainTable,
  readRecordSpan,
  readTable,
  recordSpanAt,
  textOf,
  withoutCodeSpans,
} from "./plan-text.mjs";

const BULLET = /^(?:[-*+]|\d+[.)]) (.*)$/;
const INDENTED_BULLET = /^\s+(?:[-*+]|\d+[.)])(?:\s|$)/;
const BLOCKQUOTE = /^\s*>/;
/** An HTML tag or comment at the start of a line; an autolink such as `<https://…>` is not one. */
const RAW_HTML = /^\s*<(?:!--|\/?[A-Za-z][A-Za-z0-9-]*(?:\s|\/?>|$))/;
const CHAIN_FEATURE = /^(F-\d+)(?:\s+(.*))?$/;
const AREA = /^A-([A-Z][A-Z-]*)(?:\s+(.*))?$/;
const AREA_FEATURE = /^([A-Z][A-Z-]*-(\d+)\.?|(\d+)\.)(?:\s+\(([^)]*)\))?\s+(\S.*)$/;
const ITEM_LIST_INTRO = /^(?:Items attached|Findings)\b.*:$/;
const UNITS_SECTION = /^Testing refoundation units\b/;
const UNIT = /^\d+[a-z]?\.[A-Z]?\d+[a-z]?$/;
const MP_TAG = /MP:\d+/g;
const OLD_ID = /(?<![\w-])(?:SMELL|FN|DEF)-\d+(?![\w-])/g;
const SEGMENT = /(?:^| )(Where|Done|Depends on): /g;
const CODE_SPAN = /`([^`]+)`/g;
const LINE_SUFFIX = /:\d+(?:[-,]\d+)*$/;
const LINE_REFERENCE = /^:\d+(?:[-,]\d+)*$/;
const FILE_EXTENSION = /\.[A-Za-z][A-Za-z0-9]*$/;
const NOT_STATED = /^not stated\b/i;
const MARKER_TAIL = /^[\s.,;:]+/;
const FEATURE_COLUMNS = ["Feature", "Who", "Today", "Depends on"];
const FEATURE_HEADERS = [FEATURE_COLUMNS, [...FEATURE_COLUMNS, "Need"]].map((h) => h.join("|"));
const NO_VALUE = new Set(["", "—", "-"]);
const STRAY_FEATURE_HEADING =
  "a heading that names a chain feature outside its `### F-<n>` record of the chain";
const FEATURE_ID_START = /^F-?\d/;
const MISSHAPEN_FEATURE_HEADING =
  "a third-level heading of the chain that begins like a feature id but is not a `### F-<n> <title>` record heading";
const UNRECORDED_SECTION_HEADING =
  "a third-level heading of the chain, in a section that holds feature records, that is not a `### F-<n> <title>` record heading";

/**
 * The reason a line a chain record's walk refuses is unclassified, by the walker's rule.
 *
 * @type {Record<import("./plan-text.mjs").RefusalRule, string>}
 */
const SPAN_REASONS = {
  "unreadable-entry":
    "a line of an item list that is neither an item, a note nor the continuation of an entry",
  "nested-entry": "a nested list entry under an entry of an item list",
  "item-as-continuation": "a continuation of an entry that starts like an item",
  "unlisted-item": "an item-shaped text that no item list reads",
};

/** @typedef {import("./plan-text.mjs").Text} Text */

/**
 * @typedef {object} PlanSource
 * @property {string} file The file, relative to the root.
 * @property {string} text
 */

/**
 * @typedef {object} PlanRecord
 * @property {"feature" | "item"} kind
 * @property {string | null} id The canonical id of a feature; an item's id as written, `null`
 *   when it writes none.
 * @property {string | null} writtenId The id as the plan writes it.
 * @property {string} file
 * @property {number} line One-based line of the record's heading, row or entry.
 * @property {string} title
 * @property {string | null} owner A feature's area or chain section; an item's feature, area or
 *   section.
 * @property {string | null} list The label of the list, or the sub-heading, that holds an item.
 * @property {string | null} who
 * @property {string | null} today
 * @property {string | null} need
 * @property {string | null} dependsOn
 * @property {string | null} state
 * @property {string | null} closedBy
 * @property {string[]} where
 * @property {string | null} done
 * @property {"stated" | "not-stated" | "absent"} doneState
 * @property {string[]} tags The record's own tags.
 * @property {string[]} mentions The ids its other text names.
 * @property {string} text The record's text: an item's text after its id, a feature's line.
 */

/**
 * @typedef {object} ClassifiedLine
 * @property {string} file
 * @property {number} line
 * @property {string} kind
 * @property {string} [reason] Why the line is unclassified.
 */

/**
 * @typedef {object} ParsedPlan
 * @property {PlanRecord[]} records
 * @property {ClassifiedLine[]} lines
 * @property {ClassifiedLine[]} unclassified
 * @property {string[]} failures What the plan's structure lacks, such as a readable chain table.
 */

/**
 * The text the plan writes in bold where an item's id would stand, `**(no id)**`, for an item that
 *   has no id. Its record's `id` is `null` and its `writtenId` keeps this text; the list command
 *   prints it for every record whose `id` is `null`.
 */
export const NO_ID_TEXT = "(no id)";

/**
 * @typedef {object} Filter
 * @property {string} field A key of {@link FILTER_FIELDS}, or `kind` or `file`.
 * @property {string} value
 */

/**
 * The fields a list may filter on, by the flag's name, with how a value matches: `equals` the
 *   whole field, `contains` a literal part of it, `element-equals` or `element-contains` one
 *   element of a list. No value is ever compiled as a regular expression. The object and each of
 *   its rules are frozen, so a script that imports the library cannot change how a field matches.
 */
export const FILTER_FIELDS = Object.freeze({
  id: filterRule("id", "equals"),
  "written-id": filterRule("writtenId", "equals"),
  title: filterRule("title", "contains"),
  owner: filterRule("owner", "contains"),
  list: filterRule("list", "contains"),
  who: filterRule("who", "contains"),
  today: filterRule("today", "contains"),
  need: filterRule("need", "contains"),
  "depends-on": filterRule("dependsOn", "contains"),
  state: filterRule("state", "equals"),
  "closed-by": filterRule("closedBy", "equals"),
  where: filterRule("where", "element-contains"),
  done: filterRule("done", "contains"),
  "done-state": filterRule("doneState", "equals"),
  tag: filterRule("tags", "element-equals"),
  mention: filterRule("mentions", "element-equals"),
  text: filterRule("text", "contains"),
});

/**
 * @description One frozen rule of {@link FILTER_FIELDS}.
 * @param {string} key The record's property the field reads.
 * @param {"equals" | "contains" | "element-equals" | "element-contains"} match
 * @returns {Readonly<{ key: string, match: "equals" | "contains" | "element-equals" | "element-contains" }>}
 */
function filterRule(key, match) {
  return Object.freeze({ key, match });
}

/**
 * @param {string} value
 * @returns {string | null}
 */
function valueOf(value) {
  return NO_VALUE.has(value.trim()) ? null : value.trim();
}

/**
 * @description Every match of a global pattern across the texts, in order.
 * @param {RegExp} pattern
 * @param {string[]} texts
 * @returns {string[]}
 */
function matchesOf(pattern, texts) {
  return texts.flatMap((text) => [...text.matchAll(pattern)].map((match) => match[0]));
}

/**
 * @description A record's own tags and the ids its other text names, each list without repeats
 *   and the mentions without the tags.
 * @param {string[]} own The texts that carry the record's own tags.
 * @param {string[]} other The rest of the record's text.
 * @param {string[]} units
 * @returns {{ tags: string[], mentions: string[] }}
 */
function tagsOf(own, other, units) {
  const tags = [...new Set([...matchesOf(MP_TAG, own), ...matchesOf(OLD_ID, own), ...units])];
  const mentions = [...new Set([...matchesOf(MP_TAG, other), ...matchesOf(OLD_ID, other)])];
  return { tags, mentions: mentions.filter((id) => !tags.includes(id)) };
}

/**
 * @description The leading token of each entry of a `Proof base` field that is shaped like a unit.
 * @param {string | null} proofBase
 * @returns {string[]}
 */
function unitsOfProofBase(proofBase) {
  return (proofBase ?? "")
    .split(";")
    .map((entry) => entry.trim().split(/\s/)[0] ?? "")
    .filter((token) => UNIT.test(token));
}

/**
 * @description Whether a code span names a path: no space, and a `/` or a file extension before
 *   an optional `:<line>` suffix.
 * @param {string} span
 * @returns {boolean}
 */
function isPath(span) {
  if (/\s/.test(span)) return false;
  const bare = span.replace(LINE_SUFFIX, "");
  return bare.includes("/") || FILE_EXTENSION.test(bare);
}

/**
 * @description The evidence paths of a `Where` segment: its path-shaped code spans, and each span
 *   that is only a line suffix joined to the nearest path span before it. A row writes a second
 *   line of the same file as `` `:89` `` after the path, so the path is the file it names; with no
 *   path before it the span names no file and is left out.
 * @param {string} where
 * @returns {string[]}
 */
function whereOf(where) {
  /** @type {string[]} */
  const paths = [];
  /** @type {string | null} */
  let file = null;
  for (const match of where.matchAll(CODE_SPAN)) {
    const span = match[1] ?? "";
    if (isPath(span)) {
      paths.push(span);
      file = span.replace(LINE_SUFFIX, "");
    } else if (file !== null && LINE_REFERENCE.test(span)) {
      paths.push(`${file}${span}`);
    }
  }
  return paths;
}

/**
 * @description The second-level headings of a file, by line index, whose section holds a
 *   `### F-<n>` feature record heading, fenced code left out. A section's third-level headings are
 *   judged by every record it holds, those after them included, so the file is read whole first.
 * @param {Text} text
 * @returns {Set<number>}
 */
function sectionsWithRecords(text) {
  /** @type {Set<number>} */
  const holding = new Set();
  /** @type {number | null} */
  let section = null;
  text.lines.forEach((line, index) => {
    const heading = text.fenced[index] === true ? null : HEADING.exec(line);
    if (heading === null) return;
    const level = (heading[1] ?? "").length;
    if (level <= 2) {
      section = level === 2 ? index : null;
    } else if (level === 3 && section !== null && CHAIN_FEATURE.test(heading[2] ?? "")) {
      holding.add(section);
    }
  });
  return holding;
}

/**
 * @description An item's title and its `Where`, `Done` and `Depends on` segments, each split at
 *   its first occurrence.
 * @param {string} text
 * @returns {{ title: string, where: string | null, done: string | null, dependsOn: string | null }}
 */
function segmentsOf(text) {
  /** @type {{ name: string, start: number, end: number }[]} */
  const markers = [];
  for (const match of text.matchAll(SEGMENT)) {
    const name = match[1] ?? "";
    if (markers.some((marker) => marker.name === name)) continue;
    markers.push({ name, start: match.index, end: match.index + match[0].length });
  }
  /** @type {(name: string) => string | null} */
  const segment = (name) => {
    const at = markers.findIndex((marker) => marker.name === name);
    const marker = markers[at];
    if (marker === undefined) return null;
    return text.slice(marker.end, markers[at + 1]?.start ?? text.length).trim();
  };
  return {
    title: text.slice(0, markers[0]?.start ?? text.length).trim(),
    where: segment("Where"),
    done: segment("Done"),
    dependsOn: segment("Depends on"),
  };
}

/**
 * @param {string | null} done
 * @returns {PlanRecord["doneState"]}
 */
function doneStateOf(done) {
  if (done === null) return "absent";
  return NOT_STATED.test(done) ? "not-stated" : "stated";
}

/**
 * @typedef {object} ItemDraft
 * @property {string | null} writtenId
 * @property {string | null} reference
 * @property {string} file
 * @property {number} line
 * @property {string | null} owner
 * @property {string | null} list
 * @property {string[]} units
 * @property {string[]} parts The item's text on its own line, then its continuations.
 */

/**
 * @param {ItemDraft} draft
 * @param {string} today
 * @returns {PlanRecord}
 */
function itemRecord(draft, today) {
  const text = draft.parts.join(" ");
  // An item is closed by its own line, as the plan-closure gate reads it.
  const closure = closureOf(draft.parts[0] ?? "", today);
  const closed = closure.status === "closed";
  const rest = closed ? text.slice(closure.marker.length).replace(MARKER_TAIL, "") : text;
  const { title, where, done, dependsOn } = segmentsOf(rest);
  const id = draft.writtenId === null || draft.writtenId === NO_ID_TEXT ? null : draft.writtenId;
  return {
    kind: "item",
    id,
    writtenId: draft.writtenId,
    file: draft.file,
    line: draft.line,
    title,
    owner: draft.owner,
    list: draft.list,
    who: null,
    today: null,
    need: null,
    dependsOn,
    state: !closed
      ? "open"
      : closure.form === "pull-request"
        ? "closed-by-pull-request"
        : "closed-by-decision",
    closedBy: closure.by,
    where: whereOf(where ?? ""),
    done,
    doneState: doneStateOf(done),
    ...tagsOf([draft.writtenId ?? "", draft.reference ?? ""], [text], draft.units),
    text,
  };
}

/**
 * @typedef {object} ChainDraft
 * @property {string} id
 * @property {number} line
 * @property {string} title
 * @property {string | null} owner
 * @property {string} heading
 * @property {Map<string, string>} fields
 * @property {string[]} own The record's fields and prose, which its mentions are read from.
 */

/**
 * @typedef {object} AreaState
 * @property {number} index The line of its heading.
 * @property {string | null} code The area's code, `null` when the heading names no area.
 * @property {number} tables Its feature tables.
 */

/**
 * @typedef {object} TableLine
 * @property {"table-header" | "table-separator" | "table-row" | "unclassified"} kind
 * @property {import("./plan-text.mjs").Table | null} table
 * @property {string[]} cells
 * @property {string} [reason]
 */

/**
 * @description The kind of every table line of a text outside fenced code, each table read by
 *   the reader the chain table is read with. A header with no separator row of its cell count
 *   under it is refused, and the line after it is read as a header in its turn.
 * @param {Text} text
 * @returns {Map<number, TableLine>}
 */
function tableLinesOf(text) {
  const { lines, fenced } = text;
  /** @type {Map<number, TableLine>} */
  const read = new Map();
  for (let index = 0; index < lines.length;) {
    if (fenced[index] === true || !TABLE_ROW.test(lines[index] ?? "")) {
      index += 1;
      continue;
    }
    const table = readTable(text, index);
    if (table.separator === null || table.separator.length !== table.header.length) {
      read.set(index, {
        kind: "unclassified",
        table: null,
        cells: [],
        reason: "a table line with no separator row of its cell count under it",
      });
      index += 1;
      continue;
    }
    read.set(index, { kind: "table-header", table, cells: table.header });
    read.set(index + 1, { kind: "table-separator", table, cells: table.separator });
    for (const row of table.rows) {
      read.set(
        row.index,
        row.cells.length === table.header.length
          ? { kind: "table-row", table, cells: row.cells }
          : {
              kind: "unclassified",
              table,
              cells: row.cells,
              reason:
                `a table row of ${String(row.cells.length)} cells under a header of ` +
                String(table.header.length),
            }
      );
    }
    index = table.end;
  }
  return read;
}

/**
 * @description Reads one file of the plan: the kind of every line, its items, its features and
 *   what its structure lacks.
 * @param {Text} text
 * @param {string} today
 * @returns {{ lines: ClassifiedLine[], items: PlanRecord[], chainDrafts: ChainDraft[], areaFeatures: PlanRecord[], failures: string[] }}
 */
function readFile(text, today) {
  const { file, lines, fenced, unclosed } = text;
  const isChain = file === PLAN_FILES.chain;
  const isAreas = file === PLAN_FILES.areas;
  const isItemFile = file !== PLAN_FILES.plan && !isChain && !isAreas;
  const tables = tableLinesOf(text);
  /** @type {Set<number>} */
  const recordSections = isChain ? sectionsWithRecords(text) : new Set();
  /** @type {number | null} The line of the second-level heading whose section is being read. */
  let sectionAt = null;

  /** @type {Map<number, ClassifiedLine>} */
  const classified = new Map();
  /** @type {ItemDraft[]} */
  const itemDrafts = [];
  /** @type {ChainDraft[]} */
  const chainDrafts = [];
  /** @type {PlanRecord[]} */
  const areaFeatures = [];
  /** @type {string[]} */
  const failures = [];
  /** An item's own line and its continuations, whose text the item-shape scan leaves to it. */
  const accounted = new Set();

  /** @type {string[]} */
  const headings = ["", "", "", "", "", ""];
  /** @type {AreaState | null} */
  let area = null;
  /** @type {{ kind: "items" | "prose", label: string | null } | null} */
  let list = null;
  /** @type {"item" | "prose" | "paragraph" | null} */
  let last = null;
  /** @type {ItemDraft | null} */
  let item = null;

  /** @type {(index: number, kind: string, reason?: string) => void} */
  const mark = (index, kind, reason) => {
    classified.set(index, {
      file,
      line: index + 1,
      kind,
      ...(reason === undefined ? {} : { reason }),
    });
  };
  /** @type {(index: number, reason: string) => void} */
  const refuse = (index, reason) => {
    mark(index, "unclassified", reason);
    last = null;
    item = null;
  };
  /** @type {(index: number, draft: Omit<ItemDraft, "file" | "line" | "units">) => void} */
  const openItem = (index, draft) => {
    const units =
      UNITS_SECTION.test(headings[1] ?? "") && draft.writtenId !== null ? [draft.writtenId] : [];
    item = { ...draft, file, line: index + 1, units };
    itemDrafts.push(item);
    accounted.add(index);
    mark(index, "item");
    last = "item";
  };
  /** The nearest heading under the file's title, else the title. */
  const section = () => (headings[1] !== "" ? headings[1] : headings[0]) ?? null;
  /** A file's sub-heading under its section, for an item outside the chain and the areas. */
  const subSection = () => (headings[2] !== "" ? (headings[2] ?? null) : null);
  /** An area ends at the next heading of level 2 or above, and must have held a feature table. */
  const closeArea = () => {
    if (area !== null && area.code !== null && area.tables === 0) {
      failures.push(
        `${file}:${String(area.index + 1)} opens the area A-${area.code}, which holds no feature ` +
          `table (${FEATURE_COLUMNS.join(" | ")})`
      );
    }
    area = null;
  };

  /** @type {(index: number) => void} */
  const readTableLine = (index) => {
    const at = tables.get(index);
    if (at === undefined || at.kind === "unclassified" || at.table === null) {
      refuse(index, at?.reason ?? "a table line outside any table");
      return;
    }
    const { table } = at;
    const feature = FEATURE_HEADERS.includes(table.header.join("|"));
    if (isAreas && at.kind === "table-header") {
      if (!feature) {
        refuse(index, `a table of the areas whose header is not ${FEATURE_COLUMNS.join(" | ")}`);
        return;
      }
      if (area === null) {
        refuse(index, "a feature table outside any area");
        return;
      }
      if (area.code !== null) area.tables += 1;
    }
    const code = area?.code ?? null;
    if (at.kind !== "table-row" || !isAreas || !feature || code === null) {
      mark(index, at.kind);
      return;
    }
    mark(index, "feature-row");
    const { header } = table;
    /** @type {(column: string) => string | null} */
    const cell = (column) =>
      header.includes(column) ? valueOf(at.cells[header.indexOf(column)] ?? "") : null;
    const featureCell = cell("Feature") ?? "";
    const written = AREA_FEATURE.exec(featureCell);
    const position = index - table.headerIndex - 1;
    const number = Number(written?.[2] ?? written?.[3] ?? position);
    const reference = written?.[4] ?? "";
    const others = at.cells.map((value, column) =>
      header[column] === "Feature" ? featureCell.replace(`(${reference})`, "") : value
    );
    areaFeatures.push({
      kind: "feature",
      id: `A-${code}-${String(number).padStart(2, "0")}`,
      writtenId: written?.[1] ?? null,
      file,
      line: index + 1,
      title: written?.[5] ?? featureCell,
      owner: `A-${code}`,
      list: null,
      who: cell("Who"),
      today: cell("Today"),
      need: cell("Need"),
      dependsOn: cell("Depends on"),
      state: null,
      closedBy: null,
      where: [],
      done: null,
      doneState: "absent",
      ...tagsOf([reference], others, []),
      text: lines[index] ?? "",
    });
  };

  /**
   * A heading that names a chain feature anywhere but as a `### F-<n>` heading of the chain:
   * the gate would read it as a second record of that feature.
   *
   * @type {(line: string, record: boolean) => boolean}
   */
  const strayFeatureHeading = (line, record) => {
    const heading = HEADING.exec(line);
    if (heading === null || (!isChain && !isAreas)) return false;
    const opens = isChain && !record && (heading[1] ?? "").length === 3;
    return !opens && CHAIN_FEATURE.test(heading[2] ?? "");
  };

  /** @type {(index: number, line: string) => void} */
  const readHeading = (index, line) => {
    const heading = HEADING.exec(line);
    const level = (heading?.[1] ?? "#").length;
    const words = heading?.[2] ?? "";
    headings[level - 1] = words;
    for (let deeper = level; deeper < headings.length; deeper += 1) headings[deeper] = "";
    list = null;
    last = null;
    item = null;
    if (level <= 2) sectionAt = level === 2 ? index : null;
    if (isChain && level === 3 && !CHAIN_FEATURE.test(words)) {
      if (FEATURE_ID_START.test(words)) {
        refuse(index, MISSHAPEN_FEATURE_HEADING);
        return;
      }
      if (sectionAt !== null && recordSections.has(sectionAt)) {
        refuse(index, UNRECORDED_SECTION_HEADING);
        return;
      }
    }
    if (isAreas && level <= 2) {
      closeArea();
      if (level === 2) {
        const code = AREA.exec(words)?.[1] ?? null;
        area = { index, code, tables: 0 };
        if (code === null) {
          refuse(
            index,
            "a second-level heading of the areas that names no area (`## A-<AREA> <title>`)"
          );
          return;
        }
      }
    }
    if (strayFeatureHeading(line, false)) refuse(index, STRAY_FEATURE_HEADING);
    else mark(index, "heading");
  };

  /**
   * Reads the record a `### F-<n>` heading opens with the walker the gate reads it with, and
   * returns the index after it.
   *
   * @type {(index: number, id: string, title: string) => number}
   */
  const readChainRecord = (index, id, title) => {
    /** @type {ChainDraft} */
    const draft = {
      id,
      line: index + 1,
      title,
      owner: headings[1] === "" ? null : (headings[1] ?? null),
      heading: headings[2] ?? "",
      fields: new Map(),
      own: [],
    };
    chainDrafts.push(draft);
    const span = recordSpanAt(text, index);
    const walk = readRecordSpan(span, today);
    const rules = new Map(walk.refusals.map((refusal) => [refusal.index, refusal.rule]));
    /** @type {string | null} */
    let field = null;
    for (const at of walk.lines) {
      const line = lines[at.index] ?? "";
      const rule = rules.get(at.index);
      if (at.kind === "refused" && rule !== undefined) {
        refuse(at.index, SPAN_REASONS[rule]);
      } else if (at.kind === "fenced" && at.index === unclosed) {
        refuse(at.index, "opens a fenced code block that nothing closes");
      } else if (at.kind === "fenced") {
        mark(at.index, "fenced");
      } else if (at.kind === "blank" || at.kind === "note") {
        mark(at.index, at.kind);
      } else if (at.kind === "item" || at.kind === "continuation") {
        accounted.add(at.index);
        mark(at.index, at.kind);
      } else if (BLOCKQUOTE.test(line) || RAW_HTML.test(line)) {
        refuse(at.index, BLOCKQUOTE.test(line) ? "a blockquote line" : "a raw HTML line");
      } else if (at.kind === "label") {
        field = at.label;
        draft.fields.set(at.label ?? "", line.replace(LABEL, "").trim());
        draft.own.push(line);
        mark(at.index, "field");
      } else if (HEADING.test(line)) {
        field = null;
        if (strayFeatureHeading(line, true)) refuse(at.index, STRAY_FEATURE_HEADING);
        else mark(at.index, "heading");
      } else if (TABLE_ROW.test(line)) {
        field = null;
        readTableLine(at.index);
      } else if (/^\s/.test(line) && !INDENTED_BULLET.test(line)) {
        draft.own.push(line);
        if (field !== null) {
          draft.fields.set(field, `${draft.fields.get(field) ?? ""} ${line.trim()}`.trim());
        }
        mark(at.index, "continuation");
      } else {
        field = null;
        draft.own.push(line);
        mark(at.index, "prose");
      }
    }
    for (const read of walk.items) {
      itemDrafts.push({
        writtenId: read.id,
        reference: read.reference,
        file,
        line: read.line,
        owner: id,
        list: read.list,
        units: [],
        parts: [read.text, ...read.continuations],
      });
    }
    if (walk.attached.length === 0) {
      failures.push(
        `the record of ${id} (${file}:${String(index + 1)}) holds no "Attached (<n>)" list`
      );
    }
    for (const stated of walk.miscounted) {
      failures.push(
        `the record of ${id} (${file}:${String(stated.line)}) states "${stated.label}" and ` +
          `${String(stated.items)} read under it`
      );
    }
    return span.end;
  };

  /** @type {(index: number, line: string) => void} */
  const readLine = (index, line) => {
    const bullet = BULLET.exec(line);
    if (bullet !== null) {
      const content = bullet[1] ?? "";
      const itemList = isItemFile || list?.kind === "items";
      if (!itemList) {
        if (ITEM.test(content)) {
          refuse(index, "an item in a prose list, outside any item list");
          return;
        }
        mark(index, "prose");
        last = "prose";
        item = null;
        return;
      }
      const parsed = ITEM.exec(content);
      const owner = isAreas ? `A-${area?.code ?? ""}` : section();
      const label = isAreas ? (list?.label ?? null) : subSection();
      openItem(index, {
        writtenId: parsed === null ? null : (parsed[1] ?? "").trim(),
        reference: parsed?.[2] ?? null,
        owner,
        list: label,
        parts: [parsed === null ? content : (parsed[3] ?? "")],
      });
      return;
    }
    if (!/^\s/.test(line)) {
      if (ITEM.test(line)) {
        list = null;
        refuse(index, "an item written as a paragraph, outside any item list");
        return;
      }
      const trimmed = line.trim();
      if (isAreas) {
        list = ITEM_LIST_INTRO.test(trimmed)
          ? { kind: "items", label: trimmed.replace(/:$/, "") }
          : trimmed.endsWith(":")
            ? { kind: "prose", label: trimmed.replace(/:$/, "") }
            : null;
      }
      mark(index, "prose");
      last = "paragraph";
      item = null;
      return;
    }
    if (last === "item") {
      if (INDENTED_BULLET.test(line)) {
        refuse(index, "a nested list entry under an item");
        return;
      }
      if (ITEM.test(line.trim())) {
        refuse(index, "a continuation of an item that starts like an item");
        return;
      }
      item?.parts.push(line.trim());
      accounted.add(index);
      mark(index, "continuation");
      return;
    }
    if (last === "prose") {
      const content = line.trim().replace(/^(?:[-*+]|\d+[.)]) /, "");
      if (ITEM.test(content)) {
        refuse(index, "an item in a prose list, outside any item list");
        return;
      }
      mark(index, INDENTED_BULLET.test(line) ? "prose" : "continuation");
      return;
    }
    refuse(index, "an indented line that continues no bullet");
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (fenced[index] === true) {
      last = null;
      item = null;
      if (index === unclosed) refuse(index, "opens a fenced code block that nothing closes");
      else mark(index, "fenced");
      continue;
    }
    if (line.trim() === "") {
      last = null;
      item = null;
      mark(index, "blank");
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      readHeading(index, line);
      const feature =
        isChain && (heading[1] ?? "").length === 3 ? CHAIN_FEATURE.exec(heading[2] ?? "") : null;
      if (feature !== null) {
        index = readChainRecord(index, feature[1] ?? "", feature[2] ?? "") - 1;
      }
      continue;
    }
    if (BLOCKQUOTE.test(line) || RAW_HTML.test(line)) {
      refuse(index, BLOCKQUOTE.test(line) ? "a blockquote line" : "a raw HTML line");
      continue;
    }
    if (TABLE_ROW.test(line)) {
      list = null;
      last = null;
      item = null;
      readTableLine(index);
      continue;
    }
    readLine(index, line);
  }
  if (isAreas) closeArea();

  // An item written where no item list reads it would pass unseen; the gate's scan, on every line.
  for (const [index, at] of classified) {
    const scanned = !["fenced", "blank", "unclassified"].includes(at.kind) && !accounted.has(index);
    if (scanned && ITEM_SHAPED.test(withoutCodeSpans(lines[index] ?? ""))) {
      classified.set(index, { ...at, kind: "unclassified", reason: SPAN_REASONS["unlisted-item"] });
    }
  }

  return {
    lines: [...classified.values()].sort((a, b) => a.line - b.line),
    items: itemDrafts.map((draft) => itemRecord(draft, today)),
    chainDrafts,
    areaFeatures,
    failures,
  };
}

/**
 * @param {ChainDraft} draft
 * @param {import("./plan-text.mjs").Row | undefined} row
 * @returns {PlanRecord}
 */
function chainFeatureRecord(draft, row) {
  /** @type {(name: string) => string | null} */
  const fieldOf = (name) => {
    const value = draft.fields.get(name);
    return value === undefined ? null : valueOf(value);
  };
  const done = fieldOf("Proof of done");
  const need = fieldOf("Need") ?? valueOf(row?.cells["Need"] ?? "");
  return {
    kind: "feature",
    id: draft.id,
    writtenId: draft.id,
    file: PLAN_FILES.chain,
    line: draft.line,
    title: draft.title,
    owner: draft.owner,
    list: null,
    who: fieldOf("Who"),
    today: fieldOf("Today"),
    need,
    dependsOn: fieldOf("Depends on"),
    state: row?.state ?? null,
    closedBy: valueOf(row?.cells["Closed by"] ?? ""),
    where: [],
    done,
    doneState: doneStateOf(done),
    ...tagsOf([], draft.own, unitsOfProofBase(fieldOf("Proof base"))),
    text: draft.heading,
  };
}

/**
 * @description What joins the chain table to the chain's records, and the canonical ids, lack: a
 *   row no record holds, a record no row lists, an id two features carry.
 * @param {Map<string, import("./plan-text.mjs").Row> | null} rows The chain table's rows by id,
 *   `null` when the table could not be read, which is already a failure.
 * @param {ChainDraft[]} chainDrafts
 * @param {PlanRecord[]} features
 * @returns {string[]}
 */
function joinFailures(rows, chainDrafts, features) {
  /** @type {string[]} */
  const failures = [];
  if (rows !== null) {
    for (const row of rows.values()) {
      if (!chainDrafts.some((draft) => draft.id === row.id)) {
        failures.push(
          `${PLAN_FILES.plan}:${String(row.line)} lists ${row.id} in the chain table, and no ` +
            `"### ${row.id}" heading of ${PLAN_FILES.chain} opens its record`
        );
      }
    }
    for (const draft of chainDrafts) {
      if (!rows.has(draft.id)) {
        failures.push(
          `${PLAN_FILES.chain}:${String(draft.line)} opens the record of ${draft.id}, and no row ` +
            "of the chain table lists it"
        );
      }
    }
  }
  /** @type {Map<string, PlanRecord[]>} */
  const byId = new Map();
  for (const feature of features) {
    const id = feature.id ?? "";
    byId.set(id, [...(byId.get(id) ?? []), feature]);
  }
  for (const [id, carriers] of byId) {
    if (carriers.length > 1) {
      failures.push(
        `${id} is the canonical id of ${String(carriers.length)} features ` +
          `(${carriers.map((f) => `${f.file}:${String(f.line)}`).join(", ")})`
      );
    }
  }
  return failures;
}

/**
 * @description Reads the plan's files as records, and classifies every line of them. Pure: it
 *   reads only the texts it is given.
 * @param {PlanSource[]} sources The plan's files, each with its path relative to the root.
 * @param {{ now?: Date }} [options] `now` decides which decision dates are still to come, as in the
 *   plan-closure gate (the current time by default).
 * @returns {ParsedPlan}
 */
export function parsePlan(sources, options = {}) {
  const today = (options.now ?? new Date()).toISOString().slice(0, 10);
  /** @type {ClassifiedLine[]} */
  const lines = [];
  /** @type {PlanRecord[]} */
  const items = [];
  /** @type {PlanRecord[]} */
  const areaFeatures = [];
  /** @type {ChainDraft[]} */
  const chainDrafts = [];
  /** @type {string[]} */
  const failures = [];
  /** @type {Map<string, import("./plan-text.mjs").Row> | null} */
  let rows = null;

  for (const source of sources) {
    const text = textOf(source.file, source.text);
    if (source.file === PLAN_FILES.plan) {
      const table = readChainTable(text);
      failures.push(...table.failures);
      if (table.failures.length === 0) rows = new Map(table.rows.map((row) => [row.id, row]));
    }
    const read = readFile(text, today);
    lines.push(...read.lines);
    items.push(...read.items);
    areaFeatures.push(...read.areaFeatures);
    chainDrafts.push(...read.chainDrafts);
    failures.push(...read.failures);
  }

  const chainFeatures = chainDrafts.map((draft) => chainFeatureRecord(draft, rows?.get(draft.id)));
  const features = [...chainFeatures, ...areaFeatures];
  failures.push(...joinFailures(rows, chainDrafts, features));
  return {
    records: [...features, ...items],
    lines,
    unclassified: lines.filter((line) => line.kind === "unclassified"),
    failures,
  };
}

/**
 * @description Reads the plan's six files under a root. A file that cannot be read is named in
 *   `failures`, never skipped in silence.
 * @param {string} root The directory that holds `docs/product/`.
 * @returns {{ sources: PlanSource[], failures: string[] }}
 */
export function readSources(root) {
  /** @type {PlanSource[]} */
  const sources = [];
  /** @type {string[]} */
  const failures = [];
  for (const file of Object.values(PLAN_FILES)) {
    try {
      sources.push({ file, text: readFileSync(path.join(root, file), "utf8") });
    } catch (error) {
      failures.push(
        `${file} could not be read: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return { sources, failures };
}

/**
 * @param {PlanRecord} record
 * @param {Filter} filter
 * @returns {boolean}
 */
function matches(record, { field, value }) {
  if (field === "kind") return record.kind === value;
  if (field === "file") return record.file === value;
  const rule = Object.entries(FILTER_FIELDS).find(([name]) => name === field)?.[1];
  if (rule === undefined) return false;
  const held = /** @type {Record<string, unknown>} */ (record)[rule.key];
  if (rule.match === "element-equals") return Array.isArray(held) && held.includes(value);
  if (rule.match === "element-contains") {
    return Array.isArray(held) && held.some((element) => String(element).includes(value));
  }
  if (typeof held !== "string") return false;
  return rule.match === "equals" ? held === value : held.includes(value);
}

/**
 * @description The records every filter matches, each value compared as literal text. A field it
 *   does not know is refused rather than matching nothing, so a misspelled field cannot read as a
 *   query no record answers.
 * @param {PlanRecord[]} records
 * @param {Filter[]} filters `kind` compares the kind, `file` the file's path relative to the
 *   root, any other field as {@link FILTER_FIELDS} states.
 * @returns {PlanRecord[]}
 * @throws {RangeError} When a filter's field is none of `kind`, `file` and the keys of
 *   {@link FILTER_FIELDS}; the message names the field and lists those it accepts.
 */
export function filterRecords(records, filters) {
  const accepted = ["kind", "file", ...Object.keys(FILTER_FIELDS)];
  const unknown = filters.find((filter) => !accepted.includes(filter.field));
  if (unknown !== undefined) {
    throw new RangeError(
      `filterRecords: unknown field "${unknown.field}"; the fields it accepts are ${accepted.join(", ")}`
    );
  }
  return records.filter((record) => filters.every((filter) => matches(record, filter)));
}

/**
 * @description The records an id or a location names. `<name>:<line>` names the record that
 *   starts on that line of a plan file, `<name>` one of the six keys of `PLAN_FILES`, lower case
 *   with hyphens: `plan`, `chain`, `areas`, `cross-cutting`, `off-the-map` and `parking`. Any
 *   other key, an unknown name before a colon included, names the records whose canonical id or
 *   id as written it is.
 * @param {PlanRecord[]} records
 * @param {string} key
 * @returns {PlanRecord[]}
 */
export function findRecords(records, key) {
  const location = /^([a-z-]+):([1-9]\d*)$/.exec(key);
  const file = Object.entries(PLAN_FILES).find(([name]) => name === location?.[1])?.[1];
  if (location !== null && file !== undefined) {
    const line = Number(location[2]);
    return records.filter((record) => record.file === file && record.line === line);
  }
  return records.filter((record) => record.id === key || record.writtenId === key);
}
