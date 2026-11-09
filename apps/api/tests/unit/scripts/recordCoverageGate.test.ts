/**
 * @file recordCoverageGate.test.ts
 * @description Pins `scripts/testing/record-coverage-gate.mjs`, fitness #54, the gate behind
 *   `pnpm check:record-coverage`: every test block a pull request deletes or rewrites, read from
 *   the base and head `ledger.json`, is moved, a live-tier or no-collector block, a behaviour change by a direct
 *   import of a changed source, or covered by a committed mutation-diff record with the same
 *   hashes and a GAIN, SAFE or BEHAVIOUR-CHANGED verdict; anything else is refused by name. Every
 *   case builds its own git repository in a scratch directory, a base commit and a head commit
 *   carrying fixture ledgers, records and test files, so the suite measures the rule and never
 *   this repository.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, describe, expect, it } from "vitest";

type Outcome = { exitCode: number; lines: string[] };
type Run = { code: number; stdout: string; stderr: string };
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type GateModule = {
  runGate: (input: { root: string; baseRef: string }) => Outcome;
  main: (
    argv: readonly string[],
    seams?: { root?: string; env?: Readonly<Record<string, string | undefined>> }
  ) => Run;
};
type Tree = Readonly<Record<string, string | null>>;
type Row = {
  path: string;
  framework: string;
  collectors: string[];
  blocks: { id: string; bodyHash: string }[];
};
type Hashes = { base: string | null; head: string | null };

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const { runGate, main } = (await import(
  path.join(REPO_ROOT, "scripts/testing/record-coverage-gate.mjs")
)) as GateModule;

const LEDGER = "ledger.json";
const RECORD = "docs/development/testing-refoundation/mutations/slice.record.json";
const TEST = "pkg/tests/a.test.ts";
const MOVED_TO = "pkg/tests/b.test.ts";
const SOURCE = "pkg/src/sub.ts";
const SCRIPT_TEST = "apps/api/tests/unit/scripts/gate.test.ts";
const SCRIPT = "scripts/testing/record-coverage-gate.mjs";
const ONE = `${TEST}::one`;
const TWO = `${TEST}::two`;
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H3 = "3".repeat(64);
const H9 = "9".repeat(64);

let root = "";
let scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  scratch = [];
});

const gitEnvironment = (): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  GIT_CEILING_DIRECTORIES: path.dirname(root),
});
const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: root, env: gitEnvironment(), encoding: "utf8" });

const VITEST = "vitest:pkg/vitest.config.ts";
const INTEGRATION = "node:apps/api/scripts/run-tests.sh#integration";
const LIVE_TIER = "node:apps/api/scripts/run-tests.sh#live";

const row = (
  blocks: Readonly<Record<string, string>>,
  file = TEST,
  collectors: readonly string[] = [VITEST]
): Row => ({
  path: file,
  framework: collectors.some((label) => label.startsWith("vitest:")) ? "vitest" : "node",
  collectors: [...collectors],
  blocks: Object.entries(blocks).map(([title, bodyHash]) => ({
    id: `${file}::${title}`,
    bodyHash,
  })),
});
/** A row of node:test's live tier and a row no collector runs, the population the gate's
 *  `--retire-check` reads on the head ledger. */
const LIVE_ROW = row({}, "pkg/tests/live.test.ts", [LIVE_TIER]);
const QUARANTINED_ROW = row({}, "pkg/tests/quarantined.test.ts", []);
const ledger = (rows: readonly Row[], population: readonly Row[] = []): string =>
  `${JSON.stringify({ version: 1, summary: {}, slices: {}, files: [...rows, ...population] }, null, 2)}\n`;
const testText = (lines = ""): string =>
  `import { describe, expect, it } from "vitest";\n${lines}\ndescribe("s", () => {\n  it("one", () => {\n    expect(1).toBe(1);\n  });\n});\n`;
