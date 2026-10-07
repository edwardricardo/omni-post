/**
 * @file supportIndex.test.ts
 * @description Pins `scripts/support/index.mjs`: the flat front-matter grammar, each refusal of a
 *   support doc against the template contract, the template's own drift, the scope errors, a
 *   byte-stable index that moves only with a front matter, and the committed README equal to the
 *   one regenerated from the real tree. Each case runs on a scratch tree that starts green.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Built = { markdown: string; problems: string[]; scopeError?: string };
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type Index = Record<"PAGE" | "TEMPLATE", string> & {
  SECTIONS: string[];
  buildIndex: (options: { root: string }) => Promise<Built>;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const MODULE = path.join(REPO_ROOT, "scripts/support/index.mjs");
const { PAGE, TEMPLATE, SECTIONS, buildIndex } = (await import(MODULE)) as Index;

const DOC = "docs/support/publishing.md";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const STAMP = `Last verified against main ${SHA} on 2026-10-07 by edward`;
const FRONT = `---
feature: publishing
owner: Platform engineering # a team
status: live
verified:
  sha: ${SHA}
  date: 2026-10-07
  by: edward
paths:
  - apps/api/src/posts/
covers:
  - Publish a post now
  - "Schedule: later"
legal:
  - register:9
  - subprocessors:stripe
---
`;
/** A `## ` line inside a fence is no heading, so every section of the good doc carries one. */
const FENCE = "```\n## not a heading\n```";
const BODY = SECTIONS.map((t) => `## ${t}\n\n${t === "Verification" ? STAMP : FENCE}\n`);
const GOOD = `${FRONT}\n# Publishing\n\n${BODY.join("\n")}`;
/**
 * One refusal per row: what it is | text replaced in the good doc | its replacement, `-` to delete
 * the text | the problem. Every cell is non-empty, so each row splits into exactly four. The
 * grammar and the generic checks have their variants in `supportFrontMatter.test.ts`; a row here
 * proves each reaches the index with the doc's name.
 */
const REFUSALS = String.raw`
no front matter | ---\nfeature | feature | : no front matter between two --- lines
a missing key | owner: Platform engineering # a team\n | - | : front matter has no owner
a feature that is no file name | feature: publishing | feature: shipping | : feature is "shipping", not the file name publishing
an empty owner | owner: Platform engineering # a team | owner: "" | : owner is empty
an unknown status | status: live | status: done | : status is "done", not live|partial|planned
a stamp with another key | by: edward\n | by: edward\n  at: noon\n | : verified must hold sha, date and by, and no other key
a stamp sha that is no commit | sha: ${SHA} | sha: abc | : verified sha "abc" is no 40-hex commit
a stamp date that is no day | date: 2026-10-07 | date: 2026-02-30 | : verified date "2026-02-30" is no YYYY-MM-DD date
a path that does not exist | src/posts/\n | src/gone.ts\n | : paths: apps/api/src/gone.ts does not exist
an empty list | covers:\n  - Publish a post now\n  - "Schedule: later"\n | covers:\n | : covers is no list of distinct capabilities
a repeated capability | "Schedule: later" | Publish a post now | : covers is no list of distinct capabilities
a register section that is missing | register:9 | register:99 | : legal register:99 names no register section or inventory row
an inventory row that is missing | subprocessors:stripe | subprocessors:paypal | : legal subprocessors:paypal names no register section or inventory row
none beside a reference | register:9\n | register:9\n  - none\n | : legal is no list nor none
a missing section | ## Data and privacy\n | - | : heading 6 must be "## Data and privacy", not "## Related documents"
a Verification line that is not the stamp | ${STAMP} | ${STAMP}\nMore. | : ## Verification must be the one line "${STAMP}"`
  .trim()
  .split("\n")
  .map((row) => row.split(" | ").map((cell) => cell.replaceAll("\\n", "\n")));

let root = "";
const put = (file: string, text: string): void => {
  mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};
