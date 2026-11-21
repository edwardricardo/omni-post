/**
 * @file errorSitesGate.test.ts
 * @description Pins `scripts/testing/error-sites-gate.mjs`, the half of `pnpm check:errors` that
 *   holds what ESLint's suppressions of the `errors/` rules do not: S1 (every path of the baseline
 *   is tracked), S2 (and in its rule's scope), S3 (the history exists exactly while the baseline
 *   holds an entry, every row is a birth or a row of fixed and moved sites, and its sum equals the
 *   baseline per context), S4 (ESLint reaches every file of the scope with the rule at error, the
 *   held options and the plugin's own object, the plugin's package loads only its own `src`, and
 *   the list obeys its four rules), S5 (no directive turns an `errors/` rule off, nothing lets an
 *   unused entry pass, and the root `lint` script still reaches the whole tree), the birth written
 *   by `--record`, `--stalled` (the list is above zero and no history row is dated inside the
 *   window, in UTC, with `--remind`'s one issue a day), and every fail-closed path to exit 3, which
 *   wins over 1. Every case builds its own git repository in a scratch directory and passes its own
 *   `resolveRule`, its own clock and its own `gh`, so the suite needs no ESLint installation and
 *   reaches no GitHub; one case runs the real wiring on this repository.
 * @layer infrastructure
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Outcome = { exitCode: number; stdout: string[]; stderr: string[] };
type RuleState = { severity: number; options: unknown[] };
type Resolution = {
  ignored: boolean;
  rules: Record<string, RuleState>;
  pluginIsPackage: boolean;
  processed: boolean;
  parserIsPackage: boolean;
  languageIsJavaScript: boolean;
};
type ResolveRule = (file: string) => Promise<Resolution>;
type GitResult = { status: number; stdout: string; stderr: string };
type Git = (args: readonly string[]) => GitResult;
interface Exclusion {
  readonly glob: string;
  readonly kind: string;
  readonly reason: string;
}
type Exclusions = Readonly<Record<string, readonly Exclusion[]>>;
type Options = Readonly<Record<string, readonly unknown[]>>;
interface GateInput {
  root: string;
  git: Git;
  resolveRule: ResolveRule;
  exclusions?: Exclusions;
  options?: Options;
  base?: string;
  now?: Date;
}
interface Move {
  readonly from: string;
  readonly to: string;
  readonly count: number;
}
interface RecordInput {
  root: string;
  git: Git;
  date: string;
  slug: string;
  exclusions?: Exclusions;
  base?: string;
  moves?: readonly Move[];
  now?: Date;
}
interface Row {
  version: 1;
  born?: { rule: string; contexts: Record<string, number> };
  fixed?: Record<string, number>;
  moved?: Move[];
}
interface History {
  exists: boolean;
  rows: { file: string; row: Row; text: string }[];
  problems: string[];
}
type Gh = (args: readonly string[]) => string;
interface StallInput {
  root: string;
  days: number;
  now: Date;
  gh?: Gh;
}
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type GateModule = {
  BASELINE: string;
  HISTORY: string;
  LINT_SCRIPT: string;
  contextOf: (file: string) => string;
  LINT_PARSER: string;
  createGit: (root: string, environment?: NodeJS.ProcessEnv) => Git;
  createEslintResolver: (input: {
    root: string;
    namespace: string;
    packageName: string;
    parserPackage: string;
    overrideConfig?: unknown[];
  }) => Promise<ResolveRule>;
  runGate: (input: GateInput) => Promise<Outcome>;
  recordRow: (input: RecordInput) => Outcome;
  checkStall: (input: StallInput) => Outcome;
  readHistory: (root: string) => History;
  stateOf: (rows: readonly { row: Row }[]) => Map<string, number>;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const GATE_SCRIPT = path.join(REPO_ROOT, "scripts/testing/error-sites-gate.mjs");
const {
  BASELINE,
  HISTORY,
  LINT_SCRIPT,
  LINT_PARSER,
  contextOf,
  createGit,
  createEslintResolver,
  runGate,
  recordRow,
  checkStall,
  readHistory,
  stateOf,
} = (await import(GATE_SCRIPT)) as GateModule;
/** The function the gate's own git calls run through, which drops the variables of another repository. */
const { gitEnvironment: withoutForeignGit } = (await import(
  path.join(REPO_ROOT, "scripts/testing/lib/git-environment.mjs")
)) as { gitEnvironment: (environment?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv };

const RULE = "errors/no-inline-error";
const BODY_WRITER = "apps/api/src/lib/errors/sendProblem.ts";
const OPTIONS: Options = { [RULE]: [{ bodyWriter: BODY_WRITER }] };
const LIST: readonly Exclusion[] = [
  { glob: "**/*.test.{ts,tsx,mts,cts}", kind: "test-suffix", reason: "Test files by suffix" },
  { glob: "**/*.d.{ts,mts,cts}", kind: "declaration", reason: "No executable code" },
  { glob: "apps/*/tests/**", kind: "outside-src", reason: "Test code beside a source tree" },
  { glob: "scripts/**", kind: "whole-root", reason: "Tooling" },
  { glob: "packages/eslint-plugin-errors/**", kind: "whole-root", reason: "Tooling" },
];
const EXCLUSIONS: Exclusions = { [RULE]: LIST };
const PREFIX = "error-sites-gate: ";
const ROW = `${"scripts/testing/error-sites-history"}/2026-11-20-birth.json`;

const BIRTH = { version: 1, born: { rule: RULE, contexts: { "api/admin": 3, "core/auth": 2 } } };
const SUPPRESSIONS = {
  "apps/api/src/admin/a.ts": { [RULE]: { count: 3 }, "no-console": { count: 1 } },
  "packages/core/auth/src/x.ts": { [RULE]: { count: 2 } },
  "apps/api/tests/unit/t.test.ts": { "testing/no-empty-test": { count: 1 } },
};

let root = "";

const write = (file: string, content: string): void => {
  const full = path.join(root, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
};
const writeJson = (file: string, value: unknown): void =>
  write(file, `${JSON.stringify(value, null, 2)}\n`);
const remove = (file: string): void => rmSync(path.join(root, file), { recursive: true });

/**
 * The environment of every git call the suite makes or hands the gate: the one the gate builds,
 * so a `GIT_DIR`, `GIT_WORK_TREE` or `GIT_INDEX_FILE` of the host reaches neither, and no global or
 * system configuration of the host.
 */
const gitEnvironment = (): NodeJS.ProcessEnv => ({
  ...withoutForeignGit(process.env),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
});
const gitIn = (...args: string[]): string =>
  execFileSync("git", args, { cwd: root, env: gitEnvironment(), encoding: "utf8" });

/** A tree that passes: one rule born with five sites in two contexts, every rule of the list met. */
const plantClean = (): void => {
  write("package.json", `${JSON.stringify({ scripts: { lint: LINT_SCRIPT } }, null, 2)}\n`);
  write("apps/api/src/admin/a.ts", "export const a = 1;\n");
  write("apps/api/src/admin/b.ts", "// eslint-disable-next-line no-console -- a reason\n");
  write("apps/api/src/index.ts", "/* eslint-disable @typescript-eslint/no-explicit-any */\n");
  write("packages/core/auth/src/x.ts", "export const x = 1;\n");
  write("apps/api/src/admin/a.test.ts", "/* eslint-disable */\n");
  write("apps/api/src/types/f.d.ts", "export {};\n");
  write("apps/api/tests/unit/t.test.ts", "// eslint-disable-next-line errors/no-inline-error\n");
  write("scripts/tool.mjs", "export {};\n");
  write(BODY_WRITER, "export const sendProblem = (): void => {};\n");
  writeJson("packages/eslint-plugin-errors/package.json", {
    name: "@packages/eslint-plugin-errors",
    type: "module",
    exports: { ".": "./src/index.js" },
  });
  write(
    "packages/eslint-plugin-errors/src/index.js",
    [
      "// @ts-check",
      '/** @typedef {import("eslint").ESLint.Plugin} Plugin */',
      'import rule from "./rules/no-inline-error.js";',
      'export { rule } from "./rules/no-inline-error.js";',
      'export default { rules: { "no-inline-error": rule } };',
      "",
    ].join("\n")
  );
  write(
    "packages/eslint-plugin-errors/src/rules/no-inline-error.js",
    '/** @type {import("eslint").Rule.RuleModule} */\nexport default { create: () => ({}) };\n'
  );
  writeJson(BASELINE, SUPPRESSIONS);
  writeJson(ROW, BIRTH);
};

const RESOLVED: Resolution = {
  ignored: false,
  rules: { [RULE]: { severity: 2, options: [...(OPTIONS[RULE] ?? [])] } },
  pluginIsPackage: true,
  processed: false,
  parserIsPackage: true,
  languageIsJavaScript: true,
};
const IGNORED: Resolution = {
  ignored: true,
  rules: {},
  pluginIsPackage: false,
  processed: false,
  parserIsPackage: false,
  languageIsJavaScript: false,
};
/** Every check of the suite runs on this day, so no row of its fixtures is dated after today. */
const TODAY = new Date("2026-12-01T12:00:00Z");
/** A day before every run of the command line, which reads the real clock. */
const PAST_DAY = "2026-11-19";

/** A resolver that answers the clean state for every path but those given. */
const resolverOf =
  (overrides: Readonly<Record<string, Resolution>> = {}, asked: string[] = []): ResolveRule =>
  (file) => {
    asked.push(file);
    return Promise.resolve(overrides[file] ?? RESOLVED);
  };

const scan = (input: Partial<GateInput> = {}): Promise<Outcome> => {
  gitIn("add", "--all");
  return runGate({
    root,
    git: createGit(root, gitEnvironment()),
    resolveRule: resolverOf(),
    exclusions: EXCLUSIONS,
    options: OPTIONS,
    now: TODAY,
    ...input,
  });
};

const record = (input: Partial<RecordInput> = {}): Outcome =>
  recordRow({
    root,
    git: createGit(root, gitEnvironment()),
    date: "2026-11-21",
    slug: "birth",
    exclusions: EXCLUSIONS,
    now: TODAY,
    ...input,
  });

const importRefused = (specifier: string): string =>
  `imports "${specifier}", which is neither a relative path inside packages/eslint-plugin-errors/src nor a built-in the scope allows (node:path)`;

const PASS_STDOUT = [
  `${PREFIX}PASS`,
  `${PREFIX}5 sites in 2 contexts`,
  `${PREFIX}base: none (S6 to S10 skipped)`,
];

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "error-sites-gate-test-"));
  gitIn("init", "--quiet");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("a clean tree", () => {
  it("passes, with the total, the contexts and the base it read, asking ESLint only about the scope", async () => {
    plantClean();
    const asked: string[] = [];

    const outcome = await scan({ resolveRule: resolverOf({}, asked) });

    expect(outcome).toEqual({ exitCode: 0, stdout: PASS_STDOUT, stderr: [] });
    expect(asked.sort()).toEqual([
      "apps/api/src/admin/a.ts",
      "apps/api/src/admin/b.ts",
      "apps/api/src/index.ts",
      BODY_WRITER,
      "packages/core/auth/src/x.ts",
    ]);
  });

  it("asserts nothing of an excluded file, even one ESLint ignores", async () => {
    plantClean();
    const ignored = IGNORED;

    const outcome = await scan({
      resolveRule: resolverOf({
        "apps/api/src/admin/a.test.ts": ignored,
        "scripts/tool.mjs": ignored,
      }),
    });

    expect(outcome.exitCode).toBe(0);
  });
});

