/**
 * @file instructionContextGate.test.ts
 * @description Pins `scripts/testing/instruction-context-gate.mjs`, the gate behind
 *   `pnpm check:instruction-context`: the instruction files every session loads by itself are
 *   derived from the harness's entry files, their imports and the rules, held to the checked-in
 *   manifest `.claude/instruction-manifest.json` in both directions, and held to the manifest's
 *   byte budget; each moved record keeps a live path-scoped rule that names it and is never loaded
 *   itself.
 *
 *   WHY THE GATE EXISTS, and therefore what this suite has to hold: the loaded instruction content
 *   grew from 449 KB to 572 KB in a month with nothing measuring it, until the largest model refused
 *   every request of the project. A file added to the loaded set, a byte budget left above the
 *   content it guards, and a record imported back into the context each have to read red. The gate
 *   may over-count and must never under-count, so every way the harness loads a file that the gate
 *   could miss has its own case here: a rule the harness reads as unscoped, an entry file beside
 *   `CLAUDE.md`, an import with a fragment or next to markup, and a symbolic link under the rules.
 *
 *   The rules are driven through the exported `evaluate` over an in-memory tree, so every case
 *   measures the rule and never this repository. The CLI is driven as a process over a scratch git
 *   repository for what only a process can show: the exit codes, git's listing, the usage errors and
 *   the `--write` mode that lowers the budget and never raises it.
 * @layer infrastructure
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const GATE_SCRIPT = path.join(REPO_ROOT, "scripts", "testing", "instruction-context-gate.mjs");

type FileRead =
  | { readonly kind: "file"; readonly buffer: Buffer }
  | { readonly kind: "absent" }
  | { readonly kind: "not-file" }
  | { readonly kind: "error"; readonly message: string };

interface Measured {
  readonly files: readonly string[];
  readonly bytes: number;
}

interface Verdict {
  readonly exitCode: number;
  readonly unread: readonly string[];
  readonly violations: readonly string[];
  readonly summary: string | null;
  readonly measured: Measured | null;
}

interface EvaluateInput {
  readonly root: string;
  readonly manifestText: string;
  readonly tracked: readonly string[];
  readonly links?: readonly string[];
  readonly readFile: (absolutePath: string) => FileRead;
  readonly homeDir: string;
}

/**
 * The module's surface as the suite uses it. It is loaded by a computed path because a literal
 * import of an untyped `.mjs` would leave the tests' typecheck scope an implicit-any module.
 */
interface InstructionContextGateModule {
  readonly MANIFEST: string;
  readonly BUDGET_SLACK: number;
  readonly evaluate: (input: EvaluateInput) => Verdict;
}

const { MANIFEST, BUDGET_SLACK, evaluate } = (await import(
  GATE_SCRIPT
)) as InstructionContextGateModule;

const SPAWN_TIMEOUT = 30_000;
const EXIT = { CLEAN: 0, VERDICT: 1, USAGE: 2, UNREAD: 3 } as const;

/** Where the in-memory tree lives; nothing is read from it on disk. */
const FIXTURE_ROOT = "/fixture-repo";
const FIXTURE_HOME = "/fixture-home";

const CANON = "docs/canon.md";
const RULE = ".claude/rules/record.md";
const RECORD = "docs/record.md";
const GOVERNED = "deps/workspace.yaml";
const LOCAL = "CLAUDE.local.md";
const LIVE_GLOB = "deps/*.yaml";
const EMPTY_GLOB = "patches/**";
const EMPTY_REASON = "no patch exists in the fixture";
const OWED_BY = "PLAN-9 T3";
const TARGET_GAP = 10;
/** A file a case loads by one more route, beside the default context. */
const EXTRA = "docs/extra.md";
const EXTRA_TEXT = "# Extra\n\nOne more rule.\n";
/** A rule a case adds beside the record's rule. */
const PROBE = ".claude/rules/probe.md";
const PROBE_BODY = "A rule every session would follow.\n";

const CLAUDE_TEXT = `# Fixture instructions\n\nA rule every session follows.\n\n@${CANON}\n`;
const CANON_TEXT = "# Canon\n\nAnother rule every session follows.\n";
const RECORD_TEXT = "# Record\n\n| row | history |\n| --- | --- |\n";
const GOVERNED_TEXT = "packages: []\n";
const RULE_BODY = `Search \`${RECORD}\` as a file before a change, and record the change there.`;

type Tree = Readonly<Record<string, string>>;

const byteLength = (text: string): number => Buffer.byteLength(text, "utf8");

/** The bytes of the given files of a tree. */
const bytesOf = (tree: Tree, files: readonly string[]): number =>
  files.reduce((sum, file) => sum + byteLength(tree[file] ?? ""), 0);

/** The bytes of the default auto-loaded set: `CLAUDE.md` and the canon it imports. */
const CONTEXT_BYTES = byteLength(CLAUDE_TEXT) + byteLength(CANON_TEXT);
const TARGET = CONTEXT_BYTES - TARGET_GAP;

/** A rule file: front matter with the given `paths:` lines, then its body. */
const makeRule = (
  pathsLines: readonly string[] = ["paths:", `  - "${LIVE_GLOB}"`, `  - "${EMPTY_GLOB}"`],
  body: string = RULE_BODY
): string => ["---", ...pathsLines, "---", "", body, ""].join("\n");

/** The default tree, with entries replaced or added. */
const makeTree = (overrides: Tree = {}): Tree => ({
  "CLAUDE.md": CLAUDE_TEXT,
  [CANON]: CANON_TEXT,
  [RULE]: makeRule(),
  [RECORD]: RECORD_TEXT,
  [GOVERNED]: GOVERNED_TEXT,
  ...overrides,
});

const without = (tree: Tree, ...files: readonly string[]): Tree =>
  Object.fromEntries(Object.entries(tree).filter(([file]) => !files.includes(file)));

