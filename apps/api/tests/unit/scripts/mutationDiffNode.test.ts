/**
 * @file mutationDiffNode.test.ts
 * @description Pins the node:test side of the differential mutation tool. First the results
 *   reporter, `scripts/testing/node-results-reporter.mjs`, fed a recorded event stream
 *   (`fixtures/mutation-diff/node-events.json`). Then the loader hooks,
 *   `scripts/testing/lib/mutation-diff-hooks.mjs`, called the way Node calls them. Last, the
 *   command's node:test dispatch, through `main(argv, seams)` over a git repository planted under
 *   `tmpdir()`, each run replaced by a seam that feeds node:test events to the real reporter and
 *   writes what it yields where the run's `--test-reporter-destination` points. Git runs for real.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, describe, expect, it } from "vitest";

type NodeEvent = { readonly type: string; readonly data: Readonly<Record<string, unknown>> };
type Assertion = { ancestorTitles: string[]; title: string; status: string };
type FileResult = { name: string; status: string; message: string; assertionResults: Assertion[] };
type Loaded = { format?: string; source?: string | Buffer | null; shortCircuit?: boolean };
type Next<C> = (target: string, context: C) => Promise<Loaded & { url?: string }>;
type ParentContext = { parentURL?: string };
type Hooks = {
  initialize: (data: { options?: string }) => void;
  resolve: (
    specifier: string,
    context: ParentContext,
    next: Next<ParentContext>
  ) => Promise<unknown>;
  load: (url: string, context: object, next: Next<object>) => Promise<Loaded>;
};
type Outcome = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly spawnError: string | null;
};
/** One run the command asks the seam for. */
type ScopeRun = Readonly<{
  root: string;
  command: string;
  args: readonly string[];
  cwd: string;
  side: "base" | "head";
  mutated: boolean;
  files: readonly string[];
  paths: Readonly<Record<string, string>>;
  served: Readonly<Record<string, string>>;
  report: string;
  marker: string | null;
  servedLog: string;
  env: Readonly<Record<string, string>> | null;
}>;
type Seams = {
  readonly exec?: (run: ScopeRun) => Promise<Outcome>;
  readonly env?: Readonly<Record<string, string | undefined>>;
};
type Cli = {
  main: (argv: readonly string[], seams?: Seams) => Promise<{ code: number; output: string }>;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const REGISTER = path.join(REPO_ROOT, "scripts/testing/lib/mutation-diff-register.mjs");
const RESULTS_REPORTER = path.join(REPO_ROOT, "scripts/testing/node-results-reporter.mjs");
const reporter = (
  (await import(RESULTS_REPORTER)) as {
    default: (source: AsyncIterable<NodeEvent>) => AsyncGenerator<string>;
  }
).default;
const hooks = (await import(
  path.join(REPO_ROOT, "scripts/testing/lib/mutation-diff-hooks.mjs")
)) as Hooks;
const cli = (await import(path.join(REPO_ROOT, "scripts/testing/mutation-diff.mjs"))) as Cli;

const EVENTS = JSON.parse(
  readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "fixtures/mutation-diff/node-events.json"
    ),
    "utf8"
  )
) as NodeEvent[];

let scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  scratch = [];
});

const freshDir = (prefix: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
};

/** Drives the reporter over events the way node:test does, and parses what it yields. */
const reportFrom = async (
  events: readonly NodeEvent[]
): Promise<{ chunks: string[]; results: FileResult[] }> => {
  async function* stream(): AsyncGenerator<NodeEvent> {
    yield* events;
  }
  const chunks: string[] = [];
  for await (const chunk of reporter(stream())) chunks.push(chunk);
  const parsed = JSON.parse(chunks.join("")) as { testResults: FileResult[] };
  return { chunks, results: parsed.testResults };
};

const resultOf = async (name: string): Promise<FileResult | undefined> =>
  (await reportFrom(EVENTS)).results.find((result) => result.name === name);