describe("S1 and S2: the paths of the baseline", () => {
  it("S1 refuses an entry whose file git does not track", async () => {
    plantClean();
    remove("apps/api/src/admin/a.ts");

    const outcome = await scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(
      `${PREFIX}apps/api/src/admin/a.ts: ${BASELINE} counts 3 ${RULE} sites in it, and git tracks no such file: run "pnpm exec eslint . --prune-suppressions"`
    );
  });

  it("S2 refuses an entry whose file its rule's list excludes, naming the entry", async () => {
    plantClean();
    writeJson(BASELINE, {
      ...SUPPRESSIONS,
      "apps/api/tests/unit/t.test.ts": { [RULE]: { count: 1 } },
    });
    writeJson(ROW, {
      version: 1,
      born: { rule: RULE, contexts: { "api/admin": 3, "core/auth": 2, api: 1 } },
    });

    const outcome = await scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual([
      `${PREFIX}apps/api/tests/unit/t.test.ts: ${BASELINE} counts 1 ${RULE} site in it, and the rule's scope excludes it ("**/*.test.{ts,tsx,mts,cts}", test-suffix)`,
    ]);
  });

  it("S2 refuses an entry of a file with no TypeScript extension, and one of a rule the gate holds no scope for", async () => {
    plantClean();
    write("apps/api/src/legacy.js", "export {};\n");
    writeJson(BASELINE, {
      ...SUPPRESSIONS,
      "apps/api/src/legacy.js": { [RULE]: { count: 1 } },
      "apps/api/src/admin/b.ts": { "errors/other-rule": { count: 1 } },
    });

    const outcome = await scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(
      `${PREFIX}apps/api/src/legacy.js: ${BASELINE} counts 1 ${RULE} site in it, and it has none of the scope's extensions (.ts, .tsx, .mts, .cts)`
    );
    expect(outcome.stderr).toContain(
      `${PREFIX}apps/api/src/admin/b.ts: ${BASELINE} counts 1 errors/other-rule site in it, a rule the gate holds no scope for`
    );
  });
});

describe("S3: the history", () => {
  it("refuses a baseline with errors/ entries and no history, naming the command that records the birth", async () => {
    plantClean();
    remove("scripts/testing/error-sites-history");

    const outcome = await scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(
      `${PREFIX}${HISTORY}: ${BASELINE} holds 2 errors/ entries and there is no history: record the birth with "node scripts/testing/error-sites-gate.mjs --record --date <YYYY-MM-DD> --slug <slug>"`
    );
  });

  it("refuses a history with no errors/ entry left in the baseline", async () => {
    plantClean();
    writeJson(BASELINE, {
      "apps/api/tests/unit/t.test.ts": { "testing/no-empty-test": { count: 1 } },
    });

    const outcome = await scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual([
      `${PREFIX}${HISTORY}: the history exists and ${BASELINE} holds no errors/ entry: delete the history in this change`,
    ]);
  });

  it("passes with no history and no errors/ entry, which is the end of the sweep", async () => {
    plantClean();
    remove("scripts/testing/error-sites-history");
    writeJson(BASELINE, {
      "apps/api/tests/unit/t.test.ts": { "testing/no-empty-test": { count: 1 } },
    });

    const outcome = await scan();

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout[1]).toBe(`${PREFIX}0 sites in 0 contexts`);
  });

  it("sums births, fixed sites and moves in any order, each move taking its count from the context of its source", async () => {
    plantClean();
    writeJson(ROW, {
      version: 1,
      born: { rule: RULE, contexts: { "api/admin": 6, "core/auth": 2 } },
    });
    writeJson("scripts/testing/error-sites-history/2026-11-22-admin.json", {
      version: 1,
      fixed: { "api/admin": 2 },
    });
    writeJson("scripts/testing/error-sites-history/2026-11-21-split.json", {
      version: 1,
      moved: [{ from: "apps/api/src/admin/b.ts", to: "apps/api/src/index.ts", count: 1 }],
    });
    writeJson(BASELINE, { ...SUPPRESSIONS, "apps/api/src/index.ts": { [RULE]: { count: 1 } } });

    const outcome = await scan();

    expect(outcome.stderr).toEqual([]);
    expect(outcome.stdout[1]).toBe(`${PREFIX}6 sites in 3 contexts`);
  });

  it("refuses a context whose history yields another count than the baseline, with both counts", async () => {
    plantClean();
    writeJson(ROW, {
      version: 1,
      born: { rule: RULE, contexts: { "api/admin": 4, "core/auth": 2 } },
    });

    const outcome = await scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual([
      `${PREFIX}api/admin: the history yields 4 sites and ${BASELINE} 3`,
    ]);
  });

  it("refuses the birth of a rule the gate holds no scope for, and a rule born twice", async () => {
    plantClean();
    writeJson("scripts/testing/error-sites-history/2026-11-21-other.json", {
      version: 1,
      born: { rule: "errors/other-rule", contexts: { workers: 1 } },
    });
    writeJson("scripts/testing/error-sites-history/2026-11-21-again.json", BIRTH);

    const outcome = await scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(
      `${PREFIX}${HISTORY}/2026-11-21-other.json: bears the birth of errors/other-rule, a rule the gate holds no scope for`
    );
    expect(outcome.stderr).toContain(
      `${PREFIX}${HISTORY}/2026-11-21-again.json: bears the birth of ${RULE}, which ${HISTORY}/2026-11-20-birth.json bears too`
    );
  });

  it("refuses a rule whose entries no row bears the birth of", async () => {
    plantClean();
    writeJson(ROW, { version: 1, fixed: { "api/admin": 1 } });

    const outcome = await scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(
      `${PREFIX}${RULE}: ${BASELINE} holds its entries and no row of the history bears its birth`
    );
  });

  it.each([
    ["a version other than 1", { version: 2, fixed: { workers: 1 } }],
    ["a birth and a fix in one row", { version: 1, born: BIRTH.born, fixed: { workers: 1 } }],
    ["a row with neither form", { version: 1 }],
    ["a count that is no positive integer", { version: 1, fixed: { workers: 0 } }],
    ["an empty list of moves", { version: 1, moved: [] }],
    ["a move onto its own source", { version: 1, moved: [{ from: "a.ts", to: "a.ts", count: 1 }] }],
    ["a birth with no context", { version: 1, born: { rule: RULE, contexts: {} } }],
  ])("fails closed on a row with %s", async (_label, row) => {
    plantClean();
    writeJson("scripts/testing/error-sites-history/2026-11-21-bad.json", row);

    const outcome = await scan();

    expect(outcome.exitCode).toBe(3);
    expect(outcome.stderr[0]).toMatch(
      new RegExp(`^${PREFIX}${HISTORY}/2026-11-21-bad\\.json: is not a row of the history: `)
    );
  });

  it("fails closed on a row that is not JSON, and on a file of the history with no row's name", async () => {
    plantClean();
    write("scripts/testing/error-sites-history/2026-11-21-bad.json", "{ not json\n");
    write("scripts/testing/error-sites-history/notes.md", "a stray file\n");

    const outcome = await scan();

    expect(outcome.exitCode).toBe(3);
    expect(outcome.stderr).toContain(
      `${PREFIX}${HISTORY}/notes.md: is not named <YYYY-MM-DD>-<slug>.json, so it is no row of the history`
    );
    expect(
      outcome.stderr.some((line) =>
        line.startsWith(`${PREFIX}${HISTORY}/2026-11-21-bad.json: is not JSON`)
      )
    ).toBe(true);
  });
});