const caseOf = (
  id: string,
  kind: string,
  verdict: string,
  bodyHash: Hashes
): Record<string, unknown> => ({
  id: `case-${kind}`,
  kind,
  verdict,
  ...(verdict === "UNDECIDED" ? { reason: "base-red-clean" } : {}),
  scope: { base: [TEST], head: [TEST] },
  red: { base: [], head: [] },
  blocks: [{ id, bodyHash }],
});
const record = (cases: readonly Record<string, unknown>[]): string =>
  `${JSON.stringify({ version: 1, head: "worktree", base: "0".repeat(40), cases }, null, 2)}\n`;

const BASE: Tree = {
  [LEDGER]: ledger([row({ one: H1, two: H2 })]),
  [TEST]: testText(),
  [SOURCE]: "export const sub = 1;\n",
};
const DELETED: Tree = { [LEDGER]: ledger([row({ one: H1 })]) };
const REWRITTEN: Tree = { [LEDGER]: ledger([row({ one: H1, two: H3 })]) };

const writeTree = (tree: Tree): void => {
  for (const [file, content] of Object.entries(tree)) {
    const full = path.join(root, file);
    if (content === null) {
      rmSync(full, { force: true });
    } else {
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }
};

/** Commits the base tree, then the head tree over it, and returns the base commit. */
const plant = (head: Tree, base: Tree = BASE): string => {
  root = mkdtempSync(path.join(tmpdir(), "record-coverage-"));
  scratch.push(root);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "suite@example.invalid");
  git("config", "user.name", "suite");
  writeTree(base);
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  const sha = git("rev-parse", "HEAD").trim();
  writeTree(head);
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", "head");
  return sha;
};

const summary = (
  base: string,
  counts: Readonly<Partial<Record<"c" | "m" | "l" | "q" | "b" | "r", number>>>
): string => {
  const { c = 0, m = 0, l = 0, q = 0, b = 0, r = 0 } = counts;
  return (
    `record-coverage-gate: ${c + m + l + q + b + r} bound blocks against ${base} (${base}): ` +
    `${c} covered, ${m} moved, ${l} live, ${q} no-collector, ${b} behaviour change, ${r} refused`
  );
};
const line = (text: string): string => `record-coverage-gate: ${text}`;

describe("record-coverage-gate: covered blocks", () => {
  it("passes a pull request that deletes and rewrites no block", () => {
    const base = plant({ [SOURCE]: "export const sub = 2;\n" });
    expect(runGate({ root, baseRef: base })).toEqual({ exitCode: 0, lines: [summary(base, {})] });
  });

  it("covers a deleted block with a SAFE record whose hashes equal the ledgers", () => {
    const base = plant({
      ...DELETED,
      [RECORD]: record([caseOf(TWO, "deletion", "SAFE", { base: H2, head: null })]),
    });
    expect(runGate({ root, baseRef: base })).toEqual({
      exitCode: 0,
      lines: [summary(base, { c: 1 })],
    });
  });

  it("covers a rewritten block with a GAIN record whose hashes equal the ledgers", () => {
    const base = plant({
      ...REWRITTEN,
      [RECORD]: record([caseOf(TWO, "rewrite", "GAIN", { base: H2, head: H3 })]),
    });
    expect(runGate({ root, baseRef: base })).toEqual({
      exitCode: 0,
      lines: [summary(base, { c: 1 })],
    });
  });

  it.each([
    ["deletion", DELETED, { base: H2, head: null }],
    ["rewrite", REWRITTEN, { base: H2, head: H3 }],
  ] as const)(
    "lists a %s block with a BEHAVIOUR-CHANGED record as a behaviour change, exit 0",
    (kind, tree, hashes) => {
      const base = plant({
        ...tree,
        [RECORD]: record([caseOf(TWO, kind, "BEHAVIOUR-CHANGED", hashes)]),
      });
      expect(runGate({ root, baseRef: base })).toEqual({
        exitCode: 0,
        lines: [
          summary(base, { b: 1 }),
          line(`behaviour change: ${TWO} (${kind}): BEHAVIOUR-CHANGED in ${RECORD}`),
        ],
      });
    }
  );
});