describe("node-results-reporter", () => {
  it("yields one JSON document once the stream ends, a result per file, sorted by name", async () => {
    const { chunks, results } = await reportFrom(EVENTS);

    expect(chunks).toHaveLength(1);
    expect(results.map((result) => result.name)).toEqual([
      "/fixture/a.ts",
      "/fixture/broken.ts",
      "/fixture/empty.ts",
      "/fixture/thrown.ts",
    ]);
  });

  it("names each test by the titles around it from the start events' nesting, and leaves suites out", async () => {
    const tests = (await resultOf("/fixture/a.ts"))?.assertionResults ?? [];

    expect(tests.map((test) => [test.ancestorTitles.join(" > "), test.title])).toEqual([
      ["outer", "passes"],
      ["outer > inner", "deep"],
      ["outer", "skipped"],
      ["outer", "later"],
      ["outer", "cancelled"],
    ]);
  });

  it("maps a skip to skipped, a todo to todo, and a test its parent cancelled to failed", async () => {
    const result = await resultOf("/fixture/a.ts");

    expect(result?.assertionResults.map((test) => test.status)).toEqual([
      "passed",
      "failed",
      "skipped",
      "todo",
      "failed",
    ]);
    expect([result?.status, result?.message]).toEqual(["failed", ""]);
  });

  it("keeps a file that registers no test, without the passing stand-in node:test reports for it", async () => {
    expect(await resultOf("/fixture/empty.ts")).toEqual({
      name: "/fixture/empty.ts",
      status: "passed",
      message: "",
      assertionResults: [],
    });
  });

  it("reads a file whose child failed to load as failed with no test, its message the child's error line and frames outside Node", async () => {
    expect(await resultOf("/fixture/broken.ts")).toEqual({
      name: "/fixture/broken.ts",
      status: "failed",
      message:
        "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/fixture/missing.js' imported from /fixture/broken.ts\nat file:///fixture/broken.ts:1:1",
      assertionResults: [],
    });
  });

  it("takes the message from the failure itself when the file printed no error line", async () => {
    expect((await resultOf("/fixture/thrown.ts"))?.message).toBe("boom\nat /fixture/thrown.ts:2:9");
  });
});

/** Writes a run's options JSON and returns its path. */
const optionsFile = (options: Readonly<Record<string, unknown>>): string => {
  const file = path.join(freshDir("mutation-diff-hooks-"), "options.json");
  writeFileSync(
    file,
    JSON.stringify({
      subject: null,
      search: "limit = 20",
      replace: "limit = 21",
      marker: null,
      served: {},
      servedLog: null,
      aliases: {},
      ...options,
    })
  );
  return file;
};

/** A `nextLoad` that reads `text` from disk, the way Node's default `load` would. */
const fromDisk =
  (text: string): Next<object> =>
  () =>
    Promise.resolve({ format: "module-typescript", source: Buffer.from(text) });