describe("S4: ESLint reaches the scope", () => {
  it.each<[string, Resolution, string]>([
    ["ignored", IGNORED, "ESLint ignores it"],
    ["missing", { ...RESOLVED, rules: {} }, "the rule is not on"],
    [
      "at warn",
      { ...RESOLVED, rules: { [RULE]: { severity: 1, options: [...(OPTIONS[RULE] ?? [])] } } },
      "the rule is at warn, not error",
    ],
    [
      "with other options",
      { ...RESOLVED, rules: { [RULE]: { severity: 2, options: [{ bodyWriter: "a.ts" }] } } },
      'the rule\'s options are [{"bodyWriter":"a.ts"}], not the held [{"bodyWriter":"apps/api/src/lib/errors/sendProblem.ts"}]',
    ],
    [
      "from a copy of the plugin",
      { ...RESOLVED, pluginIsPackage: false },
      "the errors plugin ESLint resolves is not the object @packages/eslint-plugin-errors exports",
    ],
    [
      "behind a processor",
      { ...RESOLVED, processed: true },
      "a processor reads it, so the rule need not see the file's text",
    ],
    [
      "read by another parser",
      { ...RESOLVED, parserIsPackage: false },
      "its parser is not the object @typescript-eslint/parser exports",
    ],
    [
      "in another language",
      { ...RESOLVED, languageIsJavaScript: false },
      "it is not linted in ESLint's own JavaScript language",
    ],
  ])("refuses a file of the scope with the rule %s", async (_label, resolution, problem) => {
    plantClean();

    const outcome = await scan({
      resolveRule: resolverOf({ "apps/api/src/admin/b.ts": resolution }),
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual([`${PREFIX}apps/api/src/admin/b.ts: ${RULE}: ${problem}`]);
  });

  it("holds the rule's bodyWriter to a set option naming a tracked file", async () => {
    plantClean();
    const held = (options: readonly unknown[]): Promise<Outcome> =>
      scan({
        options: { [RULE]: options },
        resolveRule: () =>
          Promise.resolve({
            ...RESOLVED,
            rules: { [RULE]: { severity: 2, options: [...options] } },
          }),
      });

    const right = await held([{ bodyWriter: BODY_WRITER }]);
    const unset = await held([{}]);
    const none = await held([]);
    const untracked = await held([{ bodyWriter: "apps/api/src/lib/errors/elsewhere.ts" }]);

    expect(right.exitCode).toBe(0);
    const unsetLine = `${PREFIX}${RULE}: its option "bodyWriter" is not set: the rule must name the one file that writes the error body`;
    expect(unset).toEqual({ exitCode: 1, stdout: [], stderr: [unsetLine] });
    expect(none).toEqual({ exitCode: 1, stdout: [], stderr: [unsetLine] });
    expect(untracked).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: [
        `${PREFIX}${RULE}: its option "bodyWriter" names apps/api/src/lib/errors/elsewhere.ts, which git does not track: it must name the file that writes the error body`,
      ],
    });
  });

  it("names at most twenty files per problem, then counts the rest", async () => {
    plantClean();
    for (let index = 0; index < 23; index += 1)
      write(`apps/api/src/many/f${String(index).padStart(2, "0")}.ts`, "");
    const ignored = IGNORED;
    const overrides = Object.fromEntries(
      Array.from({ length: 23 }, (_, index) => [
        `apps/api/src/many/f${String(index).padStart(2, "0")}.ts`,
        ignored,
      ])
    );

    const outcome = await scan({ resolveRule: resolverOf(overrides) });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toHaveLength(21);
    expect(outcome.stderr[0]).toBe(`${PREFIX}apps/api/src/many/f00.ts: ${RULE}: ESLint ignores it`);
    expect(outcome.stderr[20]).toBe(
      `${PREFIX}${RULE}: ESLint ignores it in 3 more files of the scope`
    );
  });

  it("fails closed when ESLint's configuration cannot be resolved, and exit 3 wins over 1 with both printed", async () => {
    plantClean();
    remove("apps/api/src/admin/a.ts");

    const outcome = await scan({
      resolveRule: () => Promise.reject(new Error("eslint.config.ts did not load")),
    });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.stderr[0]).toBe(
      `${PREFIX}ESLint's configuration could not be resolved for apps/api/src/admin/b.ts: eslint.config.ts did not load`
    );
    expect(outcome.stderr.some((line) => line.includes("git tracks no such file"))).toBe(true);
  });

  it("refuses an entry that matches no tracked file, so the list names only what exists", async () => {
    plantClean();
    const list = [
      ...LIST,
      { glob: "performance/**", kind: "whole-root", reason: "Measurement code" },
    ];

    const outcome = await scan({ exclusions: { [RULE]: list } });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual([
      `${PREFIX}${RULE}: the exclusion "performance/**" (whole-root) matches no tracked file: remove it`,
    ]);
  });

  it("refuses an outside-src entry that matches a file under a src directory, and keeps that file in scope", async () => {
    plantClean();
    const list = [...LIST, { glob: "apps/api/**", kind: "outside-src", reason: "Too wide" }];
    const asked: string[] = [];

    const outcome = await scan({
      exclusions: { [RULE]: list },
      resolveRule: resolverOf({}, asked),
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual([
      `${PREFIX}${RULE}: the exclusion "apps/api/**" is of kind outside-src and matches apps/api/src/admin/a.test.ts, a file under a src directory: only a test suffix, a declaration or a whole root may exclude one`,
    ]);
    expect(asked).toContain("apps/api/src/admin/a.ts");
  });

  it("refuses an entry whose files do not carry what its kind claims, and a whole root that is no root", async () => {
    plantClean();
    const list = [
      ...LIST,
      { glob: "apps/api/src/index.ts", kind: "test-suffix", reason: "Mislabelled" },
      { glob: "apps/api/src/index.ts", kind: "declaration", reason: "Mislabelled" },
      { glob: "**/types/**", kind: "whole-root", reason: "No root" },
      { glob: "apps/api/src/admin/b.ts", kind: "generated", reason: "No such kind" },
    ];

    const outcome = await scan({ exclusions: { [RULE]: list } });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual([
      `${PREFIX}${RULE}: the exclusion "apps/api/src/index.ts" is of kind test-suffix and matches apps/api/src/index.ts, which carries no test suffix`,
      `${PREFIX}${RULE}: the exclusion "apps/api/src/index.ts" is of kind declaration and matches apps/api/src/index.ts, which is no declaration file`,
      `${PREFIX}${RULE}: the exclusion "**/types/**" is of kind whole-root and is not a root followed by "/**"`,
      `${PREFIX}${RULE}: the exclusion "apps/api/src/admin/b.ts" has the kind "generated", which is none of test-suffix, declaration, outside-src, whole-root`,
    ]);
  });

  it("refuses a JavaScript file under a src directory outside the excluded roots", async () => {
    plantClean();
    write("packages/core/auth/src/hidden.mjs", "export {};\n");
    write("packages/eslint-plugin-errors/src/rules/extra.js", "export {};\n");

    const outcome = await scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual([
      `${PREFIX}packages/core/auth/src/hidden.mjs: a JavaScript file under a src directory, which the rule does not read: write it in TypeScript, or exclude its whole root`,
    ]);
  });

  it("refuses a plugin package whose exports leave its src", async () => {
    plantClean();
    writeJson("packages/eslint-plugin-errors/package.json", {
      name: "@packages/eslint-plugin-errors",
      exports: { ".": "./lib/index.js" },
    });

    const outcome = await scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual([
      `${PREFIX}packages/eslint-plugin-errors/package.json: its "exports" is {".":"./lib/index.js"}, not {".":"./src/index.js"}`,
    ]);
  });

  it("refuses an import of the plugin's src that is a package, leaves src, or is no literal; a type in a comment is no import", async () => {
    plantClean();
    write(
      "packages/eslint-plugin-errors/src/rules/no-inline-error.js",
      [
        '/** @type {import("eslint").Rule.RuleModule} */',
        'import ts from "typescript";',
        'import { copy } from "../../../../scripts/weak-rule.js";',
        "const name = './x.js';",
        "const later = () => import(name);",
        'const loaded = require("./helpers.js");',
        "export default { create: () => ({ ts, copy, later, loaded }) };",
        "",
      ].join("\n")
    );

    const outcome = await scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual([
      `${PREFIX}packages/eslint-plugin-errors/src/rules/no-inline-error.js:2: ${importRefused("typescript")}`,
      `${PREFIX}packages/eslint-plugin-errors/src/rules/no-inline-error.js:3: ${importRefused("../../../../scripts/weak-rule.js")}`,
      `${PREFIX}packages/eslint-plugin-errors/src/rules/no-inline-error.js:5: imports a module whose specifier is no string literal, so where it leads cannot be read`,
    ]);
  });

  it("lets the plugin's src import node:path, the one built-in the scope allows, and no other", async () => {
    plantClean();
    write(
      "packages/eslint-plugin-errors/src/rules/no-inline-error.js",
      [
        'import path from "node:path";',
        'import { createRequire } from "node:module";',
        'import plain from "path";',
        'const vm = require("node:vm");',
        'import { readFileSync } from "node:fs";',
        "export default { create: () => ({ path, createRequire, plain, vm, readFileSync }) };",
        "",
      ].join("\n")
    );

    const outcome = await scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual(
      [
        ["2", "node:module"],
        ["3", "path"],
        ["4", "node:vm"],
        ["5", "node:fs"],
      ].map(
        ([line, specifier]) =>
          `${PREFIX}packages/eslint-plugin-errors/src/rules/no-inline-error.js:${line}: ${importRefused(specifier ?? "")}`
      )
    );
  });

  it("fails closed when the plugin's manifest cannot be read", async () => {
    plantClean();
    remove("packages/eslint-plugin-errors/package.json");

    const outcome = await scan();

    expect(outcome.exitCode).toBe(3);
    expect(outcome.stderr[0]).toMatch(
      new RegExp(
        `^${PREFIX}packages/eslint-plugin-errors/package\\.json could not be read, so the plugin's entry point was not checked: `
      )
    );
  });
});

describe("S5: nothing turns the rule off", () => {
  it.each([
    [
      "names the rule",
      "// eslint-disable-next-line errors/no-inline-error -- reason\n",
      "names errors/no-inline-error",
    ],
    [
      "names it among others",
      "/* eslint-disable no-console, errors/no-inline-error */\n",
      "names errors/no-inline-error",
    ],
    ["names no rule, as a block", "const a = 1; /* eslint-disable */\n", "names no rule"],
    ["names no rule, on its line", "f(); // eslint-disable-line\n", "names no rule"],
    ["names no rule, across lines", "/*\n  eslint-disable\n*/\n", "names no rule"],
  ])("refuses a directive in a file of the scope that %s", async (_label, text, what) => {
    plantClean();
    write("apps/api/src/admin/a.ts", `export const a = 1;\n${text}`);

    const outcome = await scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual([
      `${PREFIX}apps/api/src/admin/a.ts:2: an eslint-disable directive that ${what}: no directive turns an errors/ rule off in a file of its scope`,
    ]);
  });

  it.each([
    ["turns it off", '/* eslint errors/no-inline-error: "off" */\n'],
    [
      "overrides its options",
      '/* eslint "errors/no-inline-error": ["error", { "replyHelpers": [] }] */\n',
    ],
    [
      "configures it beside another rule",
      '/* eslint no-console: "off", errors/no-inline-error: 0 */\n',
    ],
  ])(
    "refuses an eslint configuration comment in a file of the scope that %s",
    async (_label, text) => {
      plantClean();
      write("apps/api/src/admin/a.ts", `export const a = 1;\n${text}`);

      const outcome = await scan();

      expect(outcome).toEqual({
        exitCode: 1,
        stdout: [],
        stderr: [
          `${PREFIX}apps/api/src/admin/a.ts:2: an eslint configuration comment that configures errors/no-inline-error: no comment changes an errors/ rule in a file of its scope`,
        ],
      });
    }
  );

  it("lets a configuration comment of another plugin's rule stand in the same file", async () => {
    plantClean();
    write(
      "apps/api/src/admin/a.ts",
      'export const a = 1;\n/* eslint no-console: "off", "@typescript-eslint/no-explicit-any": "warn" */\n'
    );

    const outcome = await scan();

    expect(outcome.stderr).toEqual([]);
    expect(outcome.exitCode).toBe(0);
  });

  it.each(["packages/core/auth/package.json", ".husky/pre-commit", ".github/workflows/ci.yml"])(
    "refuses pass-on-unpruned-suppressions in %s",
    async (file) => {
      plantClean();
      write(file, "first line\neslint . --pass-on-unpruned-suppressions\n");

      const outcome = await scan();

      expect(outcome.exitCode).toBe(1);
      expect(outcome.stderr).toEqual([
        `${PREFIX}${file}:2: holds "pass-on-unpruned-suppressions", which lets an unused entry of ${BASELINE} pass`,
      ]);
    }
  );

  it("refuses a root lint script other than the one the gate holds", async () => {
    plantClean();
    write(
      "package.json",
      `${JSON.stringify({ scripts: { lint: "eslint apps --max-warnings 0" } }, null, 2)}\n`
    );

    const outcome = await scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual([
      `${PREFIX}package.json: its "lint" script is "eslint apps --max-warnings 0", not "${LINT_SCRIPT}": the lint run must reach the whole tree`,
    ]);
  });

  it("holds the root lint script as the repository writes it", () => {
    const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(LINT_SCRIPT).toBe(manifest.scripts["lint"]);
  });
});

describe("fail-closed inputs", () => {
  it("fails closed when git cannot list the tree, and when it lists no file", async () => {
    plantClean();
    const broken: Git = () => ({ status: 128, stdout: "", stderr: "fatal: not a git repository" });

    const failing = await runGate({
      root,
      git: broken,
      resolveRule: resolverOf(),
      exclusions: EXCLUSIONS,
      options: OPTIONS,
    });
    const empty = await runGate({
      root,
      git: () => ({ status: 0, stdout: "", stderr: "" }),
      resolveRule: resolverOf(),
      exclusions: EXCLUSIONS,
      options: OPTIONS,
    });

    expect(failing.exitCode).toBe(3);
    expect(failing.stderr).toEqual([`${PREFIX}git ls-files failed: fatal: not a git repository`]);
    expect(empty.exitCode).toBe(3);
    expect(empty.stderr).toEqual([
      `${PREFIX}git tracks no file: a scan that read nothing is not clean`,
    ]);
  });

  it.each([
    ["is not JSON", "{ broken\n", /is not JSON/],
    [
      "counts with a string",
      JSON.stringify({ "a.ts": { [RULE]: { count: "3" } } }),
      /"a\.ts" > "errors\/no-inline-error" is not \{ "count": <positive integer> \}/,
    ],
    ["is an array", "[]", /is not an object of paths/],
  ])("fails closed when %s", async (_label, text, message) => {
    plantClean();
    write(BASELINE, text);

    const outcome = await scan();

    expect(outcome.exitCode).toBe(3);
    expect(outcome.stderr[0]).toMatch(message);
  });

  it("reads a missing suppressions file as no entry, as ESLint does", async () => {
    plantClean();
    remove(BASELINE);
    remove("scripts/testing/error-sites-history");

    const outcome = await scan();

    expect(outcome.exitCode).toBe(0);
  });

  it("fails closed on a base that cannot be resolved, and names a base it resolved", async () => {
    plantClean();
    gitIn("add", "--all");
    gitIn(
      "-c",
      "user.email=gate@example.test",
      "-c",
      "user.name=Gate",
      "commit",
      "--quiet",
      "-m",
      "base"
    );

    const missing = await scan({ base: "no-such-ref" });
    const found = await scan({ base: "HEAD" });

    expect(missing.exitCode).toBe(3);
    expect(missing.stderr[0]).toMatch(
      new RegExp(`^${PREFIX}the base "no-such-ref" could not be resolved`)
    );
    expect(found.exitCode).toBe(0);
    expect(found.stdout[2]).toBe(`${PREFIX}base: HEAD`);
  });
});

const SECOND = "errors/second-rule";
const commit = (message: string): void => {
  gitIn("add", "--all");
  gitIn(
    "-c",
    "user.email=gate@example.test",
    "-c",
    "user.name=Gate",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    message
  );
};
/** Commits the clean tree, and whatever was planted beside it, as the base, tagged `base`. */
const commitBase = (): void => {
  commit("base");
  gitIn("tag", "base");
};
/** Commits the head and runs the gate against the base. */
const againstBase = (input: Partial<GateInput> = {}): Promise<Outcome> => {
  commit("head");
  return scan({ base: "base", ...input });
};
const touch = (file: string): void =>
  write(file, `${readFileSync(path.join(root, file), "utf8")}export const changed = true;\n`);
const move = (from: string, to: string): void => {
  write(to, readFileSync(path.join(root, from), "utf8"));
  remove(from);
};
/** The clean baseline with the given counts set; a count of 0 removes the rule's entry. */
const setCounts = (counts: Readonly<Record<string, Readonly<Record<string, number>>>>): void => {
  const next: Record<string, Record<string, { count: number }>> = JSON.parse(
    JSON.stringify(SUPPRESSIONS)
  ) as Record<string, Record<string, { count: number }>>;
  for (const [file, rules] of Object.entries(counts)) {
    const merged = { ...(next[file] ?? {}) };
    for (const [rule, count] of Object.entries(rules)) merged[rule] = { count };
    next[file] = Object.fromEntries(Object.entries(merged).filter(([, entry]) => entry.count > 0));
  }
  writeJson(
    BASELINE,
    Object.fromEntries(Object.entries(next).filter(([, rules]) => Object.keys(rules).length > 0))
  );
};
const addRow = (name: string, value: unknown): void => writeJson(`${HISTORY}/${name}`, value);
const A = "apps/api/src/admin/a.ts";
const B = "apps/api/src/admin/b.ts";
const X = "packages/core/auth/src/x.ts";
const riseLine = (file: string, head: number, base: number): string =>
  `${PREFIX}${file}: ${RULE} counts ${String(head)} ${head === 1 ? "site" : "sites"}, and the base counts ${String(base)}: a count never rises against the base; ` +
  `fix the sites the change added and run "pnpm exec eslint . --prune-suppressions", or, when they moved from another file of its context, record the move with --moved <from>:${file}:<count>; ` +
  "a renamed file needs no move: the gate reads renames from HEAD, so commit the rename and run again";
/**
 * S7's verdict on a count that fell where git reports its file unchanged, as `how` says; with
 * `uncommitted`, the hint the gate adds when the file holds a change that is not committed.
 */
const fallLine = (
  file: string,
  base: number,
  head: number,
  how: string,
  uncommitted = false
): string =>
  `${PREFIX}${file}: ${RULE} fell from ${String(base)} to ${String(head)} against the base, and ${how}: a count falls only when its file changes` +
  (uncommitted
    ? "; the file holds a change that is not committed, and the gate reads changes from HEAD: commit it and run again"
    : "");
const UNCHANGED = "git reports no change of its content";
const C = "apps/api/src/admin/c.ts";
const MISSING_ROW = `${PREFIX}${HISTORY}: the counts differ from the base and the head adds no row: record it with "node scripts/testing/error-sites-gate.mjs --record --date <YYYY-MM-DD> --slug <slug> --base base"`;
const TWO_RULES: Exclusions = { [RULE]: LIST, [SECOND]: LIST };
const TWO_OPTIONS: Options = { [RULE]: OPTIONS[RULE] ?? [], [SECOND]: [] };
const bothRules: ResolveRule = () =>
  Promise.resolve({
    ...RESOLVED,
    rules: { ...RESOLVED.rules, [SECOND]: { severity: 2, options: [] } },
  });

describe("S6a to S10: against a base", () => {
  it("passes a head whose counts equal the base's, and names the base", async () => {
    plantClean();
    commitBase();
    touch(A);

    const outcome = await againstBase();

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: [`${PREFIX}PASS`, `${PREFIX}5 sites in 2 contexts`, `${PREFIX}base: base`],
      stderr: [],
    });
  });

  it("S6 refuses a count that rises against the base and an entry the base does not hold, with both counts and the command that lowers them", async () => {
    plantClean();
    commitBase();
    touch(A);
    touch(B);
    setCounts({ [A]: { [RULE]: 4 }, [B]: { [RULE]: 1 } });

    const outcome = await againstBase();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(riseLine(A, 4, 3));
    expect(outcome.stderr).toContain(riseLine(B, 1, 0));
    expect(outcome.stderr).toContain(MISSING_ROW);
  });

  it("S6 lets a rule be born against the base, by its own row", async () => {
    plantClean();
    commitBase();
    setCounts({ [B]: { [SECOND]: 1 } });
    addRow("2026-11-21-second.json", {
      version: 1,
      born: { rule: SECOND, contexts: { "api/admin": 1 } },
    });

    const outcome = await againstBase({
      exclusions: TWO_RULES,
      options: TWO_OPTIONS,
      resolveRule: bothRules,
    });

    expect(outcome.stderr).toEqual([]);
    expect(outcome.exitCode).toBe(0);
  });

  it("S6 lets a count rise by exactly what a recorded move between two files of one context brings in", async () => {
    plantClean();
    commitBase();
    touch(A);
    touch(B);
    setCounts({ [A]: { [RULE]: 1 }, [B]: { [RULE]: 2 } });
    addRow("2026-11-21-split.json", { version: 1, moved: [{ from: A, to: B, count: 2 }] });

    const outcome = await againstBase();

    expect(outcome.stderr).toEqual([]);
    expect(outcome.exitCode).toBe(0);
  });

  it("S7 refuses a count that falls while git reports no change of its file, with no hint when all is committed, and passes once the file changed", async () => {
    plantClean();
    commitBase();
    setCounts({ [A]: { [RULE]: 2 } });
    addRow("2026-11-21-admin.json", { version: 1, fixed: { "api/admin": 1 } });

    const unchanged = await againstBase();
    touch(A);
    const changed = await againstBase();

    expect(unchanged).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: [fallLine(A, 3, 2, UNCHANGED)],
    });
    expect(changed.exitCode).toBe(0);
  });

  it("S7 tells a count lowered in an edit not yet committed to commit the edit, and passes once it is", async () => {
    plantClean();
    commitBase();
    touch(A);
    setCounts({ [A]: { [RULE]: 2 } });
    addRow("2026-11-21-admin.json", { version: 1, fixed: { "api/admin": 1 } });

    const uncommitted = await scan({ base: "base" });
    const committed = await againstBase();

    expect(uncommitted).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: [fallLine(A, 3, 2, UNCHANGED, true)],
    });
    expect(committed).toEqual({
      exitCode: 0,
      stdout: [`${PREFIX}PASS`, `${PREFIX}4 sites in 2 contexts`, `${PREFIX}base: base`],
      stderr: [],
    });
  });

  it("S7 gives no hint for a count lowered by hand in the list while its file is untouched, though the list's edit is not committed", async () => {
    plantClean();
    commitBase();
    setCounts({ [A]: { [RULE]: 2 } });
    addRow("2026-11-21-admin.json", { version: 1, fixed: { "api/admin": 1 } });

    const outcome = await scan({ base: "base" });

    expect(outcome).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: [fallLine(A, 3, 2, UNCHANGED)],
    });
  });

  it("S7 tells a count lowered in an edit not yet committed of a file renamed by HEAD to commit the edit, reading the file at its new path", async () => {
    plantClean();
    commitBase();
    move(A, C);
    setCounts({ [A]: { [RULE]: 0 }, [C]: { [RULE]: 3 } });
    commit("rename");
    touch(C);
    setCounts({ [A]: { [RULE]: 0 }, [C]: { [RULE]: 2 } });
    addRow("2026-11-21-admin.json", { version: 1, fixed: { "api/admin": 1 } });

    const outcome = await scan({ base: "base" });

    expect(outcome).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: [
        fallLine(C, 3, 2, `git reports ${A} renamed to it with its content unchanged`, true),
      ],
    });
  });

  it("S7 exits 3, keeping its verdict, when git cannot tell whether the file holds a change that is not committed", async () => {
    plantClean();
    commitBase();
    touch(A);
    setCounts({ [A]: { [RULE]: 2 } });
    addRow("2026-11-21-admin.json", { version: 1, fixed: { "api/admin": 1 } });
    const real = createGit(root, gitEnvironment());
    const git: Git = (args) =>
      args.includes("status")
        ? { status: 128, stdout: "", stderr: "fatal: index file corrupt" }
        : real(args);

    const outcome = await scan({ base: "base", git });

    expect(outcome).toEqual({
      exitCode: 3,
      stdout: [],
      stderr: [
        `${PREFIX}${A}: whether it holds a change that is not committed could not be read, so S7 gives no hint: git --no-optional-locks --literal-pathspecs status --porcelain=v1 -z --untracked-files=all -- ${A} failed: fatal: index file corrupt`,
        fallLine(A, 3, 2, UNCHANGED),
      ],
    });
  });

  it("S7 takes a deletion as the reason a count fell", async () => {
    plantClean();
    commitBase();
    remove(X);
    setCounts({ [X]: { [RULE]: 0 } });
    addRow("2026-11-21-auth.json", { version: 1, fixed: { "core/auth": 2 } });

    const outcome = await againstBase();

    expect(outcome.stderr).toEqual([]);
  });

  it("S8 and S7 refuse a file renamed into an excluded path with its content unchanged, with no hint when all is committed", async () => {
    plantClean();
    commitBase();
    move(A, "apps/api/tests/unit/a.ts");
    setCounts({ [A]: { [RULE]: 0 } });

    const outcome = await againstBase();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(
      `${PREFIX}${A}: renamed to apps/api/tests/unit/a.ts, which the scope of ${RULE} excludes ("apps/*/tests/**", outside-src), while the base counts 3 sites in it`
    );
    expect(outcome.stderr).toContain(
      fallLine(
        "apps/api/tests/unit/a.ts",
        3,
        0,
        `git reports ${A} renamed to it with its content unchanged`
      )
    );
  });

  it("S6a carries a count with its file through a rename inside one context that also fixes sites: no move, the fix recorded", async () => {
    const lines = Array.from(
      { length: 12 },
      (_, index) => `export const line${String(index)} = ${String(index)};`
    );
    plantClean();
    write(A, `${lines.join("\n")}\n`);
    commitBase();
    move(A, "apps/api/src/admin/c.ts");
    write("apps/api/src/admin/c.ts", `${[...lines, "export const fixed = true;"].join("\n")}\n`);
    setCounts({ [A]: { [RULE]: 0 }, "apps/api/src/admin/c.ts": { [RULE]: 2 } });
    addRow("2026-11-21-admin.json", { version: 1, fixed: { "api/admin": 1 } });

    const outcome = await againstBase();

    expect(outcome.stderr).toEqual([]);
    expect(outcome.exitCode).toBe(0);
  });

  it("S10 refuses a row the head adds dated after today in UTC, and takes one dated today", async () => {
    plantClean();
    commitBase();
    touch(A);
    setCounts({ [A]: { [RULE]: 2 } });
    addRow("2026-12-02-admin.json", { version: 1, fixed: { "api/admin": 1 } });

    const ahead = await againstBase();
    remove(`${HISTORY}/2026-12-02-admin.json`);
    addRow("2026-12-01-admin.json", { version: 1, fixed: { "api/admin": 1 } });
    const today = await againstBase();

    expect(ahead).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: [
        `${PREFIX}${HISTORY}/2026-12-02-admin.json: is dated 2026-12-02, after today, 2026-12-01 (UTC): a row is dated the day it is recorded`,
      ],
    });
    expect(today.exitCode).toBe(0);
  });

  it("S8 counts a portal as enrolled when any of its catalogs holds errorCodes on the base, stricter than R7's default locale", async () => {
    plantClean();
    write("apps/admin/i18n/routing.ts", 'export const routing = { defaultLocale: "en" };\n');
    writeJson("apps/admin/messages/en.json", { title: "Admin" });
    writeJson("apps/admin/messages/fr.json", {
      errorCodes: { NOT_FOUND: "Introuvable" },
      title: "Admin",
    });
    commitBase();
    writeJson("apps/admin/messages/fr.json", { title: "Admin" });

    const outcome = await againstBase();

    expect(outcome.stderr).toEqual([
      `${PREFIX}apps/admin/messages/en.json: holds no "errorCodes" while the portal's catalogs hold it on the base: a portal never leaves the registry's check by removing its namespace`,
      `${PREFIX}apps/admin/messages/fr.json: holds no "errorCodes" while the portal's catalogs hold it on the base: a portal never leaves the registry's check by removing its namespace`,
    ]);
  });

  it("reads the root's own repository even when GIT_DIR, GIT_WORK_TREE or GIT_INDEX_FILE points elsewhere", () => {
    plantClean();
    gitIn("add", "--all");
    const foreign = mkdtempSync(path.join(tmpdir(), "error-sites-gate-foreign-"));
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: foreign, env: gitEnvironment() });
      writeFileSync(path.join(foreign, "foreign.ts"), "export {};\n");
      execFileSync("git", ["add", "--all"], { cwd: foreign, env: gitEnvironment() });
      const git = createGit(root, {
        ...gitEnvironment(),
        GIT_DIR: path.join(foreign, ".git"),
        GIT_WORK_TREE: foreign,
        GIT_INDEX_FILE: path.join(foreign, ".git", "index"),
      });

      const listed = git(["ls-files"])
        .stdout.split("\n")
        .filter((file) => file !== "");

      expect(listed).toContain(A);
      expect(listed).not.toContain("foreign.ts");
    } finally {
      rmSync(foreign, { recursive: true, force: true });
    }
  });

  it("S6a carries a count with its file: a rename inside one context needs no row", async () => {
    plantClean();
    commitBase();
    move(A, "apps/api/src/admin/c.ts");
    setCounts({ [A]: { [RULE]: 0 }, "apps/api/src/admin/c.ts": { [RULE]: 3 } });

    const outcome = await againstBase();

    expect(outcome.stderr).toEqual([]);
  });

  it("S10 asks a rename across two contexts for its one move, and passes with it", async () => {
    plantClean();
    commitBase();
    move(A, "apps/api/src/billing/a.ts");
    setCounts({ [A]: { [RULE]: 0 }, "apps/api/src/billing/a.ts": { [RULE]: 3 } });

    const missing = await againstBase();
    addRow("2026-11-21-billing.json", {
      version: 1,
      moved: [{ from: A, to: "apps/api/src/billing/a.ts", count: 3 }],
    });
    const recorded = await againstBase();

    expect(missing.stderr).toContain(MISSING_ROW);
    expect(recorded.stderr).toEqual([]);
  });

  it("S9 refuses a change of the rule beside a change of a count, and passes a change of the rule alone", async () => {
    plantClean();
    commitBase();
    write(
      "packages/eslint-plugin-errors/src/rules/no-inline-error.js",
      "export default { create: () => ({}) };\n"
    );

    const alone = await againstBase();
    touch(A);
    setCounts({ [A]: { [RULE]: 2 } });
    addRow("2026-11-21-admin.json", { version: 1, fixed: { "api/admin": 1 } });
    const beside = await againstBase();

    expect(alone.exitCode).toBe(0);
    expect(beside).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: [
        `${PREFIX}${A}: ${RULE} counts 2 against the base's 3, in a change that also changes packages/eslint-plugin-errors/src/rules/no-inline-error.js: a change of the rule and a change of a count never share a change`,
      ],
    });
  });

  it("S9 reads a change of the scope module or of the gate as a change of the rule", async () => {
    plantClean();
    write("scripts/testing/lib/error-scope.mjs", "export {};\n");
    commitBase();
    write("scripts/testing/lib/error-scope.mjs", "export const widened = true;\n");
    touch(A);
    setCounts({ [A]: { [RULE]: 2 } });
    addRow("2026-11-21-admin.json", { version: 1, fixed: { "api/admin": 1 } });

    const outcome = await againstBase();

    expect(outcome.stderr).toEqual([
      `${PREFIX}${A}: ${RULE} counts 2 against the base's 3, in a change that also changes scripts/testing/lib/error-scope.mjs: a change of the rule and a change of a count never share a change`,
    ]);
  });

  it("S10 refuses an edited row of the base, even one whose sum is unchanged, and a deleted one", async () => {
    plantClean();
    commitBase();
    write(ROW, `${JSON.stringify(BIRTH)}\n`);

    const edited = await againstBase();
    remove(ROW);
    addRow("2026-11-21-again.json", BIRTH);
    const deleted = await againstBase();

    expect(edited).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: [
        `${PREFIX}${ROW}: a row of the base's history, edited on the head: a row is never rewritten`,
      ],
    });
    expect(deleted.stderr).toContain(
      `${PREFIX}${ROW}: a row of the base's history, deleted on the head: a row is never deleted`
    );
  });

  it("S10 refuses a row that claims more than fell", async () => {
    plantClean();
    commitBase();
    touch(A);
    setCounts({ [A]: { [RULE]: 2 } });
    addRow("2026-11-21-admin.json", { version: 1, fixed: { "api/admin": 2 } });

    const outcome = await againstBase();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(
      `${PREFIX}${HISTORY}/2026-11-21-admin.json: its "fixed" is {"api/admin":2}, and the difference with the base yields {"api/admin":1}`
    );
  });

  it("S10 refuses two rows in one change, and a row while no count differs", async () => {
    plantClean();
    commitBase();
    addRow("2026-11-21-idle.json", { version: 1, fixed: { "api/admin": 1 } });
    const idle = await againstBase();
    remove(`${HISTORY}/2026-11-21-idle.json`);
    touch(A);
    setCounts({ [A]: { [RULE]: 1 } });
    addRow("2026-11-21-one.json", { version: 1, fixed: { "api/admin": 1 } });
    addRow("2026-11-21-two.json", { version: 1, fixed: { "api/admin": 1 } });
    const two = await againstBase();

    expect(idle.stderr).toContain(
      `${PREFIX}${HISTORY}/2026-11-21-idle.json: a row the head adds while no count differs from the base: delete it`
    );
    expect(two.stderr).toContain(
      `${PREFIX}${HISTORY}: the head adds 2 rows against the base (${HISTORY}/2026-11-21-one.json, ${HISTORY}/2026-11-21-two.json): a change adds one`
    );
  });

  it("S10 refuses a birth that shares its change with a fix", async () => {
    plantClean();
    commitBase();
    touch(A);
    setCounts({ [A]: { [RULE]: 2 }, [B]: { [SECOND]: 1 } });
    addRow("2026-11-21-second.json", {
      version: 1,
      born: { rule: SECOND, contexts: { "api/admin": 1 } },
    });

    const outcome = await againstBase({
      exclusions: TWO_RULES,
      options: TWO_OPTIONS,
      resolveRule: bothRules,
    });

    expect(outcome.stderr).toContain(
      `${PREFIX}${HISTORY}/2026-11-21-second.json: ${SECOND} is born against the base beside other changes of counts: a rule is born by its own change`
    );
  });

  it("S10 refuses a move between two files of two contexts: only a rename crosses contexts", async () => {
    plantClean();
    commitBase();
    touch(A);
    touch(X);
    setCounts({ [A]: { [RULE]: 1 }, [X]: { [RULE]: 4 } });
    addRow("2026-11-21-cross.json", { version: 1, moved: [{ from: A, to: X, count: 2 }] });

    const outcome = await againstBase();

    expect(outcome).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: [
        `${PREFIX}${HISTORY}/2026-11-21-cross.json: the move of 2 sites from ${A} to ${X} crosses two contexts (api/admin, core/auth): only a rename git reports moves sites across contexts`,
      ],
    });
  });

  it("S10 refuses moves of renamed files whose counts are not each file's, even when their sum is", async () => {
    plantClean();
    setCounts({ [B]: { [RULE]: 1 } });
    writeJson(ROW, {
      version: 1,
      born: { rule: RULE, contexts: { "api/admin": 4, "core/auth": 2 } },
    });
    commitBase();
    move(A, "apps/api/src/billing/a.ts");
    move(B, "apps/api/src/billing/b.ts");
    setCounts({
      [A]: { [RULE]: 0 },
      "apps/api/src/billing/a.ts": { [RULE]: 3 },
      "apps/api/src/billing/b.ts": { [RULE]: 1 },
    });
    addRow("2026-11-21-billing.json", {
      version: 1,
      moved: [
        { from: A, to: "apps/api/src/billing/a.ts", count: 1 },
        { from: B, to: "apps/api/src/billing/b.ts", count: 3 },
      ],
    });

    const outcome = await againstBase();

    expect(outcome).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: [
        `${PREFIX}${HISTORY}/2026-11-21-billing.json: its moves of renamed files are ` +
          `[{"from":"${A}","to":"apps/api/src/billing/a.ts","count":1},{"from":"${B}","to":"apps/api/src/billing/b.ts","count":3}], ` +
          `and the renames across contexts git reports yield ` +
          `[{"from":"${A}","to":"apps/api/src/billing/a.ts","count":3},{"from":"${B}","to":"apps/api/src/billing/b.ts","count":1}]`,
      ],
    });
  });

  it("S10 refuses a move out of a file that fell by less, into a file that rose by less", async () => {
    plantClean();
    commitBase();
    touch(A);
    touch(B);
    setCounts({ [A]: { [RULE]: 2 }, [B]: { [RULE]: 1 } });
    addRow("2026-11-21-split.json", { version: 1, moved: [{ from: A, to: B, count: 2 }] });

    const outcome = await againstBase();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(
      `${PREFIX}${HISTORY}/2026-11-21-split.json: 2 sites move out of ${A}, whose count fell by 1 against the base`
    );
    expect(outcome.stderr).toContain(
      `${PREFIX}${HISTORY}/2026-11-21-split.json: 2 sites move into ${B}, whose count rose by 1 against the base`
    );
  });

  it("S8 refuses a portal that drops errorCodes from a catalog it held them in on the base", async () => {
    plantClean();
    write("apps/admin/i18n/routing.ts", 'export const routing = { defaultLocale: "en" };\n');
    writeJson("apps/admin/messages/en.json", {
      errorCodes: { NOT_FOUND: "Not found" },
      title: "Admin",
    });
    commitBase();
    writeJson("apps/admin/messages/en.json", { title: "Admin" });

    const outcome = await againstBase();

    expect(outcome).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: [
        `${PREFIX}apps/admin/messages/en.json: holds no "errorCodes" while the portal's catalogs hold it on the base: a portal never leaves the registry's check by removing its namespace`,
      ],
    });
  });

  it("fails closed on a row of the base that is not the format, and on a base baseline that is not JSON", async () => {
    plantClean();
    addRow("2026-11-21-bad.json", { version: 2 });
    commitBase();
    remove(`${HISTORY}/2026-11-21-bad.json`);
    const badRow = await againstBase();

    gitIn("tag", "-d", "base");
    write(BASELINE, "{ broken\n");
    commitBase();
    writeJson(BASELINE, SUPPRESSIONS);
    const badBaseline = await againstBase();

    expect(badRow.exitCode).toBe(3);
    expect(badRow.stderr[0]).toBe(
      `${PREFIX}base:${HISTORY}/2026-11-21-bad.json: is not a row of the history: "version" is not 1`
    );
    expect(badBaseline.exitCode).toBe(3);
    expect(badBaseline.stderr[0]).toMatch(new RegExp(`^${PREFIX}base:${BASELINE} is not JSON: `));
  });
});