describe("record-coverage-gate: refused blocks", () => {
  it("refuses a deleted block with no record, exit 1, though no mutations directory exists", () => {
    const base = plant(DELETED);
    expect(runGate({ root, baseRef: base })).toEqual({
      exitCode: 1,
      lines: [summary(base, { r: 1 }), line(`refused: ${TWO} (deletion): no-record`)],
    });
  });

  it.each([
    ["the base hash differs", DELETED, "deletion", { base: H9, head: null }],
    ["a deletion records a head hash", DELETED, "deletion", { base: H2, head: H3 }],
    ["the head hash differs", REWRITTEN, "rewrite", { base: H2, head: H9 }],
  ] as const)("refuses a stale record when %s", (_label, tree, kind, hashes) => {
    const verdict = kind === "rewrite" ? "GAIN" : "SAFE";
    const base = plant({ ...tree, [RECORD]: record([caseOf(TWO, kind, verdict, hashes)]) });
    expect(runGate({ root, baseRef: base })).toEqual({
      exitCode: 1,
      lines: [
        summary(base, { r: 1 }),
        line(
          `refused: ${TWO} (${kind}): stale-record (${RECORD}): a bodyHash differs from the ledgers, re-run mutation-diff`
        ),
      ],
    });
  });

  it("refuses a record of the wrong kind", () => {
    const base = plant({
      ...REWRITTEN,
      [RECORD]: record([caseOf(TWO, "deletion", "SAFE", { base: H2, head: H3 })]),
    });
    expect(runGate({ root, baseRef: base })).toEqual({
      exitCode: 1,
      lines: [
        summary(base, { r: 1 }),
        line(`refused: ${TWO} (rewrite): wrong-kind (${RECORD}): recorded as a deletion`),
      ],
    });
  });

  it.each([
    ["rewrite", "NO-GAIN"],
    ["rewrite", "BROKEN"],
    ["rewrite", "UNDECIDED"],
    ["rewrite", "SAFE"],
    ["deletion", "LOST"],
    ["deletion", "VACUOUS"],
    ["deletion", "UNDECIDED"],
    ["deletion", "GAIN"],
  ] as const)("refuses a %s whose record says %s", (kind, verdict) => {
    const tree = kind === "rewrite" ? REWRITTEN : DELETED;
    const hashes = { base: H2, head: kind === "rewrite" ? H3 : null };
    const base = plant({ ...tree, [RECORD]: record([caseOf(TWO, kind, verdict, hashes)]) });
    expect(runGate({ root, baseRef: base })).toEqual({
      exitCode: 1,
      lines: [
        summary(base, { r: 1 }),
        line(`refused: ${TWO} (${kind}): failing-verdict: ${verdict} (${RECORD})`),
      ],
    });
  });

  it.each([
    ["is not JSON", "{\n", "it is not JSON"],
    [
      "holds no cases array",
      `${JSON.stringify({ version: 1, head: "worktree", base: "b" })}\n`,
      '"cases" is not an array',
    ],
    [
      "holds a case with no blocks",
      `${JSON.stringify({ version: 1, head: "worktree", base: "b", cases: [{ id: "x", kind: "rewrite", verdict: "GAIN", scope: { base: [], head: [] }, red: { base: [], head: [] } }] })}\n`,
      'case 1 (x): "blocks" is not a list of { id, bodyHash: { base, head } }',
    ],
  ] as const)("exits 1 on a record that %s, naming it", (_label, text, why) => {
    const base = plant({ [RECORD]: text });
    expect(runGate({ root, baseRef: base })).toEqual({
      exitCode: 1,
      lines: [summary(base, {}), line(`${RECORD} is not a mutation-diff record: ${why}`)],
    });
  });
});

