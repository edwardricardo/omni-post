/**
 * @file supportFrontMatter.test.ts
 * @description Pins `scripts/support/lib/front-matter.mjs`: the flat front-matter grammar and each
 *   line it refuses, the `## ` headings outside code fences, the heading order and key-set
 *   problems, the repository path refusals, and the `YYYY-MM-DD` date and 40-hex sha checks.
 * @layer infrastructure
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Heading = { title: string; index: number };
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type Library = {
  parseFrontMatter: (
    file: string,
    text: string
  ) => { data: Map<string, unknown>; body: string[]; problems: string[] };
  headingsOf: (lines: string[]) => Heading[];
  sectionProblem: (titles: string[], expected: string[]) => string | null;
  keyProblems: (keys: Iterable<string>, expected: string[]) => string[];
  pathProblem: (root: string, entry: string) => string | null;
  isIsoDate: (date: string) => boolean;
  isCommitSha: (sha: string) => boolean;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const MODULE = path.join(REPO_ROOT, "scripts/support/lib/front-matter.mjs");
const lib = (await import(MODULE)) as Library;
const { parseFrontMatter, headingsOf, sectionProblem, keyProblems, pathProblem } = lib;

const FILE = "docs/support/publishing.md";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const FRONT = `---
feature: publishing
owner: Platform engineering # a team
status: 'live'
verified:
  sha: ${SHA}
  date: 2026-10-07
  by: edward
covers:
  - Publish a post now
  - "Schedule: later # not a comment"
---
# Publishing
`;
/**
 * One refusal per row: what it is | text replaced in the front matter | its replacement | the
 * problem. Every cell is non-empty, so each row splits into exactly four.
 */
const REFUSALS = String.raw`
no opening line | ---\nfeature | feature | : no front matter between two --- lines
no closing line | ---\n# Publishing | # Publishing | : no front matter between two --- lines
a key set twice | status: 'live'\n | status: 'live'\nstatus: live\n | :5: status is set twice
an item that is not indented | covers:\n  - Publish | covers:\n- Publish | :10: no "key: value", "  - item" or "  key: value"
an indented line under a value | status: 'live'\n | status: 'live'\n  - x\n | :5: no "key: value", "  - item" or "  key: value"
a key line after the items of a list | "Schedule: later # not a comment"\n | "Schedule: later # not a comment"\n  at: noon\n | :12: no "key: value", "  - item" or "  key: value"
an item after the keys of a map | by: edward\n | by: edward\n  - x\n | :9: no "key: value", "  - item" or "  key: value"`
  .trim()
  .split("\n")
  .map((row) => row.split(" | ").map((cell) => cell.replaceAll("\\n", "\n")));
const SECTIONS = ["One", "Two", "Three"];

let root = "";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "support-front-matter-test-"));
  mkdirSync(path.join(root, "apps/api/src/posts"), { recursive: true });
  writeFileSync(path.join(root, "apps/api/src/posts/postRoutes.ts"), "");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("parseFrontMatter", () => {
  it("reads values without quotes or comments, lists, a map, and the body after it", () => {
    const { data, body, problems } = parseFrontMatter(FILE, FRONT);

    expect(problems).toEqual([]);
    expect(Object.fromEntries(data)).toEqual({
      feature: "publishing",
      owner: "Platform engineering",
      status: "live",
      verified: { sha: SHA, date: "2026-10-07", by: "edward" },
      covers: ["Publish a post now", "Schedule: later # not a comment"],
    });
    expect(body).toEqual(["# Publishing", ""]);
  });

  it("reads a key with no item as an empty list, and skips blank and comment lines", () => {
    const { data, problems } = parseFrontMatter(FILE, "---\npaths:\n\n# note\nlegal: none\n---\n");

    expect(problems).toEqual([]);
    expect(Object.fromEntries(data)).toEqual({ paths: [], legal: "none" });
  });

  it.each(REFUSALS)("refuses %s", (title, from, to, problem, ...extra) => {
    expect([title, from, to, problem, ...extra].filter(Boolean)).toHaveLength(4);
    expect(FRONT).toContain(from);

    expect(parseFrontMatter(FILE, FRONT.replace(from, to)).problems).toContain(`${FILE}${problem}`);
  });
});

describe("the headings", () => {
  it("lists the ## headings with their line, none inside a ``` or ~~~ fence", () => {
    const lines = ["## One", "```", "## In a fence", "```", "~~~", "## Two", "~~~", "## Two  "];

    expect(headingsOf(lines)).toEqual([
      { title: "One", index: 0 },
      { title: "Two", index: 7 },
    ]);
  });

  it.each<[string, string[], string | null]>([
    ["the expected ones", ["One", "Two", "Three"], null],
    ["a missing one", ["One", "Three"], 'heading 2 must be "## Two", not "## Three"'],
    ["one out of order", ["Two", "One", "Three"], 'heading 1 must be "## One", not "## Two"'],
    ["one too many", ["One", "Two", "Three", "Four"], 'heading 4 must be none, not "## Four"'],
    ["one too few at the end", ["One", "Two"], 'heading 3 must be "## Three", not none'],
  ])("reports where %s first differs", (_, titles, problem) => {
    expect(sectionProblem(titles, SECTIONS)).toBe(problem);
  });
});

describe("the checks", () => {
  it("lists the missing keys before the unknown ones", () => {
    expect(
      keyProblems(
        new Map([
          ["title", 1],
          ["owner", 2],
        ]).keys(),
        ["feature", "owner"]
      )
    ).toEqual(["front matter has no feature", "title is no template key"]);
  });

  it.each<[string, string | null]>([
    ["apps/api/src/posts/", null],
    ["apps/api/src/posts/postRoutes.ts", null],
    ["apps/api/src/gone.ts", "apps/api/src/gone.ts does not exist"],
    ["apps/api/src/posts", "apps/api/src/posts is a directory: end it with /"],
    ["apps/api/src/posts/postRoutes.ts/", "apps/api/src/posts/postRoutes.ts/ does not exist"],
    ["apps/*/", "apps/*/ is no repository-relative path without globs"],
    ["apps/../apps/", "apps/../apps/ is no repository-relative path without globs"],
    ["apps//api/", "apps//api/ is no repository-relative path without globs"],
    ["/apps/api/", "/apps/api/ is no repository-relative path without globs"],
  ])("judges the path %s", (entry, problem) => {
    expect(pathProblem(root, entry)).toBe(problem);
  });

  it.each([
    ["2026-10-07", true],
    ["2026-02-30", false],
    ["2026-10", false],
    ["2026-13-01", false],
    ["7 Oct 2026", false],
  ])("judges %s as a YYYY-MM-DD date: %s", (date, valid) => {
    expect(lib.isIsoDate(date)).toBe(valid);
  });

  it.each([
    [SHA, true],
    [SHA.toUpperCase(), false],
    [SHA.slice(1), false],
    [`${SHA}0`, false],
  ])("judges %s as a commit sha: %s", (sha, valid) => {
    expect(lib.isCommitSha(sha)).toBe(valid);
  });
});
