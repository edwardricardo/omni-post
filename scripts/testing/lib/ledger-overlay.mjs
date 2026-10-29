// @ts-check
/**
 * @file ledger-overlay.mjs
 * @description The human half of the test ledger, beside the rows the machine computes: the
 *   overlay a reviewer writes in `docs/development/testing-refoundation/adjudications.json`, which
 *   confirms a row's verdict, the slice assignment authored beside it in `slices.json`, which names
 *   the demolition slice a row belongs to, and the deletion a set of rows stands for, the blocks of
 *   its DELETE rows, which `--area` prints and each live slice counts as its expected drop.
 *
 *   A slice of `slices.json` is `{ "files": [...] }`, live, or, once its pull request deleted
 *   tests, it also records `"deleted": { "files": n, "blocks": n }`, its drop frozen as recorded,
 *   and may record `"floors": { "<metric>": { "from": x, "to": y } }`, the coverage floors that
 *   pull request lowered. A path has left the tree when `git ls-files` no longer lists it, the
 *   tracked set the command hands in, never when it is merely no ledger row. A deleted slice's
 *   paths may have left the tree: each such path that has a test's shape is accepted and counted
 *   as a deleted file. A whole-file slice, one that records every file it lists deleted, refuses
 *   every path the tree still tracks, a ledger row or not; a slice that keeps some or all of its
 *   files (block deletion) keeps the rows among them, and the number of its paths that left the
 *   tree must be its recorded file count. Its recorded block count is taken as written: nothing
 *   derives it. The overlay holds only live rows, so an entry for a path a slice records deleted
 *   is refused, saying to remove it.
 *
 *   A file that is no JSON, that writes a key twice in one object (which `JSON.parse` would settle
 *   by keeping the last, a guess at what the author meant), or that is not the one object it must
 *   be, is an input that could not be read. An entry that cannot be applied (a path the ledger
 *   does not list, a malformed entry, a DELETE or a slice for a row a decision excludes, a slice id
 *   outside ADR-0039's grammar, a slice with no file or an unknown key, a malformed deletion
 *   record, a path in two slices) is a problem naming it, and is left out, so the rows stay the
 *   machine's wherever the overlay is wrong. Pure: it reads the texts and the tracked set the
 *   command hands it, `null` for a file that is absent.
 * @layer infrastructure
 */
import { FLOOR_METRICS, decisionOf, shapeOf } from "./ledger-core.mjs";
import { byCodeUnit, isObject, messageOf } from "./record-helpers.mjs";

/** The directory of the files a human writes and reads beside `ledger.json`. */
export const OVERLAY_DIR = "docs/development/testing-refoundation";
export const ADJUDICATIONS_FILE = `${OVERLAY_DIR}/adjudications.json`;
export const SLICES_FILE = `${OVERLAY_DIR}/slices.json`;

/** ADR-0039's grammar of a demolition slice's id: `2.6a`, `2.7`, `2.8.1a`. */
const SLICE_ID = /^[0-9]+(\.[0-9]+)+[a-z]?$/;
const SLICE_KEYS = ["files", "deleted", "floors"];
const DROP_GRAMMAR = '{ "files": <count>, "blocks": <count> }';
const FLOORS_GRAMMAR = `{ "<${FLOOR_METRICS.join("|")}>": { "from": <percent>, "to": <lower percent> } }`;
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
 * @typedef {import("./ledger-core.mjs").Floor} Floor
 * @typedef {import("./ledger-core.mjs").LedgerSlice} LedgerSlice
 *
 * @typedef {object} DeclaredSlice A slice of `slices.json` that holds the grammar.
 * @property {string[]} files Its distinct paths, as written.
 * @property {Drop | null} deleted The drop it records, `null` for a live slice.
 * @property {Record<string, Floor>} floors The floor descents it records, empty when none.
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
 *   machine basis stays; any other entry is a problem naming its path, and changes no row. An
 *   entry for a path a slice records deleted is told to leave, since the overlay holds only live
 *   rows.
 * @param {readonly FileRow[]} rows
 * @param {Record<string, unknown> | null} entries The overlay's entries, `null` when there is no
 *   overlay.
 * @param {ReadonlyMap<string, string>} deleted Each path a slice records deleted, with the slice.
 * @returns {{ rows: FileRow[], problems: string[] }}
 */
