/**
 * @file maturityWatchlist.test.ts
 * @description Pins `scripts/testing/maturity-watchlist.mjs`: the list of versions that entered
 *   inside the 7-day maturity buffer, reviewed 7 and 14 days after publication. `validate` refuses
 *   each malformed shape, a review dated after the day it runs, and a review dated before its
 *   milestone unless it carries an early reason and is at most 2 days early. `dueToday` returns
 *   every unrecorded review on or past its milestone with the days it is overdue, counting an early
 *   review as recorded, and `--check`, the CI step, exits 1 naming every problem of a list
 *   written to a scratch file and every review more than 3 days overdue. `--remind` plans one issue
 *   action per due review, reopening the issue of a review still unrecorded after a closing; an
 *   injected fetch stands in for the GitHub API, answering each route and recording every call.
 * @layer infrastructure
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Entry = Record<string, unknown>;
type List = { entries: Entry[] };
type Outcome = { exitCode: number; messages: string[] };
type Issue = { number: number; title: string; state: string; closed_at: string | null };
type Routes = Record<string, { status: number; body?: unknown }>;
type Fetch = (url: string, init: { method: string; body?: string }) => Promise<Response>;
type Io = { env?: Record<string, string>; file?: string; fetchImpl?: Fetch };
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type WatchlistModule = {
  validate: (list: unknown, today?: string) => string[];
  dueToday: (list: List, today: string) => { milestone: string; overdueDays: number }[];
  planReminders: (list: List, today: string, issues: Issue[]) => Record<string, unknown>[];
  runCli: (argv: string[], io?: { file?: string }) => Outcome;
  runRemind: (argv: string[], io?: Io) => Promise<Outcome>;
};

const ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPT = path.join(ROOT, "scripts/testing/maturity-watchlist.mjs");
const watchlist = (await import(SCRIPT)) as WatchlistModule;
const { validate, dueToday, planReminders, runCli, runRemind } = watchlist;
const TITLE = "Maturity review due: left-pad@1.3.1 (7-day)";
const FINAL_TITLE = "Maturity review due: left-pad@1.3.1 (14-day)";
const ENV = { GITHUB_TOKEN: "token", GITHUB_REPOSITORY: "o/r" };
/** The query the reminder lists with when the earliest due review is the 7-day one. */
const LIST_QUERY =
  "GET /issues?labels=maturity-review&state=all&since=2026-10-09T00:00:00Z&per_page=100";

const pkg = (overrides: Entry = {}): Entry => ({
  kind: "package",
  name: "left-pad",
  version: "1.3.1",
  published: "2026-10-02T12:00:00.000Z",
  entered: { date: "2026-10-03", commit: "abc1234", pr: 1 },
  milestones: { maturity: "2026-10-09", final: "2026-10-16" },
  reviews: {},
  ...overrides,
});
const dated = (overrides: Entry = {}): Entry => ({
  kind: "date",
  ...{ id: "node-26", title: "Node 26", due: "2026-10-28", refs: ["task 0.16"], reviews: {} },
  ...overrides,
});
const one = (entry: Entry): List => ({ entries: [entry] });
const review = (date: string, outcome = "clean") => ({ maturity: { date, outcome, note: "" } });
/** A 7-day review dated before its milestone, carrying the reason an early review must give. */
const earlyReview = (date: string, reason = "recorded early on the owner's instruction") => ({
  maturity: { date, outcome: "clean", note: "", early: { reason } },
});
/** The fixture's 7-day milestone, and the day the validation cases are measured on. */
const MATURITY_DAY = "2026-10-09";
const BOTH_REVIEWED = {
  ...review("2026-10-09"),
  final: { date: "2026-10-16", outcome: "clean", note: "" },
};
const issueIn = (state: string, closedAt: string | null = null): Issue[] => [
  { number: 7, title: TITLE, state, closed_at: closedAt },
];
const CLOSED_EARLIER = issueIn("closed", "2026-10-09T14:00:00Z");

let dir = "";
let file = "";
let calls: string[] = [];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "maturity-watchlist-test-"));
  file = path.join(dir, "list.json");
  calls = [];
  writeFileSync(file, JSON.stringify({ entries: [pkg(), dated()] }));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Answers `METHOD /path` from `routes`, 404 otherwise, and records `METHOD /path?query`. */
