// @ts-check
/**
 * @file ledger-overlay.mjs
 * @description The human half of the test ledger, beside the rows the machine computes: the
 *   overlay a reviewer writes in `docs/development/testing-refoundation/adjudications.json`, which
 *   confirms a row's verdict, the slice assignment authored beside it in `slices.json`, which names
 *   the demolition slice a row belongs to, and the deletion a set of rows stands for, the blocks of
 *   its DELETE rows, which `--area` prints and each slice counts as its expected drop.
 *
 *   A file that is no JSON, that writes a key twice in one object (which `JSON.parse` would settle
 *   by keeping the last, a guess at what the author meant), or that is not the one object it must
 *   be, is an input that could not be read. An entry that cannot be applied (a path the ledger
 *   does not list, a malformed entry, a DELETE or a slice for a row a decision excludes, a slice id
 *   outside ADR-0039's grammar, a slice with no file, a path in two slices) is a problem naming
 *   it, and is left out, so the rows stay the machine's wherever the overlay is wrong. Pure: it
 *   reads the texts the command hands it, `null` for a file that is absent.
 * @layer infrastructure
 */
import { byCodeUnit, isObject, messageOf } from "./record-helpers.mjs";

/** The directory of the files a human writes and reads beside `ledger.json`. */
export const OVERLAY_DIR = "docs/development/testing-refoundation";
export const ADJUDICATIONS_FILE = `${OVERLAY_DIR}/adjudications.json`;
export const SLICES_FILE = `${OVERLAY_DIR}/slices.json`;

/** ADR-0039's grammar of a demolition slice's id: `2.6a`, `2.7`, `2.8.1a`. */
const SLICE_ID = /^[0-9]+(\.[0-9]+)+[a-z]?$/;
const ENTRY_KEYS = ["verdict", "criteria", "blocks", "evidence", "status", "reviewer", "date"];
/** A confirmation decides: ADJUDICATE is what the machine says when it cannot. */
const VERDICTS = ["DELETE", "REWRITE", "KEEP"];
/** The plan's decorative-test criteria (a) to (d). */
const CRITERIA = ["a", "b", "c", "d"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @template T
 * @typedef {import("./record-helpers.mjs").Result<T>} Result
 */

/**
 * @typedef {import("./ledger-core.mjs").FileRow} FileRow
 * @typedef {import("./ledger-core.mjs").Drop} Drop
 * @typedef {import("./ledger-core.mjs").LedgerSlice} LedgerSlice
 *
 * @typedef {object} Overlaid The rows with the overlay applied.
 * @property {FileRow[]} rows In the order given, each confirmed or assigned row copied.
 * @property {Record<string, LedgerSlice>} slices The accepted slices, by id.
 * @property {string[]} problems One per entry or assignment refused, naming it.
 *
 * @typedef {object} Deletion What deleting a set of rows' DELETE rows removes.
 * @property {string[]} lines `file:line:title` per block, a block-less file by its path.
 * @property {number} files
 * @property {number} blocks
 */

/**
 * @description Finds the first key a JSON text writes twice in one object, which `JSON.parse`
 *   would keep silently, the last value winning. It reads a text `JSON.parse` has accepted, so a
 *   string is always closed; a key is a string followed by `:`, compared as JSON decodes it.
 * @param {string} text Valid JSON.
 * @returns {{ key: string, path: string[] } | null} The key and the keys of the objects that hold
 *   it, outermost first (`[]` for an array's element), or `null` when every key is distinct.
 */
function repeatedKey(text) {
  /** @type {{ keys: Set<string> | null, path: string[] }[]} */
  const open = [];
  let last = "";
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    const top = open.at(-1);
    if (char === '"') {
      let end = at + 1;
      while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      let next = end + 1;
      while (/\s/.test(text[next] ?? "")) next += 1;
      if (top?.keys && text[next] === ":") {
        last = /** @type {string} */ (JSON.parse(text.slice(at, end + 1)));
        if (top.keys.has(last)) return { key: last, path: top.path };
        top.keys.add(last);
      }
      at = end;
    } else if (char === "{" || char === "[") {
      const path = top === undefined ? [] : [...top.path, top.keys ? last : "[]"];
      open.push({ keys: char === "{" ? new Set() : null, path });
    } else if (char === "}" || char === "]") {
      open.pop();
    }
  }
  return null;
}

/**
 * @description Reads a file that must be one object holding one object under `key`, every key of
 *   every object written once.
 * @param {string} text The file's text.
 * @param {string} file Repository-relative, as the messages name it.
 * @param {string} key The one top-level key.
 * @returns {Result<Record<string, unknown>>} The object under `key`, or why the file is unread.
 */
