// @ts-check
/**
 * @file maturity-watchlist.mjs
 * @description Reads `scripts/testing/maturity-watchlist.json`: package versions that entered the
 *   tree inside the 7-day maturity buffer, reviewed 7 and 14 days after publication, and dated
 *   milestones. `validate` names every reason the list cannot be trusted, and `dueToday` the reviews
 *   that fall due on a date. `--check`, the CI step, exits 0 on a valid list, or 1 naming each cause.
 *   `--remind`, the scheduled workflow, opens one issue per review due today, or comments on it while
 *   it stays open; a closed issue is a review done, so the day's later firings skip it. `--dry-run`
 *   calls no API, so it plans as if no issue existed; `--today YYYY-MM-DD` replaces the UTC date.
 * @layer infrastructure
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const LIST_FILE = fileURLToPath(new URL("./maturity-watchlist.json", import.meta.url));
const DAY_MS = 86_400_000;
const LABEL = "maturity-review";
const USAGE =
  "usage: node scripts/testing/maturity-watchlist.mjs --check | --remind [--dry-run] [--today YYYY-MM-DD]";
const FLAG = /** @type {const} */ ({ type: "boolean" });
const DATE = /** @type {const} */ ({ type: "string" });
const REMIND_OPTIONS = { remind: FLAG, "dry-run": FLAG, today: DATE };
/** Days from publication to each package milestone. @type {Record<string, number>} */
const MILESTONE_DAYS = { maturity: 7, final: 14 };
const OUTCOMES = ["clean", "flagged"];

/**
 * @typedef {{ kind: string, name: string, version: string, published: string, members?: string[],
 *   entered: { date: string, commit: string, pr: number }, milestones: Record<string, string>,
 *   id: string, title: string, due: string, refs: string[], reviews: Record<string, unknown> }} Entry
 * @typedef {{ entries: Entry[] }} List
 * @typedef {{ action: string, title: string, number?: number, body?: string }} Action
 * @typedef {{ exitCode: number, messages: string[] }} Outcome
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
/** @type {(error: unknown) => string} */
const reason = (error) => (error instanceof Error ? error.message : String(error));
/** @type {(message: string) => Outcome} */
const refuse = (message) => ({ exitCode: 1, messages: [message] });

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
 * One action per review due today: open its issue, comment while it is open, skip it once closed.
 * @type {(list: List, today: string, issues: { number: number, title: string, state: string }[]) => Action[]}
 */
export function planReminders(list, today, issues) {
  return dueToday(list, today).map(({ entry, milestone }) => {
    const id = idOf(entry);
    const days = MILESTONE_DAYS[milestone];
    const title = entry.kind === "date" ? entry.title : `Maturity review due: ${id} (${days}-day)`;
    const issue = issues.find((candidate) => candidate.title === title);
    if (issue?.state === "open") {
      return { action: "comment", title, number: issue.number, body: `Still open on ${today}.` };
    }
    if (issue) return { action: "skip", title, number: issue.number };
    const facts =
      entry.kind === "date"
        ? `Due ${entry.due}. See ${entry.refs.join("; ")}.`
        : `${[id, ...(entry.members ?? [])].join(", ")}: published ${entry.published}, entered on ` +
          `${entry.entered.date} (${entry.entered.commit}, #${entry.entered.pr}) inside the 7-day ` +
          "maturity buffer. Check the advisories (OSV, GitHub), the upstream issues opened since " +
          "and the release notes, and confirm it works here.";
    const close =
      `Record the outcome under \`reviews.${milestone}\` in \`scripts/testing/maturity-watchlist.json\`, ` +
      "then close this issue: closing it cancels the day's later reminders.";
    return { action: "open", title, body: `${facts}\n\n${close}` };
  });
}

/**
 * Lists the labelled issues, creates the label before the first issue needs it, and runs each
 * planned action, logging it as it completes.
 * @type {(list: List, today: string, env: NodeJS.ProcessEnv, fetchImpl: typeof fetch, log: string[]) => Promise<void>}
 */
