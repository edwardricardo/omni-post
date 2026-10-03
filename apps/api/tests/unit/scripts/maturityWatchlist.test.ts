/**
 * @file maturityWatchlist.test.ts
 * @description Pins `scripts/testing/maturity-watchlist.mjs`: the list of versions that entered
 *   inside the 7-day maturity buffer, reviewed 7 and 14 days after publication. `validate` refuses
 *   each malformed shape, `dueToday` returns only the reviews due that day, and `--check`, the CI
 *   step, exits 1 naming every problem of a list written to a scratch file. `--remind` plans one issue
 *   action per due review; an injected fetch stands in for the GitHub API, answering each route and
 *   recording every call.
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
type Issue = { number: number; title: string; state: string };
type Routes = Record<string, { status: number; body?: unknown }>;
type Fetch = (url: string, init: { method: string; body?: string }) => Promise<Response>;
type Io = { env?: Record<string, string>; file?: string; fetchImpl?: Fetch };
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type WatchlistModule = {
  validate: (list: unknown) => string[];
  dueToday: (list: List, today: string) => { milestone: string }[];
  planReminders: (list: List, today: string, issues: Issue[]) => Record<string, unknown>[];
  runCli: (argv: string[], io?: { file?: string }) => Outcome;
  runRemind: (argv: string[], io?: Io) => Promise<Outcome>;
};

const ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPT = path.join(ROOT, "scripts/testing/maturity-watchlist.mjs");
const watchlist = (await import(SCRIPT)) as WatchlistModule;
const { validate, dueToday, planReminders, runCli, runRemind } = watchlist;
const TITLE = "Maturity review due: left-pad@1.3.1 (7-day)";
const ENV = { GITHUB_TOKEN: "token", GITHUB_REPOSITORY: "o/r" };

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
const issueIn = (state: string): Issue[] => [{ number: 7, title: TITLE, state }];

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
    const reply = routes[route] ?? { status: 404, body: { message: "Not Found" } };
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
  };
const CREATED = { status: 201 };
const listed = (body: unknown[]): Routes => ({ "GET /issues": { status: 200, body } });
const remind = (routes: Routes) =>
  runRemind(["--remind", "--today", "2026-10-09"], { env: ENV, file, fetchImpl: github(routes) });

describe("validate", () => {
  it("returns no problem for the committed list and for a recorded review", () => {
    const committed: unknown = JSON.parse(readFileSync(SCRIPT.replace(/mjs$/, "json"), "utf8"));

    expect(validate(committed)).toEqual([]);
    expect(validate(one(pkg({ reviews: review("2026-10-10") })))).toEqual([]);
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
    ["an early review", one(pkg({ reviews: review("2026-10-08") })), "dated 2026-10-08, before"],
    ["an unknown outcome", one(pkg({ reviews: review("2026-10-09", "ok") })), "needs a date"],
    ["no such milestone", one(dated({ reviews: review("2026-10-28") })), "unknown milestone"],
    ["a duplicate id", { entries: [pkg(), pkg()] }, "entry 1: duplicate id left-pad@1.3.1"],
  ])("returns a problem for %s", (_case, list, problem) => {
    expect(validate(list).join("\n")).toContain(problem);
  });
});

describe("dueToday", () => {
  it.each([
    ["the 7-day review on the maturity day", one(pkg()), "2026-10-09", ["maturity"]],
    ["the 14-day review on the two-week day", one(pkg()), "2026-10-16", ["final"]],
    ["nothing on a day between the two", one(pkg()), "2026-10-12", []],
    ["nothing once it is reviewed", one(pkg({ reviews: review("2026-10-09") })), "2026-10-09", []],
    ["a date entry on its due day", one(dated()), "2026-10-28", ["due"]],
  ])("returns %s", (_case, list, today, milestones) => {
    expect(dueToday(list, today).map((due) => due.milestone)).toEqual(milestones);
  });
});

describe("--check", () => {
  it("exits 0 on a valid list", () => {
    expect(runCli(["--check"], { file })).toEqual({
      exitCode: 0,
      messages: ["2 entries, all valid"],
    });
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
    ["no mode", [], undefined, "usage:"],
  ])("exits 1 on %s", (_case, argv, missing, cause) => {
    const outcome = runCli(argv, { file: missing ?? file });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.messages.join("\n")).toContain(cause);
  });
});

describe("planReminders", () => {
  it.each([
    ["opens the issue at the first firing", [], { action: "open", title: TITLE }],
    ["comments while the issue is open", issueIn("open"), { action: "comment", number: 7 }],
    ["skips the issue once it is closed", issueIn("closed"), { action: "skip", number: 7 }],
  ])("%s", (_case, issues, action) => {
    expect(planReminders(one(pkg()), "2026-10-09", issues)).toMatchObject([action]);
  });

  it("plans nothing on a day that is no milestone, even with the issue open", () => {
    expect(planReminders(one(pkg()), "2026-10-10", issueIn("open"))).toEqual([]);
  });

  it("tells in the opened issue how to record the review and close it", () => {
    expect(planReminders(one(pkg()), "2026-10-09", [])[0]?.body).toContain("then close this issue");
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
    ["nothing on a day that is no milestone", "2026-10-10", []],
  ])("prints %s in a dry run, calling no API", async (_case, today, messages) => {
    const argv = ["--remind", "--dry-run", "--today", today];

    const outcome = await runRemind(argv, { env: {}, file, fetchImpl: github({}) });

    expect(outcome).toEqual({ exitCode: 0, messages });
    expect(calls).toEqual([]);
  });

  it("exits 0 calling no API on a day with no review due", async () => {
    const argv = ["--remind", "--today", "2026-10-10"];

    const outcome = await runRemind(argv, { env: ENV, file, fetchImpl: github(listed([])) });

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
      "GET /issues?labels=maturity-review&state=all&since=2026-10-09T00:00:00Z&per_page=100",
      ...["GET /labels/maturity-review", "POST /labels", "POST /issues", "with the label"],
    ]);
  });

  it("comments on the open issue, ignoring a pull request with the same title", async () => {
    const pull = { number: 3, title: TITLE, state: "closed", pull_request: {} };

    const outcome = await remind({
      ...listed([pull, ...issueIn("open")]),
      "POST /issues/7/comments": CREATED,
    });

    expect(outcome).toEqual({ exitCode: 0, messages: [`comment #7: ${TITLE}`] });
    expect(calls.slice(1)).toEqual(["POST /issues/7/comments"]);
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