const build = (): Promise<Built> => buildIndex({ root });

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "support-index-test-"));
  put(TEMPLATE, readFileSync(path.join(REPO_ROOT, TEMPLATE), "utf8"));
  put("docs/legal/REGISTER.md", "# Register\n\n## 9. Retention\n");
  put("docs/legal/inventories/subprocessors.generated.md", "| `stripe` |\n");
  put("apps/api/src/posts/postRoutes.ts", "");
  put(DOC, GOOD);
  ["README", "NON_FEATURES"].forEach((page) => put(`docs/support/${page}.md`, "#"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a support doc", () => {
  it("starts green, a fenced ## line in every section included", async () => {
    expect((await build()).problems).toEqual([]);
  });

  it.each(REFUSALS)("refuses %s", async (title, from, to, problem, ...extra) => {
    expect([title, from, to, problem, ...extra].filter(Boolean)).toHaveLength(4);
    expect(GOOD).toContain(from);
    put(DOC, GOOD.replace(from, to === "-" ? "" : to));

    expect((await build()).problems).toContain(`${DOC}${problem}`);
  });

  it("accepts legal: none alone, and refuses a file name that is no kebab-case slug", async () => {
    put(DOC, GOOD.replace("legal:\n  - register:9\n  - subprocessors:stripe", "legal: none"));
    put("docs/support/Bad_Name.md", GOOD.replace("publishing", "Bad_Name"));

    expect((await build()).problems).toEqual([
      "docs/support/Bad_Name.md: the file name is no kebab-case slug",
    ]);
  });

  it("returns the template problems of a stray EXCEPTIONS.md when it is no companion page", async () => {
    const stray = "docs/support/EXCEPTIONS.md";
    put(stray, "# Exceptions\n\nDated exceptions live here.\n");

    const built = await build();

    expect(built.markdown).toContain("| [EXCEPTIONS](EXCEPTIONS.md) |");
    expect(built.problems).toContain(`${stray}: no front matter between two --- lines`);
    expect(built.problems.every((problem) => problem.startsWith(`${stray}: `))).toBe(true);
  });
});

describe("the index", () => {
  it("renders one row per doc, byte-stable, moving with a front matter only", async () => {
    const [first, second] = [await build(), await build()];
    put(DOC, GOOD.replace(FENCE, "Prose."));
    const prose = await build();
    put(DOC, GOOD.replace("Platform engineering", "Support"));
    const cells = "`0123456789` on 2026-10-07 by edward | Publish a post now; Schedule: later";
    const row = `| [publishing](publishing.md) | live   | ${cells} | register:9, subprocessors:stripe |`;

    expect(first.markdown).toContain(`${row} Platform engineering |`);
    expect(first.markdown).toMatch(/\| live +\| 1 +\|/);
    expect([second.markdown, prose.markdown]).toEqual([first.markdown, first.markdown]);
    expect((await build()).markdown).not.toBe(first.markdown);
  });

  it("renders an empty index without docs, and a scope error without its contract", async () => {
    rmSync(path.join(root, DOC));
    const empty = await build();
    rmSync(path.join(root, TEMPLATE));

    expect(empty.problems).toEqual([]);
    expect(empty.markdown).toMatch(/## Index\n\nNone\.\n$/);
    expect((await build()).scopeError).toMatch(/^docs\/support\/_TEMPLATE\.md does not exist/);
    rmSync(path.join(root, "docs/support"), { recursive: true });
    expect((await build()).scopeError).toMatch(/^docs\/support does not exist/);
  });

  it("refuses a template that drifts from the contract", async () => {
    const template = readFileSync(path.join(REPO_ROOT, TEMPLATE), "utf8");
    put(TEMPLATE, template.replace("## Configuration\n", "").replace("owner:", "title: x\nowner:"));
    const keys = "feature, title, owner, status, verified, paths, covers, legal";

    expect((await build()).problems).toEqual([
      `${TEMPLATE}: its keys ${keys} are not feature,owner,status,verified,paths,covers,legal`,
      `${TEMPLATE}: heading 5 must be "## Configuration", not "## Data and privacy"`,
    ]);
  });

  it("finds the real tree clean and its committed page current", async () => {
    const built = await buildIndex({ root: REPO_ROOT });

    expect(built.problems).toEqual([]);
    expect(built.markdown).toBe(readFileSync(path.join(REPO_ROOT, PAGE), "utf8"));
  });
});

describe("the runner", () => {
  const RUNNER = path.join(REPO_ROOT, "scripts/support/run.mjs");
  const run = (args: string[]) =>
    spawnSync(process.execPath, [RUNNER, ...args], { cwd: REPO_ROOT, encoding: "utf8" });

  // Without --only there is no pair to accept, so the first position is checked like any other:
  // a token there must not reach the generators, where it would rewrite the page unasked.
  it.each([
    ["an unknown flag", ["--unknown"]],
    ["a stray positional", ["typo"]],
    ["a positional before --check", ["typo", "--check"]],
    ["a positional after --check", ["--check", "typo"]],
    ["a second positional after --only <name>", ["--only", "index", "typo"]],
    ["--only with no name", ["--only"]],
    ["--only with a flag as its name", ["--only", "--check"]],
  ])("returns exit 1 and the usage error naming the arguments when given %s", (_case, args) => {
    const result = run(args);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `usage: run.mjs [--check] [--only <name>]; got ${args.join(" ")}`
    );
    expect(result.stdout).toBe("");
  });

  it.each([
    ["--check", ["--check"]],
    ["--only index --check", ["--only", "index", "--check"]],
  ])("returns exit 0 and reports the README current when given %s", (_case, args) => {
    const result = run(args);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("support-docs index: docs/support/README.md is current\n");
    expect(result.stderr).toBe("");
  });
});