describe("mutation-diff-hooks", () => {
  it("serves a listed file's text, query stripped, keeps the format the chain gave, and logs the file", async () => {
    const dir = freshDir("mutation-diff-served-");
    const file = path.join(dir, "a.test.ts");
    const log = path.join(dir, "served.log");
    hooks.initialize({ options: optionsFile({ served: { [file]: "base text" }, servedLog: log }) });

    const loaded = await hooks.load(`${pathToFileURL(file).href}?tsx`, {}, fromDisk("head text"));

    expect(loaded).toEqual({
      format: "module-typescript",
      source: "base text",
      shortCircuit: true,
    });
    expect(readFileSync(log, "utf8")).toBe(`${file}\n`);
  });

  it("replaces the subject's search once, literally, and writes the marker on a mutated run", async () => {
    const dir = freshDir("mutation-diff-mutated-");
    const subject = path.join(dir, "subject.ts");
    const marker = path.join(dir, "applied");
    hooks.initialize({ options: optionsFile({ subject, marker, replace: "limit = $&1" }) });

    const loaded = await hooks.load(
      pathToFileURL(subject).href,
      {},
      fromDisk("const limit = 20; // limit = 20")
    );

    expect(loaded.source).toBe("const limit = $&1; // limit = 20");
    expect(readFileSync(marker, "utf8")).toBe("applied\n");
  });

  it("throws when the subject lacks the search, and writes no marker", async () => {
    const dir = freshDir("mutation-diff-absent-");
    const subject = path.join(dir, "subject.ts");
    const marker = path.join(dir, "applied");
    hooks.initialize({ options: optionsFile({ subject, marker }) });

    await expect(
      hooks.load(pathToFileURL(subject).href, {}, fromDisk("const other = 1;"))
    ).rejects.toThrow(`mutation-diff: the search is absent from ${subject}`);
    expect(existsSync(marker)).toBe(false);
  });

  it("hands every other module, and every module of a run with no options, to the next hook unchanged", async () => {
    const dir = freshDir("mutation-diff-through-");
    const subject = path.join(dir, "subject.ts");
    const untouched: Loaded = { format: "module", source: "export {};" };
    const next = (): Promise<Loaded> => Promise.resolve(untouched);
    hooks.initialize({ options: optionsFile({ subject: null }) });
    const clean = await hooks.load(pathToFileURL(subject).href, {}, next);
    hooks.initialize({});
    const bare = await hooks.load(pathToFileURL(subject).href, {}, next);

    expect([clean, bare]).toEqual([untouched, untouched]);
  });

  it("resolves a copy's imports from the original's URL, and any other importer's as they are", async () => {
    const copy = "/scratch/at-base/pkg/tests/gone.test.ts";
    const original = "/repo/pkg/tests/gone.test.ts";
    hooks.initialize({ options: optionsFile({ aliases: { [copy]: original } }) });
    const parents: (string | undefined)[] = [];
    const next: Next<ParentContext> = (_specifier, context) => {
      parents.push(context.parentURL);
      return Promise.resolve({ url: "file:///resolved.ts" });
    };
    const other = pathToFileURL("/repo/pkg/tests/other.test.ts").href;

    await hooks.resolve("../src/subject.js", { parentURL: `${pathToFileURL(copy).href}?x` }, next);
    await hooks.resolve("../src/subject.js", { parentURL: other }, next);

    expect(parents).toEqual([pathToFileURL(original).href, other]);
  });
});

const INTEGRATION = "node:pkg/scripts/run-tests.sh#integration";
const TEST = "pkg/tests/subject.integration.test.ts";
const KEPT = "pkg/tests/kept.integration.test.ts";
const SUBJECT = "pkg/src/subject.ts";
const DATABASE = { DATABASE_URL: "postgresql://suite.invalid/db" };

/** The titles each planted file holds on each side. */
const TITLES: Readonly<Record<"base" | "head", Readonly<Record<string, readonly string[]>>>> = {
  base: { [TEST]: ["pins the limit", "drops the limit"], [KEPT]: ["uses the limit"] },
  head: { [TEST]: ["pins the limit"], [KEPT]: ["uses the limit"] },
};

const nodeText = (titles: readonly string[], expected: number): string =>
  [
    'import assert from "node:assert/strict";',
    'import { describe, it } from "node:test";',
    'import { limit } from "../src/subject.js";',
    "",
    'describe("subject", () => {',
    ...titles.map(
      (title) => `  it(${JSON.stringify(title)}, () => assert.equal(limit, ${expected}));`
    ),
    "});",
    "",
  ].join("\n");

const put = (root: string, file: string, text: string): void => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};

/** A repository whose base commit holds the base tests and whose working tree the head ones,
 *  each test's ledger row run by `collectors`. */
