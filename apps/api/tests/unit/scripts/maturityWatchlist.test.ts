/**
 * @file maturityWatchlist.test.ts
 * @description Pins `scripts/testing/maturity-watchlist.mjs`: the list of versions that entered
 *   inside the 7-day maturity buffer, reviewed 7 and 14 days after publication. `validate` refuses
 *   each malformed shape, `dueToday` returns only the reviews due that day, and `--check`, the CI
 *   step, exits 1 naming every problem of a list written to a scratch file.
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
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type WatchlistModule = {
  validate: (list: unknown) => string[];
  dueToday: (list: List, today: string) => { milestone: string }[];
  runCli: (argv: string[], io?: { file?: string }) => Outcome;
};

const ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPT = path.join(ROOT, "scripts/testing/maturity-watchlist.mjs");
const { validate, dueToday, runCli } = (await import(SCRIPT)) as WatchlistModule;

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

let dir = "";
let file = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "maturity-watchlist-test-"));
  file = path.join(dir, "list.json");
  writeFileSync(file, JSON.stringify({ entries: [pkg(), dated()] }));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

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