describe("record-coverage-gate: exclusions", () => {
  it("lists a deleted block whose bodyHash reappears under another id as moved", () => {
    const base = plant({
      [LEDGER]: ledger([row({ one: H1 }), row({ two: H2 }, MOVED_TO)]),
    });
    expect(runGate({ root, baseRef: base })).toEqual({
      exitCode: 0,
      lines: [
        summary(base, { m: 1 }),
        line(`moved: ${TWO} (deletion): its bodyHash reappears as ${MOVED_TO}::two`),
      ],
    });
  });

  it("refuses a deleted block whose bodyHash the head holds only under an id the base held too", () => {
    const base = plant(
      { [LEDGER]: ledger([row({ one: H1 }), row({ copy: H2 }, MOVED_TO)]) },
      { ...BASE, [LEDGER]: ledger([row({ one: H1, two: H2 }), row({ copy: H2 }, MOVED_TO)]) }
    );
    expect(runGate({ root, baseRef: base })).toEqual({
      exitCode: 1,
      lines: [summary(base, { r: 1 }), line(`refused: ${TWO} (deletion): no-record`)],
    });
  });

  it("refuses a node:test integration block with no record, exit 1", () => {
    const base = plant(
      { [LEDGER]: ledger([row({ one: H1 }, TEST, [INTEGRATION])]) },
      { ...BASE, [LEDGER]: ledger([row({ one: H1, two: H2 }, TEST, [INTEGRATION])]) }
    );

    expect(runGate({ root, baseRef: base })).toEqual({
      exitCode: 1,
      lines: [summary(base, { r: 1 }), line(`refused: ${TWO} (deletion): no-record`)],
    });
  });

  it.each([
    [
      "live",
      [LIVE_TIER],
      { l: 1 },
      "counted, not refused: a live-tier test needs a running API, which mutation-diff does not start",
    ],
    [
      "no-collector",
      [],
      { q: 1 },
      "counted, not refused: no collector runs it, so mutation-diff cannot",
    ],
  ] as const)("lists a %s block, counted, never refused", (cls, collectors, counts, detail) => {
    const base = plant(
      { [LEDGER]: ledger([row({ one: H1 }, TEST, collectors)]) },
      { ...BASE, [LEDGER]: ledger([row({ one: H1, two: H2 }, TEST, collectors)]) }
    );

    expect(runGate({ root, baseRef: base })).toEqual({
      exitCode: 0,
      lines: [summary(base, counts), line(`${cls}: ${TWO} (deletion): ${detail}`)],
    });
  });

  it.each([
    [
      "live",
      [QUARANTINED_ROW],
      "the live class matches no ledger row: delete it (its tier left the tree)",
    ],
    [
      "no-collector",
      [LIVE_ROW],
      "the no-collector class matches no ledger row: delete it (its files left the quarantine)",
    ],
  ] as const)(
    "fails under --retire-check, exit 1, once the head ledger holds no row of the %s class",
    (_cls, population, problem) => {
      const base = plant({ [LEDGER]: ledger([row({ one: H1, two: H2 })], population) });

      const result = main(["--retire-check"], { root, env: { FITNESS_BASE_REF: base } });

      expect([result.code, result.stdout]).toEqual([1, `${summary(base, {})}\n${line(problem)}\n`]);
    }
  );

  it("passes under --retire-check a head ledger that holds a live-tier row and a row no collector runs", () => {
    const base = plant({
      [LEDGER]: ledger([row({ one: H1, two: H2 })], [LIVE_ROW, QUARANTINED_ROW]),
    });

    const result = main(["--retire-check"], { root, env: { FITNESS_BASE_REF: base } });

    expect([result.code, result.stdout]).toEqual([0, `${summary(base, {})}\n`]);
  });

  it("skips the class check without --retire-check, so a head ledger with neither row passes", () => {
    const base = plant({ [LEDGER]: ledger([row({ one: H1, two: H2 })]) });

    const result = main([], { root, env: { FITNESS_BASE_REF: base } });

    expect([result.code, result.stdout]).toEqual([0, `${summary(base, {})}\n`]);
  });

  it("lists as a behaviour change a deleted file whose base text imports a changed source by a relative specifier", () => {
    const base = plant(
      { [LEDGER]: ledger([]), [TEST]: null, [SOURCE]: "export const sub = 2;\n" },
      { ...BASE, [TEST]: testText('import { sub } from "../src/sub.js";') }
    );
    const detail = `its test imports ${SOURCE}, which this pull request changes`;
    expect(runGate({ root, baseRef: base })).toEqual({
      exitCode: 0,
      lines: [
        summary(base, { b: 2 }),
        line(`behaviour change: ${ONE} (deletion): ${detail}`),
        line(`behaviour change: ${TWO} (deletion): ${detail}`),
      ],
    });
  });

  it("lists as a behaviour change a rewrite whose head text imports a changed source by a path-mapped specifier", () => {
    const base = plant(
      {
        ...REWRITTEN,
        [TEST]: testText('import { sub } from "@pkg/sub";'),
        [SOURCE]: "export const sub = 2;\n",
      },
      {
        ...BASE,
        "tsconfig.base.json": `${JSON.stringify({ compilerOptions: { paths: { "@pkg/*": ["./pkg/src/*"] } } })}\n`,
      }
    );
    expect(runGate({ root, baseRef: base })).toEqual({
      exitCode: 0,
      lines: [
        summary(base, { b: 1 }),
        line(
          `behaviour change: ${TWO} (rewrite): its test imports ${SOURCE}, which this pull request changes`
        ),
      ],
    });
  });

  it("refuses a rewrite whose head text names a changed source only in a string literal", () => {
    const base = plant(
      {
        ...REWRITTEN,
        [TEST]: testText('const subject = path.join(ROOT, "pkg/src/sub.ts");'),
        [SOURCE]: "export const sub = 2;\n",
      },
      BASE
    );
    expect(runGate({ root, baseRef: base })).toEqual({
      exitCode: 1,
      lines: [summary(base, { r: 1 }), line(`refused: ${TWO} (rewrite): no-record`)],
    });
  });

  it("lists as a behaviour change a deleted block whose scripts suite names a changed script in a string literal", () => {
    const base = plant(
      { [LEDGER]: ledger([row({ one: H1 }, SCRIPT_TEST)]), [SCRIPT]: "export const gate = 2;\n" },
      {
        ...BASE,
        [LEDGER]: ledger([row({ one: H1, two: H2 }, SCRIPT_TEST)]),
        [SCRIPT_TEST]: testText(`const gate = path.join(ROOT, "${SCRIPT}");`),
        [SCRIPT]: "export const gate = 1;\n",
      }
    );
    expect(runGate({ root, baseRef: base })).toEqual({
      exitCode: 0,
      lines: [
        summary(base, { b: 1 }),
        line(
          `behaviour change: ${SCRIPT_TEST}::two (deletion): its test names ${SCRIPT} in a string literal, which this pull request changes`
        ),
      ],
    });
  });

  it("refuses a deleted block whose scripts suite names the changed script only in its comments", () => {
    const base = plant(
      { [LEDGER]: ledger([row({ one: H1 }, SCRIPT_TEST)]), [SCRIPT]: "export const gate = 2;\n" },
      {
        ...BASE,
        [LEDGER]: ledger([row({ one: H1, two: H2 }, SCRIPT_TEST)]),
        [SCRIPT_TEST]: testText(
          `/**\n * @file Pins \`${SCRIPT}\`.\n */\n// reads "${SCRIPT}" by path`
        ),
        [SCRIPT]: "export const gate = 1;\n",
      }
    );
    expect(runGate({ root, baseRef: base })).toEqual({
      exitCode: 1,
      lines: [summary(base, { r: 1 }), line(`refused: ${SCRIPT_TEST}::two (deletion): no-record`)],
    });
  });

  it("keeps a literal that holds a comment marker, so a file URL to the changed script still counts", () => {
    const base = plant(
      { [LEDGER]: ledger([row({ one: H1 }, SCRIPT_TEST)]), [SCRIPT]: "export const gate = 2;\n" },
      {
        ...BASE,
        [LEDGER]: ledger([row({ one: H1, two: H2 }, SCRIPT_TEST)]),
        [SCRIPT_TEST]: testText(`const gate = new URL("file:///repo/${SCRIPT}"); // the gate`),
        [SCRIPT]: "export const gate = 1;\n",
      }
    );
    expect(runGate({ root, baseRef: base })).toEqual({
      exitCode: 0,
      lines: [
        summary(base, { b: 1 }),
        line(
          `behaviour change: ${SCRIPT_TEST}::two (deletion): its test names ${SCRIPT} in a string literal, which this pull request changes`
        ),
      ],
    });
  });

  it("refuses that deletion when the script its scripts suite names is unchanged", () => {
    const base = plant(
      { [LEDGER]: ledger([row({ one: H1 }, SCRIPT_TEST)]) },
      {
        ...BASE,
        [LEDGER]: ledger([row({ one: H1, two: H2 }, SCRIPT_TEST)]),
        [SCRIPT_TEST]: testText(`const gate = path.join(ROOT, "${SCRIPT}");`),
        [SCRIPT]: "export const gate = 1;\n",
      }
    );
    expect(runGate({ root, baseRef: base })).toEqual({
      exitCode: 1,
      lines: [summary(base, { r: 1 }), line(`refused: ${SCRIPT_TEST}::two (deletion): no-record`)],
    });
  });

  it("reads a rewrite's imports at the head, so an import only the base held excludes nothing", () => {
    const base = plant(
      { ...REWRITTEN, [TEST]: testText(), [SOURCE]: "export const sub = 2;\n" },
      { ...BASE, [TEST]: testText('import { sub } from "../src/sub.js";') }
    );
    expect(runGate({ root, baseRef: base })).toEqual({
      exitCode: 1,
      lines: [summary(base, { r: 1 }), line(`refused: ${TWO} (rewrite): no-record`)],
    });
  });
});