const plant = (collectors: readonly string[] = [INTEGRATION]): { root: string; base: string } => {
  const root = freshDir("mutation-diff-node-repo-");
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "suite@example.invalid");
  git("config", "user.name", "suite");
  put(root, SUBJECT, "export const limit = 20;\n");
  put(root, "pkg/scripts/run-tests.sh", "#!/bin/sh\n");
  put(root, "pkg/vitest.config.ts", "export default {};\n");
  const side = (each: "base" | "head", expected: number): void => {
    for (const [file, titles] of Object.entries(TITLES[each])) {
      put(root, file, nodeText(titles, file === TEST ? expected : 20));
    }
    const files = Object.keys(TITLES[each]).map((file) => ({
      path: file,
      framework: collectors[0]?.startsWith("vitest:") === true ? "vitest" : "node",
      collectors,
    }));
    put(root, "ledger.json", `${JSON.stringify({ files })}\n`);
  };
  side("base", 20);
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD").trim();
  side("head", 20.0);
  return { root, base };
};

/** A replaced runner: node:test events for each file, through the real reporter. */
const fakeRunner = (
  red: (run: ScopeRun) => readonly string[] = () => []
): { runs: ScopeRun[]; exec: (run: ScopeRun) => Promise<Outcome> } => {
  const runs: ScopeRun[] = [];
  const exec = async (run: ScopeRun): Promise<Outcome> => {
    runs.push(run);
    const failing = new Set(red(run));
    const events = run.files.flatMap((file): NodeEvent[] => {
      const name = run.paths[file] ?? path.join(run.root, file);
      return [
        { type: "test:start", data: { name: "subject", nesting: 0, file: name } },
        ...(TITLES[run.side][file] ?? []).flatMap((title): NodeEvent[] => [
          { type: "test:start", data: { name: title, nesting: 1, file: name } },
          {
            type: failing.has(title) ? "test:fail" : "test:pass",
            data: { name: title, nesting: 1, file: name, details: { type: "test" } },
          },
        ]),
        {
          type: "test:pass",
          data: { name: "subject", nesting: 0, file: name, details: { type: "suite" } },
        },
      ];
    });
    writeFileSync(run.report, (await reportFrom(events)).chunks.join(""));
    if (run.mutated && run.marker !== null) writeFileSync(run.marker, "applied\n");
    for (const file of Object.keys(run.served)) appendFileSync(run.servedLog, `${file}\n`);
    return {
      status: failing.size > 0 ? 1 : 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      spawnError: null,
    };
  };
  return { runs, exec };
};

const caseFor = (kind: "rewrite" | "deletion"): Record<string, unknown> => ({
  id: kind === "rewrite" ? "pins" : "drops",
  kind,
  test: TEST,
  blocks: [`${TEST}::${kind === "rewrite" ? "pins" : "drops"} the limit`],
  subject: SUBJECT,
  search: "limit = 20",
  replace: "limit = 21",
  note: "the limit is pinned",
});

/** Runs the command over one case and reads back the record. */
const runCase = async (
  planted: { root: string; base: string },
  kase: Record<string, unknown>,
  seams: Seams
): Promise<{ code: number; output: string; record: string | null }> => {
  const dir = freshDir("mutation-diff-node-out-");
  const cases = path.join(dir, "cases.json");
  const out = path.join(dir, "record.json");
  writeFileSync(cases, JSON.stringify([kase]));
  const result = await cli.main(
    ["--root", planted.root, "--cases", cases, "--out", out, "--base", planted.base],
    seams
  );
  return { ...result, record: existsSync(out) ? readFileSync(out, "utf8") : null };
};

const verdictOf = (record: string | null): unknown =>
  (JSON.parse(record ?? "{}") as { cases?: { verdict?: string }[] }).cases?.[0]?.verdict;