describe("--record against a base", () => {
  it("writes the fixed sites the difference yields, and the gate then passes", async () => {
    plantClean();
    commitBase();
    touch(A);
    setCounts({ [A]: { [RULE]: 1 } });
    commit("head");

    const outcome = record({ base: "base", slug: "admin" });

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: [
        `${PREFIX}recorded ${HISTORY}/2026-11-21-admin.json: 2 sites fixed in 1 context, 0 moves`,
      ],
      stderr: [],
    });
    expect(readFileSync(path.join(root, HISTORY, "2026-11-21-admin.json"), "utf8")).toBe(
      `${JSON.stringify({ version: 1, fixed: { "api/admin": 2 } }, null, 2)}\n`
    );
    expect((await againstBase()).stderr).toEqual([]);
  });

  it("writes the move of a file renamed across two contexts, read from git", async () => {
    plantClean();
    commitBase();
    move(A, "apps/api/src/billing/a.ts");
    setCounts({ [A]: { [RULE]: 0 }, "apps/api/src/billing/a.ts": { [RULE]: 3 } });
    commit("head");

    const outcome = record({ base: "base", slug: "billing" });

    expect(outcome.exitCode).toBe(0);
    expect(
      JSON.parse(readFileSync(path.join(root, HISTORY, "2026-11-21-billing.json"), "utf8"))
    ).toEqual({
      version: 1,
      moved: [{ from: A, to: "apps/api/src/billing/a.ts", count: 3 }],
    });
    expect((await againstBase()).stderr).toEqual([]);
  });

  it("writes a stated move between two files of one context, and fixed as what fell beyond it", async () => {
    plantClean();
    commitBase();
    touch(A);
    touch(B);
    setCounts({ [A]: { [RULE]: 0 }, [B]: { [RULE]: 2 } });
    commit("head");

    const outcome = record({ base: "base", slug: "split", moves: [{ from: A, to: B, count: 2 }] });

    expect(outcome.exitCode).toBe(0);
    expect(
      JSON.parse(readFileSync(path.join(root, HISTORY, "2026-11-21-split.json"), "utf8"))
    ).toEqual({
      version: 1,
      fixed: { "api/admin": 1 },
      moved: [{ from: A, to: B, count: 2 }],
    });
    expect((await againstBase()).stderr).toEqual([]);
  });

  it("refuses a date after today in UTC, with no base and against one, and writes nothing", () => {
    plantClean();
    remove("scripts/testing/error-sites-history");
    const birth = record({ date: "2026-12-02" });
    writeJson(ROW, BIRTH);
    commitBase();
    touch(A);
    setCounts({ [A]: { [RULE]: 2 } });
    commit("head");
    const fix = record({ base: "base", date: "2026-12-02", slug: "admin" });

    expect(birth).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: [
        `${PREFIX}${HISTORY}/2026-12-02-birth.json: is dated 2026-12-02, after today, 2026-12-01 (UTC): a row is dated the day it is recorded`,
      ],
    });
    expect(fix.stderr).toEqual([
      `${PREFIX}${HISTORY}/2026-12-02-admin.json: is dated 2026-12-02, after today, 2026-12-01 (UTC): a row is dated the day it is recorded`,
    ]);
    expect(existsSync(path.join(root, HISTORY, "2026-12-02-admin.json"))).toBe(false);
  });

  it("refuses when nothing differs from the base, and when the head already adds a row", () => {
    plantClean();
    commitBase();
    commit("head");
    const nothing = record({ base: "base" });
    touch(A);
    setCounts({ [A]: { [RULE]: 2 } });
    addRow("2026-11-21-admin.json", { version: 1, fixed: { "api/admin": 1 } });
    commit("head");
    const already = record({ base: "base", slug: "again" });

    expect(nothing).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: [`${PREFIX}nothing differs from the base base, so there is no row to record`],
    });
    expect(already.stderr).toEqual([
      `${PREFIX}the head already adds ${HISTORY}/2026-11-21-admin.json against the base: a change adds one row, so delete it and record again`,
    ]);
  });

  it("refuses a rise no stated move explains, a move across two contexts, and a move given for a renamed file", () => {
    plantClean();
    commitBase();
    touch(A);
    touch(X);
    move(B, "apps/api/src/admin/c.ts");
    setCounts({ [A]: { [RULE]: 1 }, [X]: { [RULE]: 4 } });
    commit("head");

    const rise = record({ base: "base" });
    const crossing = record({ base: "base", moves: [{ from: A, to: X, count: 2 }] });
    const renamed = record({
      base: "base",
      moves: [{ from: B, to: "apps/api/src/admin/c.ts", count: 1 }],
    });

    expect(rise.exitCode).toBe(1);
    expect(rise.stderr).toEqual([riseLine(X, 4, 2)]);
    expect(crossing.stderr).toEqual([
      `${PREFIX}the move of 2 sites from ${A} to ${X} crosses two contexts (api/admin, core/auth): only a rename git reports moves sites across contexts`,
    ]);
    expect(renamed.stderr).toEqual([
      `${PREFIX}${B} is renamed to apps/api/src/admin/c.ts: the move of a renamed file is read from git, so it is not given`,
    ]);
    expect(existsSync(path.join(root, HISTORY, "2026-11-21-birth.json"))).toBe(false);
  });

  it("reads --moved from the command line, and refuses one that is not <from>:<to>:<count>", () => {
    plantClean();
    commitBase();
    touch(A);
    touch(B);
    setCounts({ [A]: { [RULE]: 1 }, [B]: { [RULE]: 2 } });
    commit("head");
    const command = (args: readonly string[]) =>
      spawnSync(
        process.execPath,
        [GATE_SCRIPT, "--record", "--date", PAST_DAY, "--slug", "split", "--root", root, ...args],
        {
          cwd: root,
          encoding: "utf8",
          env: { ...gitEnvironment(), FITNESS_BASE_REF: "" },
        }
      );

    const malformed = [
      ["--moved", `${A}:${B}`],
      ["--moved", `${A}:${A}:1`],
      ["--moved", `${A}:${B}:0`],
    ].map((args) => command(args).status);
    const written = command(["--base", "base", "--moved", `${A}:${B}:2`]);

    expect(malformed).toEqual([2, 2, 2]);
    expect(written.status).toBe(0);
    expect(written.stdout).toBe(
      `${PREFIX}recorded ${HISTORY}/${PAST_DAY}-split.json: 0 sites fixed in 0 contexts, 1 move\n`
    );
  });
});