function adjudicate(rows, entries, deleted) {
  if (entries === null) return { rows: [...rows], problems: [] };
  const byPath = new Map(rows.map((row) => [row.path, row]));
  /** @type {Map<string, FileRow["verdict"]>} */
  const confirmed = new Map();
  /** @type {string[]} */
  const problems = [];
  for (const file of Object.keys(entries).sort(byCodeUnit)) {
    const entry = entries[file];
    const row = byPath.get(file);
    const slice = deleted.get(file);
    /** @type {string[]} */
    let found = ["the ledger lists no such row"];
    if (row !== undefined) found = entryProblems(entry, row);
    else if (slice !== undefined) found = [`slice ${slice} records it deleted; remove its entry`];
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
  return { rows: applied, problems };
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
 * @description Says whether a value is a count: a whole number, zero or more.
 * @param {unknown} value Any value.
 * @returns {value is number}
 */
function isCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * @description Says whether a value is a coverage percentage, a finite number from 0 to 100.
 * @param {unknown} value Any value.
 * @returns {value is number}
 */
function isPercent(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

/**
 * @description Reads a deletion record: exactly a file count and a block count.
 * @param {unknown} value The `deleted` of a slice, as written.
 * @returns {Drop | null} The drop, or `null` when the value is not one.
 */
function recordedDrop(value) {
  if (!isObject(value) || Object.keys(value).sort(byCodeUnit).join() !== "blocks,files") {
    return null;
  }
  const { files, blocks } = value;
  return isCount(files) && isCount(blocks) ? { files, blocks } : null;
}

/**
 * @description Reads the floor descents of a slice: per metric fitness #37 holds, exactly a
 *   `from` and a lower `to`, each a percentage, copied in the order of `FLOOR_METRICS`.
 * @param {unknown} value The `floors` of a slice, as written.
 * @returns {Record<string, Floor> | null} The descents, or `null` when the value is not one.
 */
function recordedFloors(value) {
  /** @type {readonly string[]} */
  const metrics = FLOOR_METRICS;
  if (!isObject(value) || !Object.keys(value).every((metric) => metrics.includes(metric))) {
    return null;
  }
  /** @type {Record<string, Floor>} */
  const floors = {};
  for (const metric of metrics.filter((name) => Object.hasOwn(value, name))) {
    const floor = value[metric];
    if (!isObject(floor) || Object.keys(floor).sort(byCodeUnit).join() !== "from,to") return null;
    const { from, to } = floor;
    if (!isPercent(from) || !isPercent(to) || to >= from) return null;
    floors[metric] = { from, to };
  }
  return floors;
}

/**
 * @description Holds one slice of `slices.json` to its grammar: `{ "files": [...] }` with at
 *   least one distinct path, and, for a deleted slice, a `deleted` record of no more files than
 *   it lists and `floors` of #37's metrics, each a descent. A slice that keeps some of its files
 *   (one that records fewer deleted files than it lists) must count as deleted exactly the paths
 *   that left the tree, the ones git no longer tracks. `floors` without `deleted` records a
 *   descent no deletion explains.
 * @param {unknown} slice The slice as written.
 * @param {ReadonlySet<string>} tracked Every path `git ls-files` lists.
 * @returns {Result<DeclaredSlice>} The slice, or why it is refused.
 */
function declaredSlice(slice, tracked) {
  const files = isObject(slice) ? slice["files"] : undefined;
  if (!isObject(slice) || !Array.isArray(files) || !isDistinctList(files, () => true)) {
    return { error: 'is not one object, { "files": [<distinct paths>] }' };
  }
  const unknown = Object.keys(slice).filter((key) => !SLICE_KEYS.includes(key));
  if (unknown.length > 0) return { error: `has unknown keys ${unknown.join(", ")}` };
  if (files.length === 0) return { error: "lists no file" };
  const recordsFloors = Object.hasOwn(slice, "floors");
  if (!Object.hasOwn(slice, "deleted")) {
    return recordsFloors
      ? { error: "records floors but no deletion" }
      : { value: { files, deleted: null, floors: {} } };
  }
  const deleted = recordedDrop(slice["deleted"]);
  if (deleted === null) {
    return { error: `has deleted ${JSON.stringify(slice["deleted"])}, not ${DROP_GRAMMAR}` };
  }
  const recorded = counted(deleted.files, "deleted file");
  if (deleted.files > files.length) {
    return { error: `records ${recorded}, more than the ${files.length} it lists` };
  }
  const floors = recordsFloors ? recordedFloors(slice["floors"]) : {};
  if (floors === null) {
    return { error: `has floors ${JSON.stringify(slice["floors"])}, not ${FLOORS_GRAMMAR}` };
  }
  const gone = files.filter((file) => !tracked.has(file)).length;
  if (deleted.files < files.length && gone !== deleted.files) {
    return { error: `records ${recorded}, yet ${counted(gone, "path")} it lists left the tree` };
  }
  return { value: { files, deleted, floors } };
}

/**
 * @description Lists the paths that left the tree, the ones git no longer tracks, under a slice
 *   recording its deletion, each with the first such slice in code-unit order, read from the
 *   declared slices as written, so the overlay can name the slice whatever else that slice breaks.
 * @param {Record<string, unknown> | null} declared The slices of `slices.json`, or `null`.
 * @param {ReadonlySet<string>} tracked Every path `git ls-files` lists.
 * @returns {Map<string, string>} Each deleted path with its slice's id.
 */
function deletedPaths(declared, tracked) {
  /** @type {Map<string, string>} */
  const deleted = new Map();
  for (const id of Object.keys(declared ?? {}).sort(byCodeUnit)) {
    const slice = declared?.[id];
    if (!SLICE_ID.test(id) || !isObject(slice) || !Object.hasOwn(slice, "deleted")) continue;
    const files = slice["files"];
    for (const file of Array.isArray(files) ? files : []) {
      if (typeof file === "string" && !tracked.has(file) && !deleted.has(file)) {
        deleted.set(file, id);
      }
    }
  }
  return deleted;
}

/**
 * @description Says why a slice refuses one of its paths, or `null` when it takes it. A path the
 *   tree tracks follows a live slice's rules: it must be a ledger row, excluded by no decision and
 *   in no earlier slice; a whole-file slice refuses it first, row or not, since it records every
 *   file it lists deleted. A path that left the tree, which only a deleted slice may list, must be
 *   excluded by no decision, hold a ledger candidate's shape and sit in no earlier slice.
 * @param {string} file Repository-relative.
 * @param {{ row: FileRow | undefined, left: boolean, deleted: boolean, whole: boolean,
 *   other: string | undefined }} facts What the assignment knows of the path: its row, whether it
 *   left the tree, whether its slice records a deletion and of every file it lists, and the slice
 *   that already holds it.
 * @returns {string | null}
 */
function refusalOf(file, { row, left, deleted, whole, other }) {
  if (whole && !left) {
    return `${file}: is still tracked, yet the slice records every file it lists deleted`;
  }
  if (row === undefined && !(deleted && left)) return `${file}: the ledger lists no such row`;
  const decision = row === undefined ? decisionOf(file) : row.excluded;
  if (decision !== null) return `${file}: is excluded by ${decision} from every delete slice`;
  if (row === undefined && shapeOf(file) === null) {
    return `${file}: has no shape of a ledger row, so no deleted test had this path`;
  }
  return other === undefined ? null : `${file}: already in slice ${other}`;
}

/**
 * @description Applies the slice assignment: each slice whose id follows ADR-0039's grammar and
 *   whose value holds the slice grammar takes its paths in code-unit order, ids in code-unit order
 *   too. A live slice takes the paths that are ledger rows, excluded by no decision and in no
 *   earlier slice, and counts its expected drop from them. A deleted slice also accepts each path
 *   that left the tree, the ones git no longer tracks, with a ledger candidate's shape, which no
 *   decision excludes and no earlier slice holds, and carries its recorded drop and floor
 *   descents, never a drop recomputed from rows; a whole-file slice refuses every path the tree
 *   still tracks. Each row a slice takes carries its id. Each path `refusalOf` refuses, and a
 *   malformed or empty slice, is a problem naming it.
 * @param {readonly FileRow[]} rows
 * @param {Record<string, unknown> | null} declared The slices of `slices.json`, `null` when there
 *   is none.
 * @param {ReadonlySet<string>} tracked Every path `git ls-files` lists.
 * @returns {Overlaid}
 */
function assignSlices(rows, declared, tracked) {
  if (declared === null) return { rows: [...rows], slices: {}, problems: [] };
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
  for (const id of Object.keys(declared).sort(byCodeUnit)) {
    const read = SLICE_ID.test(id)
      ? declaredSlice(declared[id], tracked)
      : { error: `is not a slice id of ADR-0039's grammar ${SLICE_ID.source.slice(1, -1)}` };
    if ("error" in read) {
      refuse(id, read.error);
      continue;
    }
    const { files, deleted, floors } = read.value;
    const whole = deleted !== null && deleted.files === files.length;
    /** @type {string[]} */
    const taken = [];
    /** @type {FileRow[]} */
    const members = [];
    for (const file of [...files].sort(byCodeUnit)) {
      const row = byPath.get(file);
      const left = !tracked.has(file);
      const other = sliceOf.get(file);
      const why = refusalOf(file, { row, left, deleted: deleted !== null, whole, other });
      if (why !== null) {
        refuse(id, why);
        continue;
      }
      sliceOf.set(file, id);
      taken.push(file);
      if (row !== undefined) members.push(row);
    }
    if (deleted === null) {
      const { files: dropped, blocks } = deletionOf(members);
      slices[id] = { files: taken, expectedDrop: { files: dropped, blocks } };
    } else {
      slices[id] = { files: taken, deleted, floors };
    }
  }
  const assigned = rows.map((row) => {
    const sliceId = sliceOf.get(row.path);
    return sliceId === undefined ? row : { ...row, sliceId };
  });
  return { rows: assigned, slices, problems };
}

/**
 * @description Reads a file of the overlay that must be one object under `key`, or nothing.
 * @param {string | null} text The file's text, `null` when it is absent.
 * @param {string} file Repository-relative, as the messages name it.
 * @param {string} key The one top-level key.
 * @returns {Result<Record<string, unknown> | null>} The object, `null` for an absent file, or why
 *   the file is unread.
 */
function optionalHolding(text, file, key) {
  return text === null ? { value: null } : holding(text, file, key);
}

/**
 * @description Reads the overlay, then the slice assignment, so an unread overlay is named first;
 *   applies the overlay, telling an entry for a path a slice records deleted to leave, then the
 *   slice assignment, so a live slice counts a confirmed verdict in its expected drop. Absent
 *   files leave the rows and the slices as they were.
 * @param {readonly FileRow[]} rows The machine's rows.
 * @param {{ adjudications: string | null, slices: string | null }} texts Each file's text, or
 *   `null` when it is absent.
 * @param {ReadonlySet<string>} tracked Every path `git ls-files` lists: a path has left the tree
 *   only when this set lacks it.
 * @returns {Result<Overlaid>} The error names the file that is unread.
 */
export function applyOverlay(rows, texts, tracked) {
  const entries = optionalHolding(texts.adjudications, ADJUDICATIONS_FILE, "entries");
  if ("error" in entries) return entries;
  const declared = optionalHolding(texts.slices, SLICES_FILE, "slices");
  if ("error" in declared) return declared;
  const confirmed = adjudicate(rows, entries.value, deletedPaths(declared.value, tracked));
  const sliced = assignSlices(confirmed.rows, declared.value, tracked);
  return { value: { ...sliced, problems: [...confirmed.problems, ...sliced.problems] } };
}