async function remind(list, today, env, fetchImpl, log) {
  /** @type {(method: string, path: string, body?: object, absentOk?: boolean) => Promise<Response>} */
  const call = async (method, path, body, absentOk = false) => {
    const authorization = `Bearer ${env.GITHUB_TOKEN}`;
    const headers = { accept: "application/vnd.github+json", authorization };
    const url = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}${path}`;
    const response = await fetchImpl(url, { method, headers, body: JSON.stringify(body) });
    if (response.ok || (absentOk && response.status === 404)) return response;
    const route = `${method} ${path.split("?")[0]}`;
    throw new Error(`${route} answered ${response.status}: ${await response.text()}`);
  };
  // An issue for a review due today was opened today, so issues untouched since then are not read.
  const query = `labels=${LABEL}&state=all&since=${today}T00:00:00Z&per_page=100`;
  const page = await (await call("GET", `/issues?${query}`)).json();
  if (!Array.isArray(page) || page.length === 100) {
    throw new Error("GET /issues: no list, or a full page");
  }
  const issues = page.filter((issue) => record(issue) && !issue.pull_request);
  const actions = planReminders(list, today, issues);
  if (actions.some(({ action }) => action === "open")) {
    const label = await call("GET", `/labels/${LABEL}`, undefined, true);
    if (label.status === 404) await call("POST", "/labels", { name: LABEL, color: "fbca04" });
  }
  for (const { action, title, number, body } of actions) {
    if (action === "open") await call("POST", "/issues", { title, body, labels: [LABEL] });
    if (action === "comment") await call("POST", `/issues/${number}/comments`, { body });
    log.push(`${action}${number ? ` #${number}` : ""}: ${title}`);
  }
}

/**
 * Reads and validates the list, or answers why it cannot.
 * @type {(file: string) => { list: List } | { outcome: Outcome }}
 */
function load(file) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { outcome: refuse(`${file} is unreadable: ${reason(error)}`) };
  }
  const problems = validate(parsed);
  if (problems.length > 0) return { outcome: { exitCode: 1, messages: problems } };
  return { list: /** @type {List} */ (parsed) };
}

/**
 * Runs the check. The list file is injectable, so the suite drives every path without the
 * repository's list.
 * @type {(argv: string[], io?: { file?: string }) => Outcome}
 */
export function runCli(argv, { file = LIST_FILE } = {}) {
  if (argv.join(" ") !== "--check") return refuse(USAGE);
  const loaded = load(file);
  if ("outcome" in loaded) return loaded.outcome;
  return { exitCode: 0, messages: [`${loaded.list.entries.length} entries, all valid`] };
}

/**
 * Runs the reminder. The list file, the environment and fetch are injectable, so the suite drives
 * every path without the repository's list or the GitHub API.
 * @type {(argv: string[], io?: { env?: NodeJS.ProcessEnv, file?: string, fetchImpl?: typeof fetch }) => Promise<Outcome>}
 */
export async function runRemind(argv, io = {}) {
  const { env = process.env, file = LIST_FILE, fetchImpl = globalThis.fetch } = io;
  let values;
  try {
    values = parseArgs({ args: argv, options: REMIND_OPTIONS }).values;
  } catch (error) {
    return refuse(`${reason(error)}; ${USAGE}`);
  }
  if (!values.remind) return refuse(USAGE);
  const today = values.today ?? new Date().toISOString().slice(0, 10);
  if (!day(today)) return refuse(`--today ${today} is not a YYYY-MM-DD date`);
  const loaded = load(file);
  if ("outcome" in loaded) return loaded.outcome;
  const { list } = loaded;
  const plan = planReminders(list, today, []).map(({ action, title }) => `${action}: ${title}`);
  if (values["dry-run"]) return { exitCode: 0, messages: plan };
  const missing = ["GITHUB_TOKEN", "GITHUB_REPOSITORY"].filter((name) => !text(env[name]));
  if (missing.length > 0) {
    return refuse(`--remind needs ${missing.join(" and ")} in the environment`);
  }
  /** @type {string[]} */
  const log = [];
  try {
    if (dueToday(list, today).length > 0) await remind(list, today, env, fetchImpl, log);
    return { exitCode: 0, messages: log };
  } catch (error) {
    return { exitCode: 1, messages: [...log, `GitHub API: ${reason(error)}`] };
  }
}

/** True only when this file is the process entry point, so importing its exports runs nothing. */
const entryPoint = process.argv[1];
if (entryPoint !== undefined && existsSync(entryPoint)) {
  if (realpathSync(entryPoint) === fileURLToPath(import.meta.url)) {
    const argv = process.argv.slice(2);
    const outcome = argv.includes("--remind") ? await runRemind(argv) : runCli(argv);
    const stream = outcome.exitCode === 0 ? process.stdout : process.stderr;
    for (const message of outcome.messages) stream.write(`maturity-watchlist: ${message}\n`);
    process.exitCode = outcome.exitCode;
  }
}