function holding(text, file, key) {
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { error: `${file} is not JSON: ${messageOf(error)}` };
  }
  const repeated = repeatedKey(text);
  if (repeated !== null) {
    const where =
      repeated.path.length === 0 ? "at its top level" : `under ${repeated.path.join(" > ")}`;
    return { error: `${file} holds the key ${JSON.stringify(repeated.key)} twice ${where}` };
  }
  const inner = isObject(data) && Object.keys(data).join() === key ? data[key] : undefined;
  return isObject(inner)
    ? { value: inner }
    : { error: `${file} is not one object, { "${key}": { ... } }` };
}

/**
 * @description Says whether a value is a list of distinct strings each `admits` accepts.
 * @param {unknown} value Any value.
 * @param {(item: string) => boolean} admits
 * @returns {boolean}
 */
function isDistinctList(value, admits) {
  return (
    Array.isArray(value) &&
    new Set(value).size === value.length &&
    value.every((item) => typeof item === "string" && admits(item))
  );
}

/**
 * @description Says whether a value names a calendar day as `YYYY-MM-DD`; the round trip through
 *   `Date` refuses `2026-02-30`, which the pattern admits.
 * @param {unknown} value Any value.
 * @returns {boolean}
 */
function isDay(value) {
  const day = typeof value === "string" && DAY.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  return day !== null && !Number.isNaN(day.getTime()) && day.toISOString().startsWith(`${value}`);
}

/**
 * @description Holds one overlay entry to the plan's fields: a verdict that decides, and is no
 *   DELETE for a row a decision excludes, distinct criteria of (a) to (d), distinct block ids of
 *   the row it confirms, non-empty evidence and reviewer, the status `confirmed` and a calendar
 *   day, and no other key.
 * @param {unknown} entry The entry as written.
 * @param {FileRow} row The row it confirms.
 * @returns {string[]} One problem per rule it breaks.
 */
function entryProblems(entry, row) {
  if (!isObject(entry)) return ["is not an object"];
  const { verdict, criteria, blocks, evidence, status, reviewer, date } = entry;
  const ids = new Set(row.blocks.map((block) => block.id));
  /** @type {string[]} */
  const problems = [];
  /** @type {(field: string, value: unknown, expected: string) => void} */
  const refuse = (field, value, expected) => {
    problems.push(`has ${field} ${JSON.stringify(value)}, not ${expected}`);
  };
  const unknown = Object.keys(entry).filter((key) => !ENTRY_KEYS.includes(key));
  if (unknown.length > 0) problems.push(`has unknown keys ${unknown.join(", ")}`);
  if (!VERDICTS.includes(String(verdict))) refuse("verdict", verdict, VERDICTS.join("|"));
  if (verdict === "DELETE" && row.excluded !== null) {
    problems.push(`is excluded by ${row.excluded}, which no confirmation turns into DELETE`);
  }
  if (!isDistinctList(criteria, (item) => CRITERIA.includes(item))) {
    refuse("criteria", criteria, `distinct criteria of ${CRITERIA.join("|")}`);
  }
  if (!isDistinctList(blocks, (id) => ids.has(id))) {
    refuse("blocks", blocks, "distinct block ids of its row");
  }
  if (typeof evidence !== "string" || evidence === "") problems.push("has no evidence");
  if (status !== "confirmed") refuse("status", status, "confirmed");
  if (typeof reviewer !== "string" || reviewer === "") problems.push("has no reviewer");
  if (!isDay(date)) refuse("date", date, "a YYYY-MM-DD day");
  return problems;
}

/**
 * @description Applies the overlay: each entry that names a ledger row and holds the plan's
 *   fields confirms that row, which takes the entry's verdict and the status `confirmed` while its
 *   machine basis stays; any other entry is a problem naming its path, and changes no row.
 * @param {readonly FileRow[]} rows
 * @param {string | null} text The overlay's text, `null` when there is no overlay.
 * @returns {Result<{ rows: FileRow[], problems: string[] }>} The error when the file is unread.
 */
function adjudicate(rows, text) {
  if (text === null) return { value: { rows: [...rows], problems: [] } };
  const entries = holding(text, ADJUDICATIONS_FILE, "entries");
  if ("error" in entries) return entries;
  const byPath = new Map(rows.map((row) => [row.path, row]));
  /** @type {Map<string, FileRow["verdict"]>} */
  const confirmed = new Map();
  /** @type {string[]} */
  const problems = [];
  for (const file of Object.keys(entries.value).sort(byCodeUnit)) {
    const entry = entries.value[file];
    const row = byPath.get(file);
    const found = row === undefined ? ["the ledger lists no such row"] : entryProblems(entry, row);
    problems.push(...found.map((problem) => `${ADJUDICATIONS_FILE}: ${file}: ${problem}`));
    if (found.length === 0 && isObject(entry)) {
      confirmed.set(file, /** @type {FileRow["verdict"]} */ (entry["verdict"]));
    }
  }
  const applied = rows.map((row) => {
    const verdict = confirmed.get(row.path);
    return verdict === undefined
      ? row
      : { ...row, verdict, status: /** @type {const} */ ("confirmed") };
  });
  return { value: { rows: applied, problems } };
}