describe("main: a node:test case", () => {
  it("runs node:test from the package directory through the loader hooks, the options path in the child's environment alone", async () => {
    const planted = plant();
    const runner = fakeRunner();

    await runCase(planted, caseFor("rewrite"), { exec: runner.exec, env: DATABASE });

    const run = runner.runs[0];
    const stem = run?.report.replace(/\.report\.json$/, "") ?? "";
    expect([run?.command, run?.cwd, run?.env]).toEqual([
      process.execPath,
      path.join(planted.root, "pkg"),
      { MUTATION_DIFF_OPTIONS: `${stem}.options.json` },
    ]);
    expect(run?.args).toEqual([
      "--conditions",
      "development",
      "--import",
      REGISTER,
      "--import",
      "tsx",
      "--test",
      `--test-reporter=${RESULTS_REPORTER}`,
      `--test-reporter-destination=${run?.report}`,
      "--test-force-exit",
      "--test-concurrency=1",
      "--test-timeout=30000",
      "tests/kept.integration.test.ts",
      "tests/subject.integration.test.ts",
    ]);
  });

  const mutated =
    (base: readonly string[], head: readonly string[]) =>
    (run: ScopeRun): readonly string[] =>
      run.mutated ? (run.side === "base" ? base : head) : [];

  it.each([
    ["GAIN", "rewrite", mutated([], ["pins the limit"])],
    ["NO-GAIN", "rewrite", mutated(["pins the limit"], ["pins the limit"])],
    ["SAFE", "deletion", mutated(["drops the limit"], ["uses the limit"])],
    ["LOST", "deletion", mutated(["drops the limit"], [])],
  ] as const)("reads %s from the node-shaped reports of a %s", async (verdict, kind, red) => {
    const result = await runCase(plant(), caseFor(kind), {
      exec: fakeRunner(red).exec,
      env: DATABASE,
    });

    expect([result.code, verdictOf(result.record)]).toEqual([0, verdict]);
  });

  it.each([
    [
      "node:test's live tier",
      ["node:pkg/scripts/run-tests.sh#live"],
      'case pins: field "test" names pkg/tests/subject.integration.test.ts: a live-tier test needs a running API, which this tool does not start',
    ],
    [
      "no collector",
      [],
      'case pins: field "test" names pkg/tests/subject.integration.test.ts, and no collector runs it',
    ],
  ] as const)(
    "refuses a test run by %s, exit 2, with no run and no record",
    async (_name, collectors, message) => {
      const runner = fakeRunner();

      const result = await runCase(plant(collectors), caseFor("rewrite"), {
        exec: runner.exec,
        env: DATABASE,
      });

      expect([result.code, result.record, runner.runs.length]).toEqual([2, null, 0]);
      expect(result.output).toContain(`mutation-diff: refused: ${message}`);
    }
  );

  it.each([
    ["empty", { DATABASE_URL: "" }],
    ["unset", {}],
  ] as const)("exits 3 before any run when DATABASE_URL is %s", async (_name, env) => {
    const runner = fakeRunner();

    const result = await runCase(plant(), caseFor("rewrite"), { exec: runner.exec, env });

    expect([result.code, result.record, runner.runs.length]).toEqual([3, null, 0]);
    expect(result.output).toContain(
      "DATABASE_URL is empty, so there is no test database to run the integration suites against"
    );
  });

  it("runs a vitest case as before: vitest's own command, no environment of its own, no database needed", async () => {
    const runner = fakeRunner(mutated([], ["pins the limit"]));

    const result = await runCase(plant(["vitest:pkg/vitest.config.ts"]), caseFor("rewrite"), {
      exec: runner.exec,
      env: {},
    });

    const run = runner.runs[0];
    expect([result.code, verdictOf(result.record), run?.env]).toEqual([0, "GAIN", null]);
    expect([run?.args[0], run?.args[1], run?.args.at(-1)]).toEqual([
      path.join(REPO_ROOT, "node_modules/vitest/vitest.mjs"),
      "run",
      `--outputFile=${run?.report}`,
    ]);
  });
});
