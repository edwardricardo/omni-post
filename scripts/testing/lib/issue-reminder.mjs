// @ts-check
/**
 * @file issue-reminder.mjs
 * @description The GitHub half of a scheduled gate's `--remind`, shared by the patched-dependencies
 *   gate and the sites gate's `--stalled` mode. Each reminder is one issue, found by its exact title
 *   among the issues of one label, open and closed. When none exists it opens one, creating the label
 *   first; while it stays open it comments on it once a day, never on the day it was opened; and when
 *   it was closed while the reminder still stands it reopens it with that day's comment. A second run
 *   on the same day therefore opens no second issue and posts no second comment, which is what makes
 *   a scheduled workflow's retry safe.
 *
 *   Every call goes through the `gh` the caller passes: a command passes `createGh()`, which runs
 *   GitHub's CLI with the repository and token of its environment, and a suite passes a double. The
 *   module imports nothing but Node's own modules, so a gate that uses it still runs with nothing
 *   installed.
 *
 *   FAIL-CLOSED: a listing that is not JSON or no list is refused, as `IssueListingUnreadableError`,
 *   rather than read as no issue or no comment, which would open a second issue or post a second
 *   comment; a full page of issues is refused, as `IssueListingFullError`, since an issue past it
 *   could be duplicated; a caller tells the two apart by their class and prints their message as it
 *   is. Any call that fails throws with its error, and the actions completed before it stay in the
 *   caller's log.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";

/**
 * @typedef {(args: readonly string[]) => string} Gh Runs `gh` with the arguments and returns its
 *   standard output; a call that fails throws with its standard error.
 */
/**
 * @typedef {object} Label The label that marks a gate's issues.
 * @property {string} name
 * @property {string} color Six hexadecimal digits, without `#`.
 * @property {string} description
 */
/**
 * @typedef {object} Reminder One issue to keep open while what it reports stands.
 * @property {string} title The exact title the issue is found by, so it never changes from day to day.
 * @property {string} body The text the issue opens with.
 * @property {string} comment The day's comment, posted at most once a day; a comment with the same
 *   text posted since the start of that day, in UTC, means the day's comment is done.
 */
/** @typedef {{ number: number, title: string, state: string, created: string }} Issue */

/**
 * @description The fields of a parsed JSON value, read without a cast at every call: GitHub's
 *   answers and a gate's records are both read through it.
 * @param {unknown} value
 * @returns {Record<string, unknown>} The value when it is a plain object, otherwise an empty one.
 */
