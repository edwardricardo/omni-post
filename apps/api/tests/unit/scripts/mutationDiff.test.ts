/**
 * @file mutationDiff.test.ts
 * @description Pins the differential mutation tool. First its pure core,
 *   `scripts/testing/lib/mutation-diff-core.mjs`: the refusal of a case file, the default scope (the
 *   test, the named files and every test of the project that imports the subject directly), the
 *   block a ledger id resolves to, the reading of a vitest JSON report, every verdict of the table
 *   fed recorded run results, and the record's determinism. Then the Vite plugin,
 *   `scripts/testing/lib/mutation-diff-plugin.mjs`, by calling its transform. Last, the command,
 *   `scripts/testing/mutation-diff.mjs`, through `main(argv, seams)` over a git repository planted
 *   under `tmpdir()`, its vitest runs replaced by a seam that writes each run's JSON report, marker
 *   and served log, for every exit code and `--require`. Git runs for real.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, describe, expect, it } from "vitest";

type Result<T> = { value: T } | { error: string };
type Kind = "rewrite" | "deletion";
type Side = "base" | "head";
type Hashes = { readonly base: string | null; readonly head: string | null };

/** A case as the case file states it. */
interface Case {
  readonly id: string;
  readonly kind: Kind;
  readonly test: string;
  readonly blocks: readonly string[];
  readonly subject: string;
  readonly search: string;
  readonly replace: string;
  readonly base?: string;
  readonly scope?: readonly string[];
  readonly note: string;
}

/** One test of a vitest report. */
interface TestResult {
  readonly ancestors: readonly string[];
  readonly title: string;
  readonly status: string;
}

/** One file of a vitest report. */
interface FileReport {
  readonly status: string;
  readonly tests: readonly TestResult[];
  readonly message?: string;
}

/** What one vitest run gave. */
interface Run {
  readonly failure: string | null;
  readonly report: ReadonlyMap<string, FileReport>;
}

/** A ledger id resolved on one side. */
type Resolution =
  | { readonly state: "found"; readonly describe: readonly string[]; readonly title: string }
  | { readonly state: "missing" }
  | { readonly state: "ambiguous" };

/** A block of a test file, by its ledger id. */
interface Block {
  readonly id: string;
  readonly describe: readonly string[];
  readonly title: string;
  readonly bodyHash: string;
}

/** The verdict of one case. */
interface Decided {
  readonly verdict: string;
  readonly reason: string | null;
  readonly red: { readonly base: readonly string[]; readonly head: readonly string[] };
}

/** What `decide` reads. */
interface DecideInput {
  readonly kind: Kind;
  readonly test: string;
  readonly blocks: readonly string[];
  readonly searchFound: boolean;
  readonly resolutions: Readonly<Record<string, Readonly<Record<Side, Resolution>>>>;
  readonly runs: Readonly<Record<Side, { readonly clean: Run; readonly mutated: Run }>>;
  readonly files: Readonly<Record<Side, readonly string[]>>;
}

type MutationDiffCore = {
  parseCases: (text: string) => Result<Case[]>;
  scopeOf: (input: {
    readonly test: string;
    readonly scope: readonly string[];
    readonly subject: string;
    readonly candidates: readonly { readonly path: string; readonly text: string }[];
  }) => string[];
  blocksOf: (file: string, text: string) => Block[];
  resolveBlock: (blocks: readonly Block[], id: string) => Resolution;
  reportOf: (json: unknown, root: string) => Result<Map<string, FileReport>>;
  decide: (input: DecideInput) => Decided;
  bodyHashes: (
    ids: readonly string[],
    blocks: Readonly<Record<Side, readonly Block[] | null>>
  ) => Record<string, Hashes>;
  caseEntry: (
    spec: Case,
    scope: Readonly<Record<Side, readonly string[]>>,
    decided: Decided,
    base: string | null,
    hashes: Readonly<Record<string, Hashes>>
  ) => Record<string, unknown>;
  recordOf: (input: {
    readonly head: string;
    readonly base: string;
    readonly cases: readonly Record<string, unknown>[];
  }) => unknown;
  exitOf: (results: readonly Decided[], requirement: "gain" | "safe" | null) => number;
};

/** The plugin's options. */
interface PluginOptions {
  readonly subject: string | null;
  readonly search: string;
  readonly replace: string;
  readonly marker: string | null;
  readonly served: Readonly<Record<string, string>>;
  readonly servedLog: string | null;
  readonly aliases: Readonly<Record<string, string>>;
}

/** The Vite plugin, as far as the suite calls it. */
interface Plugin {
  readonly name: string;
  readonly enforce: string;
  readonly transform: (code: string, id: string) => { code: string; map: null } | null;
  readonly resolveId: (
    this: { resolve: (source: string, importer: string, options: object) => Promise<unknown> },
    source: string,
    importer: string | undefined,
    options: object
  ) => Promise<unknown>;
}

type MutationDiffPlugin = { mutationPlugin: (options: PluginOptions) => Plugin };

/** What a replaced process returns. */
interface Ran {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly spawnError: string | null;
}

/** One vitest run the command asks for. */
interface VitestRun {
  readonly root: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly side: Side;
  readonly mutated: boolean;
  readonly files: readonly string[];
  readonly paths: Readonly<Record<string, string>>;
  readonly served: Readonly<Record<string, string>>;
  readonly report: string;
  readonly marker: string | null;
  readonly servedLog: string;
}

type MutationDiffCli = {
  main: (
    argv: readonly string[],
    seams?: { readonly exec?: (run: VitestRun) => Promise<Ran> }
  ) => Promise<{ readonly code: number; readonly output: string }>;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const core = (await import(
  path.join(REPO_ROOT, "scripts/testing/lib/mutation-diff-core.mjs")
)) as MutationDiffCore;
const plugin = (await import(
  path.join(REPO_ROOT, "scripts/testing/lib/mutation-diff-plugin.mjs")
)) as MutationDiffPlugin;
const cli = (await import(
  path.join(REPO_ROOT, "scripts/testing/mutation-diff.mjs")
)) as MutationDiffCli;

let scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  scratch = [];
});

/** A fresh directory below `tmpdir()`, removed after the test. */
const scratchDir = (prefix: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
};

/** A valid case, with the fields a test overrides. */
const makeCase = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "pins-limit",
  kind: "rewrite",
  test: "pkg/tests/subject.test.ts",
  blocks: ["pkg/tests/subject.test.ts::pins the limit"],
  subject: "pkg/src/subject.ts",
  search: "limit = 20",
  replace: "limit = 21",
  note: "the limit is pinned",
  ...overrides,
});

const PASS = "passed";
const FAIL = "failed";
const found = (describe: readonly string[], title: string): Resolution => ({
  state: "found",
  describe,
  title,
});
const MISSING: Resolution = { state: "missing" };

/**
 * A run whose files report the tests given as `[describe, title, status]`, with the file status
 * and the vitest message a file carries where one is given.
 */
const run = (
  files: Readonly<Record<string, readonly (readonly [string, string, string])[]>>,
  failure: string | null = null,
  status: Readonly<Record<string, string>> = {},
  messages: Readonly<Record<string, string>> = {}
): Run => ({
  failure,
  report: new Map(
    Object.entries(files).map(([file, tests]) => [
      file,
      {
        status: status[file] ?? (tests.some(([, , state]) => state === FAIL) ? FAIL : PASS),
        tests: tests.map(([ancestor, title, state]) => ({
          ancestors: [ancestor],
          title,
          status: state,
        })),
        ...(messages[file] === undefined ? {} : { message: messages[file] }),
      },
    ])
  ),
});

const T = "a.test.ts";
const O = "b.test.ts";
const greenRun = (): Run =>
  run({
    [T]: [
      ["s", "kept", PASS],
      ["s", "target", PASS],
    ],
    [O]: [["o", "other", PASS]],
  });
const states = (target: string, other = PASS, kept = PASS): Run =>
  run({
    [T]: [
      ["s", "kept", kept],
      ["s", "target", target],
    ],
    [O]: [["o", "other", other]],
  });

/** A decide input whose runs are all green, with the parts a test overrides. */
const input = (overrides: Partial<DecideInput> = {}): DecideInput => ({
  kind: "rewrite",
  test: T,
  blocks: [`${T}::target`],
  searchFound: true,
  resolutions: { [`${T}::target`]: { base: found(["s"], "target"), head: found(["s"], "target") } },
  runs: {
    base: { clean: greenRun(), mutated: greenRun() },
    head: { clean: greenRun(), mutated: greenRun() },
  },
  files: { base: [T, O], head: [T, O] },
  ...overrides,
});