describe("the history's reader", () => {
  it("reads every row and sums them, the one reader of the format the reference page shares", () => {
    plantClean();
    addRow("2026-11-21-admin.json", { version: 1, fixed: { "api/admin": 1 } });
    addRow("2026-11-22-move.json", {
      version: 1,
      moved: [{ from: A, to: "apps/api/src/billing/a.ts", count: 2 }],
    });

    const history = readHistory(root);

    expect(history.exists).toBe(true);
    expect(history.problems).toEqual([]);
    expect(history.rows.map((entry) => entry.file)).toEqual([
      ROW,
      `${HISTORY}/2026-11-21-admin.json`,
      `${HISTORY}/2026-11-22-move.json`,
    ]);
    expect(stateOf(history.rows)).toEqual(
      new Map([
        ["api/admin", 0],
        ["core/auth", 2],
        ["api/billing", 2],
      ])
    );
  });

  it("names every entry that is no row, so its caller fails closed, and reads no directory as no history", () => {
    plantClean();
    addRow("2026-11-21-bad.json", { version: 1, fixed: {} });

    const broken = readHistory(root);
    remove(HISTORY);
    const absent = readHistory(root);

    expect(broken.problems).toEqual([
      `${HISTORY}/2026-11-21-bad.json: is not a row of the history: "fixed" is not an object of at least one context`,
    ]);
    expect(absent).toEqual({ exists: false, rows: [], problems: [] });
  });
});