export function fieldsOf(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @description The `gh` a command reminds through: GitHub's CLI, run with the arguments.
 * @returns {Gh} A runner that returns the call's standard output and throws when it fails.
 */
export function createGh() {
  return (args) =>
    execFileSync("gh", [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** The page of issues one listing asks for; a listing that fills it may leave issues past it. */
const ISSUE_PAGE = 100;

/**
 * @description Raised when the listing of a label's issues fills the page it asked for, so more
 *   issues may exist past it and the reminder's own issue could be among them: the reminder then
 *   opens and comments nothing, rather than open a second issue. No retry changes it while the
 *   label holds that many issues.
 */
export class IssueListingFullError extends Error {
  /**
   * @param {string} label The label whose issues filled the page.
   * @param {number} page The number of issues the listing asked for, and received.
   */
  constructor(label, page) {
    super(`listing the ${label} issues returned no list, or a full page`);
    /** The label whose issues filled the page. */
    this.label = label;
    /** The number of issues the listing asked for, and received. */
    this.page = page;
  }
}

/**
 * @description Raised when a listing the reminder reads (a label's issues, or an issue's comments
 *   since the start of the day) answers with something it cannot read: text that is not JSON, or
 *   JSON that is not a list. It is refused rather than read as no issue or no comment, which would
 *   open a second issue or post a second comment.
 */
export class IssueListingUnreadableError extends Error {}

/**
 * The listing `gh` printed, parsed. Text that is not JSON is an unreadable listing, with the
 * parser's own message; any other error is not the answer's and is thrown as it is.
 *
 * @param {string} answer
 * @returns {unknown}
 */
function parsedListing(answer) {
  try {
    return JSON.parse(answer);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new IssueListingUnreadableError(error.message, { cause: error });
    }
    throw error;
  }
}

/**
 * The issues carrying the label, open and closed. A full page is refused: an issue past it could
 * be duplicated.
 *
 * @param {Gh} gh
 * @param {string} label
 * @returns {Issue[]}
 */
function listIssues(gh, label) {
  const page = parsedListing(
    gh(["api", `repos/{owner}/{repo}/issues?labels=${label}&state=all&per_page=${ISSUE_PAGE}`])
  );
  if (!Array.isArray(page)) {
    throw new IssueListingUnreadableError(
      `listing the ${label} issues returned no list, or a full page`
    );
  }
  if (page.length === ISSUE_PAGE) throw new IssueListingFullError(label, ISSUE_PAGE);
  return page
    .map((issue) => fieldsOf(issue))
    .filter((issue) => issue.pull_request === undefined)
    .map((issue) => ({
      number: Number(issue.number),
      title: String(issue.title),
      state: String(issue.state),
      created: typeof issue.created_at === "string" ? issue.created_at : "",
    }));
}

/**
 * The comment bodies an issue received on or after the start of `today`. An answer that is not a
 * list is refused rather than read as no comment, which would post a second one the same day.
 *
 * @param {Gh} gh
 * @param {number} number
 * @param {string} today
 * @returns {string[]}
 */
function commentsSince(gh, number, today) {
  const endpoint = `repos/{owner}/{repo}/issues/${String(number)}/comments`;
  const page = parsedListing(gh(["api", `${endpoint}?since=${today}T00:00:00Z&per_page=100`]));
  if (!Array.isArray(page)) {
    throw new IssueListingUnreadableError(
      `listing the comments of #${String(number)} returned no list`
    );
  }
  return page.map((comment) => String(fieldsOf(comment).body));
}

/**
 * @description Opens one issue per reminder that has none, comments on each open one once a day
 *   (never on the day it was opened), and reopens each closed one with the day's comment.
 * @param {object} input
 * @param {Gh} input.gh Runs GitHub's CLI.
 * @param {Label} input.label The label every issue of the gate carries.
 * @param {readonly Reminder[]} input.reminders The issues to keep open.
 * @param {string} input.today `YYYY-MM-DD`, the UTC day the run reads as today.
 * @param {string[]} input.log Receives one line per action, `open: <title>`, `comment #<n>: <title>`,
 *   `reopen #<n>: <title>` or `skip #<n>: <title> (<why>)`, so a call that fails midway still
 *   reports what was done before it.
 * @returns {void}
 * @throws {IssueListingFullError} When the label's issues fill the page the listing asked for.
 * @throws {IssueListingUnreadableError} When a listing answers with text that is not JSON, or JSON
 *   that is not a list.
 * @throws {Error} What the `gh` it was given throws when a call fails, as it was thrown.
 */
export function remindIssues({ gh, label, reminders, today, log }) {
  const issues = listIssues(gh, label.name);
  let labelled = false;
  for (const { title, body, comment } of reminders) {
    const issue = issues.find((candidate) => candidate.title === title);
    if (issue === undefined) {
      if (!labelled) {
        gh([
          "label",
          "create",
          label.name,
          "--color",
          label.color,
          "--description",
          label.description,
          "--force",
        ]);
        labelled = true;
      }
      gh(["issue", "create", "--title", title, "--body", body, "--label", label.name]);
      log.push(`open: ${title}`);
      continue;
    }
    if (issue.state !== "open") {
      gh(["issue", "reopen", String(issue.number), "--comment", comment]);
      log.push(`reopen #${String(issue.number)}: ${title}`);
    } else if (issue.created.slice(0, 10) === today) {
      log.push(`skip #${String(issue.number)}: ${title} (opened on ${today})`);
    } else if (commentsSince(gh, issue.number, today).includes(comment)) {
      log.push(`skip #${String(issue.number)}: ${title} (already commented on ${today})`);
    } else {
      gh(["issue", "comment", String(issue.number), "--body", comment]);
      log.push(`comment #${String(issue.number)}: ${title}`);
    }
  }
}