const github =
  (routes: Routes): Fetch =>
  async (url, { method, body }) => {
    const call = `${method} ${url.replace("https://api.github.com/repos/o/r", "")}`;
    const route = call.split("?")[0] ?? call;
    calls.push(call);
    if (body?.includes('"labels":["maturity-review"]')) calls.push("with the label");
    if (body?.includes('"state":"open"')) calls.push("reopening it");
    const reply = routes[route] ?? { status: 404, body: { message: "Not Found" } };
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
  };
const CREATED = { status: 201 };
const listed = (body: unknown[]): Routes => ({ "GET /issues": { status: 200, body } });
const remindOn = (today: string, routes: Routes) =>
  runRemind(["--remind", "--today", today], { env: ENV, file, fetchImpl: github(routes) });
const remind = (routes: Routes) => remindOn("2026-10-09", routes);
const check = (today: string) => runCli(["--check", "--today", today], { file });

describe("validate", () => {
  it("returns no problem for the committed list and for a recorded review", () => {
    const committed: unknown = JSON.parse(readFileSync(SCRIPT.replace(/mjs$/, "json"), "utf8"));

    expect(validate(committed)).toEqual([]);
    expect(validate(one(pkg({ reviews: review("2026-10-10") })), "2026-10-10")).toEqual([]);
  });

  it.each([
    ["no entries array", { items: [] }, "the list has no `entries` array"],
    ["an unknown kind", one({ kind: "module" }), "entry 0: missing or malformed kind"],
    [
      "a missing field",
      one(pkg({ published: undefined })),
      "entry 0: missing or malformed published",
    ],
    ["an impossible date", one(dated({ due: "2026-02-30" })), "entry 0: missing or malformed due"],
    ["an underived milestone", one(pkg({ milestones: {} })), "is undefined, derived 2026-10-09"],
    [
      "an early review with no early field",
      one(pkg({ reviews: review("2026-10-08") })),
      "dated 2026-10-08, before",
    ],
    ["an unknown outcome", one(pkg({ reviews: review("2026-10-09", "ok") })), "needs a date"],
    ["no such milestone", one(dated({ reviews: review("2026-10-28") })), "unknown milestone"],
    ["a duplicate id", { entries: [pkg(), pkg()] }, "entry 1: duplicate id left-pad@1.3.1"],
    [
      "a review dated after the day it runs",
      one(pkg({ reviews: review("2026-10-10") })),
      "left-pad@1.3.1: review maturity dated 2026-10-10, after today 2026-10-09",
    ],
    [
      "an early review more than 2 days early, even with its reason",
      one(pkg({ reviews: earlyReview("2026-10-06") })),
      "left-pad@1.3.1: review maturity dated 2026-10-06 is 3 days before 2026-10-09; " +
        "an early review may be at most 2 days early",
    ],
    [
      "an early review with an empty reason",
      one(pkg({ reviews: earlyReview("2026-10-08", "") })),
      "left-pad@1.3.1: review maturity has an early field without a non-empty reason",
    ],
    [
      "an early review with a blank reason",
      one(pkg({ reviews: earlyReview("2026-10-08", "   ") })),
      "left-pad@1.3.1: review maturity has an early field without a non-empty reason",
    ],
    [
      "an early field that holds no reason object",
      one(
        pkg({
          reviews: { maturity: { date: "2026-10-08", outcome: "clean", note: "", early: true } },
        })
      ),
      "left-pad@1.3.1: review maturity has an early field without a non-empty reason",
    ],
    [
      "an early field on a review that is not early",
      one(pkg({ reviews: earlyReview("2026-10-09") })),
      "left-pad@1.3.1: review maturity dated 2026-10-09 has an early field, but is not before " +
        "2026-10-09",
    ],
  ])("returns a problem for %s", (_case, list, problem) => {
    expect(validate(list, MATURITY_DAY).join("\n")).toContain(problem);
  });

  it.each([
    ["1 day", "2026-10-08"],
    ["2 days", "2026-10-07"],
  ])("returns no problem for a review recorded %s early with its reason", (_case, date) => {
    expect(validate(one(pkg({ reviews: earlyReview(date) })), date)).toEqual([]);
  });

  it("returns only the date problem for an early review dated after the day it runs", () => {
    const list = one(pkg({ reviews: earlyReview("2026-10-08") }));

    expect(validate(list, "2026-10-07")).toEqual([
      "left-pad@1.3.1: review maturity dated 2026-10-08, after today 2026-10-07",
    ]);
  });

  it("measures the day it runs from the real UTC date when no today is given", () => {
    const problems = validate(one(pkg({ reviews: review("2999-01-01") })));

    expect(problems.join("\n")).toContain("review maturity dated 2999-01-01, after today ");
  });

  it("returns a problem for an impossible today", () => {
    expect(validate(one(pkg()), "2026-10-9")).toEqual(["today 2026-10-9 is not a YYYY-MM-DD date"]);
  });
});