interface RecordEntry {
  readonly rule: string;
  readonly document: string;
  readonly emptyGlobs?: Readonly<Record<string, string>>;
}

interface Budget {
  readonly bytes: number;
  readonly target: number;
  readonly targetOwedBy?: string;
}

interface Manifest {
  readonly version: number;
  readonly tracked: readonly string[];
  readonly local: readonly string[];
  readonly records: readonly RecordEntry[];
  /** Partial, so a case can leave a field out. */
  readonly budget: Partial<Budget>;
}

const makeRecord = (overrides: Partial<RecordEntry> = {}): RecordEntry => ({
  rule: RULE,
  document: RECORD,
  emptyGlobs: { [EMPTY_GLOB]: EMPTY_REASON },
  ...overrides,
});

const makeBudget = (overrides: Partial<Budget> = {}): Budget => ({
  bytes: CONTEXT_BYTES,
  target: TARGET,
  targetOwedBy: OWED_BY,
  ...overrides,
});

const makeManifest = (overrides: Partial<Manifest> = {}): Manifest => ({
  version: 1,
  tracked: ["CLAUDE.md", CANON],
  local: [LOCAL],
  records: [makeRecord()],
  budget: makeBudget(),
  ...overrides,
});

const budgetWithout = (key: keyof Budget, overrides: Partial<Budget> = {}): Partial<Budget> =>
  Object.fromEntries(Object.entries(makeBudget(overrides)).filter(([name]) => name !== key));

interface Scenario {
  readonly tree?: Tree;
  readonly manifest?: Manifest | string;
  /** Git's listing; defaults to every file of the tree. */
  readonly tracked?: readonly string[];
  /** The paths git's listing records as a symbolic link or a submodule. */
  readonly links?: readonly string[];
  /** Files the reader fails on, as an unreadable file would. */
  readonly unreadable?: readonly string[];
  /** Files outside the repository, by absolute path. */
  readonly external?: Readonly<Record<string, string>>;
}

const reader =
  (tree: Tree, unreadable: readonly string[], external: Readonly<Record<string, string>>) =>
  (absolutePath: string): FileRead => {
    const relative = path.posix.relative(FIXTURE_ROOT, absolutePath);
    // An unreadable entry is also an unreadable directory: every path below it fails the same way.
    if (unreadable.some((entry) => relative === entry || relative.startsWith(`${entry}/`))) {
      return { kind: "error", message: `EACCES: permission denied, open '${absolutePath}'` };
    }
    const text = tree[relative] ?? external[absolutePath];
    return text === undefined ? { kind: "absent" } : { kind: "file", buffer: Buffer.from(text) };
  };

const run = (scenario: Scenario = {}): Verdict => {
  const tree = scenario.tree ?? makeTree();
  const manifest = scenario.manifest ?? makeManifest();
  return evaluate({
    root: FIXTURE_ROOT,
    manifestText: typeof manifest === "string" ? manifest : JSON.stringify(manifest, null, 2),
    tracked: scenario.tracked ?? Object.keys(tree),
    links: scenario.links ?? [],
    readFile: reader(tree, scenario.unreadable ?? [], scenario.external ?? {}),
    homeDir: FIXTURE_HOME,
  });
};

/** Asserts a verdict of exactly one violation holding each fragment. */
const expectOneViolation = (verdict: Verdict, ...fragments: readonly string[]): void => {
  expect(verdict.unread).toEqual([]);
  expect(verdict.exitCode).toBe(EXIT.VERDICT);
  expect(verdict.violations).toHaveLength(1);
  for (const fragment of fragments) expect(verdict.violations[0]).toContain(fragment);
};

/** Asserts a verdict holding a violation with every fragment, among others. */
const expectViolation = (verdict: Verdict, ...fragments: readonly string[]): void => {
  expect(verdict.exitCode).toBe(EXIT.VERDICT);
  const match = verdict.violations.find((violation) =>
    fragments.every((fragment) => violation.includes(fragment))
  );
  expect(
    match,
    `no violation holds ${fragments.join(" + ")} among:\n${verdict.violations.join("\n")}`
  ).toBeDefined();
};

const expectUnread = (verdict: Verdict, ...fragments: readonly string[]): void => {
  expect(verdict.exitCode).toBe(EXIT.UNREAD);
  expect(verdict.unread.length).toBeGreaterThan(0);
  for (const fragment of fragments) expect(verdict.unread.join("\n")).toContain(fragment);
};

/** The summary of a clean default tree. */
const cleanSummary = (bytes: number, budget: number): string =>
  `2 auto-loaded files, ${String(bytes)} bytes of a budget of ${String(budget)} ` +
  `(${String(budget - TARGET)} above the target of ${String(TARGET)} owed by ${OWED_BY}); ` +
  "1 record, 2 globs (1 empty by entry); 0 violations";