describe("contextOf", () => {
  it.each([
    ["packages/core/auth/src/x.ts", "core/auth"],
    ["apps/api/src/admin/auth/a.ts", "api/admin"],
    ["apps/api/src/index.ts", "api/src"],
    ["apps/api/scripts/dump.ts", "api"],
    ["apps/workers/src/jobs/a.ts", "workers"],
    ["packages/providers/x/src/a.ts", "providers/x"],
    ["packages/adapters/db-prisma/src/a.ts", "adapters/db-prisma"],
    ["packages/monitoring/circuit-breaker/src/a.ts", "monitoring/circuit-breaker"],
    ["packages/observability/logger/src/a.ts", "observability/logger"],
    ["packages/shared/src/a.ts", "packages/shared"],
    ["packages/core/vitest.config.ts", "packages/core"],
    ["infra/prisma/src/a.ts", "infra/prisma"],
    ["apps/admin/lib/a.ts", "admin"],
    ["apps/client/lib/a.ts", "client"],
    ["apps/cli/src/a.ts", "cli"],
    ["tools/a.ts", "tools"],
    ["vitest.workspace.ts", "(root)"],
  ])("puts %s in %s", (file, context) => {
    expect(contextOf(file)).toBe(context);
  });
});

describe("--record", () => {
  it("writes the birth the baseline yields, as prettier writes it, and the gate then passes", async () => {
    plantClean();
    remove("scripts/testing/error-sites-history");

    const outcome = record();

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: [
        `${PREFIX}recorded ${HISTORY}/2026-11-21-birth.json: the birth of ${RULE}, 5 sites in 2 contexts`,
      ],
      stderr: [],
    });
    expect(readFileSync(path.join(root, HISTORY, "2026-11-21-birth.json"), "utf8")).toBe(
      `${JSON.stringify(BIRTH, null, 2)}\n`
    );
    expect((await scan()).exitCode).toBe(0);
  });

  it("refuses when nothing differs, and never rewrites a row", () => {
    plantClean();

    const nothing = record();
    remove(ROW);
    writeJson(`${HISTORY}/2026-11-21-birth.json`, { version: 1, fixed: { workers: 1 } });
    const taken = record();

    expect(nothing).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: [
        `${PREFIX}nothing differs: the history yields what ${BASELINE} holds, so there is no row to record`,
      ],
    });
    expect(taken.exitCode).toBe(1);
    expect(taken.stderr).toEqual([
      `${PREFIX}${HISTORY}/2026-11-21-birth.json already exists: a row is never rewritten, so choose another slug`,
    ]);
  });

  it("refuses a birth when the rule is born and its counts fell", () => {
    plantClean();
    writeJson(BASELINE, {
      ...SUPPRESSIONS,
      "packages/core/auth/src/x.ts": { [RULE]: { count: 1 } },
    });

    const outcome = record();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual([
      `${PREFIX}the history and ${BASELINE} differ (core/auth) and no rule awaits its birth, so the row is no birth: it is written against a base`,
    ]);
  });

  it("writes the birth of the one rule that awaits it, beside a rule already born", () => {
    plantClean();
    writeJson(BASELINE, {
      ...SUPPRESSIONS,
      "apps/api/src/admin/b.ts": { "errors/second-rule": { count: 1 } },
    });

    const outcome = record({
      exclusions: { [RULE]: LIST, "errors/second-rule": LIST, "errors/third-rule": LIST },
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toEqual([
      `${PREFIX}recorded ${HISTORY}/2026-11-21-birth.json: the birth of errors/second-rule, 1 site in 1 context`,
    ]);
  });

  it("refuses when two rules await their birth, since a row bears one", () => {
    plantClean();
    remove(ROW);
    writeJson(BASELINE, {
      ...SUPPRESSIONS,
      "apps/api/src/admin/b.ts": { "errors/third-rule": { count: 1 } },
    });

    const outcome = record({ exclusions: { [RULE]: LIST, "errors/third-rule": LIST } });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual([
      `${PREFIX}${RULE} and errors/third-rule each await their birth: a row bears one birth, so each rule is born by its own change`,
    ]);
  });

  it("refuses the birth of a rule the gate holds no scope for", () => {
    plantClean();
    remove("scripts/testing/error-sites-history");
    writeJson(BASELINE, { "apps/api/src/admin/a.ts": { "errors/other-rule": { count: 1 } } });

    const outcome = record();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual([
      `${PREFIX}${BASELINE} counts sites of errors/other-rule, a rule the gate holds no scope for, so its birth cannot be recorded`,
    ]);
    expect(existsSync(path.join(root, HISTORY))).toBe(false);
  });
});