describe("dueToday", () => {
  it.each([
    ["the 7-day review on the maturity day", one(pkg()), "2026-10-09", [["maturity", 0]]],
    [
      "the 7-day review 3 days overdue between the two",
      one(pkg()),
      "2026-10-12",
      [["maturity", 3]],
    ],
    [
      "both unrecorded reviews on the two-week day",
      one(pkg()),
      "2026-10-16",
      [
        ["maturity", 7],
        ["final", 0],
      ],
    ],
    [
      "only the unrecorded review once the other is recorded",
      one(pkg({ reviews: review("2026-10-09") })),
      "2026-10-16",
      [["final", 0]],
    ],
    ["nothing before the maturity day", one(pkg()), "2026-10-08", []],
    ["nothing once both are recorded", one(pkg({ reviews: BOTH_REVIEWED })), "2026-10-30", []],
    [
      "nothing on the maturity day once the 7-day review is recorded early",
      one(pkg({ reviews: earlyReview("2026-10-08") })),
      "2026-10-09",
      [],
    ],
    [
      "the 14-day review on its day after the 7-day one was recorded early",
      one(pkg({ reviews: earlyReview("2026-10-08") })),
      "2026-10-16",
      [["final", 0]],
    ],
    ["a date entry on its due day", one(dated()), "2026-10-28", [["due", 0]]],
    ["a date entry past its due day", one(dated()), "2026-11-02", [["due", 5]]],
  ])("returns %s", (_case, list, today, due) => {
    const found = dueToday(list, today).map(({ milestone, overdueDays }) => [
      milestone,
      overdueDays,
    ]);

    expect(found).toEqual(due);
  });
});

describe("--check", () => {
  it("exits 0 on a valid list whose reviews are at most 3 days overdue", () => {
    expect(check("2026-10-12")).toEqual({
      exitCode: 0,
      messages: ["2 entries, all valid"],
    });
  });

  it("exits 1 naming a review 4 days overdue", () => {
    expect(check("2026-10-13")).toEqual({
      exitCode: 1,
      messages: [
        "left-pad@1.3.1: review maturity was due 2026-10-09, 4 days ago, and is not recorded",
      ],
    });
  });

  it("exits 1 naming every review more than 3 days overdue, and no recorded one", () => {
    const entries = [pkg({ reviews: review("2026-10-09") }), dated()];
    writeFileSync(file, JSON.stringify({ entries }));

    expect(check("2026-11-02")).toEqual({
      exitCode: 1,
      messages: [
        "left-pad@1.3.1: review final was due 2026-10-16, 17 days ago, and is not recorded",
        "node-26: review due was due 2026-10-28, 5 days ago, and is not recorded",
      ],
    });
  });

  it("measures the overdue days from the real UTC date without --today", () => {
    const milestones = { maturity: "2020-01-08", final: "2020-01-15" };
    const old = pkg({ published: "2020-01-01T00:00:00.000Z", milestones });
    writeFileSync(file, JSON.stringify({ entries: [old] }));

    const outcome = runCli(["--check"], { file });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.messages.join("\n")).toContain("review maturity was due 2020-01-08");
  });

  it("exits 1 naming a review dated after --today", () => {
    writeFileSync(file, JSON.stringify({ entries: [pkg({ reviews: review("2026-10-10") })] }));

    expect(check("2026-10-09")).toEqual({
      exitCode: 1,
      messages: ["left-pad@1.3.1: review maturity dated 2026-10-10, after today 2026-10-09"],
    });
  });

  it("exits 1 naming a review dated after the real UTC date without --today", () => {
    writeFileSync(file, JSON.stringify({ entries: [pkg({ reviews: review("2999-01-01") })] }));

    const outcome = runCli(["--check"], { file });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.messages.join("\n")).toContain("review maturity dated 2999-01-01, after today ");
  });

  it("exits 1 naming each problem of an invalid list", () => {
    writeFileSync(file, JSON.stringify({ entries: [{ kind: "module" }, dated({ due: "soon" })] }));

    expect(runCli(["--check"], { file })).toEqual({
      exitCode: 1,
      messages: ["entry 0: missing or malformed kind", "entry 1: missing or malformed due"],
    });
  });

  it.each([
    ["an unreadable list", ["--check"], "/nonexistent/list.json", "list.json is unreadable"],
    ["an unknown flag", ["--check", "--sideways"], undefined, "usage:"],
    ["an impossible --today", ["--check", "--today", "2026-10-9"], undefined, "not a YYYY-MM-DD"],
    ["no mode", [], undefined, "usage:"],
  ])("exits 1 on %s", (_case, argv, missing, cause) => {
    const outcome = runCli(argv, { file: missing ?? file });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.messages.join("\n")).toContain(cause);
  });
});