/**
 * @description Words a count of a noun, in the singular for one.
 * @param {number} count
 * @param {string} noun In the singular.
 * @returns {string} `1 file`, `2 files`.
 */
export function counted(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * @description Words what a deletion drops, as `--area` and the page print it.
 * @param {Drop} drop
 * @returns {string} `1 file, 2 blocks`.
 */
export function dropWords(drop) {
  return `${counted(drop.files, "file")}, ${counted(drop.blocks, "block")}`;
}

/**
 * @description Lists what deleting the DELETE rows among `rows` removes: each block as
 *   `file:line:title`, the title as the ledger's block id carries it, and a file with no block by
 *   its path, in the order given, with the files and blocks it drops.
 * @param {readonly FileRow[]} rows
 * @returns {Deletion}
 */
export function deletionOf(rows) {
  const deleted = rows.filter((row) => row.verdict === "DELETE");
  const lines = deleted.flatMap((row) =>
    row.blocks.length === 0
      ? [row.path]
      : row.blocks.map(
          (block) => `${row.path}:${block.line}:${block.id.slice(row.path.length + 2)}`
        )
  );
  const blocks = deleted.reduce((sum, row) => sum + row.blockCount, 0);
  return { lines, files: deleted.length, blocks };
}

/**
 * @description Applies the slice assignment: each slice whose id follows ADR-0039's grammar and
 *   whose value is `{ "files": [...] }` with at least one path takes the paths that are ledger
 *   rows, excluded by no decision and in no earlier slice, ids and paths in code-unit order; each
 *   row it takes carries its id. A malformed or empty slice, a path the ledger does not list, a
 *   path a decision excludes and a path already in a slice are problems naming them.
 * @param {readonly FileRow[]} rows
 * @param {string | null} text The assignment's text, `null` when there is none.
 * @returns {Result<Overlaid>} The error when the file is unread.
 */
function assignSlices(rows, text) {
  if (text === null) return { value: { rows: [...rows], slices: {}, problems: [] } };
  const declared = holding(text, SLICES_FILE, "slices");
  if ("error" in declared) return declared;
  const byPath = new Map(rows.map((row) => [row.path, row]));
  /** @type {Map<string, string>} */
  const sliceOf = new Map();
  /** @type {Record<string, LedgerSlice>} */
  const slices = {};
  /** @type {string[]} */
  const problems = [];
  /** @type {(id: string, why: string) => void} */
  const refuse = (id, why) => {
    problems.push(`${SLICES_FILE}: ${id}: ${why}`);
  };
  for (const id of Object.keys(declared.value).sort(byCodeUnit)) {
    const slice = declared.value[id];
    const files = isObject(slice) && Object.keys(slice).join() === "files" ? slice["files"] : null;
    if (!SLICE_ID.test(id)) {
      refuse(id, `is not a slice id of ADR-0039's grammar ${SLICE_ID.source.slice(1, -1)}`);
    } else if (!Array.isArray(files) || !isDistinctList(files, () => true)) {
      refuse(id, 'is not one object, { "files": [<distinct paths>] }');
    } else if (files.length === 0) {
      refuse(id, "lists no file");
    } else {
      /** @type {FileRow[]} */
      const members = [];
      for (const file of [...files].sort(byCodeUnit)) {
        const row = byPath.get(file);
        const other = sliceOf.get(file);
        if (row === undefined) refuse(id, `${file}: the ledger lists no such row`);
        else if (row.excluded !== null) {
          refuse(id, `${file}: is excluded by ${row.excluded} from every delete slice`);
        } else if (other !== undefined) refuse(id, `${file}: already in slice ${other}`);
        else {
          sliceOf.set(file, id);
          members.push(row);
        }
      }
      const { files: dropped, blocks } = deletionOf(members);
      slices[id] = {
        files: members.map((row) => row.path),
        expectedDrop: { files: dropped, blocks },
      };
    }
  }
  const assigned = rows.map((row) => {
    const sliceId = sliceOf.get(row.path);
    return sliceId === undefined ? row : { ...row, sliceId };
  });
  return { value: { rows: assigned, slices, problems } };
}

/**
 * @description Applies the overlay, then the slice assignment, so a slice counts a confirmed
 *   verdict in its expected drop. Absent files leave the rows and the slices as they were.
 * @param {readonly FileRow[]} rows The machine's rows.
 * @param {{ adjudications: string | null, slices: string | null }} texts Each file's text, or
 *   `null` when it is absent.
 * @returns {Result<Overlaid>} The error names the file that is unread.
 */
export function applyOverlay(rows, texts) {
  const confirmed = adjudicate(rows, texts.adjudications);
  if ("error" in confirmed) return confirmed;
  const sliced = assignSlices(confirmed.value.rows, texts.slices);
  if ("error" in sliced) return sliced;
  const problems = [...confirmed.value.problems, ...sliced.value.problems];
  return { value: { ...sliced.value, problems } };
}