describe("the command", () => {
  const run = (args: readonly string[], environment: NodeJS.ProcessEnv = {}) =>
    spawnSync(process.execPath, [GATE_SCRIPT, ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...gitEnvironment(), FITNESS_BASE_REF: "", ...environment },
    });

  it.each([
    ["an unknown argument", ["--frobnicate"]],
    ["a date without --record", ["--date", "2026-11-21"]],
    ["a move without --record", ["--moved", "a.ts:b.ts:1"]],
    ["a slug without --record", ["--slug", "birth"]],
    ["--record without a slug", ["--record", "--date", "2026-11-21"]],
    ["a date that is no calendar date", ["--record", "--date", "2026-02-30", "--slug", "birth"]],
    ["a slug outside its pattern", ["--record", "--date", "2026-11-21", "--slug", "Birth_1"]],
    ["--root twice", ["--root", "a", "--root", "b"]],
  ])("exits 2 on %s", (_label, args) => {
    const result = run(args);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^usage: node scripts\/testing\/error-sites-gate\.mjs/);
  });

  it("records a birth from the command line, and reads FITNESS_BASE_REF when --base is absent", () => {
    plantClean();
    remove("scripts/testing/error-sites-history");
    gitIn("add", "--all");

    const unresolved = run(["--record", "--date", PAST_DAY, "--slug", "birth", "--root", root], {
      FITNESS_BASE_REF: "no-such-ref",
    });
    const written = run(["--record", "--date", PAST_DAY, "--slug", "birth", "--root", root]);

    expect(unresolved.status).toBe(3);
    expect(unresolved.stderr).toMatch(/the base "no-such-ref" could not be resolved/);
    expect(written.status).toBe(0);
    expect(written.stdout).toBe(
      `${PREFIX}recorded ${HISTORY}/${PAST_DAY}-birth.json: the birth of ${RULE}, 5 sites in 2 contexts\n`
    );
  });
});

describe("the ESLint wiring, on this repository", () => {
  it("reads a rule's severity and options, the identity of the plugin and the parser, the processor, the language, and an ignored path", async () => {
    const resolve = await createEslintResolver({
      root: REPO_ROOT,
      namespace: "testing",
      packageName: "@packages/eslint-plugin-testing",
      parserPackage: LINT_PARSER,
    });

    const testFile = await resolve("apps/api/tests/unit/scripts/errorSitesGate.test.ts");
    const sourceFile = await resolve("apps/api/src/index.ts");
    const script = await resolve("scripts/testing/error-sites-gate.mjs");
    const ignored = await resolve("apps/api/dist/index.ts");

    expect(testFile.ignored).toBe(false);
    expect(testFile.pluginIsPackage).toBe(true);
    expect(testFile.rules["testing/no-empty-test"]).toEqual({ severity: 2, options: [] });
    // The testing plugin's block reads test files only, so a source file resolves no such plugin.
    expect(sourceFile).toEqual({
      ignored: false,
      rules: {},
      pluginIsPackage: false,
      processed: false,
      parserIsPackage: true,
      languageIsJavaScript: true,
    });
    expect(script.parserIsPackage).toBe(false);
    expect(script.languageIsJavaScript).toBe(true);
    expect(ignored).toEqual(IGNORED);

    const vitest = await createEslintResolver({
      root: REPO_ROOT,
      namespace: "vitest",
      packageName: "@vitest/eslint-plugin",
      parserPackage: LINT_PARSER,
    });
    const withOptions = await vitest("apps/api/tests/unit/scripts/errorSitesGate.test.ts");
    expect(withOptions.rules["vitest/expect-expect"]?.severity).toBe(2);
    expect(withOptions.rules["vitest/expect-expect"]?.options).toEqual([
      {
        assertFunctionNames: ["expect", "expect*", "assert", "assert.*", "expectTypeOf"],
        additionalTestBlockFunctions: [],
      },
    ]);
  }, 60_000);

  it("sees a block that adds a processor, swaps the parser or swaps the language, which the rule's own settings never show", async () => {
    const load = createRequire(path.join(REPO_ROOT, "package.json"));
    const { ESLint } = load("eslint") as {
      ESLint: new (options: { cwd: string }) => {
        calculateConfigForFile: (file: string) => Promise<{ plugins: Record<string, unknown> }>;
      };
    };
    const core = (
      await new ESLint({ cwd: REPO_ROOT }).calculateConfigForFile(
        path.join(REPO_ROOT, "apps/api/src/index.ts")
      )
    ).plugins["@"] as { languages: { js: object } };
    const file = "apps/api/src/index.ts";
    const withBlock = async (block: Record<string, unknown>): Promise<Resolution> =>
      (
        await createEslintResolver({
          root: REPO_ROOT,
          namespace: "testing",
          packageName: "@packages/eslint-plugin-testing",
          parserPackage: LINT_PARSER,
          overrideConfig: [{ files: [file], ...block }],
        })
      )(file);

    const processed = await withBlock({
      processor: {
        preprocess: (text: string) => [text],
        postprocess: (messages: unknown[][]) => messages.flat(),
      },
    });
    const reparsed = await withBlock({
      languageOptions: { parser: { meta: { name: "another-parser" }, parse: () => ({}) } },
    });
    const relanguaged = await withBlock({
      plugins: { another: { languages: { js: { ...core.languages.js } } } },
      language: "another/js",
    });

    expect([
      processed.processed,
      processed.parserIsPackage,
      processed.languageIsJavaScript,
    ]).toEqual([true, true, true]);
    expect([reparsed.processed, reparsed.parserIsPackage, reparsed.languageIsJavaScript]).toEqual([
      false,
      false,
      true,
    ]);
    expect([relanguaged.processed, relanguaged.languageIsJavaScript]).toEqual([false, false]);
  }, 60_000);
});

/** Fourteen days after the clean tree's birth, the first instant the 14-day window is over. */
const STALLED_AT = new Date("2026-12-04T07:23:00Z");
/** The last second of the thirteenth day after the birth. */
const INSIDE_AT = new Date("2026-12-03T23:59:59Z");
const STALL_LABEL = "error-sites-stalled";
const STALL_TITLE = "Error sites stalled: the list of existing error sites stopped shrinking";
const STALL_LINES = [
  `${PREFIX}STALLED: no history row was added in the last 14 days: the newest, ${ROW}, is dated 2026-11-20, 14 days before today, 2026-12-04 (UTC)`,
  `${PREFIX}5 sites in 2 contexts`,
  `${PREFIX}api/admin: 3 sites`,
  `${PREFIX}core/auth: 2 sites`,
];
const STALL_FACTS =
  "The list of existing error sites holds 5 sites in 2 contexts (api/admin: 3, core/auth: 2), and the newest row of scripts/testing/error-sites-history/ is dated 2026-11-20: no row was added in the last 14 days (today is 2026-12-04, UTC).";
const STALL_COMMENT = `Still stalled on 2026-12-04: ${STALL_FACTS}`;
const ISSUES_CALL = [
  "api",
  `repos/{owner}/{repo}/issues?labels=${STALL_LABEL}&state=all&per_page=100`,
];
const COMMENTS_CALL = [
  "api",
  "repos/{owner}/{repo}/issues/4/comments?since=2026-12-04T00:00:00Z&per_page=100",
];
/** The baseline with no `errors/` entry: an empty list beside another rule's suppression. */
const NO_ERROR_SITES = {
  "apps/api/tests/unit/t.test.ts": { "testing/no-empty-test": { count: 1 } },
};

interface GhDouble {
  readonly gh: Gh;
  /** Every call, in order: `gh`'s arguments. */
  readonly calls: string[][];
}

/**
 * A recording `gh`: it lists the given issues and comments, and fails on the given call. `listing`,
 * when given, is the issue listing's whole answer in place of `issues`, so a listing that is no
 * list can be answered.
 */
const ghDouble = (
  answers: {
    issues?: readonly Record<string, unknown>[];
    listing?: unknown;
    comments?: readonly Record<string, unknown>[];
    failsOn?: readonly string[];
  } = {}
): GhDouble => {
  const calls: string[][] = [];
  const failsOn = answers.failsOn ?? [];
  const gh: Gh = (args) => {
    calls.push([...args]);
    if (failsOn.length > 0 && failsOn.every((part, index) => args[index] === part)) {
      throw new Error("HTTP 502: Bad Gateway");
    }
    const endpoint = (args.find((arg) => arg.startsWith("repos/")) ?? "").split("?")[0] ?? "";
    if (args[0] === "api" && endpoint.endsWith("/comments")) {
      return JSON.stringify(answers.comments ?? []);
    }
    if (args[0] !== "api") return "";
    return JSON.stringify("listing" in answers ? answers.listing : (answers.issues ?? []));
  };
  return { gh, calls };
};

const stall = (input: Partial<StallInput> = {}): Outcome =>
  checkStall({ root, days: 14, now: STALLED_AT, ...input });

const issueOf = (state: string, created: string): Record<string, unknown> => ({
  number: 4,
  title: STALL_TITLE,
  state,
  created_at: created,
});