describe("planReminders", () => {
  it.each([
    ["opens the issue at the first firing", "2026-10-09", [], { action: "open", title: TITLE }],
    [
      "comments while the issue is open",
      "2026-10-09",
      issueIn("open"),
      { action: "comment", number: 7, body: "Still open on 2026-10-09." },
    ],
    [
      "comments with the days overdue on a later day",
      "2026-10-10",
      issueIn("open"),
      {
        action: "comment",
        number: 7,
        body: "Still open on 2026-10-10; due 2026-10-09, 1 day overdue.",
      },
    ],
    [
      "skips the issue closed earlier the same day",
      "2026-10-10",
      issueIn("closed", "2026-10-10T14:00:00Z"),
      { action: "skip", number: 7 },
    ],
    [
      "reopens the issue closed on an earlier day",
      "2026-10-11",
      CLOSED_EARLIER,
      { action: "reopen", title: TITLE, number: 7 },
    ],
  ])("%s", (_case, today, issues, action) => {
    expect(planReminders(one(pkg()), today, issues)).toMatchObject([action]);
  });

  it.each([
    ["before the milestone day", one(pkg()), "2026-10-08"],
    ["once the review is recorded", one(pkg({ reviews: review("2026-10-09") })), "2026-10-12"],
  ])("plans nothing %s, even with the issue open", (_case, list, today) => {
    expect(planReminders(list, today, issueIn("open"))).toEqual([]);
  });

  it("tells in the opened issue how to record the review and close it, and no lateness", () => {
    const body = String(planReminders(one(pkg()), "2026-10-09", [])[0]?.body);

    expect(body).toContain("then close this issue");
    expect(body).not.toContain("overdue");
  });

  it("names the milestone date and the days overdue in an issue opened late", () => {
    const body = String(planReminders(one(pkg()), "2026-10-12", [])[0]?.body);

    expect(body).toContain("This review was due 2026-10-09 and is 3 days overdue.");
  });

  it("tells in the reopened issue how long the review went unrecorded and how to record it", () => {
    const body = String(planReminders(one(pkg()), "2026-10-11", CLOSED_EARLIER)[0]?.body);

    expect(body).toContain("still not recorded 2 days after its milestone, 2026-10-09");
    expect(body).toContain("then close this issue");
  });
});