describe("record-coverage-gate: the environment and the command", () => {
  it("exits 3 when the base does not resolve to a commit", () => {
    plant(DELETED);
    expect(runGate({ root, baseRef: "no-such-ref" })).toEqual({
      exitCode: 3,
      lines: [line("the base no-such-ref does not resolve to a commit: failing closed")],
    });
  });

  it.each([
    ["the base ledger.json is missing", {}, { ...BASE, [LEDGER]: null }, "the base"],
    ["the head ledger.json is not JSON", { [LEDGER]: "{\n" }, BASE, "the head"],
    ["the head ledger.json has no files array", { [LEDGER]: "{}\n" }, BASE, "the head"],
  ] as const)("exits 3 when %s", (_label, head, baseTree, side) => {
    const base = plant(head, baseTree);
    const outcome = runGate({ root, baseRef: base });
    expect(outcome.exitCode).toBe(3);
    expect(outcome.lines).toEqual([
      expect.stringMatching(
        new RegExp(`^record-coverage-gate: ledger\\.json at ${side} .*: failing closed$`)
      ),
    ]);
  });

  it.each([[["extra"]], [["--summary"]], [["--summary", "a.md", "--summary", "b.md"]]] as const)(
    "exits 2 on the usage error %j",
    (argv) => {
      expect(main(argv)).toEqual({
        code: 2,
        stdout: "",
        stderr:
          "usage: node scripts/testing/record-coverage-gate.mjs [--summary <file>] [--retire-check]\n",
      });
    }
  );

  it("prints the lines and writes them to --summary as a Markdown table", () => {
    const base = plant(DELETED);
    const file = path.join(root, "summary.md");
    const result = main(["--summary", file], { root, env: { FITNESS_BASE_REF: base } });
    expect(result).toEqual({
      code: 1,
      stdout: `${summary(base, { r: 1 })}\n${line(`refused: ${TWO} (deletion): no-record`)}\n`,
      stderr: "",
    });
    expect(readFileSync(file, "utf8")).toBe(
      [
        "### Fitness #54: record coverage",
        "",
        summary(base, { r: 1 }).replace("record-coverage-gate: ", ""),
        "",
        "| Class | Block | Kind | Detail |",
        "| --- | --- | --- | --- |",
        `| refused | \`${TWO}\` | deletion | no-record |`,
        "",
      ].join("\n")
    );
  });
});