describe("parseCases", () => {
  it("accepts a case file whose cases carry every field", () => {
    const result = core.parseCases(
      JSON.stringify([makeCase(), makeCase({ id: "b", base: "abc" })])
    );

    expect(result).toEqual({
      value: [makeCase(), makeCase({ id: "b", base: "abc" })],
    });
  });

  it.each([
    ["{", "the case file is not JSON"],
    ["{}", "the case file is not a JSON array of cases"],
    ["[]", "the case file holds no case"],
    [JSON.stringify([makeCase({ extra: 1 })]), 'case 1 (pins-limit): unknown key "extra"'],
    [
      JSON.stringify([{ ...makeCase(), note: undefined }]),
      'case 1 (pins-limit): missing field "note"',
    ],
    [JSON.stringify([makeCase({ kind: "move" })]), 'case 1 (pins-limit): field "kind"'],
    [JSON.stringify([makeCase({ search: "" })]), 'case 1 (pins-limit): field "search"'],
    [JSON.stringify([makeCase({ blocks: [] })]), 'case 1 (pins-limit): field "blocks"'],
    [
      JSON.stringify([makeCase({ blocks: ["pkg/tests/other.test.ts::x"] })]),
      'case 1 (pins-limit): field "blocks" names pkg/tests/other.test.ts::x, whose path is not "test"',
    ],
    [JSON.stringify([makeCase({ scope: "x" })]), 'case 1 (pins-limit): field "scope"'],
    [JSON.stringify([makeCase(), makeCase()]), 'case 2 (pins-limit): duplicate id "pins-limit"'],
  ])("refuses %s, naming the field", (text, message) => {
    const result = core.parseCases(text);

    expect("error" in result ? result.error : "accepted").toContain(message);
  });
});

describe("scopeOf", () => {
  it("holds the test, the named files and the tests that import the subject directly", () => {
    const scope = core.scopeOf({
      test: "pkg/tests/a.test.ts",
      scope: ["pkg/tests/named.test.ts"],
      subject: "pkg/src/subject.ts",
      candidates: [
        { path: "pkg/tests/js.test.ts", text: 'import { a } from "../src/subject.js";\n' },
        { path: "pkg/tests/bare.test.ts", text: "import {\n  a,\n} from '../src/subject';\n" },
        { path: "pkg/tests/dynamic.test.ts", text: 'await import("../src/subject.ts");\n' },
        { path: "pkg/tests/via.test.ts", text: 'import { a } from "../src/index.js";\n' },
        { path: "pkg/tests/alias.test.ts", text: 'import { a } from "@pkg/subject";\n' },
        { path: "pkg/tests/deep/up.test.ts", text: 'export { a } from "../../src/subject.js";\n' },
      ],
    });

    expect(scope).toEqual([
      "pkg/tests/a.test.ts",
      "pkg/tests/bare.test.ts",
      "pkg/tests/deep/up.test.ts",
      "pkg/tests/dynamic.test.ts",
      "pkg/tests/js.test.ts",
      "pkg/tests/named.test.ts",
    ]);
  });
});