describe("instruction-context gate", () => {
  describe("a clean context", () => {
    it("derives CLAUDE.md and its import, and reports the bytes against the budget and the target", () => {
      const verdict = run();

      expect(verdict.unread).toEqual([]);
      expect(verdict.violations).toEqual([]);
      expect(verdict.exitCode).toBe(EXIT.CLEAN);
      expect(verdict.measured).toEqual({ files: ["CLAUDE.md", CANON], bytes: CONTEXT_BYTES });
      expect(verdict.summary).toBe(cleanSummary(CONTEXT_BYTES, CONTEXT_BYTES));
    });

    it("does not count a token that names a directory or no file", () => {
      const claude = `${CLAUDE_TEXT}See @deps for the folder, @nowhere.md and @ alone.\n`;

      const verdict = run({
        tree: makeTree({ "CLAUDE.md": claude }),
        manifest: makeManifest({
          budget: makeBudget({ bytes: byteLength(claude) + byteLength(CANON_TEXT) }),
        }),
      });

      expect(verdict.violations).toEqual([]);
      expect(verdict.exitCode).toBe(EXIT.CLEAN);
      expect(verdict.measured?.files).toEqual(["CLAUDE.md", CANON]);
    });

    it("resolves an import from the directory of the file that holds it, and reads an escaped space", () => {
      const nested = "docs/nested/part.md";
      const spaced = "docs/My Notes.md";
      const tree = makeTree({
        [CANON]: `${CANON_TEXT}\n@nested/part.md\n@My\\ Notes.md\n`,
        [nested]: "# Part\n",
        [spaced]: "# Notes\n",
      });
      const files = ["CLAUDE.md", CANON, nested, spaced];
      const bytes = files.reduce((sum, file) => sum + byteLength(tree[file] ?? ""), 0);

      const verdict = run({
        tree,
        manifest: makeManifest({ tracked: files, budget: makeBudget({ bytes }) }),
      });

      expect(verdict.violations).toEqual([]);
      expect(verdict.measured).toEqual({ files: [...files].sort(), bytes });
    });

    it("follows imports at any depth, past the four hops the harness follows", () => {
      const chain = [
        "docs/hop1.md",
        "docs/hop2.md",
        "docs/hop3.md",
        "docs/hop4.md",
        "docs/hop5.md",
      ];
      const tree = makeTree({
        "CLAUDE.md": `${CLAUDE_TEXT}@${chain[0] ?? ""}\n`,
        ...Object.fromEntries(
          chain.map((file, index) => [
            file,
            `# Hop ${String(index + 1)}\n@${path.posix.basename(chain[index + 1] ?? "none.md")}\n`,
          ])
        ),
      });
      const loaded = ["CLAUDE.md", CANON, ...chain];
      const bytes = bytesOf(tree, loaded);

      const verdict = run({
        tree,
        manifest: makeManifest({ tracked: loaded, budget: makeBudget({ bytes }) }),
      });

      expect(verdict.violations).toEqual([]);
      expect(verdict.measured?.files).toEqual([...loaded].sort());
    });

    it("loads a rule without paths: and the imports of every rule, but not a path-scoped rule's body", () => {
      const always = ".claude/rules/always.md";
      const scopedImport = "docs/scoped-import.md";
      const scoped = ".claude/rules/scoped.md";
      const tree = makeTree({
        [always]: "Every session follows this rule.\n",
        [scoped]: makeRule(["paths:", `  - "${LIVE_GLOB}"`], "@../../docs/scoped-import.md\n"),
        [scopedImport]: "# Imported by a scoped rule\n",
      });
      const loaded = [always, "CLAUDE.md", CANON, scopedImport];
      const bytes = loaded.reduce((sum, file) => sum + byteLength(tree[file] ?? ""), 0);

      const verdict = run({
        tree,
        manifest: makeManifest({ tracked: loaded, budget: makeBudget({ bytes }) }),
      });

      expect(verdict.violations).toEqual([]);
      expect(verdict.measured?.files).toEqual([...loaded].sort());
    });

    it("states the target as met once the budget is at or under it and no item is owed", () => {
      const verdict = run({
        manifest: makeManifest({
          budget: budgetWithout("targetOwedBy", { target: CONTEXT_BYTES }),
        }),
      });

      expect(verdict.violations).toEqual([]);
      expect(verdict.summary).toContain(`(within the target of ${String(CONTEXT_BYTES)})`);
    });
  });

  describe("imports: every @ token is counted wherever it is written, so none the harness loads is missed", () => {
    const placements: readonly (readonly [string, string])[] = [
      ["inside a fenced block", `\`\`\`\n@${EXTRA}\n\`\`\``],
      ["inside a code span", `Mention \`@${EXTRA}\` here.`],
      ["right after inline markup", `See **this**@${EXTRA} here.`],
      ["inside escaped backticks", `See \\\`@${EXTRA}\\\` here.`],
      ["right before closing markup", `See **@${EXTRA}** here.`],
      ["as the text of a link", `See [@${EXTRA}](https://example.com) here.`],
      ["inside quotes", `"@${EXTRA}" in quotes.`],
      ["after a word", `Write to someone@${EXTRA} today.`],
      ["inside an HTML comment", `<!-- @${EXTRA} -->`],
      ["with a fragment, which the harness cuts at its first #", `See @${EXTRA}#section here.`],
    ];

    it.each(placements)("counts an import written %s", (_placement, line) => {
      const claude = `${CLAUDE_TEXT}${line}\n`;
      const tree = makeTree({ "CLAUDE.md": claude, [EXTRA]: EXTRA_TEXT });
      const files = ["CLAUDE.md", CANON, EXTRA];
      const bytes = bytesOf(tree, files);

      const verdict = run({
        tree,
        manifest: makeManifest({ tracked: files, budget: makeBudget({ bytes }) }),
      });

      expect(verdict.violations).toEqual([]);
      expect(verdict.exitCode).toBe(EXIT.CLEAN);
      expect(verdict.measured).toEqual({ files: [...files].sort(), bytes });
    });

    it("refuses an import with a fragment that the tracked list does not name", () => {
      const claude = `${CLAUDE_TEXT}@${EXTRA}#section\n`;
      const tree = makeTree({ "CLAUDE.md": claude, [EXTRA]: EXTRA_TEXT });

      expectOneViolation(
        run({
          tree,
          manifest: makeManifest({
            budget: makeBudget({ bytes: bytesOf(tree, ["CLAUDE.md", CANON, EXTRA]) }),
          }),
        }),
        "M1:",
        `${EXTRA} is auto-loaded (imported by CLAUDE.md) and is not in the manifest's tracked list`
      );
    });
  });

  describe("entry files: each one the harness reads from the project root is derived when git tracks it", () => {
    it.each([[".claude/CLAUDE.md"], ["CLAUDE.local.md"], ["AGENTS.md"], [".claude/AGENTS.md"]])(
      "derives %s and its imports when git tracks it",
      (entry) => {
        const text = `# Entry\n@${path.posix.relative(path.posix.dirname(entry), EXTRA)}\n`;
        const tree = makeTree({ [entry]: text, [EXTRA]: EXTRA_TEXT });
        const files = ["CLAUDE.md", CANON, entry, EXTRA];
        const bytes = bytesOf(tree, files);

        const verdict = run({
          tree,
          manifest: makeManifest({ tracked: files, local: [], budget: makeBudget({ bytes }) }),
        });

        expect(verdict.violations).toEqual([]);
        expect(verdict.exitCode).toBe(EXIT.CLEAN);
        expect(verdict.measured).toEqual({ files: [...files].sort(), bytes });
      }
    );

    it("refuses a tracked .claude/CLAUDE.md that the tracked list does not name", () => {
      const entry = ".claude/CLAUDE.md";
      const tree = makeTree({ [entry]: "# Alternate project file\n" });

      expectOneViolation(
        run({
          tree,
          manifest: makeManifest({
            local: [],
            budget: makeBudget({ bytes: bytesOf(tree, ["CLAUDE.md", CANON, entry]) }),
          }),
        }),
        "M1:",
        `${entry} is auto-loaded (an entry file the harness reads from the project root)`
      );
    });

    it("does not derive an entry file git does not track, which only one checkout holds", () => {
      const verdict = run({
        tree: makeTree({ ".claude/CLAUDE.md": "# Local\n", [LOCAL]: "# Local\n" }),
        tracked: Object.keys(makeTree()),
      });

      expect(verdict.violations).toEqual([]);
      expect(verdict.measured?.files).toEqual(["CLAUDE.md", CANON]);
    });
  });

  describe("rules: a rule counts as path-scoped only when its front matter proves it", () => {
    const unproven: readonly (readonly [string, string])[] = [
      ["no front matter", ""],
      ["paths: null", "---\npaths: null\n---\n"],
      ['paths: "**" as one quoted string', '---\npaths: "**"\n---\n'],
      ["paths: ~", "---\npaths: ~\n---\n"],
      ["a paths: that is neither a list nor a string", "---\npaths: 5\n---\n"],
      [
        "globs that are all ** once a trailing /** is cut",
        '---\npaths:\n  - "**"\n  - "**/**"\n---\n',
      ],
      ["an unquoted glob, which YAML reads as an alias", "---\npaths:\n  - **/*.ts\n---\n"],
      ["an unclosed flow list", "---\npaths: [src/**/*.ts\n---\n"],
      ["a flow list", `---\npaths: ["${LIVE_GLOB}"]\n---\n`],
      ["a comma-separated string", `---\npaths: "${LIVE_GLOB}, ${EMPTY_GLOB}"\n---\n`],
      ["a plain unquoted glob", `---\npaths:\n  - ${LIVE_GLOB}\n---\n`],
      ["only a brace list", '---\npaths:\n  - "{**,**/**}"\n---\n'],
      ["another key beside paths:", `---\ndescription: x\npaths:\n  - "${LIVE_GLOB}"\n---\n`],
      ["text after its closing ---", `---\npaths:\n  - "${LIVE_GLOB}"\n--- x\n`],
      ["Windows line endings", `---\r\npaths:\r\n  - "${LIVE_GLOB}"\r\n---\r\n`],
      ["a byte-order mark", `\uFEFF---\npaths:\n  - "${LIVE_GLOB}"\n---\n`],
    ];

    it.each(unproven)("counts a rule with %s as loaded at session start", (_form, front) => {
      const rule = `${front}${PROBE_BODY}`;
      const tree = makeTree({ [PROBE]: rule });

      const verdict = run({
        tree,
        manifest: makeManifest({ budget: makeBudget({ bytes: CONTEXT_BYTES + byteLength(rule) }) }),
      });

      expectOneViolation(
        verdict,
        "M1:",
        `${PROBE} is auto-loaded (a rule whose front matter does not prove it path-scoped)`
      );
      expect(verdict.measured).toEqual({
        files: [PROBE, "CLAUDE.md", CANON],
        bytes: CONTEXT_BYTES + byteLength(rule),
      });
    });

    it.each([
      ["a block list with blank lines", `---\n\npaths:\n\n  - "${LIVE_GLOB}"\n---\n`],
      ["a ** glob beside a scoping one", `---\npaths:\n  - "**"\n  - "${LIVE_GLOB}"\n---\n`],
      ["a brace list beside a scoping one", `---\npaths:\n  - "{a,b}/**"\n  - "deps/**"\n---\n`],
      ["a glob ending in /**", '---\npaths:\n  - "deps/**"\n---\n'],
    ])("reads a rule with %s as path-scoped", (_form, front) => {
      const verdict = run({ tree: makeTree({ [PROBE]: `${front}${PROBE_BODY}` }) });

      expect(verdict.violations).toEqual([]);
      expect(verdict.exitCode).toBe(EXIT.CLEAN);
      expect(verdict.measured?.files).toEqual(["CLAUDE.md", CANON]);
    });
  });

  describe("L1: no symbolic link or submodule hides rules from git's listing", () => {
    it.each([
      [".claude/rules/shared"],
      [".claude/rules/linked.md"],
      [".claude/rules"],
      [".claude"],
    ])(
      "refuses %s tracked as a link, whose rules the harness reads and the gate cannot see",
      (link) => {
        expectOneViolation(
          run({ tracked: [...Object.keys(makeTree()), link], links: [link] }),
          "L1:",
          `git tracks ${link} as a symbolic link or a submodule`,
          "replace the link with the files it points to"
        );
      }
    );

    it("accepts a link outside .claude/rules/", () => {
      const verdict = run({
        tracked: [...Object.keys(makeTree()), "docs/linked"],
        links: ["docs/linked"],
      });

      expect(verdict.violations).toEqual([]);
      expect(verdict.exitCode).toBe(EXIT.CLEAN);
    });
  });

  describe("M1: the tracked list equals the derived set", () => {
    it("refuses an auto-loaded file the tracked list does not name", () => {
      expectOneViolation(
        run({ manifest: makeManifest({ tracked: ["CLAUDE.md"] }) }),
        "M1:",
        `${CANON} is auto-loaded (imported by CLAUDE.md)`,
        "not in the manifest's tracked list"
      );
    });

    it("refuses a tracked entry that nothing loads at session start", () => {
      expectOneViolation(
        run({ manifest: makeManifest({ tracked: ["CLAUDE.md", CANON, GOVERNED] }) }),
        "M1:",
        `${GOVERNED} is in the manifest's tracked list and nothing loads it at session start`
      );
    });

    it("refuses a tracked entry git does not track", () => {
      expectOneViolation(
        run({ tracked: Object.keys(without(makeTree(), CANON)) }),
        "M1:",
        `${CANON} is in the manifest's tracked list and git does not track it`
      );
    });

    it("refuses a path listed twice in tracked", () => {
      expectOneViolation(
        run({ manifest: makeManifest({ tracked: ["CLAUDE.md", CANON, CANON] }) }),
        "M1:",
        `${CANON} is listed twice in the manifest's tracked list: delete the repeated entry`
      );
    });
  });

  describe("M2: a local entry is neither tracked nor auto-loaded by the tracked set", () => {
    it("refuses a local entry git tracks", () => {
      expectOneViolation(
        run({ manifest: makeManifest({ local: [LOCAL, GOVERNED] }) }),
        "M2:",
        `${GOVERNED} is in the manifest's local list and git tracks it`
      );
    });

    it("refuses a path listed twice in local", () => {
      expectOneViolation(
        run({ manifest: makeManifest({ local: [LOCAL, LOCAL] }) }),
        "M2:",
        `${LOCAL} is listed twice in the manifest's local list: delete the repeated entry`
      );
    });

    it("refuses a local entry the tracked set loads", () => {
      const tree = makeTree({ "CLAUDE.md": `${CLAUDE_TEXT}@${LOCAL}\n`, [LOCAL]: "# Local\n" });
      const bytes =
        byteLength(tree["CLAUDE.md"] ?? "") + byteLength(CANON_TEXT) + byteLength("# Local\n");

      const verdict = run({
        tree,
        tracked: Object.keys(without(tree, LOCAL)),
        manifest: makeManifest({ budget: makeBudget({ bytes }) }),
      });

      expectViolation(
        verdict,
        "M2:",
        `${LOCAL} is in the manifest's local list and is auto-loaded`
      );
    });
  });

  describe("A1: every import resolves inside the repository", () => {
    it("refuses an import that resolves to a file outside the repository", () => {
      const external = `${FIXTURE_HOME}/.claude/notes.md`;

      const verdict = run({
        tree: makeTree({ "CLAUDE.md": `${CLAUDE_TEXT}@~/.claude/notes.md\n` }),
        external: { [external]: "# Notes\n" },
        manifest: makeManifest({
          budget: makeBudget({
            bytes: byteLength(`${CLAUDE_TEXT}@~/.claude/notes.md\n`) + byteLength(CANON_TEXT),
          }),
        }),
      });

      expectOneViolation(
        verdict,
        "A1:",
        `CLAUDE.md imports ~/.claude/notes.md, which resolves to ${external}, outside the repository`
      );
    });
  });

  describe("B1 to B3: the byte budget", () => {
    it("refuses a context one byte above its budget, naming the growth", () => {
      expectOneViolation(
        run({ manifest: makeManifest({ budget: makeBudget({ bytes: CONTEXT_BYTES - 1 }) }) }),
        "B1:",
        `is ${String(CONTEXT_BYTES)} bytes, above its budget of ${String(CONTEXT_BYTES - 1)}`,
        "grew by 1 byte."
      );
    });

    it("refuses a budget more than the slack above the context, naming the figure to lower it to", () => {
      expectOneViolation(
        run({
          manifest: makeManifest({
            budget: makeBudget({ bytes: CONTEXT_BYTES + BUDGET_SLACK + 1 }),
          }),
        }),
        "B2:",
        `${String(BUDGET_SLACK + 1)} bytes above the context's ${String(CONTEXT_BYTES)}`,
        `lower it to ${String(CONTEXT_BYTES)}`
      );
    });

    it("accepts a budget exactly the slack above the context", () => {
      const verdict = run({
        manifest: makeManifest({ budget: makeBudget({ bytes: CONTEXT_BYTES + BUDGET_SLACK }) }),
      });

      expect(BUDGET_SLACK).toBe(1024);
      expect(verdict.violations).toEqual([]);
      expect(verdict.exitCode).toBe(EXIT.CLEAN);
    });

    it("refuses a budget above the target when no plan item owes the target", () => {
      expectOneViolation(
        run({ manifest: makeManifest({ budget: budgetWithout("targetOwedBy") }) }),
        "B3:",
        `budget.bytes ${String(CONTEXT_BYTES)} is above the target of ${String(TARGET)}`,
        "budget.targetOwedBy names no plan item"
      );
    });

    it("refuses an owed target once the context meets it", () => {
      expectOneViolation(
        run({ manifest: makeManifest({ budget: makeBudget({ target: CONTEXT_BYTES }) }) }),
        "B3:",
        `meets the target of ${String(CONTEXT_BYTES)}`,
        "delete budget.targetOwedBy"
      );
    });

    it("refuses a targetOwedBy that does not start with a plan item id", () => {
      expectOneViolation(
        run({ manifest: makeManifest({ budget: makeBudget({ targetOwedBy: "later" }) }) }),
        "B3:",
        'budget.targetOwedBy "later" does not start with a plan item id'
      );
    });
  });

  describe("R1: each record's rule is a live path-scoped rule that names its document", () => {
    it("refuses a rule outside .claude/rules/", () => {
      const moved = "docs/rules/record.md";

      expectOneViolation(
        run({
          tree: makeTree({ [moved]: makeRule() }),
          manifest: makeManifest({ records: [makeRecord({ rule: moved })] }),
        }),
        "R1:",
        `the record rule ${moved} is not a Markdown file under .claude/rules/`
      );
    });

    it("refuses a rule git does not track, saying what to do", () => {
      expectOneViolation(
        run({ tracked: Object.keys(without(makeTree(), RULE)) }),
        "R1:",
        `the record rule ${RULE} is not tracked by git: commit it, or correct the record's rule`
      );
    });

    it("refuses a rule whose front matter does not prove it path-scoped, which then loads in every session", () => {
      const tree = makeTree({ [RULE]: `${RULE_BODY}\n` });

      const verdict = run({ tree });

      expectViolation(
        verdict,
        "R1:",
        `the record rule ${RULE} does not prove it is path-scoped`,
        'open it with "---", "paths:" and one `  - "<glob>"` line per glob'
      );
      expectViolation(
        verdict,
        "M1:",
        `${RULE} is auto-loaded (a rule whose front matter does not prove it path-scoped)`
      );
    });

    it("refuses a rule that imports a file", () => {
      const tree = makeTree({ [RULE]: makeRule(undefined, `${RULE_BODY}\n@../../${RECORD}`) });

      expectViolation(run({ tree }), "R1:", `the record rule ${RULE} imports ${RECORD}`);
    });

    it("refuses a rule that does not name its document", () => {
      expectOneViolation(
        run({ tree: makeTree({ [RULE]: makeRule(undefined, "Search the record first.") }) }),
        "R1:",
        `the record rule ${RULE} does not name its document ${RECORD}`
      );
    });
  });

  describe("R2: each record is tracked and never auto-loaded", () => {
    it("refuses a record git does not track, saying what to do", () => {
      expectOneViolation(
        run({ tracked: Object.keys(without(makeTree(), RECORD)) }),
        "R2:",
        `the record ${RECORD} is not tracked by git: commit it, or correct the record's document`
      );
    });

    it("refuses a record the context imports, beside the growth it causes", () => {
      const claude = `${CLAUDE_TEXT}@${RECORD}\n`;

      const verdict = run({ tree: makeTree({ "CLAUDE.md": claude }) });

      expectViolation(
        verdict,
        "R2:",
        `the record ${RECORD} is auto-loaded (imported by CLAUDE.md)`
      );
      expectViolation(verdict, "M1:", `${RECORD} is auto-loaded (imported by CLAUDE.md)`);
      expectViolation(verdict, "B1:", "grew by");
    });
  });

  describe("R3: each glob of a record's rule matches a tracked file, or says why not", () => {
    it("refuses a glob that matches no tracked file and no entry explains", () => {
      const dead = "nonexistent/**";
      const tree = makeTree({
        [RULE]: makeRule(["paths:", `  - "${LIVE_GLOB}"`, `  - "${EMPTY_GLOB}"`, `  - "${dead}"`]),
      });

      expectOneViolation(
        run({ tree }),
        "R3:",
        `the glob "${dead}" of ${RULE} matches no tracked file`
      );
    });

    it("matches a glob with no slash at any depth, as the harness does", () => {
      const tree = makeTree({
        [RULE]: makeRule([
          "paths:",
          `  - "${path.posix.basename(GOVERNED)}"`,
          `  - "${EMPTY_GLOB}"`,
        ]),
      });

      const verdict = run({ tree });

      expect(verdict.violations).toEqual([]);
      expect(verdict.exitCode).toBe(EXIT.CLEAN);
    });

    it("anchors a glob with a leading slash to the root, as the harness does", () => {
      const anchored = makeTree({
        [RULE]: makeRule(["paths:", `  - "/${GOVERNED}"`, `  - "${EMPTY_GLOB}"`]),
      });
      const nested = "/workspace.yaml";
      const unmatched = makeTree({
        [RULE]: makeRule(["paths:", `  - "${nested}"`, `  - "${EMPTY_GLOB}"`]),
      });

      expect(run({ tree: anchored }).violations).toEqual([]);
      expectOneViolation(
        run({ tree: unmatched }),
        "R3:",
        `the glob "${nested}" of ${RULE} matches no tracked file`
      );
    });

    it("refuses an emptyGlobs entry whose glob matches a tracked file", () => {
      const patch = "patches/fixture.patch";

      expectOneViolation(
        run({ tree: makeTree({ [patch]: "diff\n" }) }),
        "R3:",
        `emptyGlobs names "${EMPTY_GLOB}", which matches 1 tracked file (${patch}): delete it`
      );
    });

    it("refuses an emptyGlobs entry for a glob the rule does not list", () => {
      const stale = "gone/**";

      expectOneViolation(
        run({
          manifest: makeManifest({
            records: [
              makeRecord({ emptyGlobs: { [EMPTY_GLOB]: EMPTY_REASON, [stale]: EMPTY_REASON } }),
            ],
          }),
        }),
        "R3:",
        `emptyGlobs names "${stale}", which ${RULE} does not list: delete it`
      );
    });

    it("refuses an emptyGlobs entry with no reason", () => {
      expectOneViolation(
        run({
          manifest: makeManifest({ records: [makeRecord({ emptyGlobs: { [EMPTY_GLOB]: " " } })] }),
        }),
        "R3:",
        `emptyGlobs gives "${EMPTY_GLOB}" no reason`
      );
    });
  });

  describe("fail-closed: an input the gate cannot read exits 3", () => {
    it("refuses a manifest that is not JSON", () => {
      expectUnread(run({ manifest: "{ not json" }), `${MANIFEST} is not JSON`);
    });

    const malformed: readonly (readonly [string, unknown, string])[] = [
      ["an unknown key", { ...makeManifest(), extra: true }, "unknown key extra"],
      ["a version other than 1", makeManifest({ version: 2 }), "version must be 1"],
      ["an empty tracked list", makeManifest({ tracked: [] }), "tracked must be a non-empty array"],
      ["a path that climbs out", makeManifest({ tracked: ["../CLAUDE.md"] }), "tracked must be"],
      ["a local list that is not an array", { ...makeManifest(), local: "x" }, "local must be"],
      [
        "a record with an unknown key",
        { ...makeManifest(), records: [{ ...makeRecord(), why: "x" }] },
        "records[0]",
      ],
      [
        "a budget that is not a positive integer",
        makeManifest({ budget: makeBudget({ bytes: 0 }) }),
        "budget.bytes",
      ],
      [
        "a budget with no target",
        makeManifest({ budget: budgetWithout("target") }),
        "budget.target",
      ],
      [
        "an emptyGlobs reason that is not a string",
        { ...makeManifest(), records: [{ ...makeRecord(), emptyGlobs: { [EMPTY_GLOB]: 1 } }] },
        "emptyGlobs",
      ],
      [
        "a budget with an unknown key",
        { ...makeManifest(), budget: { ...makeBudget(), cap: 1 } },
        "budget holds the unknown key cap",
      ],
      [
        "a targetOwedBy that is not a string",
        { ...makeManifest(), budget: { ...makeBudget(), targetOwedBy: 3 } },
        "budget.targetOwedBy must be a string when present",
      ],
    ];

    it.each(malformed)("refuses a manifest with %s", (_name, manifest, fragment) => {
      expectUnread(run({ manifest: JSON.stringify(manifest) }), MANIFEST, fragment);
    });

    it("refuses a tree with no CLAUDE.md, rather than a context derived from nothing", () => {
      expectUnread(run({ tree: without(makeTree(), "CLAUDE.md") }), "CLAUDE.md does not exist");
    });

    it.each([["CLAUDE.md"], [CANON], [RULE]])("refuses %s when it cannot be read", (file) => {
      expectUnread(run({ unreadable: [file] }), `${file} could not be read`);
    });

    it.each([
      ["a record's rule", RULE, makeTree()],
      ["a rule", PROBE, makeTree({ [PROBE]: PROBE_BODY })],
      ["an entry file", ".claude/CLAUDE.md", makeTree({ ".claude/CLAUDE.md": "# Entry\n" })],
      ["an import", CANON, makeTree()],
    ])(
      "refuses %s git tracks and the checkout lacks, whose bytes it cannot count",
      (_kind, file, tree) => {
        expectUnread(
          run({ tree: without(tree, file), tracked: Object.keys(tree) }),
          `${file} is tracked by git and missing from the checkout`,
          "restore it with git checkout, or delete it with git rm"
        );
      }
    );

    it("refuses an unreadable import once per token, not once per prefix of it", () => {
      const claude = `${CLAUDE_TEXT}@locked/deep/rule.md\n`;

      const verdict = run({ tree: makeTree({ "CLAUDE.md": claude }), unreadable: ["locked"] });

      expect(verdict.exitCode).toBe(EXIT.UNREAD);
      expect(verdict.unread).toEqual([
        `locked could not be read: EACCES: permission denied, open '${FIXTURE_ROOT}/locked'`,
      ]);
    });

    it("exits 3 when an unread input meets a verdict, so a partial read never reads as a verdict", () => {
      const verdict = run({
        unreadable: [CANON],
        manifest: makeManifest({ budget: makeBudget({ bytes: CONTEXT_BYTES - 1 }) }),
      });

      expectUnread(verdict, `${CANON} could not be read`);
    });
  });

  describe("the command", () => {
    let root = "";

    const gitEnvironment = (): NodeJS.ProcessEnv => ({
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
      GIT_CEILING_DIRECTORIES: path.dirname(root),
    });

    const git = (...args: readonly string[]): void => {
      execFileSync("git", args, { cwd: root, env: gitEnvironment(), stdio: "ignore" });
    };

    const writeFile = (file: string, content: string): void => {
      const full = path.join(root, file);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    };

    const manifestText = (manifest: Manifest): string => `${JSON.stringify(manifest, null, 2)}\n`;

    /** Writes the tree and the manifest, and stages the tree, since the gate reads git's listing. */
    const writeRepo = (
      tree: Tree = makeTree(),
      manifest: Manifest | null = makeManifest()
    ): void => {
      git("init", "--quiet");
      for (const [file, content] of Object.entries(tree)) writeFile(file, content);
      if (manifest !== null) writeFile(MANIFEST, manifestText(manifest));
      git("add", "--all");
    };

    const gate = (
      ...args: readonly string[]
    ): { status: number; stdout: string; stderr: string } => {
      const result = spawnSync(process.execPath, [GATE_SCRIPT, ...args], {
        encoding: "utf8",
        env: gitEnvironment(),
        timeout: SPAWN_TIMEOUT,
      });
      return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
    };

    beforeEach(() => {
      root = mkdtempSync(path.join(tmpdir(), "instruction-context-gate-test-"));
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("exits 0 and prints the summary on a clean repository", () => {
      writeRepo();

      const result = gate("--root", root);

      expect(result.stderr).toBe("");
      expect(result.status).toBe(EXIT.CLEAN);
      expect(result.stdout).toBe(
        `instruction-context-gate: ${cleanSummary(CONTEXT_BYTES, CONTEXT_BYTES)}\n`
      );
    });

    it("exits 1 with each violation and the summary on stderr", () => {
      writeRepo(makeTree(), makeManifest({ budget: makeBudget({ bytes: CONTEXT_BYTES - 1 }) }));

      const result = gate("--root", root);

      expect(result.status).toBe(EXIT.VERDICT);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("instruction-context-gate: B1: ");
      expect(result.stderr).toContain("grew by 1 byte.");
      expect(result.stderr).toContain("; 1 violation\n");
    });

    it("exits 3 when the manifest is missing", () => {
      writeRepo(makeTree(), null);

      const result = gate("--root", root);

      expect(result.status).toBe(EXIT.UNREAD);
      expect(result.stderr).toContain(`instruction-context-gate: ${MANIFEST} could not be read`);
    });

    it("exits 3 when git cannot list the root", () => {
      writeFile(MANIFEST, manifestText(makeManifest()));

      const result = gate("--root", root);

      expect(result.status).toBe(EXIT.UNREAD);
      expect(result.stderr).toContain(`instruction-context-gate: git ls-files failed in ${root}`);
    });

    it("exits 3 when git tracks no file", () => {
      git("init", "--quiet");
      writeFile(MANIFEST, manifestText(makeManifest()));

      const result = gate("--root", root);

      expect(result.status).toBe(EXIT.UNREAD);
      expect(result.stderr).toContain("git tracks no file");
    });

    it.each([
      ["an unknown flag", ["--fix"]],
      ["--root with no value", ["--root"]],
      ["--write given twice", ["--write", "--write"]],
    ])("exits 2 on %s", (_name, args) => {
      const result = gate(...args);

      expect(result.status).toBe(EXIT.USAGE);
      expect(result.stderr).toContain(
        "usage: node scripts/testing/instruction-context-gate.mjs [--write] [--root <dir>]"
      );
    });

    it("lowers budget.bytes to the context with --write, keeping every other byte of the manifest", () => {
      const stale = makeManifest({ budget: makeBudget({ bytes: CONTEXT_BYTES + TARGET_GAP }) });
      writeRepo(makeTree(), stale);
      const before = manifestText(stale);

      const result = gate("--root", root, "--write");

      expect(result.status).toBe(EXIT.CLEAN);
      expect(result.stdout).toContain(
        `lowered budget.bytes from ${String(CONTEXT_BYTES + TARGET_GAP)} to ${String(CONTEXT_BYTES)}`
      );
      expect(readFileSync(path.join(root, MANIFEST), "utf8")).toBe(
        before.replace(
          `"bytes": ${String(CONTEXT_BYTES + TARGET_GAP)}`,
          `"bytes": ${String(CONTEXT_BYTES)}`
        )
      );
    });

    it("refuses to raise budget.bytes with --write, and leaves the manifest unchanged", () => {
      const tight = makeManifest({ budget: makeBudget({ bytes: CONTEXT_BYTES - 1 }) });
      writeRepo(makeTree(), tight);

      const result = gate("--root", root, "--write");

      expect(result.status).toBe(EXIT.VERDICT);
      expect(result.stderr).toContain("grew by 1 byte.");
      expect(result.stderr).toContain("--write never raises budget.bytes");
      expect(readFileSync(path.join(root, MANIFEST), "utf8")).toBe(manifestText(tight));
    });

    it("writes nothing with --write when budget.bytes already equals the context", () => {
      writeRepo();
      const before = manifestText(makeManifest());

      const result = gate("--root", root, "--write");

      expect(result.status).toBe(EXIT.CLEAN);
      expect(result.stdout).toContain(
        `instruction-context-gate: budget.bytes already equals the context's ${String(CONTEXT_BYTES)} bytes; nothing to write`
      );
      expect(readFileSync(path.join(root, MANIFEST), "utf8")).toBe(before);
    });

    it("exits 3 with --write when budget.bytes is not written where it can place the figure", () => {
      writeRepo(makeTree(), null);
      const stale = manifestText(
        makeManifest({ budget: makeBudget({ bytes: CONTEXT_BYTES + TARGET_GAP }) })
      ).replace('"bytes":', '"b\\u0079tes":');
      writeFile(MANIFEST, stale);

      const result = gate("--root", root, "--write");

      expect(result.status).toBe(EXIT.UNREAD);
      expect(result.stderr).toContain("so --write cannot place the new figure");
      expect(readFileSync(path.join(root, MANIFEST), "utf8")).toBe(stale);
    });

    it("exits 1 when git tracks a symbolic link under .claude/rules/, naming the link", () => {
      writeRepo(makeTree({ "shared/always.md": "# A rule behind a link\n" }));
      symlinkSync("../../shared", path.join(root, ".claude", "rules", "shared"));
      git("add", "--all");

      const result = gate("--root", root);

      expect(result.status).toBe(EXIT.VERDICT);
      expect(result.stderr).toContain(
        "instruction-context-gate: L1: git tracks .claude/rules/shared as a symbolic link or a submodule"
      );
    });

    it("exits 1 when git tracks a submodule under .claude/rules/, naming it", () => {
      writeRepo();
      // A gitlink entry is what a submodule leaves in the index; its commit need not exist here.
      git("update-index", "--add", "--cacheinfo", `160000,${"a".repeat(40)},.claude/rules/vendor`);

      const result = gate("--root", root);

      expect(result.status).toBe(EXIT.VERDICT);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(
        "instruction-context-gate: L1: git tracks .claude/rules/vendor as a symbolic link or a submodule"
      );
      expect(result.stderr).toContain("; 1 violation\n");
    });

    it("skips an import whose name is too long for any file to have, as the harness does", () => {
      const claude = `${CLAUDE_TEXT}@${"a".repeat(5000)}.md\n`;
      const bytes = byteLength(claude) + byteLength(CANON_TEXT);
      writeRepo(makeTree({ "CLAUDE.md": claude }), makeManifest({ budget: makeBudget({ bytes }) }));

      const result = gate("--root", root);

      expect(result.stderr).toBe("");
      expect(result.status).toBe(EXIT.CLEAN);
      expect(result.stdout).toBe(`instruction-context-gate: ${cleanSummary(bytes, bytes)}\n`);
    });

    it("exits 3 when CLAUDE.md is a directory, saying it is not a regular file", () => {
      writeRepo(without(makeTree(), "CLAUDE.md"));
      writeFile("CLAUDE.md/notes.md", "# Not the entry file\n");
      git("add", "--all");

      const result = gate("--root", root);

      expect(result.status).toBe(EXIT.UNREAD);
      expect(result.stderr).toContain(
        "instruction-context-gate: CLAUDE.md is not a regular file in"
      );
    });
  });
});
