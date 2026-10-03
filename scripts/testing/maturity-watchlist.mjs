// @ts-check
/**
 * @file maturity-watchlist.mjs
 * @description Reads `scripts/testing/maturity-watchlist.json`: package versions that entered the
 *   tree inside the 7-day maturity buffer, reviewed 7 and 14 days after publication, and dated
 *   milestones. `validate` names every reason the list cannot be trusted, and `dueToday` the reviews
 *   that fall due on a date. `--check`, the CI step, exits 0 on a valid list, or 1 naming each cause.
 * @layer infrastructure
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LIST_FILE = fileURLToPath(new URL("./maturity-watchlist.json", import.meta.url));
const DAY_MS = 86_400_000;
const USAGE = "usage: node scripts/testing/maturity-watchlist.mjs --check";
/** Days from publication to each package milestone. @type {Record<string, number>} */
const MILESTONE_DAYS = { maturity: 7, final: 14 };
const OUTCOMES = ["clean", "flagged"];

/**
 * @typedef {{ kind: string, name: string, version: string, published: string, members?: string[],
 *   entered: { date: string, commit: string, pr: number }, milestones: Record<string, string>,
 *   id: string, title: string, due: string, refs: string[], reviews: Record<string, unknown> }} Entry
 * @typedef {{ entries: Entry[] }} List
 */

/** @type {(v: unknown) => v is string} */
const text = (v) => typeof v === "string" && v.length > 0;
/** @type {(v: unknown) => v is Record<string, unknown>} */
const record = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/** @type {(v: unknown) => Record<string, unknown>} */
const fieldsOf = (v) => (record(v) ? v : {});
/** @type {(v: unknown) => v is string[]} */
const texts = (v) => Array.isArray(v) && v.length > 0 && v.every(text);
/** A date that round-trips: V8 reads `2026-02-30` as March 2 and `2026-10-9` as a date. */
/** @type {(v: unknown) => v is string} */
const day = (v) => text(v) && new Date(Date.parse(v) || 0).toISOString().slice(0, 10) === v;
/** @type {(instant: string, days: number) => string} */
const addDays = (instant, days) =>
  new Date((Math.floor(Date.parse(instant) / DAY_MS) + days) * DAY_MS).toISOString().slice(0, 10);

/** @type {Record<string, Record<string, (v: unknown) => boolean>>} */
const SHAPES = {
  package: {
    name: text,
    version: text,
    published: (v) => !Number.isNaN(Date.parse(String(v))),
    members: (v) => v === undefined || texts(v),
    entered: (v) => record(v) && day(v.date) && text(v.commit) && Number.isInteger(v.pr),
    milestones: record,
    reviews: record,
  },
  date: { id: text, title: text, due: day, refs: texts, reviews: record },
};

/** @type {(entry: Entry) => string} */
const idOf = (entry) => (entry.kind === "package" ? `${entry.name}@${entry.version}` : entry.id);
/** @type {(entry: Entry) => Record<string, string | undefined>} */
const milestonesOf = ({ kind, due, milestones }) =>
  kind === "date" ? { due } : { maturity: milestones.maturity, final: milestones.final };

/** Every reason the list cannot be trusted, in entry order. @type {(list: unknown) => string[]} */
export function validate(list) {
  const { entries } = fieldsOf(list);
  if (!Array.isArray(entries)) return ["the list has no `entries` array"];
  const problems = [];
  const seen = new Set();
  for (const [index, raw] of entries.entries()) {
    const fields = fieldsOf(raw);
    const shape = SHAPES[String(fields.kind)] ?? { kind: () => false };
    const malformed = Object.keys(shape).filter((field) => !shape[field]?.(fields[field]));
    if (malformed.length > 0) {
      problems.push(`entry ${index}: missing or malformed ${malformed.join(", ")}`);
      continue;
    }
    const entry = /** @type {Entry} */ (/** @type {unknown} */ (fields));
    const id = idOf(entry);
    if (seen.has(id)) problems.push(`entry ${index}: duplicate id ${id}`);
    seen.add(id);
    const dates = milestonesOf(entry);
    for (const [key, days] of entry.kind === "package" ? Object.entries(MILESTONE_DAYS) : []) {
      const derived = addDays(entry.published, days);
      if (dates[key] !== derived) {
        problems.push(`${id}: ${key} is ${dates[key]}, derived ${derived}`);
      }
    }
    for (const [key, done] of Object.entries(entry.reviews)) {
      const { date, outcome, note } = fieldsOf(done);
      const wellFormed =
        day(date) && OUTCOMES.includes(String(outcome)) && typeof note === "string";
      if (!(key in dates)) {
        problems.push(`${id}: review of unknown milestone ${key}`);
      } else if (!wellFormed) {
        problems.push(`${id}: review ${key} needs a date, a clean or flagged outcome, and a note`);
      } else if (date < String(dates[key])) {
        problems.push(`${id}: review ${key} dated ${date}, before ${dates[key]}`);
      }
    }
  }
  return problems;
}

/**
 * The reviews due on `today` and not recorded yet. Only the milestone day itself is due, so a day
 * that passes unreviewed is not carried over to the next.
 * @type {(list: List, today: string) => { entry: Entry, milestone: string }[]}
 */
export const dueToday = (list, today) =>
  list.entries.flatMap((entry) =>
    Object.entries(milestonesOf(entry))
      .filter(([key, date]) => date === today && !(key in entry.reviews))
      .map(([milestone]) => ({ entry, milestone }))
  );

/**
 * Runs the check. The list file is injectable, so the suite drives every path without the
 * repository's list.
 * @type {(argv: string[], io?: { file?: string }) => { exitCode: number, messages: string[] }}
 */
export function runCli(argv, { file = LIST_FILE } = {}) {
  if (argv.join(" ") !== "--check") return { exitCode: 1, messages: [USAGE] };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, messages: [`${file} is unreadable: ${cause}`] };
  }
  const problems = validate(parsed);
  if (problems.length > 0) return { exitCode: 1, messages: problems };
  const { length } = /** @type {List} */ (parsed).entries;
  return { exitCode: 0, messages: [`${length} entries, all valid`] };
}

/** True only when this file is the process entry point, so importing its exports runs nothing. */
const entryPoint = process.argv[1];
if (entryPoint !== undefined && existsSync(entryPoint)) {
  if (realpathSync(entryPoint) === fileURLToPath(import.meta.url)) {
    const outcome = runCli(process.argv.slice(2));
    const stream = outcome.exitCode === 0 ? process.stdout : process.stderr;
    for (const message of outcome.messages) stream.write(`maturity-watchlist: ${message}\n`);
    process.exitCode = outcome.exitCode;
  }
}