describe("blocksOf and resolveBlock", () => {
  const text = [
    'import { describe, expect, it } from "vitest";',
    'describe("outer", () => {',
    '  describe("inner", () => {',
    '    it("one", () => { expect(1).toBe(1); });',
    '    it("twice", () => { expect(1).toBe(1); });',
    '    it("twice", () => { expect(2).toBe(2); });',
    "  });",
    "});",
    "",
  ].join("\n");
  const blocks = core.blocksOf("t.test.ts", text);

  it("resolves a ledger id to the titles around the block and its own", () => {
    expect(core.resolveBlock(blocks, "t.test.ts::one")).toEqual(found(["outer", "inner"], "one"));
  });

  it("reads a title two blocks share, under either id, as ambiguous", () => {
    expect([
      core.resolveBlock(blocks, "t.test.ts::twice"),
      core.resolveBlock(blocks, "t.test.ts::twice #2"),
    ]).toEqual([{ state: "ambiguous" }, { state: "ambiguous" }]);
  });

  it("reads an id the file does not hold as missing", () => {
    expect(core.resolveBlock(blocks, "t.test.ts::none")).toEqual(MISSING);
  });

  it("hashes each block with the classifier's bodyHash, the one ledger.json holds", () => {
    const file = "apps/api/tests/unit/scripts/hardProbe.test.ts";
    const text = readFileSync(path.join(REPO_ROOT, file), "utf8");
    const ledger = JSON.parse(readFileSync(path.join(REPO_ROOT, "ledger.json"), "utf8")) as {
      files: { path: string; blocks: { id: string; bodyHash: string }[] }[];
    };
    const row = ledger.files.find((entry) => entry.path === file);

    expect(core.blocksOf(file, text).map(({ id, bodyHash }) => ({ id, bodyHash }))).toEqual(
      row?.blocks.map(({ id, bodyHash }) => ({ id, bodyHash }))
    );
  });

  it("gives each listed block its hash on each side, null where it does not exist", () => {
    expect(
      core.bodyHashes(["t.test.ts::one", "t.test.ts::gone"], { base: blocks, head: null })
    ).toEqual({
      "t.test.ts::gone": { base: null, head: null },
      "t.test.ts::one": { base: blocks[0]?.bodyHash, head: null },
    });
    expect(blocks[0]?.bodyHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("reportOf", () => {
  it("reads each file of a vitest JSON report by its repository-relative path", () => {
    const report = core.reportOf(
      {
        testResults: [
          {
            name: "/repo/pkg/tests/a.test.ts",
            status: "failed",
            assertionResults: [
              { ancestorTitles: ["s"], title: "t", fullName: "s t", status: "failed" },
            ],
          },
        ],
      },
      "/repo"
    );

    expect("value" in report ? [...report.value] : report).toEqual([
      [
        "pkg/tests/a.test.ts",
        { status: "failed", tests: [{ ancestors: ["s"], title: "t", status: "failed" }] },
      ],
    ]);
  });

  it("refuses a report with no testResults", () => {
    expect(core.reportOf({ numTotalTests: 0 }, "/repo")).toEqual({
      error: "the vitest report holds no testResults",
    });
  });

  it("returns a file's vitest message when it is a non-empty string, and no message field when it is missing, empty or not a string", () => {
    const file = (name: string, message: unknown): Record<string, unknown> => ({
      name: `/repo/pkg/tests/${name}.test.ts`,
      status: "failed",
      assertionResults: [],
      ...(message === undefined ? {} : { message }),
    });

    const report = core.reportOf(
      {
        testResults: [
          file("loud", "Error: the env is invalid\n    at env.ts:1:1"),
          file("empty", ""),
          file("missing", undefined),
          file("odd", 42),
        ],
      },
      "/repo"
    );

    expect("value" in report ? [...report.value] : report).toStrictEqual([
      [
        "pkg/tests/loud.test.ts",
        { status: "failed", tests: [], message: "Error: the env is invalid\n    at env.ts:1:1" },
      ],
      ["pkg/tests/empty.test.ts", { status: "failed", tests: [] }],
      ["pkg/tests/missing.test.ts", { status: "failed", tests: [] }],
      ["pkg/tests/odd.test.ts", { status: "failed", tests: [] }],
    ]);
  });
});

describe("decide", () => {
  const rewriteTable: readonly (readonly [string, Partial<DecideInput>, Decided])[] = [
    [
      "GAIN when no base test is red and the block is red at the head",
      {
        runs: {
          base: { clean: greenRun(), mutated: greenRun() },
          head: { clean: greenRun(), mutated: states(FAIL) },
        },
      },
      { verdict: "GAIN", reason: null, red: { base: [], head: [`${T}::s > target`] } },
    ],
    [
      "NO-GAIN when any base scope test is red, naming each one",
      {
        runs: {
          base: { clean: greenRun(), mutated: states(PASS, FAIL, FAIL) },
          head: { clean: greenRun(), mutated: states(FAIL) },
        },
      },
      {
        verdict: "NO-GAIN",
        reason: null,
        red: { base: [`${T}::s > kept`, `${O}::o > other`], head: [`${T}::s > target`] },
      },
    ],
    [
      "BROKEN when the block is green at the head under its own mutation",
      {
        runs: {
          base: { clean: greenRun(), mutated: greenRun() },
          head: { clean: greenRun(), mutated: states(PASS, FAIL) },
        },
      },
      { verdict: "BROKEN", reason: null, red: { base: [], head: [`${O}::o > other`] } },
    ],
  ];

  it.each(rewriteTable)("rewrite: %s", (_name, overrides, expected) => {
    expect(core.decide(input(overrides))).toEqual(expected);
  });

  const deletion = (base: Run, head: Run): Partial<DecideInput> => ({
    kind: "deletion",
    resolutions: { [`${T}::target`]: { base: found(["s"], "target"), head: MISSING } },
    runs: {
      base: { clean: greenRun(), mutated: base },
      head: {
        clean: run({ [T]: [["s", "kept", PASS]], [O]: [["o", "other", PASS]] }),
        mutated: head,
      },
    },
  });
  const headWithout = (kept: string, other: string): Run =>
    run({ [T]: [["s", "kept", kept]], [O]: [["o", "other", other]] });

  it.each([
    [
      "SAFE when the deleted block is red at the base and a head test is red",
      deletion(states(FAIL), headWithout(PASS, FAIL)),
      {
        verdict: "SAFE",
        reason: null,
        red: { base: [`${T}::s > target`], head: [`${O}::o > other`] },
      },
    ],
    [
      "LOST when the deleted block is red at the base and no head test is red",
      deletion(states(FAIL), headWithout(PASS, PASS)),
      { verdict: "LOST", reason: null, red: { base: [`${T}::s > target`], head: [] } },
    ],
    [
      "VACUOUS when the deleted block is green at the base under the mutation",
      deletion(states(PASS, FAIL), headWithout(FAIL, PASS)),
      {
        verdict: "VACUOUS",
        reason: null,
        red: { base: [`${O}::o > other`], head: [`${T}::s > kept`] },
      },
    ],
  ] as const)("deletion: %s", (_name, overrides, expected) => {
    expect(core.decide(input(overrides))).toEqual(expected);
  });

  const none = { base: [], head: [] };
  it.each([
    ["search-absent", { searchFound: false }, none],
    ["base-empty", { files: { base: [], head: [T, O] } }, none],
    [
      "block-missing",
      { resolutions: { [`${T}::target`]: { base: MISSING, head: found(["s"], "target") } } },
      none,
    ],
    [
      "block-present-at-head",
      {
        kind: "deletion",
        resolutions: {
          [`${T}::target`]: { base: found(["s"], "target"), head: found(["s"], "target") },
        },
      },
      none,
    ],

    [
      "block-missing",
      { resolutions: { [`${T}::target`]: { base: MISSING, head: MISSING } } },
      none,
    ],
    [
      "ambiguous-id",
      { resolutions: { [`${T}::target`]: { base: MISSING, head: { state: "ambiguous" } } } },
      none,
    ],
    [
      "runner-failed",
      {
        runs: {
          base: { clean: run({ [T]: [["s", "kept", PASS]] }), mutated: greenRun() },
          head: { clean: greenRun(), mutated: greenRun() },
        },
      },
      none,
    ],
    [
      "timeout",
      {
        runs: {
          base: { clean: greenRun(), mutated: greenRun() },
          head: { clean: run({}, "timeout"), mutated: greenRun() },
        },
      },
      none,
    ],
    [
      "base-unreadable",
      {
        runs: {
          base: {
            clean: run({ [T]: [], [O]: [["o", "other", PASS]] }, null, { [T]: FAIL }),
            mutated: greenRun(),
          },
          head: { clean: greenRun(), mutated: greenRun() },
        },
      },
      { base: [`${T}::(the file failed)`], head: [] },
    ],
    [
      "head-unreadable",
      {
        runs: {
          base: { clean: greenRun(), mutated: greenRun() },
          head: {
            clean: run({ [T]: [], [O]: [["o", "other", PASS]] }, null, { [T]: FAIL }),
            mutated: greenRun(),
          },
        },
      },
      { base: [], head: [`${T}::(the file failed)`] },
    ],
    [
      "both-unreadable",
      {
        runs: {
          base: {
            clean: run(
              { [T]: [], [O]: [["o", "other", PASS]] },
              null,
              { [T]: FAIL },
              { [T]: "\n   Error: DATABASE_URL is required  \n    at env.ts:12:3" }
            ),
            mutated: greenRun(),
          },
          head: {
            clean: run(
              { [T]: [], [O]: [] },
              null,
              { [T]: FAIL, [O]: FAIL },
              { [O]: "x".repeat(250) }
            ),
            mutated: greenRun(),
          },
        },
      },
      {
        base: [`${T}::(the file failed): Error: DATABASE_URL is required`],
        head: [`${T}::(the file failed)`, `${O}::(the file failed): ${"x".repeat(200)}`],
      },
    ],
    [
      "base-red-clean",
      {
        runs: {
          base: { clean: states(PASS, FAIL), mutated: greenRun() },
          head: { clean: greenRun(), mutated: greenRun() },
        },
      },
      { base: [`${O}::o > other`], head: [] },
    ],
    [
      "head-red-clean",
      {
        runs: {
          base: { clean: greenRun(), mutated: greenRun() },
          head: { clean: states(FAIL), mutated: greenRun() },
        },
      },
      { base: [], head: [`${T}::s > target`] },
    ],
    [
      "not-applied",
      {
        runs: {
          base: { clean: greenRun(), mutated: run({}, "not-applied") },
          head: { clean: greenRun(), mutated: states(FAIL) },
        },
      },
      none,
    ],
    [
      "block-missing",
      {
        runs: {
          base: { clean: greenRun(), mutated: greenRun() },
          head: {
            clean: greenRun(),
            mutated: run({
              [T]: [
                ["s", "kept", PASS],
                ["s", "target", "skipped"],
              ],
              [O]: [["o", "other", PASS]],
            }),
          },
        },
      },
      none,
    ],
    [
      "block-missing",
      {
        runs: {
          base: { clean: greenRun(), mutated: greenRun() },
          head: {
            clean: greenRun(),
            mutated: run(
              { [T]: [], [O]: [["o", "other", PASS]] },
              null,
              { [T]: FAIL },
              { [T]: "SyntaxError: the mutation broke the import" }
            ),
          },
        },
      },
      { base: [], head: [`${T}::(the file failed): SyntaxError: the mutation broke the import`] },
    ],
  ] as const)("UNDECIDED on %s", (reason, overrides, red) => {
    expect(core.decide(input(overrides as Partial<DecideInput>))).toEqual({
      verdict: "UNDECIDED",
      reason,
      red,
    });
  });
});

describe("decide: a behaviour change measured on the clean runs", () => {
  const deletionResolutions = {
    [`${T}::target`]: { base: found(["s"], "target"), head: MISSING },
  };
  const headWithoutTarget = (): Run =>
    run({ [T]: [["s", "kept", PASS]], [O]: [["o", "other", PASS]] });

  it("gives a rewrite BEHAVIOUR-CHANGED when only its listed block is red at the base and the head is green", () => {
    const decided = core.decide(
      input({
        runs: {
          base: { clean: states(FAIL), mutated: greenRun() },
          head: { clean: greenRun(), mutated: states(FAIL) },
        },
      })
    );
    expect(decided).toEqual({
      verdict: "BEHAVIOUR-CHANGED",
      reason: null,
      red: { base: [`${T}::s > target`], head: [] },
    });
  });

  it("gives a deletion BEHAVIOUR-CHANGED when only its deleted block is red at the base and the head is green", () => {
    const decided = core.decide(
      input({
        kind: "deletion",
        resolutions: deletionResolutions,
        runs: {
          base: { clean: states(FAIL), mutated: states(FAIL) },
          head: { clean: headWithoutTarget(), mutated: headWithoutTarget() },
        },
      })
    );
    expect(decided).toEqual({
      verdict: "BEHAVIOUR-CHANGED",
      reason: null,
      red: { base: [`${T}::s > target`], head: [] },
    });
  });

  it("keeps UNDECIDED base-red-clean when a scope test besides the listed block is red at the base", () => {
    const decided = core.decide(
      input({
        runs: {
          base: { clean: states(FAIL, FAIL), mutated: greenRun() },
          head: { clean: greenRun(), mutated: states(FAIL) },
        },
      })
    );
    expect(decided).toEqual({
      verdict: "UNDECIDED",
      reason: "base-red-clean",
      red: { base: [`${T}::s > target`, `${O}::o > other`], head: [] },
    });
  });

  it("keeps UNDECIDED base-red-clean when the head clean run is red too", () => {
    const decided = core.decide(
      input({
        runs: {
          base: { clean: states(FAIL), mutated: greenRun() },
          head: { clean: states(PASS, FAIL), mutated: states(FAIL) },
        },
      })
    );
    expect(decided).toEqual({
      verdict: "UNDECIDED",
      reason: "base-red-clean",
      red: { base: [`${T}::s > target`], head: [] },
    });
  });

  it("keeps UNDECIDED base-red-clean when a base file failed with none of its tests failed", () => {
    const decided = core.decide(
      input({
        runs: {
          base: {
            clean: run(
              {
                [T]: [
                  ["s", "kept", PASS],
                  ["s", "target", FAIL],
                ],
                [O]: [["o", "other", PASS]],
              },
              null,
              { [O]: FAIL }
            ),
            mutated: greenRun(),
          },
          head: { clean: greenRun(), mutated: states(FAIL) },
        },
      })
    );
    expect(decided).toEqual({
      verdict: "UNDECIDED",
      reason: "base-red-clean",
      red: { base: [`${T}::s > target`, `${O}::(the file failed)`], head: [] },
    });
  });
});

describe("the record and the exit", () => {
  const decided = (verdict: string, reason: string | null = null): Decided => ({
    verdict,
    reason,
    red: { base: [], head: [] },
  });

  it("renders the same record whatever order its cases and scope arrive in", () => {
    const spec = makeCase() as unknown as Case;
    const other = makeCase({ id: "a-first", kind: "deletion" }) as unknown as Case;
    const id = "pkg/tests/subject.test.ts::pins the limit";
    const gained = { [id]: { base: null, head: "h" } };
    const deleted = { [id]: { base: "b", head: null } };
    const one = core.recordOf({
      head: "worktree",
      base: "abc",
      cases: [
        core.caseEntry(
          spec,
          { base: ["z.test.ts", "a.test.ts"], head: ["a.test.ts"] },
          decided("GAIN"),
          null,
          gained
        ),
        core.caseEntry(
          other,
          { base: ["a.test.ts"], head: [] },
          decided("UNDECIDED", "timeout"),
          "def",
          deleted
        ),
      ],
    });
    const two = core.recordOf({
      head: "worktree",
      base: "abc",
      cases: [
        core.caseEntry(
          other,
          { base: ["a.test.ts"], head: [] },
          decided("UNDECIDED", "timeout"),
          "def",
          deleted
        ),
        core.caseEntry(
          spec,
          { base: ["a.test.ts", "z.test.ts"], head: ["a.test.ts"] },
          decided("GAIN"),
          null,
          gained
        ),
      ],
    });

    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
    expect(JSON.stringify(one)).toBe(
      JSON.stringify({
        base: "abc",
        cases: [
          {
            base: "def",
            blocks: [{ bodyHash: { base: "b", head: null }, id }],
            id: "a-first",
            kind: "deletion",
            reason: "timeout",
            red: { base: [], head: [] },
            scope: { base: ["a.test.ts"], head: [] },
            verdict: "UNDECIDED",
          },
          {
            blocks: [{ bodyHash: { base: null, head: "h" }, id }],
            id: "pins-limit",
            kind: "rewrite",
            red: { base: [], head: [] },
            scope: { base: ["a.test.ts", "z.test.ts"], head: ["a.test.ts"] },
            verdict: "GAIN",
          },
        ],
        head: "worktree",
        version: 1,
      })
    );
  });

  it.each([
    [["GAIN", "NO-GAIN", "SAFE", "LOST", "VACUOUS"], null, 0],
    [["GAIN", "BROKEN"], null, 1],
    [["SAFE", "UNDECIDED"], null, 1],
    [["GAIN", "NO-GAIN"], "gain", 1],
    [["GAIN", "LOST"], "gain", 0],
    [["SAFE", "LOST"], "safe", 1],
    [["SAFE", "VACUOUS"], "safe", 1],
    [["SAFE", "NO-GAIN"], "safe", 0],
    [["GAIN", "SAFE", "BEHAVIOUR-CHANGED"], null, 0],
    [["GAIN", "BEHAVIOUR-CHANGED"], "gain", 1],
    [["SAFE", "BEHAVIOUR-CHANGED"], "safe", 1],
  ] as const)("exits %#: %j under --require %s", (verdicts, requirement, code) => {
    expect(
      core.exitOf(
        verdicts.map((verdict) => decided(verdict)),
        requirement
      )
    ).toBe(code);
  });
});

describe("mutationPlugin", () => {
  const options = (overrides: Partial<PluginOptions> = {}): PluginOptions => ({
    subject: "/repo/src/subject.ts",
    search: "a = 1",
    replace: "a = $&2",
    marker: null,
    served: {},
    servedLog: null,
    aliases: {},
    ...overrides,
  });

  it("is a pre plugin named mutation-diff", () => {
    const made = plugin.mutationPlugin(options());

    expect([made.name, made.enforce]).toEqual(["mutation-diff", "pre"]);
  });

  it("mutates the subject at the first occurrence of the search, literally, and marks it", () => {
    const marker = path.join(scratchDir("mutation-diff-plugin-"), "applied");

    const result = plugin
      .mutationPlugin(options({ marker }))
      .transform("const a = 1; const b = 1; a = 1;", "/repo/src/subject.ts?v=3");

    expect(result).toEqual({ code: "const a = $&2; const b = 1; a = 1;", map: null });
    expect(readFileSync(marker, "utf8")).toBe("applied\n");
  });

  it("throws when the search is absent from the subject", () => {
    const made = plugin.mutationPlugin(options());

    expect(() => made.transform("const b = 1;", "/repo/src/subject.ts")).toThrow(
      "mutation-diff: the search is absent from /repo/src/subject.ts"
    );
  });

  it("serves the base content for a test file id and logs it", () => {
    const servedLog = path.join(scratchDir("mutation-diff-plugin-"), "served");
    const made = plugin.mutationPlugin(
      options({ served: { "/repo/tests/a.test.ts": "base text" }, servedLog })
    );

    const result = made.transform("head text", "/repo/tests/a.test.ts?import");

    expect(result).toEqual({ code: "base text", map: null });
    expect(readFileSync(servedLog, "utf8")).toBe("/repo/tests/a.test.ts\n");
  });

  it("resolves an aliased test file's imports from the file's own path, any other's not at all", async () => {
    const made = plugin.mutationPlugin(
      options({ aliases: { "/scratch/tests/a.test.ts": "/repo/tests/a.test.ts" } })
    );
    const context = {
      resolve: (source: string, importer: string): Promise<unknown> =>
        Promise.resolve({ id: `${importer}|${source}` }),
    };

    const resolved = await Promise.all([
      made.resolveId.call(context, "../src/x.js", "/scratch/tests/a.test.ts?v=1", {}),
      made.resolveId.call(context, "../src/x.js", "/repo/tests/b.test.ts", {}),
      made.resolveId.call(context, "../src/x.js", undefined, {}),
    ]);

    expect(resolved).toEqual([{ id: "/repo/tests/a.test.ts|../src/x.js" }, null, null]);
  });

  it("passes any other module through, and the subject too on a clean run", () => {
    expect([
      plugin.mutationPlugin(options()).transform("const a = 1;", "/repo/src/other.ts"),
      plugin.mutationPlugin(options({ subject: null })).transform("x", "/repo/src/subject.ts"),
    ]).toEqual([null, null]);
  });
});

/** The planted repository's tests: their describe, their titles on each side (`null`: the side
 *  does not hold the file) and whether each side's form imports the subject. */
const TESTS: Readonly<
  Record<
    string,
    {
      describe: string;
      base: string[] | null;
      head: string[] | null;
      imports: Readonly<Record<Side, boolean>>;
      module?: string;
    }
  >
> = {
  "pkg/tests/subject.test.ts": {
    describe: "subject",
    base: ["reads the limit", "pins the limit"],
    head: ["pins the limit", "adds a bound"],
    imports: { base: true, head: true },
  },
  "pkg/tests/other.test.ts": {
    describe: "other",
    base: ["uses the limit"],
    head: ["uses the limit"],
    imports: { base: true, head: true },
  },
  "pkg/tests/unrelated.test.ts": {
    describe: "unrelated",
    base: ["stands"],
    head: ["stands"],
    imports: { base: false, head: false },
  },
  "pkg/tests/former.test.ts": {
    describe: "former",
    base: ["once used the limit"],
    head: ["once used the limit"],
    imports: { base: true, head: false },
  },
  "pkg/tests/gone.test.ts": {
    describe: "gone",
    base: ["guards the limit"],
    head: null,
    imports: { base: true, head: false },
  },
  "pkg/tests/fresh.test.ts": {
    describe: "fresh",
    module: "fresh",
    base: null,
    head: ["checks the limit"],
    imports: { base: false, head: true },
  },
};

const SUBJECT_TEST = "pkg/tests/subject.test.ts";

const testText = (file: string, side: Side): string => {
  const spec = TESTS[file];
  const imports =
    spec?.imports[side] === true
      ? `import { limit } from "../src/${spec?.module ?? "subject"}.js";\n`
      : "";
  const blocks = (spec?.[side] ?? [])
    .map((title) => `  it(${JSON.stringify(title)}, () => {\n    expect(1).toBe(1);\n  });\n`)
    .join("");
  return `import { describe, expect, it } from "vitest";\n${imports}\ndescribe(${JSON.stringify(spec?.describe)}, () => {\n${blocks}});\n`;
};

const git = (root: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Writes a file below a directory, creating its parents. */
const writeFile = (root: string, file: string, text: string): void => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};

/** Writes one side's tests and its ledger, removing a test the side does not hold. */
const writeSide = (root: string, side: Side): void => {
  const held = Object.keys(TESTS).filter((file) => TESTS[file]?.[side] != null);
  for (const file of Object.keys(TESTS)) {
    if (held.includes(file)) writeFile(root, file, testText(file, side));
    else rmSync(path.join(root, file), { force: true });
  }
  writeFile(
    root,
    "ledger.json",
    `${JSON.stringify({
      files: held.map((file) => ({
        path: file,
        framework: "vitest",
        collectors: ["vitest:pkg/vitest.config.ts"],
      })),
    })}\n`
  );
};

/**
 * A repository whose base commit holds the base tests and whose working tree the head ones;
 * `extra` adds to each side once its tests and ledger are written.
 */
const plantRepository = (
  commitHead = false,
  extra: (root: string, side: Side) => void = () => undefined
): { root: string; base: string; head: string | null } => {
  const root = scratchDir("mutation-diff-repo-");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "suite@example.invalid");
  git(root, "config", "user.name", "suite");
  writeFile(root, "pkg/vitest.config.ts", "export default {};\n");
  writeFile(root, "pkg/src/subject.ts", "export const limit = 20;\n");
  writeFile(root, "pkg/src/fresh.ts", "export const fresh = 1;\n");
  writeSide(root, "base");
  extra(root, "base");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  const base = git(root, "rev-parse", "HEAD").trim();
  writeSide(root, "head");
  extra(root, "head");
  if (!commitHead) return { root, base, head: null };
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "head");
  return { root, base, head: git(root, "rev-parse", "HEAD").trim() };
};

/** How a replaced run behaves. */
interface Plan {
  readonly failing?: (run: VitestRun) => readonly string[];
  /** The files of a run that fail to load, each with the message vitest reports for it. */
  readonly unloaded?: (run: VitestRun) => Readonly<Record<string, string>>;
  readonly applied?: boolean;
  readonly served?: boolean;
  readonly spawnError?: boolean;
}

/** A replaced vitest that writes each run's JSON report, marker and served log, and records it. */
const fakeVitest = (
  plan: Plan = {}
): { runs: VitestRun[]; exec: (run: VitestRun) => Promise<Ran> } => {
  const runs: VitestRun[] = [];
  const exec = (vitestRun: VitestRun): Promise<Ran> => {
    runs.push(vitestRun);
    if (plan.spawnError === true) {
      return Promise.resolve({
        status: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        spawnError: "spawn ENOENT",
      });
    }
    const failing = new Set(plan.failing?.(vitestRun) ?? []);
    const unloaded = plan.unloaded?.(vitestRun) ?? {};
    const testResults = vitestRun.files.map((file) => {
      const name = vitestRun.paths?.[file] ?? path.join(vitestRun.root, file);
      const message = unloaded[file];
      if (message !== undefined) return { name, status: FAIL, message, assertionResults: [] };
      const spec = TESTS[file];
      const assertionResults = (spec?.[vitestRun.side] ?? []).map((title) => ({
        ancestorTitles: [spec?.describe ?? ""],
        title,
        fullName: `${spec?.describe ?? ""} ${title}`,
        status: failing.has(title) ? FAIL : PASS,
      }));
      return {
        name,
        status: assertionResults.some((test) => test.status === FAIL) ? FAIL : PASS,
        assertionResults,
      };
    });
    writeFileSync(vitestRun.report, JSON.stringify({ testResults }));
    if (vitestRun.mutated && vitestRun.marker !== null && plan.applied !== false) {
      writeFileSync(vitestRun.marker, "applied\n");
    }
    for (const served of plan.served === false ? [] : Object.keys(vitestRun.served)) {
      appendFileSync(vitestRun.servedLog, `${served}\n`);
    }
    return Promise.resolve({
      status: failing.size > 0 || Object.keys(unloaded).length > 0 ? 1 : 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      spawnError: null,
    });
  };
  return { runs, exec };
};

/** Runs the command over a case file it writes, and reads back the record. */
const command = async (
  root: string,
  cases: readonly Record<string, unknown>[],
  exec: (run: VitestRun) => Promise<Ran>,
  extra: readonly string[] = []
): Promise<{ code: number; output: string; record: string | null; out: string }> => {
  const dir = scratchDir("mutation-diff-out-");
  const casesFile = path.join(dir, "cases.json");
  const out = path.join(dir, "record.json");
  writeFileSync(casesFile, JSON.stringify(cases));
  const result = await cli.main(["--root", root, "--cases", casesFile, "--out", out, ...extra], {
    exec,
  });
  let record: string | null = null;
  try {
    record = readFileSync(out, "utf8");
  } catch {
    record = null;
  }
  return { ...result, record, out };
};

const caseOf = (record: string | null, id: string): Record<string, unknown> | undefined =>
  (JSON.parse(record ?? "{}") as { cases?: Record<string, unknown>[] }).cases?.find(
    (entry) => entry["id"] === id
  );

/** The classifier's hash of a planted test's block on one side, or null where it is absent. */
const hashOf = (side: Side, title: string, file = SUBJECT_TEST): string | null =>
  core.blocksOf(file, testText(file, side)).find((block) => block.id === `${file}::${title}`)
    ?.bodyHash ?? null;

const headMutated = (titles: readonly string[]) => (vitestRun: VitestRun) =>
  vitestRun.side === "head" && vitestRun.mutated ? titles : [];

const BASE_SCOPE = [
  "pkg/tests/former.test.ts",
  "pkg/tests/gone.test.ts",
  "pkg/tests/other.test.ts",
  "pkg/tests/subject.test.ts",
];
const HEAD_SCOPE = ["pkg/tests/other.test.ts", "pkg/tests/subject.test.ts"];

describe("main", () => {
  it.each([
    [[], "--cases and --out are required"],
    [["--cases", "c.json"], "--cases and --out are required"],
    [["--cases", "c.json", "--out", "o.json", "--require", "all"], "--require takes gain or safe"],
    [["--bogus"], "Unknown option '--bogus'"],
  ])("refuses %j as a usage error", async (argv, message) => {
    const result = await cli.main(argv);

    expect(result.code).toBe(2);
    expect(result.output).toContain(message);
    expect(result.output).toContain("usage: node scripts/testing/mutation-diff.mjs");
  });

  it("gives GAIN and exit 0, with the base content served at the base", async () => {
    const { root, base } = plantRepository();
    const vitest = fakeVitest({ failing: headMutated(["pins the limit"]) });

    const result = await command(root, [makeCase()], vitest.exec, ["--base", base]);

    expect(result.code).toBe(0);
    expect(hashOf("head", "pins the limit")).toMatch(/^[0-9a-f]{64}$/);
    expect(caseOf(result.record, "pins-limit")).toEqual({
      blocks: [
        {
          bodyHash: {
            base: hashOf("base", "pins the limit"),
            head: hashOf("head", "pins the limit"),
          },
          id: "pkg/tests/subject.test.ts::pins the limit",
        },
      ],
      id: "pins-limit",
      kind: "rewrite",
      red: { base: [], head: ["pkg/tests/subject.test.ts::subject > pins the limit"] },
      scope: { base: BASE_SCOPE, head: HEAD_SCOPE },
      verdict: "GAIN",
    });
    expect(vitest.runs.map((each) => `${each.side}${each.mutated ? "*" : ""}`)).toEqual([
      "base",
      "head",
      "base*",
      "head*",
    ]);
    const baseRun = vitest.runs[0];
    expect(baseRun?.served[path.join(root, SUBJECT_TEST)]).toBe(testText(SUBJECT_TEST, "base"));
    expect(vitest.runs[1]?.served).toEqual({});
    expect(baseRun?.cwd).toBe(path.join(root, "pkg"));
    expect(baseRun?.args).toEqual(
      expect.arrayContaining([
        "run",
        "tests/other.test.ts",
        "tests/subject.test.ts",
        "--reporter=json",
      ])
    );
  });

  it("computes the default scope on each side from that side's tree", async () => {
    const { root, base } = plantRepository();
    const vitest = fakeVitest({ failing: headMutated(["pins the limit"]) });

    const result = await command(root, [makeCase()], vitest.exec, ["--base", base]);

    expect(caseOf(result.record, "pins-limit")?.["scope"]).toEqual({
      base: BASE_SCOPE,
      head: HEAD_SCOPE,
    });
    expect(vitest.runs.map((each) => [each.side, each.files])).toEqual([
      ["base", BASE_SCOPE],
      ["head", HEAD_SCOPE],
      ["base", BASE_SCOPE],
      ["head", HEAD_SCOPE],
    ]);
  });

  it("gives NO-GAIN naming the red base tests, exit 0, and exit 1 under --require gain", async () => {
    const { root, base } = plantRepository();
    const failing = (vitestRun: VitestRun): readonly string[] =>
      vitestRun.mutated
        ? vitestRun.side === "base"
          ? ["uses the limit"]
          : ["pins the limit"]
        : [];

    const plain = await command(root, [makeCase()], fakeVitest({ failing }).exec, ["--base", base]);
    const required = await command(root, [makeCase()], fakeVitest({ failing }).exec, [
      "--base",
      base,
      "--require",
      "gain",
    ]);

    expect([plain.code, required.code]).toEqual([0, 1]);
    expect(caseOf(plain.record, "pins-limit")?.["red"]).toEqual({
      base: ["pkg/tests/other.test.ts::other > uses the limit"],
      head: ["pkg/tests/subject.test.ts::subject > pins the limit"],
    });
    expect(caseOf(required.record, "pins-limit")?.["verdict"]).toBe("NO-GAIN");
  });

  it("gives BROKEN and exit 1 when the head block is green under its own mutation", async () => {
    const { root, base } = plantRepository();

    const result = await command(root, [makeCase()], fakeVitest().exec, ["--base", base]);

    expect(result.code).toBe(1);
    expect(caseOf(result.record, "pins-limit")?.["verdict"]).toBe("BROKEN");
    expect(result.output).toContain("mutation-diff: pins-limit: BROKEN");
  });

  it("gives UNDECIDED base-empty, running nothing, for a rewrite of a test the base does not hold", async () => {
    const { root, base } = plantRepository();
    const vitest = fakeVitest({ failing: headMutated(["checks the limit"]) });
    const fresh = makeCase({
      id: "fresh",
      test: "pkg/tests/fresh.test.ts",
      blocks: ["pkg/tests/fresh.test.ts::checks the limit"],
      subject: "pkg/src/fresh.ts",
      search: "fresh = 1",
    });

    const result = await command(root, [fresh], vitest.exec, ["--base", base]);

    expect(result.code).toBe(1);
    expect(caseOf(result.record, "fresh")).toMatchObject({
      verdict: "UNDECIDED",
      reason: "base-empty",
      scope: { base: [], head: ["pkg/tests/fresh.test.ts"] },
    });
    expect(vitest.runs).toEqual([]);
  });

  it("gives UNDECIDED block-missing for a rewrite of a block the base does not hold", async () => {
    const { root, base } = plantRepository();
    const vitest = fakeVitest({ failing: headMutated(["adds a bound"]) });

    const result = await command(
      root,
      [makeCase({ id: "added", blocks: [`${SUBJECT_TEST}::adds a bound`] })],
      vitest.exec,
      ["--base", base]
    );

    expect(result.code).toBe(1);
    expect(caseOf(result.record, "added")).toMatchObject({
      verdict: "UNDECIDED",
      reason: "block-missing",
    });
    expect(vitest.runs).toEqual([]);
  });

  it("gives LOST for a deletion, exit 0, and exit 1 under --require safe", async () => {
    const { root, base } = plantRepository();
    const lost = makeCase({
      id: "drops-read",
      kind: "deletion",
      blocks: ["pkg/tests/subject.test.ts::reads the limit"],
    });
    const failing = (vitestRun: VitestRun): readonly string[] =>
      vitestRun.side === "base" && vitestRun.mutated ? ["reads the limit"] : [];

    const plain = await command(root, [lost], fakeVitest({ failing }).exec, ["--base", base]);
    const required = await command(root, [lost], fakeVitest({ failing }).exec, [
      "--base",
      base,
      "--require",
      "safe",
    ]);

    expect([plain.code, required.code]).toEqual([0, 1]);
    expect(caseOf(plain.record, "drops-read")?.["verdict"]).toBe("LOST");
    expect(hashOf("base", "reads the limit")).toMatch(/^[0-9a-f]{64}$/);
    expect(caseOf(plain.record, "drops-read")?.["blocks"]).toEqual([
      {
        bodyHash: { base: hashOf("base", "reads the limit"), head: null },
        id: "pkg/tests/subject.test.ts::reads the limit",
      },
    ]);
  });

  it("runs a whole-file deletion: the base runs the deleted file from a copy, the head runs without it", async () => {
    const { root, base } = plantRepository();
    const gone = "pkg/tests/gone.test.ts";
    const failing = (vitestRun: VitestRun): readonly string[] =>
      vitestRun.mutated
        ? vitestRun.side === "base"
          ? ["guards the limit"]
          : ["uses the limit"]
        : [];
    const vitest = fakeVitest({ failing });

    const result = await command(
      root,
      [
        makeCase({
          id: "gone",
          kind: "deletion",
          test: gone,
          blocks: [`${gone}::guards the limit`],
        }),
      ],
      vitest.exec,
      ["--base", base]
    );

    expect(result.code).toBe(0);
    expect(caseOf(result.record, "gone")).toMatchObject({
      verdict: "SAFE",
      red: {
        base: [`${gone}::gone > guards the limit`],
        head: ["pkg/tests/other.test.ts::other > uses the limit"],
      },
      blocks: [
        {
          bodyHash: { base: hashOf("base", "guards the limit", gone), head: null },
          id: `${gone}::guards the limit`,
        },
      ],
    });
    const copy = vitest.runs[0]?.paths[gone] ?? root;
    expect(copy.startsWith(root)).toBe(false);
    expect(vitest.runs[0]?.served[copy]).toBe(testText(gone, "base"));
    expect(vitest.runs.filter((each) => each.side === "head").map((each) => each.files)).toEqual([
      ["pkg/tests/other.test.ts", "pkg/tests/subject.test.ts"],
      ["pkg/tests/other.test.ts", "pkg/tests/subject.test.ts"],
    ]);
  });

  it("gives UNDECIDED block-present-at-head for a deletion whose block the head still holds", async () => {
    const { root, base } = plantRepository();
    const vitest = fakeVitest();

    const result = await command(root, [makeCase({ id: "kept", kind: "deletion" })], vitest.exec, [
      "--base",
      base,
    ]);

    expect(result.code).toBe(1);
    expect(caseOf(result.record, "kept")).toMatchObject({
      verdict: "UNDECIDED",
      reason: "block-present-at-head",
    });
    expect(vitest.runs).toEqual([]);
  });

  it("gives UNDECIDED search-absent and exit 1 without running anything", async () => {
    const { root, base } = plantRepository();
    const vitest = fakeVitest();

    const result = await command(root, [makeCase({ search: "nowhere" })], vitest.exec, [
      "--base",
      base,
    ]);

    expect(result.code).toBe(1);
    expect(caseOf(result.record, "pins-limit")).toMatchObject({
      verdict: "UNDECIDED",
      reason: "search-absent",
    });
    expect(vitest.runs).toEqual([]);
  });

  it("gives UNDECIDED not-applied and exit 1 when a mutated run leaves no marker", async () => {
    const { root, base } = plantRepository();
    const vitest = fakeVitest({ failing: headMutated(["pins the limit"]), applied: false });

    const result = await command(root, [makeCase()], vitest.exec, ["--base", base]);

    expect(result.code).toBe(1);
    expect(caseOf(result.record, "pins-limit")?.["reason"]).toBe("not-applied");
  });

  it("gives UNDECIDED not-served and exit 1 when a base file never reaches the plugin", async () => {
    const { root, base } = plantRepository();
    const vitest = fakeVitest({ failing: headMutated(["pins the limit"]), served: false });

    const result = await command(root, [makeCase()], vitest.exec, ["--base", base]);

    expect(result.code).toBe(1);
    expect(caseOf(result.record, "pins-limit")).toMatchObject({
      verdict: "UNDECIDED",
      reason: "not-served",
    });
  });

  it("returns UNDECIDED both-unreadable with each side's unloaded file and its message's first line when the test module throws at import without the variable the fixture names", async () => {
    const variable = "MUTATION_DIFF_SUITE_LOAD_KEY";
    expect(process.env[variable]).toBeUndefined();
    const { root, base } = plantRepository();
    const throwsWithoutVariable = (): Readonly<Record<string, string>> =>
      process.env[variable] === undefined
        ? { [SUBJECT_TEST]: `\nError: ${variable} is not set\n    at ${SUBJECT_TEST}:2:9\n` }
        : {};
    const vitest = fakeVitest({
      failing: headMutated(["pins the limit"]),
      unloaded: throwsWithoutVariable,
    });

    const result = await command(root, [makeCase()], vitest.exec, ["--base", base]);

    const entry = `${SUBJECT_TEST}::(the file failed): Error: ${variable} is not set`;
    expect(result.code).toBe(1);
    expect(caseOf(result.record, "pins-limit")).toMatchObject({
      verdict: "UNDECIDED",
      reason: "both-unreadable",
      red: { base: [entry], head: [entry] },
    });
  });

  it("shares the clean runs between cases and keeps only the cases --only names", async () => {
    const { root, base } = plantRepository();
    const vitest = fakeVitest({ failing: headMutated(["pins the limit"]) });
    const second = makeCase({ id: "second", replace: "limit = 22" });

    const both = await command(root, [makeCase(), second], vitest.exec, ["--base", base]);
    const only = await command(root, [makeCase(), second], fakeVitest().exec, [
      "--base",
      base,
      "--only",
      "second",
    ]);

    expect(vitest.runs).toHaveLength(6);
    expect(JSON.parse(both.record ?? "{}").cases).toHaveLength(2);
    expect(
      (JSON.parse(only.record ?? "{}").cases as { id: string }[]).map((entry) => entry.id)
    ).toEqual(["second"]);
  });

  it("serves the head content from --head and records the head's sha", async () => {
    const { root, base, head } = plantRepository(true);
    const vitest = fakeVitest({ failing: headMutated(["pins the limit"]) });

    const result = await command(root, [makeCase()], vitest.exec, [
      "--base",
      base,
      "--head",
      "HEAD",
    ]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.record ?? "{}")).toMatchObject({ base, head, version: 1 });
    expect(vitest.runs[1]?.served[path.join(root, SUBJECT_TEST)]).toBe(
      testText(SUBJECT_TEST, "head")
    );
  });

  it("writes the same bytes for the same input", async () => {
    const { root, base } = plantRepository();
    const plan = { failing: headMutated(["pins the limit"]) };

    const one = await command(root, [makeCase()], fakeVitest(plan).exec, ["--base", base]);
    const two = await command(root, [makeCase()], fakeVitest(plan).exec, ["--base", base]);

    expect(one.record).not.toBeNull();
    expect(one.record).toBe(two.record);
  });

  it.each([
    ["an unknown key", [makeCase({ extra: true })], [], 'unknown key "extra"'],
    [
      "an --only that names no case",
      [makeCase()],
      ["--only", "nope"],
      "--only names no case: nope",
    ],
    [
      "a test neither ledger runs with a runner this tool knows",
      [makeCase({ test: "pkg/tests/none.test.ts", blocks: ["pkg/tests/none.test.ts::x"] })],
      [],
      "field \"test\" names pkg/tests/none.test.ts, which neither the working tree's ledger nor its base's runs with a vitest config or node:test's integration tier",
    ],
  ])("exits 2 on %s and writes no record", async (_name, cases, extra, message) => {
    const { root, base } = plantRepository();

    const result = await command(root, cases, fakeVitest().exec, ["--base", base, ...extra]);

    expect([result.code, result.record]).toEqual([2, null]);
    expect(result.output).toContain(message);
  });

  it("exits 3 when the case file cannot be read", async () => {
    const { root } = plantRepository();
    const out = path.join(scratchDir("mutation-diff-out-"), "record.json");

    const result = await cli.main([
      "--root",
      root,
      "--cases",
      path.join(root, "absent.json"),
      "--out",
      out,
    ]);

    expect(result.code).toBe(3);
    expect(result.output).toContain("mutation-diff: unread: ");
  });

  it("exits 3 when git cannot resolve the base", async () => {
    const { root } = plantRepository();

    const result = await command(root, [makeCase()], fakeVitest().exec, ["--base", "no-such-ref"]);

    expect([result.code, result.record]).toEqual([3, null]);
    expect(result.output).toContain("no-such-ref");
  });

  it("exits 3 when the runner does not start", async () => {
    const { root, base } = plantRepository();

    const result = await command(root, [makeCase()], fakeVitest({ spawnError: true }).exec, [
      "--base",
      base,
    ]);

    expect([result.code, result.record]).toEqual([3, null]);
    expect(result.output).toContain("the runner did not start: spawn ENOENT");
  });
});

const TWIN_TEST = "twin/tests/twin.test.ts";
const TWIN_CONFIG = "twin/vitest.config.ts";
const TWIN_TITLE = "holds its own";

/** Appends rows to the ledger a side's `writeSide` wrote. */
const addRows = (root: string, rows: readonly Record<string, unknown>[]): void => {
  const ledger = JSON.parse(readFileSync(path.join(root, "ledger.json"), "utf8")) as {
    files: Record<string, unknown>[];
  };
  writeFile(root, "ledger.json", `${JSON.stringify({ files: [...ledger.files, ...rows] })}\n`);
};

/** Plants a second vitest project, `twin/`, whose one test the ledger runs with its own config. */
const plantTwin = (root: string): void => {
  writeFile(root, TWIN_CONFIG, "export default {};\n");
  writeFile(
    root,
    TWIN_TEST,
    `import { describe, expect, it } from "vitest";\n\ndescribe("twin", () => {\n  it(${JSON.stringify(TWIN_TITLE)}, () => {\n    expect(1).toBe(1);\n  });\n});\n`
  );
  addRows(root, [{ path: TWIN_TEST, framework: "vitest", collectors: [`vitest:${TWIN_CONFIG}`] }]);
};

/**
 * A replaced vitest over both projects: a run of `twin/` reports the twin's test, red where
 * `failing` names its title, and never marks the mutation applied, since it does not load the
 * subject; any other run is `fakeVitest`'s. Each run's generated config is kept beside it.
 */
const projectsVitest = (
  failing: (run: VitestRun) => readonly string[] = () => []
): { runs: { run: VitestRun; config: string }[]; exec: (run: VitestRun) => Promise<Ran> } => {
  const runs: { run: VitestRun; config: string }[] = [];
  const inner = fakeVitest({ failing });
  const exec = (vitestRun: VitestRun): Promise<Ran> => {
    const config = vitestRun.args[vitestRun.args.indexOf("--config") + 1] ?? "";
    runs.push({ run: vitestRun, config: readFileSync(config, "utf8") });
    if (vitestRun.cwd !== path.join(vitestRun.root, "twin")) return inner.exec(vitestRun);
    const red = failing(vitestRun).includes(TWIN_TITLE);
    const testResults = vitestRun.files.map((file) => ({
      name: vitestRun.paths[file] ?? path.join(vitestRun.root, file),
      status: red ? FAIL : PASS,
      assertionResults: [
        {
          ancestorTitles: ["twin"],
          title: TWIN_TITLE,
          fullName: `twin ${TWIN_TITLE}`,
          status: red ? FAIL : PASS,
        },
      ],
    }));
    writeFileSync(vitestRun.report, JSON.stringify({ testResults }));
    for (const served of Object.keys(vitestRun.served)) {
      appendFileSync(vitestRun.servedLog, `${served}\n`);
    }
    return Promise.resolve({
      status: red ? 1 : 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      spawnError: null,
    });
  };
  return { runs, exec };
};

/** Names a run by its side, its state, the package it ran from and its files. */
const runName = (root: string, vitestRun: VitestRun): string =>
  `${vitestRun.side}${vitestRun.mutated ? "*" : ""} ${path.relative(root, vitestRun.cwd)} ${vitestRun.files.join(",")}`;

describe("main: a scope entry of another vitest project", () => {
  it("runs the twin under its own config, rooted at its package, in a run of its own per side and state, and merges its red into the case", async () => {
    const { root, base } = plantRepository(false, plantTwin);
    const vitest = projectsVitest((each) => {
      if (!each.mutated) return [];
      if (each.cwd === path.join(root, "twin")) return [TWIN_TITLE];
      return each.side === "head" ? ["pins the limit"] : [];
    });

    const result = await command(root, [makeCase({ scope: [TWIN_TEST] })], vitest.exec, [
      "--base",
      base,
    ]);

    expect(result.code).toBe(0);
    expect(caseOf(result.record, "pins-limit")).toMatchObject({
      red: {
        base: [`${TWIN_TEST}::twin > ${TWIN_TITLE}`],
        head: [
          "pkg/tests/subject.test.ts::subject > pins the limit",
          `${TWIN_TEST}::twin > ${TWIN_TITLE}`,
        ],
      },
      scope: { base: [...BASE_SCOPE, TWIN_TEST], head: [...HEAD_SCOPE, TWIN_TEST] },
      verdict: "NO-GAIN",
    });
    expect(vitest.runs.map((each) => runName(root, each.run)).sort()).toEqual(
      [
        `base pkg ${BASE_SCOPE.join(",")}`,
        `base twin ${TWIN_TEST}`,
        `head pkg ${HEAD_SCOPE.join(",")}`,
        `head twin ${TWIN_TEST}`,
        `base* pkg ${BASE_SCOPE.join(",")}`,
        `base* twin ${TWIN_TEST}`,
        `head* pkg ${HEAD_SCOPE.join(",")}`,
        `head* twin ${TWIN_TEST}`,
      ].sort()
    );
    for (const { run: each, config } of vitest.runs) {
      const project = path.relative(root, each.cwd);
      expect(config).toContain(
        `import base from ${JSON.stringify(path.join(root, project, "vitest.config.ts"))};`
      );
      expect(config).toContain(`root: ${JSON.stringify(path.join(root, project))}`);
    }
  });

  it.each([
    ["pkg/tests/nowhere.test.ts", null, "which the ledger does not list"],
    [
      "pkg/tests/flow.integration.test.ts",
      ["node:pkg/scripts/run-tests.sh#integration"],
      "run by node:pkg/scripts/run-tests.sh#integration, which this tool runs only as a case's own test",
    ],
    ["pkg/tests/idle.test.ts", [], "which no collector runs"],
  ] as const)(
    "refuses a scope entry %s with exit 2, naming the case, and runs nothing",
    async (entry, collectors, reason) => {
      const { root, base } = plantRepository(false, (planted) => {
        if (collectors === null) return;
        addRows(planted, [{ path: entry, framework: "vitest", collectors: [...collectors] }]);
      });
      const vitest = fakeVitest();

      const result = await command(root, [makeCase({ scope: [entry] })], vitest.exec, [
        "--base",
        base,
      ]);

      expect([result.code, result.record, vitest.runs.length]).toEqual([2, null, 0]);
      expect(result.output).toContain(
        `mutation-diff: refused: case pins-limit: field "scope" names ${entry}, ${reason}`
      );
    }
  );

  it("shares the twin's clean runs between two cases whose own runs differ, and spawns every other run", async () => {
    const { root, base } = plantRepository(false, plantTwin);
    const vitest = projectsVitest(headMutated(["pins the limit"]));
    const second = makeCase({
      id: "second",
      replace: "limit = 22",
      scope: [TWIN_TEST, "pkg/tests/unrelated.test.ts"],
    });

    const result = await command(root, [makeCase({ scope: [TWIN_TEST] }), second], vitest.exec, [
      "--base",
      base,
    ]);

    const twinRun = (each: VitestRun): boolean => each.cwd === path.join(root, "twin");
    const clean = vitest.runs.filter((each) => !each.run.mutated).map((each) => each.run);
    expect(result.code).toBe(0);
    expect(
      clean
        .filter(twinRun)
        .map((each) => each.side)
        .sort()
    ).toEqual(["base", "head"]);
    expect(clean.filter((each) => !twinRun(each))).toHaveLength(4);
    expect(vitest.runs.filter((each) => each.run.mutated)).toHaveLength(8);
    expect(vitest.runs).toHaveLength(14);
    expect(
      (JSON.parse(result.record ?? "{}") as { cases: { id: string; verdict: string }[] }).cases
        .map((entry) => `${entry.id} ${entry.verdict}`)
        .sort()
    ).toEqual(["pins-limit GAIN", "second GAIN"]);
  });

  it("keeps a case with no scope entry of another project to one run per side and state, from its own package", async () => {
    const { root, base } = plantRepository(false, plantTwin);
    const vitest = projectsVitest(headMutated(["pins the limit"]));

    const result = await command(root, [makeCase()], vitest.exec, ["--base", base]);

    expect(result.code).toBe(0);
    expect(caseOf(result.record, "pins-limit")).toMatchObject({
      red: { base: [], head: ["pkg/tests/subject.test.ts::subject > pins the limit"] },
      scope: { base: BASE_SCOPE, head: HEAD_SCOPE },
      verdict: "GAIN",
    });
    expect(vitest.runs.map((each) => runName(root, each.run)).sort()).toEqual(
      [
        `base pkg ${BASE_SCOPE.join(",")}`,
        `head pkg ${HEAD_SCOPE.join(",")}`,
        `base* pkg ${BASE_SCOPE.join(",")}`,
        `head* pkg ${HEAD_SCOPE.join(",")}`,
      ].sort()
    );
  });
});

const LONE_TEST = "pkg/tests/lone.test.ts";
const LONE_TITLE = "guards the lone limit";

/**
 * Plants, at the base only, a test of `pkg/` that alone imports a subject of its own,
 * `pkg/src/lone.ts`; the head holds the subject and neither the test nor its ledger row.
 */
const plantLone = (root: string, side: Side): void => {
  writeFile(root, "pkg/src/lone.ts", "export const lone = 20;\n");
  const sides: Record<Side, () => void> = {
    base: () => {
      writeFile(
        root,
        LONE_TEST,
        `import { describe, expect, it } from "vitest";\nimport { lone } from "../src/lone.js";\n\ndescribe("lone", () => {\n  it(${JSON.stringify(LONE_TITLE)}, () => {\n    expect(lone).toBe(20);\n  });\n});\n`
      );
      addRows(root, [
        { path: LONE_TEST, framework: "vitest", collectors: ["vitest:pkg/vitest.config.ts"] },
      ]);
    },
    head: () => rmSync(path.join(root, LONE_TEST), { force: true }),
  };
  sides[side]();
};

/** `fakeVitest`, whose report holds the lone test's block, red on a mutated run. */
const loneVitest = (): { runs: VitestRun[]; exec: (run: VitestRun) => Promise<Ran> } => {
  const inner = fakeVitest();
  const exec = async (vitestRun: VitestRun): Promise<Ran> => {
    const ran = await inner.exec(vitestRun);
    const status = vitestRun.mutated ? FAIL : PASS;
    const testResults = vitestRun.files.map((file) => ({
      name: vitestRun.paths[file] ?? path.join(vitestRun.root, file),
      status,
      assertionResults: [
        { ancestorTitles: ["lone"], title: LONE_TITLE, fullName: `lone ${LONE_TITLE}`, status },
      ],
    }));
    writeFileSync(vitestRun.report, JSON.stringify({ testResults }));
    return { ...ran, status: vitestRun.mutated ? 1 : 0 };
  };
  return { runs: inner.runs, exec };
};

describe("main: a scope entry's runner and a side's merged run", () => {
  it("refuses a scope entry a runner of another kind collects with exit 2, naming the case and the runner, and runs nothing", async () => {
    const entry = "pkg/e2e/flow.spec.ts";
    const runner = "playwright:apps/admin/playwright.config.ts";
    const { root, base } = plantRepository(false, (planted) =>
      addRows(planted, [{ path: entry, framework: "playwright", collectors: [runner] }])
    );
    const vitest = fakeVitest();

    const result = await command(root, [makeCase({ scope: [entry] })], vitest.exec, [
      "--base",
      base,
    ]);

    expect([result.code, result.record, vitest.runs.length]).toEqual([2, null, 0]);
    expect(result.output).toContain(
      `mutation-diff: refused: case pins-limit: field "scope" names ${entry}, run by ${runner}: this tool runs a vitest config or node:test's integration tier`
    );
  });

  it("spawns nothing for a side whose scope is empty and reads the deletion LOST", async () => {
    const { root, base } = plantRepository(false, plantLone);
    const vitest = loneVitest();

    const result = await command(
      root,
      [
        makeCase({
          id: "lone",
          kind: "deletion",
          test: LONE_TEST,
          blocks: [`${LONE_TEST}::${LONE_TITLE}`],
          subject: "pkg/src/lone.ts",
          search: "lone = 20",
          replace: "lone = 21",
        }),
      ],
      vitest.exec,
      ["--base", base]
    );

    expect(result.code).toBe(0);
    expect(caseOf(result.record, "lone")).toMatchObject({
      verdict: "LOST",
      scope: { base: [LONE_TEST], head: [] },
      red: { base: [`${LONE_TEST}::lone > ${LONE_TITLE}`], head: [] },
    });
    expect(vitest.runs.map((each) => runName(root, each))).toEqual([
      `base pkg ${LONE_TEST}`,
      `base* pkg ${LONE_TEST}`,
    ]);
  });

  it("reads a mutated side whose one run serves nothing and leaves no marker as UNDECIDED not-applied, the base tool's order", async () => {
    const { root, base } = plantRepository();
    const clean = fakeVitest();
    const mutated = fakeVitest({ applied: false, served: false });
    const exec = (vitestRun: VitestRun): Promise<Ran> =>
      (vitestRun.mutated ? mutated : clean).exec(vitestRun);

    const result = await command(root, [makeCase()], exec, ["--base", base]);

    expect(result.code).toBe(1);
    expect(caseOf(result.record, "pins-limit")).toMatchObject({
      verdict: "UNDECIDED",
      reason: "not-applied",
    });
    expect(mutated.runs.map((each) => runName(root, each))).toEqual([
      `base* pkg ${BASE_SCOPE.join(",")}`,
      `head* pkg ${HEAD_SCOPE.join(",")}`,
    ]);
  });
});