describe("--remind", () => {
  it.each([
    ["an impossible --today", ["--remind", "--today", "2026-10-9"], {}, "not a YYYY-MM-DD date"],
    ["an unknown flag", ["--remind", "--sideways"], {}, "--sideways"],
    ["no GITHUB_TOKEN", ["--remind"], { env: { GITHUB_REPOSITORY: "o/r" } }, "GITHUB_TOKEN"],
    ["no GITHUB_REPOSITORY", ["--remind"], { env: { GITHUB_TOKEN: "t" } }, "GITHUB_REPOSITORY"],
  ])("exits 1 on %s, calling no API", async (_case, argv, io: Io, cause) => {
    const outcome = await runRemind(argv, { file, ...io, fetchImpl: github({}) });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.messages.join("\n")).toContain(cause);
    expect(calls).toEqual([]);
  });

  it.each([
    ["the planned open on a milestone day", "2026-10-09", [`open: ${TITLE}`]],
    ["the planned open of a review past its milestone", "2026-10-10", [`open: ${TITLE}`]],
    ["nothing before any milestone", "2026-10-08", []],
  ])("prints %s in a dry run, calling no API", async (_case, today, messages) => {
    const argv = ["--remind", "--dry-run", "--today", today];

    const outcome = await runRemind(argv, { env: {}, file, fetchImpl: github({}) });

    expect(outcome).toEqual({ exitCode: 0, messages });
    expect(calls).toEqual([]);
  });

  it("exits 1 naming a review dated after --today, calling no API", async () => {
    writeFileSync(file, JSON.stringify({ entries: [pkg({ reviews: review("2026-10-10") })] }));

    const outcome = await remindOn("2026-10-09", {});

    expect(outcome).toEqual({
      exitCode: 1,
      messages: ["left-pad@1.3.1: review maturity dated 2026-10-10, after today 2026-10-09"],
    });
    expect(calls).toEqual([]);
  });

  it("exits 0 calling no API on a day with no review due", async () => {
    const outcome = await remindOn("2026-10-08", listed([]));

    expect(outcome).toEqual({ exitCode: 0, messages: [] });
    expect(calls).toEqual([]);
  });

  it("creates the missing label, then opens the issue carrying it", async () => {
    const outcome = await remind({
      ...listed([]),
      "POST /labels": CREATED,
      "POST /issues": CREATED,
    });

    expect(outcome).toEqual({ exitCode: 0, messages: [`open: ${TITLE}`] });
    expect(calls).toEqual([
      LIST_QUERY,
      ...["GET /labels/maturity-review", "POST /labels", "POST /issues", "with the label"],
    ]);
  });

  it("lists the issues updated since the earliest due review, not since today", async () => {
    const outcome = await remindOn("2026-10-16", {
      ...listed([]),
      "GET /labels/maturity-review": { status: 200 },
      "POST /issues": CREATED,
    });

    expect(outcome).toEqual({ exitCode: 0, messages: [`open: ${TITLE}`, `open: ${FINAL_TITLE}`] });
    expect(calls[0]).toBe(LIST_QUERY);
  });

  it("comments on the open issue, ignoring a pull request with the same title", async () => {
    const pull = { number: 3, title: TITLE, state: "closed", closed_at: null, pull_request: {} };

    const outcome = await remind({
      ...listed([pull, ...issueIn("open")]),
      "POST /issues/7/comments": CREATED,
    });

    expect(outcome).toEqual({ exitCode: 0, messages: [`comment #7: ${TITLE}`] });
    expect(calls.slice(1)).toEqual(["POST /issues/7/comments"]);
  });

  it("calls nothing past the list for an issue closed earlier the same day", async () => {
    const outcome = await remind(listed(issueIn("closed", "2026-10-09T15:00:00Z")));

    expect(outcome).toEqual({ exitCode: 0, messages: [`skip #7: ${TITLE}`] });
    expect(calls).toEqual([LIST_QUERY]);
  });

  it("reopens the issue closed on an earlier day, then comments on it", async () => {
    const outcome = await remindOn("2026-10-11", {
      ...listed(CLOSED_EARLIER),
      "PATCH /issues/7": { status: 200 },
      "POST /issues/7/comments": CREATED,
    });

    expect(outcome).toEqual({ exitCode: 0, messages: [`reopen #7: ${TITLE}`] });
    expect(calls).toEqual([
      LIST_QUERY,
      ...["PATCH /issues/7", "reopening it", "POST /issues/7/comments"],
    ]);
  });

  it.each([
    ["an error status", { status: 500, body: "boom" }, 'GET /issues answered 500: "boom"'],
    ["a full page it cannot see past", { status: 200, body: Array(100).fill({}) }, "a full page"],
  ])("exits 1 when the API answers %s", async (_case, reply, cause) => {
    const outcome = await remind({ "GET /issues": reply });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.messages.join("\n")).toContain(cause);
  });
});