describe("--stalled: whether the list stopped shrinking", () => {
  it("exits 1 when the list is above zero and the newest row is dated the window's length before today, giving the total, each context and that date", () => {
    plantClean();

    expect(stall()).toEqual({ exitCode: 1, stdout: [], stderr: STALL_LINES });
  });

  it("counts the window from the newest row, not the first, and holds a row of the thirteenth day inside it", () => {
    plantClean();
    setCounts({ [A]: { [RULE]: 2 } });
    addRow("2026-11-25-admin.json", { version: 1, fixed: { "api/admin": 1 } });

    const inside = stall({ now: new Date("2026-12-08T23:59:59Z") });
    const over = stall({ now: new Date("2026-12-09T00:00:00Z") });

    expect(inside).toEqual({
      exitCode: 0,
      stdout: [
        `${PREFIX}not stalled: the newest history row, ${HISTORY}/2026-11-25-admin.json, is dated 2026-11-25, 13 days before today, 2026-12-08 (UTC), inside the 14-day window`,
        `${PREFIX}4 sites in 2 contexts`,
      ],
      stderr: [],
    });
    expect(over.exitCode).toBe(1);
    expect(over.stderr[0]).toBe(
      `${PREFIX}STALLED: no history row was added in the last 14 days: the newest, ${HISTORY}/2026-11-25-admin.json, is dated 2026-11-25, 14 days before today, 2026-12-09 (UTC)`
    );
  });

  it("exits 0 when the list is empty, however old its history", () => {
    plantClean();
    writeJson(BASELINE, NO_ERROR_SITES);

    expect(stall()).toEqual({
      exitCode: 0,
      stdout: [`${PREFIX}not stalled: the list of existing error sites is empty`],
      stderr: [],
    });
  });

  it("counts a list of one site as a list above zero", () => {
    plantClean();
    setCounts({ [A]: { [RULE]: 0 }, [X]: { [RULE]: 1 } });

    const outcome = stall();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr.slice(1)).toEqual([
      `${PREFIX}1 site in 1 context`,
      `${PREFIX}core/auth: 1 site`,
    ]);
  });

  it.each([
    ["does not exist", () => remove(HISTORY)],
    ["holds no row", () => remove(ROW)],
  ])(
    "exits 3 when the list is above zero and its history %s, since such a list cannot be dated",
    (what, plant) => {
      plantClean();
      plant();

      expect(stall()).toEqual({
        exitCode: 3,
        stdout: [],
        stderr: [
          `${PREFIX}${HISTORY} ${what}, so the list of 5 sites cannot be dated: a list above zero is dated by the rows of its history`,
        ],
      });
    }
  );

  it.each([
    [
      "the suppressions file is not JSON",
      () => write(BASELINE, "{ broken\n"),
      `${PREFIX}${BASELINE} is not JSON:`,
    ],
    [
      "a row of the history is no row",
      () => addRow("2026-11-21-bad.json", { version: 1, fixed: {} }),
      `${PREFIX}${HISTORY}/2026-11-21-bad.json: is not a row of the history:`,
    ],
  ])("exits 3, not 1, when %s, though the window is over", (_label, plant, message) => {
    plantClean();
    plant();

    const outcome = stall();

    expect(outcome.exitCode).toBe(3);
    expect(outcome.stdout).toEqual([]);
    expect(outcome.stderr).toHaveLength(1);
    expect(outcome.stderr[0]?.startsWith(message)).toBe(true);
  });

  it("exits 3 when the newest row is dated after today, a day no row was recorded on", () => {
    plantClean();
    addRow("2026-12-05-admin.json", { version: 1, fixed: { "api/admin": 1 } });

    expect(stall()).toEqual({
      exitCode: 3,
      stdout: [],
      stderr: [
        `${PREFIX}the newest history row, ${HISTORY}/2026-12-05-admin.json, is dated 2026-12-05, after today, 2026-12-04 (UTC): a row is dated the day it is recorded, so the window cannot be read from it`,
      ],
    });
  });

  it("reads today as the UTC date of the instant, whatever the time zone of the process", () => {
    plantClean();
    /** Runs the mode in a process of the given zone; prints its exit code and the local day. */
    const inZone = (zone: string, instant: string): string => {
      const driver = [
        `const { checkStall } = await import(${JSON.stringify(pathToFileURL(GATE_SCRIPT).href)});`,
        `const now = new Date(${JSON.stringify(instant)});`,
        `const outcome = checkStall({ root: ${JSON.stringify(root)}, days: 14, now });`,
        "process.stdout.write(`${String(outcome.exitCode)} ${String(now.getDate())}`);",
      ].join("\n");
      return spawnSync(process.execPath, ["--input-type=module", "--eval", driver], {
        encoding: "utf8",
        env: { ...process.env, TZ: zone },
      }).stdout;
    };

    // UTC+14: the local day is the fourteenth after the birth, the UTC day the thirteenth.
    const east = inZone("Pacific/Kiritimati", "2026-12-03T23:30:00Z");
    // UTC-11: the local day is the thirteenth after the birth, the UTC day the fourteenth.
    const west = inZone("Pacific/Pago_Pago", "2026-12-04T00:30:00Z");

    expect(east).toBe("0 4");
    expect(west).toBe("1 3");
  });
});

describe("--stalled --remind: one issue, a comment a day", () => {
  it("opens one labelled issue that carries the facts when none exists, and still exits 1", () => {
    plantClean();
    const double = ghDouble();

    const outcome = stall({ gh: double.gh });

    expect(outcome).toEqual({
      exitCode: 1,
      stdout: [`${PREFIX}remind: open: ${STALL_TITLE}`],
      stderr: STALL_LINES,
    });
    expect(double.calls).toEqual([
      ISSUES_CALL,
      [
        "label",
        "create",
        STALL_LABEL,
        "--color",
        "b60205",
        "--description",
        "The list of existing error sites stopped shrinking",
        "--force",
      ],
      [
        "issue",
        "create",
        "--title",
        STALL_TITLE,
        "--body",
        expect.stringContaining(STALL_FACTS),
        "--label",
        STALL_LABEL,
      ],
    ]);
  });

  it("comments on the open issue instead of opening a second one", () => {
    plantClean();
    const double = ghDouble({ issues: [issueOf("open", "2026-12-01T07:23:10Z")] });

    const outcome = stall({ gh: double.gh });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stdout).toEqual([`${PREFIX}remind: comment #4: ${STALL_TITLE}`]);
    expect(double.calls).toEqual([
      ISSUES_CALL,
      COMMENTS_CALL,
      ["issue", "comment", "4", "--body", STALL_COMMENT],
    ]);
  });

  it("posts no second comment on the same day", () => {
    plantClean();
    const double = ghDouble({
      issues: [issueOf("open", "2026-12-01T07:23:10Z")],
      comments: [{ body: STALL_COMMENT }],
    });

    const outcome = stall({ gh: double.gh });

    expect(outcome.stdout).toEqual([
      `${PREFIX}remind: skip #4: ${STALL_TITLE} (already commented on 2026-12-04)`,
    ]);
    expect(double.calls).toEqual([ISSUES_CALL, COMMENTS_CALL]);
  });

  it("comments nothing on the day it opened the issue, so a retry repeats nothing", () => {
    plantClean();
    const double = ghDouble({ issues: [issueOf("open", "2026-12-04T07:23:05Z")] });

    const outcome = stall({ gh: double.gh });

    expect(outcome.stdout).toEqual([
      `${PREFIX}remind: skip #4: ${STALL_TITLE} (opened on 2026-12-04)`,
    ]);
    expect(double.calls).toEqual([ISSUES_CALL]);
  });

  it("reopens the issue when it was closed while the list still stalls", () => {
    plantClean();
    const double = ghDouble({ issues: [issueOf("closed", "2026-11-28T07:23:10Z")] });

    const outcome = stall({ gh: double.gh });

    expect(outcome.stdout).toEqual([`${PREFIX}remind: reopen #4: ${STALL_TITLE}`]);
    expect(double.calls).toEqual([
      ISSUES_CALL,
      ["issue", "reopen", "4", "--comment", STALL_COMMENT],
    ]);
  });

  it("makes no GitHub call while a row is dated inside the window, nor when the list is empty", () => {
    plantClean();
    const double = ghDouble();

    const inside = stall({ now: INSIDE_AT, gh: double.gh });
    writeJson(BASELINE, NO_ERROR_SITES);
    const empty = stall({ gh: double.gh });

    expect(inside.exitCode).toBe(0);
    expect(empty.exitCode).toBe(0);
    expect(double.calls).toEqual([]);
  });

  it("exits 3, not 1, when a GitHub call fails, with the stall's lines and the call's error", () => {
    plantClean();
    const double = ghDouble({ failsOn: ["issue", "create"] });

    const outcome = stall({ gh: double.gh });

    expect(outcome).toEqual({
      exitCode: 3,
      stdout: [],
      stderr: [...STALL_LINES, `${PREFIX}GitHub: HTTP 502: Bad Gateway`],
    });
  });

  it.each([
    ["is no list", { listing: { message: "Not Found" } }],
    [
      "is a full page of 100 other issues, past which the stall's issue could be",
      {
        issues: Array.from({ length: 100 }, (_, index) => ({
          number: index + 10,
          title: `Another issue ${String(index)}`,
          state: "open",
          created_at: "2026-11-01T00:00:00Z",
        })),
      },
    ],
  ])("exits 3, opening and commenting nothing, when the issue listing %s", (_label, answers) => {
    plantClean();
    const double = ghDouble(answers);

    const outcome = stall({ gh: double.gh });

    expect(outcome).toEqual({
      exitCode: 3,
      stdout: [],
      stderr: [
        ...STALL_LINES,
        `${PREFIX}GitHub: listing the ${STALL_LABEL} issues returned no list, or a full page`,
      ],
    });
    expect(double.calls).toEqual([ISSUES_CALL]);
  });
});

describe("the stall workflow", () => {
  it("runs the exact command of the stall mode and retries only exit 3", () => {
    const workflow = readFileSync(
      path.join(REPO_ROOT, ".github/workflows/error-sites-stall.yml"),
      "utf8"
    );
    // Lines are compared trimmed, so the step's indentation is the YAML's and not part of the command.
    const lines = workflow.split("\n").map((line) => line.trim());
    const runs = lines.filter(
      (line) => line.includes("scripts/testing/error-sites-gate.mjs") && line.startsWith("node ")
    );
    const retries = lines.filter((line) => /\[ "\$status" -eq \d+ \]/.test(line));

    expect(runs).toEqual([
      "node scripts/testing/error-sites-gate.mjs --stalled --days 14 --remind || status=$?",
    ]);
    expect(retries).toEqual(['[ "$status" -eq 3 ] || break']);
  });
});

describe("--stalled from the command line", () => {
  const runCommand = (args: readonly string[], environment: NodeJS.ProcessEnv = {}) =>
    spawnSync(process.execPath, [GATE_SCRIPT, ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...gitEnvironment(), FITNESS_BASE_REF: "", ...environment },
    });

  it.each([
    [
      "--stalled with --record",
      ["--stalled", "--days", "14", "--record", "--date", "2026-11-21", "--slug", "birth"],
    ],
    ["--stalled with --base", ["--stalled", "--days", "14", "--base", "main"]],
    ["--stalled with --moved", ["--stalled", "--days", "14", "--moved", "a.ts:b.ts:1"]],
    ["--stalled with --date", ["--stalled", "--days", "14", "--date", "2026-11-21"]],
    ["--stalled with --slug", ["--stalled", "--days", "14", "--slug", "birth"]],
    ["--stalled without --days", ["--stalled"]],
    ["--days without --stalled", ["--days", "14"]],
    ["--remind without --stalled", ["--remind"]],
    ["--days 0", ["--stalled", "--days", "0"]],
    ["--days that is no integer", ["--stalled", "--days", "1.5"]],
    ["--days with a leading zero", ["--stalled", "--days", "014"]],
    ["a negative --days", ["--stalled", "--days", "-3"]],
    ["--stalled twice", ["--stalled", "--stalled", "--days", "14"]],
    ["--days twice", ["--stalled", "--days", "14", "--days", "7"]],
    ["--remind twice", ["--stalled", "--days", "14", "--remind", "--remind"]],
  ])("exits 2 on %s", (_label, args) => {
    const result = runCommand(args);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^usage: node scripts\/testing\/error-sites-gate\.mjs/);
  });

  it("reads its two inputs and nothing else: no base, no ESLint and no GitHub call while the list does not stall", () => {
    plantClean();
    const bin = mkdtempSync(path.join(tmpdir(), "error-sites-gate-gh-"));
    try {
      writeFileSync(
        path.join(bin, "gh"),
        [
          `#!${process.execPath}`,
          'const fs = require("node:fs");',
          'fs.appendFileSync(require("node:path").join(__dirname, "calls.log"), JSON.stringify(process.argv.slice(2)) + "\\n");',
          "process.exit(1);",
        ].join("\n"),
        { mode: 0o755 }
      );
      const environment = {
        FITNESS_BASE_REF: "no-such-ref",
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      };
      remove(HISTORY);
      const undated = runCommand(
        ["--stalled", "--days", "14", "--remind", "--root", root],
        environment
      );
      writeJson(BASELINE, NO_ERROR_SITES);
      const empty = runCommand(
        ["--stalled", "--days", "14", "--remind", "--root", root],
        environment
      );

      expect(undated.status).toBe(3);
      expect(undated.stderr).toBe(
        `${PREFIX}${HISTORY} does not exist, so the list of 5 sites cannot be dated: a list above zero is dated by the rows of its history\n`
      );
      expect(empty.status).toBe(0);
      expect(empty.stdout).toBe(
        `${PREFIX}not stalled: the list of existing error sites is empty\n`
      );
      expect(existsSync(path.join(bin, "calls.log"))).toBe(false);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });
});
