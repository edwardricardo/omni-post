/**
 * @file hardProbe.test.ts
 * @description Pins the hard probe. First its pure logic: the gutting of
 *   `scripts/testing/lib/hard-probe-gut.mjs` (the body of every exported function and method of a
 *   module replaced by a throw, everything else as written), evaluated by importing a gutted module;
 *   then `scripts/testing/lib/hard-probe-core.mjs`: the seeded sampling over the ledger's blocks, the
 *   name pattern and the command that runs one block, the outcome read from a vitest JSON report and
 *   from node:test's summary reporter (real reports captured under `fixtures/hard-probe/`), the
 *   subject a test's import closure gives, and the deterministic `probes.json` with its per-class
 *   summary. Last, the command, `scripts/testing/hard-probe.mjs`, through `main(argv, seams)` over git
 *   repositories planted under `tmpdir()`: the refusals before any worktree exists, one full run whose
 *   install and runner are replaced, and the abort when a probe leaves the probe worktree dirty. Git
 *   runs for real, so each case reads `git worktree list` before and after.
 * @layer infrastructure
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { until, untilValue } from "@packages/vitest-shared/determinism";
import { afterEach, describe, expect, it } from "vitest";

type Result<T> = { value: T } | { error: string };
type Outcome = "GREEN" | "RED" | "LOAD-ERROR";
type Sample = "targeted" | "behavioural" | "only";

/** What one probe found. */
interface Verdict {
  readonly outcome: Outcome;
  readonly reason: string | null;
}

/** A block of a ledger row, as far as the probe reads it. */
interface LedgerBlock {
  readonly id: string;
  readonly blockClass: string;
}

/** A ledger row, as far as the probe reads it. */
interface LedgerRow {
  readonly path: string;
  readonly verdict: string | null;
  readonly collectors: readonly string[] | null;
  readonly blocks: readonly LedgerBlock[];
}

/** The ledger, as far as the probe reads it. */
interface ProbeLedger {
  readonly files: readonly LedgerRow[];
}

/** One block the plan probes. */
interface PlannedProbe {
  readonly id: string;
  readonly path: string;
  readonly blockClass: string;
  readonly sample: Sample;
  readonly runner: string | null;
}

/** The planned probes and the BEHAVIOURAL population the sample was drawn from. */
interface Plan {
  readonly probes: readonly PlannedProbe[];
  readonly pool: number;
}

interface PlanOptions {
  readonly seed: number;
  readonly limit: number | null;
  readonly only: string | null;
}

/** The command that runs one block. */
interface Command {
  readonly runner: "vitest" | "node";
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly file: string;
  readonly pattern: string;
}

/** A command as `probes.json` records it. */
interface RecordedCommand {
  readonly argv: readonly string[];
  readonly cwd: string;
}

/** One probe, as the command hands it to the record. */
interface ProbeEntry {
  readonly id: string;
  readonly blockClass: string;
  readonly command: RecordedCommand | null;
  readonly gutted: number;
  readonly outcome: Outcome;
  readonly partial: readonly string[];
  readonly reason: string | null;
  readonly sample: Sample;
  readonly subject: readonly string[];
  readonly subjectHash: string;
  readonly testHash: string;
}

/** What a run selected its probes by. */
interface Selection {
  readonly fraction: number;
  readonly limit: number | null;
  readonly only: string | null;
  readonly seed: number;
}

/** One class's counts. */
interface ClassSummary {
  readonly GREEN: number;
  readonly "LOAD-ERROR": number;
  readonly RED: number;
  readonly conclusive: number;
  readonly greenRate: number | null;
  readonly lintRule: boolean;
  readonly probes: number;
}

/** One recorded probe. */
type RecordedProbe = Omit<ProbeEntry, "id"> & { readonly sha: string };

/** `probes.json`. */
interface ProbesRecord {
  readonly probes: Readonly<Record<string, RecordedProbe>>;
  readonly selection: Selection;
  readonly sha: string;
  readonly summary: Readonly<Record<string, ClassSummary>>;
  readonly version: number;
}

/** The core's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type HardProbeCore = {
  planProbes: (ledger: ProbeLedger, options: PlanOptions) => Result<Plan>;
  testNamePattern: (describe: readonly string[], title: string) => string;
  probeCommand: (file: string, runner: string, pattern: string) => Command;
  outcomeOf: (command: Command, stdout: string) => Verdict;
  subjectModules: (closure: readonly string[]) => string[];
  isProbesRecord: (text: string) => boolean;
  pendingTempPath: (target: string, suffix: string) => string;
  hashes: (
    testText: string,
    subject: readonly { readonly path: string; readonly text: string }[]
  ) => { testHash: string; subjectHash: string };
  probesRecord: (input: {
    sha: string;
    options: PlanOptions;
    entries: readonly ProbeEntry[];
  }) => ProbesRecord;
  summaryLines: (record: ProbesRecord) => string[];
  renderProbes: (record: ProbesRecord) => Promise<string>;
};

/** The gutting's surface, typed for the same reason. */
type HardProbeGut = {
  gutModule: (
    text: string,
    fileName: string
  ) => { text: string; gutted: string[]; ungutted: string[] };
};

/** What a replaced process returns. */
interface Ran {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly spawnError: string | null;
}

/** What the suite replaces in the command; git always runs for real. */
interface ProbeSeams {
  readonly exec?: (command: string, args: readonly string[], cwd: string) => Ran;
  readonly buildLedger?: (root: string) => Result<ProbeLedger>;
  readonly progress?: (line: string) => void;
  readonly writeText?: (fd: number, text: string) => void;
}

/** What the command prints and the exit code it ends with. */
interface CliResult {
  readonly code: number;
  readonly output: string;
}

type HardProbeCli = {
  main: (argv: readonly string[], seams?: ProbeSeams) => Promise<CliResult>;
  runTool: (command: string, args: readonly string[], cwd: string, timeout: number) => Promise<Ran>;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/hard-probe");
const core = (await import(
  path.join(REPO_ROOT, "scripts/testing/lib/hard-probe-core.mjs")
)) as HardProbeCore;
const gut = (await import(
  path.join(REPO_ROOT, "scripts/testing/lib/hard-probe-gut.mjs")
)) as HardProbeGut;
const cli = (await import(path.join(REPO_ROOT, "scripts/testing/hard-probe.mjs"))) as HardProbeCli;

const THROW = 'throw new Error("__HARD_PROBE__")';
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

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

/** Imports a module's text, written to a scratch file of that name, through vitest's transform. */
const importText = async (text: string, name: string): Promise<unknown> => {
  const file = path.join(scratchDir("hard-probe-gut-"), name);
  writeFileSync(file, text);
  return (await import(pathToFileURL(file).href)) as unknown;
};

/** Writes files below a directory, creating their parents. */
const writeFiles = (root: string, files: Readonly<Record<string, string>>): void => {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
};

const MODULE = [
  "const BASE = 40;",
  "function helper(value: number): number {",
  "  return value + BASE;",
  "}",
  "export const ANSWER = helper(2);",
  "export function add(left: number, right: number): number {",
  "  return left + right;",
  "}",
  "export class Calculator {",
  "  private stored = 0;",
  "  constructor(public readonly start: number) {}",
  "  double(value: number): number {",
  "    return value * 2;",
  "  }",
  "  get label(): string {",
  '    return "calculator";',
  "  }",
  "  set label(value: string) {",
  "    this.stored = value.length;",
  "  }",
  "  readonly onTick = (): number => this.stored + 1;",
  "  static create(): Calculator {",
  "    return new Calculator(0);",
  "  }",
  "}",
  "export const triple = (value: number): number => value * 3;",
  "function aliased(): string {",
  '  return "aliased";',
  "}",
  "function kept(): string {",
  '  return "kept";',
  "}",
  "export const KEPT = kept();",
  "export { aliased as renamed };",
  "export default function main(): string {",
  '  return "main";',
  "}",
  "",
].join("\n");

/** The gutted module, as importing it exposes it. */
interface GuttedModule {
  readonly ANSWER: number;
  readonly KEPT: string;
  readonly add: (left: number, right: number) => number;
  readonly Calculator: new (start: number) => {
    readonly start: number;
    double: (value: number) => number;
    label: string;
    onTick: () => number;
  } & { create: () => unknown };
  readonly triple: (value: number) => number;
  readonly renamed: () => string;
  readonly default: () => string;
}

describe("gutModule", () => {
  it("throws from the body of every exported function and method, and keeps the constructor, the other functions and the top level", async () => {
    const result = gut.gutModule(MODULE, "src/calculator.ts");

    expect(result.gutted).toEqual([
      "add",
      "Calculator.double",
      "Calculator.get label",
      "Calculator.set label",
      "Calculator.onTick",
      "Calculator.create",
      "triple",
      "aliased",
      "main",
    ]);
    expect(result.ungutted).toEqual([]);
    expect(result.text.split(THROW)).toHaveLength(10);
    const loaded = (await importText(result.text, "calculator.ts")) as GuttedModule;
    expect(loaded.ANSWER).toBe(42);
    expect(loaded.KEPT).toBe("kept");
    const calculator = new loaded.Calculator(5);
    expect(calculator.start).toBe(5);
    expect(() => loaded.add(1, 2)).toThrow("__HARD_PROBE__");
    expect(() => calculator.double(1)).toThrow("__HARD_PROBE__");
    expect(() => calculator.label).toThrow("__HARD_PROBE__");
    expect(() => {
      calculator.label = "x";
    }).toThrow("__HARD_PROBE__");
    expect(() => calculator.onTick()).toThrow("__HARD_PROBE__");
    expect(() => (loaded.Calculator as unknown as { create: () => unknown }).create()).toThrow(
      "__HARD_PROBE__"
    );
    expect(() => loaded.triple(1)).toThrow("__HARD_PROBE__");
    expect(() => loaded.renamed()).toThrow("__HARD_PROBE__");
    expect(() => loaded.default()).toThrow("__HARD_PROBE__");
  });

  it("guts the exported components of a .tsx module and keeps the JSX of the others as written", () => {
    const text = [
      'const Inner = () => <span className="kept">ok</span>;',
      "export function Badge(props: { readonly label: string }) {",
      "  return <strong>{props.label}</strong>;",
      "}",
      "export const Panel = () => (",
      "  <section>",
      "    <Inner />",
      "  </section>",
      ");",
      "",
    ].join("\n");

    const result = gut.gutModule(text, "src/Badge.tsx");

    expect(result.gutted).toEqual(["Badge", "Panel"]);
    expect(result.text).toContain('const Inner = () => <span className="kept">ok</span>;');
    expect(result.text.split(THROW)).toHaveLength(3);
    expect(result.text).not.toContain("<strong>");
    expect(result.text).not.toContain("<section>");
  });

  it("returns a module that exports no function byte for byte, with nothing gutted", () => {
    const text =
      "const a = () => 1;\nfunction b() {\n  return 2;\n}\nexport const VALUE = a() + b();\nexport type Shape = { readonly a: number };\n";

    expect(gut.gutModule(text, "src/value.mjs")).toEqual({ text, gutted: [], ungutted: [] });
  });

  it("guts only the public members of an exported class, so a constructor that calls the others still constructs", async () => {
    const text = [
      "export class Account {",
      "  private readonly id: string;",
      "  #balance = 0;",
      "  constructor(id: string) {",
      "    this.id = this.normalise(id);",
      "    this.#open();",
      "    this.audit();",
      "    this.tick();",
      "  }",
      "  private normalise(id: string): string {",
      "    return id.trim();",
      "  }",
      "  protected audit(): void {",
      "    this.#balance += 1;",
      "  }",
      "  #open(): void {",
      "    this.#balance = 10;",
      "  }",
      "  private readonly tick = (): number => this.#balance;",
      "  describe(): string {",
      "    return this.id;",
      "  }",
      "  get balance(): number {",
      "    return this.#balance;",
      "  }",
      "}",
      "",
    ].join("\n");

    const result = gut.gutModule(text, "src/account.ts");

    expect(result.gutted).toEqual(["Account.describe", "Account.get balance"]);
    expect(result.ungutted).toEqual([]);
    expect(result.text).toContain("return id.trim();");
    const loaded = (await importText(result.text, "account.ts")) as {
      Account: new (id: string) => { describe: () => string; readonly balance: number };
    };
    const account = new loaded.Account(" a1 ");
    expect(() => account.describe()).toThrow("__HARD_PROBE__");
    expect(() => account.balance).toThrow("__HARD_PROBE__");
  });

  it("guts through as and satisfies, an exported object's functions and an exported call's function arguments, and names the exports it leaves", async () => {
    const text = [
      "type Fn = (value: number) => number;",
      "const memo = <T,>(fn: T): T => fn;",
      "const create = <S,>(init: (set: (next: Partial<S>) => void) => S): (() => S) => {",
      "  const state = init(() => undefined);",
      "  return () => state;",
      "};",
      "class Hidden {",
      "  speak(): string {",
      '    return "hidden";',
      "  }",
      "}",
      "export const asCast = ((value: number): number => value + 1) as Fn;",
      "export const checked = ((value: number): number => value * 2) satisfies Fn;",
      "export const service = {",
      '  label: "service",',
      "  greet(name: string): string {",
      "    return `hi ${name}`;",
      "  },",
      "  double: (value: number): number => value * 2,",
      "  get size(): number {",
      "    return 1;",
      "  },",
      "};",
      "export const Memoised = memo((value: number): number => value + 10);",
      "export const useCounter = create<{ count: number; increment: () => void }>((set) => ({",
      "  count: 0,",
      "  increment: () => set({ count: 1 }),",
      "}));",
      "export const hidden = new Hidden();",
      "export default {",
      "  run(): string {",
      '    return "run";',
      "  },",
      "};",
      "",
    ].join("\n");

    const result = gut.gutModule(text, "src/surface.ts");

    expect(result.gutted).toEqual([
      "asCast",
      "checked",
      "service.greet",
      "service.double",
      "service.get size",
      "Memoised",
      "useCounter.increment",
      "default.run",
    ]);
    expect(result.ungutted).toEqual(["hidden (an instance of Hidden)"]);
    const loaded = (await importText(result.text, "surface.ts")) as {
      asCast: (value: number) => number;
      checked: (value: number) => number;
      service: {
        label: string;
        greet: (name: string) => string;
        double: (value: number) => number;
        readonly size: number;
      };
      Memoised: (value: number) => number;
      useCounter: () => { count: number; increment: () => void };
      hidden: { speak: () => string };
      default: { run: () => string };
    };
    expect(() => loaded.asCast(1)).toThrow("__HARD_PROBE__");
    expect(() => loaded.checked(1)).toThrow("__HARD_PROBE__");
    expect(loaded.service.label).toBe("service");
    expect(() => loaded.service.greet("a")).toThrow("__HARD_PROBE__");
    expect(() => loaded.service.double(1)).toThrow("__HARD_PROBE__");
    expect(() => loaded.service.size).toThrow("__HARD_PROBE__");
    expect(() => loaded.Memoised(1)).toThrow("__HARD_PROBE__");
    expect(loaded.useCounter().count).toBe(0);
    expect(() => loaded.useCounter().increment()).toThrow("__HARD_PROBE__");
    expect(loaded.hidden.speak()).toBe("hidden");
    expect(() => loaded.default.run()).toThrow("__HARD_PROBE__");
  });

  it("names an exported namespace as left ungutted, and returns its module as written", () => {
    const text =
      "export namespace Tools {\n  export function twice(value: number): number {\n    return value * 2;\n  }\n}\n";

    expect(gut.gutModule(text, "src/tools.ts")).toEqual({
      text,
      gutted: [],
      ungutted: ["Tools (a namespace)"],
    });
  });
});

describe("testNamePattern", () => {
  it("anchors the describe titles and the block title joined by spaces, every regular expression character escaped", () => {
    const pattern = core.testNamePattern(["math (add)", "costs $5 [net]?"], "adds two numbers.");

    expect(pattern).toBe("^math \\(add\\) costs \\$5 \\[net\\]\\? adds two numbers\\.$");
    expect(new RegExp(pattern).test("math (add) costs $5 [net]? adds two numbers.")).toBe(true);
    expect(new RegExp(pattern).test("math (add) costs $5 [net]? adds two numbers.x")).toBe(false);
    expect(new RegExp(pattern).test("adds two numbers.")).toBe(false);
  });

  it("leaves a slash as written, which both runners' patterns read literally", () => {
    const pattern = core.testNamePattern(["routes"], "detects LOGIN from /auth/login POST");

    expect(pattern).toBe("^routes detects LOGIN from /auth/login POST$");
    expect(new RegExp(pattern).test("routes detects LOGIN from /auth/login POST")).toBe(true);
  });

  it("matches any value where an each title formats one or a template literal interpolates one", () => {
    const pattern = core.testNamePattern(["parses %s"], "maps $kind to ${label} in %d ms");

    expect(new RegExp(pattern).test("parses json maps post to Post in 3 ms")).toBe(true);
    expect(new RegExp(pattern).test("parses json maps post to Post")).toBe(false);
  });
});

describe("probeCommand", () => {
  it("runs a vitest block from its config's directory with the JSON reporter", () => {
    expect(
      core.probeCommand("pkg/tests/math.test.ts", "vitest:pkg/vitest.config.ts", "^a$")
    ).toEqual({
      runner: "vitest",
      cwd: "pkg",
      file: "tests/math.test.ts",
      pattern: "^a$",
      argv: [
        "pnpm",
        "exec",
        "vitest",
        "run",
        "tests/math.test.ts",
        "--config",
        "vitest.config.ts",
        "-t",
        "^a$",
        "--reporter=json",
      ],
    });
  });

  it("runs a node:test block as run-tests.sh runs one file, with its summary reporter and the name pattern", () => {
    expect(
      core.probeCommand(
        "apps/api/tests/integration/demo.integration.test.ts",
        "node:apps/api/scripts/run-tests.sh#integration",
        "^a$"
      )
    ).toEqual({
      runner: "node",
      cwd: "apps/api",
      file: "tests/integration/demo.integration.test.ts",
      pattern: "^a$",
      argv: [
        "node",
        "--conditions",
        "development",
        "--import",
        "tsx",
        "--test",
        "--test-reporter=../../scripts/testing/node-summary-reporter.mjs",
        "--test-reporter-destination=stdout",
        "--test-force-exit",
        "--test-concurrency=1",
        "--test-timeout=30000",
        "--test-name-pattern=^a$",
        "tests/integration/demo.integration.test.ts",
      ],
    });
  });
});

/** A captured vitest report on one line, after a line of other output, as `pnpm exec` prints it. */
const vitestStdout = (fixture: string): string => {
  const report = JSON.parse(readFileSync(path.join(FIXTURES, fixture), "utf8")) as unknown;
  return `stdout | a line a suite printed\n${JSON.stringify(report)}\n`;
};

describe("outcomeOf a vitest report", () => {
  const VITEST = "vitest:pkg/vitest.config.ts";
  const math = (pattern: string): Command =>
    core.probeCommand("pkg/tests/math.test.ts", VITEST, pattern);

  it.each([
    [
      "a passing block",
      "vitest-pass.json",
      math("^math \\(add\\) adds two numbers$"),
      "GREEN",
      null,
    ],
    ["a failing block", "vitest-fail.json", math("^math \\(add\\) subtracts$"), "RED", null],
    [
      "a file that does not load",
      "vitest-load-error.json",
      core.probeCommand("pkg/tests/broken.test.ts", VITEST, "^math \\(add\\) adds two numbers$"),
      "LOAD-ERROR",
      "load-error",
    ],
    [
      "a pattern no test matched",
      "vitest-no-match.json",
      math("^nothing$"),
      "LOAD-ERROR",
      "no-test-ran",
    ],
    [
      "a report that names another file",
      "vitest-pass.json",
      core.probeCommand("pkg/tests/other.test.ts", VITEST, "^math \\(add\\) adds two numbers$"),
      "LOAD-ERROR",
      "no-report",
    ],
    [
      "a block skipped because its describe's beforeAll failed",
      "vitest-hook-failure.json",
      core.probeCommand(
        "pkg/tests/hooks.test.ts",
        VITEST,
        "^broken setup runs after a failed beforeAll$"
      ),
      "LOAD-ERROR",
      "hook-failure",
    ],
    [
      "a block skipped because a top-level beforeAll failed",
      "vitest-top-hook-failure.json",
      core.probeCommand(
        "pkg/tests/top.test.ts",
        VITEST,
        "^runs after a failed top-level beforeAll$"
      ),
      "LOAD-ERROR",
      "hook-failure",
    ],
    [
      "a block that passed before its describe's afterAll failed",
      "vitest-after-hook-failure.json",
      core.probeCommand(
        "pkg/tests/after.test.ts",
        VITEST,
        "^broken teardown runs before a failed afterAll$"
      ),
      "LOAD-ERROR",
      "hook-failure",
    ],
  ] as const)("reads %s", (_case, fixture, command, outcome, reason) => {
    expect(core.outcomeOf(command, vitestStdout(fixture))).toEqual({ outcome, reason });
  });

  it("reads the report among a suite's own JSON log lines, printed before it and after it", () => {
    const log = JSON.stringify({ level: 30, msg: "audit event recorded" });
    const stdout = `${log}\n${vitestStdout("vitest-pass.json")}${log}\n`;

    expect(core.outcomeOf(math("^math \\(add\\) adds two numbers$"), stdout)).toEqual({
      outcome: "GREEN",
      reason: null,
    });
  });

  it("reads no report when vitest printed no JSON", () => {
    expect(core.outcomeOf(math("^a$"), "No test files found, exiting with code 1\n")).toEqual({
      outcome: "LOAD-ERROR",
      reason: "no-report",
    });
  });
});

describe("outcomeOf node:test's summary", () => {
  const command = core.probeCommand(
    "apps/api/tests/integration/demo.integration.test.ts",
    "node:apps/api/scripts/run-tests.sh#integration",
    "^Outer inner does a thing$"
  );
  const summary = (counts: string): string => `# tests 1\n@@SUMMARY ${counts}\n`;

  it.each([
    [
      "a passing block",
      summary("tests=1 pass=1 fail=0 cancelled=0 skipped=0 todo=0"),
      "GREEN",
      null,
    ],
    [
      "a failing block",
      "failed: Outer > inner > does a thing (/repo/apps/api/tests/integration/demo.integration.test.ts:6:5)\n" +
        "  testCodeFailure: Expected values to be strictly equal\n" +
        summary("tests=1 pass=0 fail=1 cancelled=0 skipped=0 todo=0"),
      "RED",
      null,
    ],
    [
      "a cancelled block",
      summary("tests=1 pass=0 fail=0 cancelled=1 skipped=0 todo=0"),
      "RED",
      null,
    ],
    [
      "a file that does not load",
      "# Error [ERR_MODULE_NOT_FOUND]: Cannot find module\n" +
        "failed: tests/integration/demo.integration.test.ts (tests/integration/demo.integration.test.ts:1:1)\n" +
        "  testCodeFailure: test failed\n" +
        summary("tests=1 pass=0 fail=1 cancelled=0 skipped=0 todo=0"),
      "LOAD-ERROR",
      "load-error",
    ],
    [
      "a pattern no test matched",
      "no test registered: tests/integration/demo.integration.test.ts\n" +
        summary("tests=0 pass=0 fail=0 cancelled=0 skipped=0 todo=0"),
      "LOAD-ERROR",
      "no-test-ran",
    ],
    [
      "a skipped block",
      summary("tests=1 pass=0 fail=0 cancelled=0 skipped=1 todo=0"),
      "LOAD-ERROR",
      "no-test-ran",
    ],
    [
      "an output with no summary line",
      "node: bad option: --conditions\n",
      "LOAD-ERROR",
      "no-report",
    ],
    [
      "a block cancelled because its describe's before hook failed",
      "cancelled: Outer > inner > does a thing (tests/integration/demo.integration.test.ts:5:3)\n" +
        "  cancelledByParent: test did not finish before its parent and was cancelled\n" +
        "suite failed: Outer > inner (tests/integration/demo.integration.test.ts:3:1)\n" +
        "  hookFailed: failed running before hook\n" +
        "  cause: __HARD_PROBE__\n" +
        summary("tests=1 pass=0 fail=0 cancelled=1 skipped=0 todo=0"),
      "LOAD-ERROR",
      "hook-failure",
    ],
    [
      "a block failed by a top-level before hook",
      "failed: Outer inner does a thing (tests/integration/demo.integration.test.ts:4:1)\n" +
        "  hookFailed: failed running before hook\n" +
        "  cause: __HARD_PROBE__\n" +
        summary("tests=1 pass=0 fail=1 cancelled=0 skipped=0 todo=0"),
      "LOAD-ERROR",
      "hook-failure",
    ],
    [
      "a block that passed before its describe's after hook failed",
      "suite failed: Outer > inner (tests/integration/demo.integration.test.ts:3:1)\n" +
        "  hookFailed: failed running after hook\n" +
        "  cause: __HARD_PROBE__\n" +
        summary("tests=1 pass=1 fail=0 cancelled=0 skipped=0 todo=0"),
      "LOAD-ERROR",
      "hook-failure",
    ],
    [
      "a block its own beforeEach hook failed",
      "failed: Outer > inner > does a thing (tests/integration/demo.integration.test.ts:9:3)\n" +
        "  hookFailed: failed running beforeEach hook\n" +
        "  cause: __HARD_PROBE__\n" +
        summary("tests=1 pass=0 fail=1 cancelled=0 skipped=0 todo=0"),
      "RED",
      null,
    ],
  ] as const)("reads %s", (_case, stdout, outcome, reason) => {
    expect(core.outcomeOf(command, stdout)).toEqual({ outcome, reason });
  });
});

describe("subjectModules", () => {
  it("keeps the first-party production modules the closure reached, sorted, and no test, helper, runner, test configuration, declaration or data file", () => {
    expect(
      core.subjectModules([
        "packages/core/posts/src/index.ts",
        "apps/api/src/routes/posts.ts",
        "apps/api/scripts/tool.ts",
        "apps/admin/lib/http/forwardedFor.ts",
        "apps/client/components/editor/Editor.tsx",
        "apps/client/hooks/useDraft.ts",
        "apps/client/app/[locale]/page.tsx",
        "apps/api/tests/unit/helpers/makePost.ts",
        "apps/api/tests/run-integration.ts",
        "apps/admin/lib/http/__tests__/headers.ts",
        "apps/client/e2e/pages/LoginPage.ts",
        "packages/providers/x/fixtures/payload.ts",
        "apps/client/__mocks__/next-router.ts",
        "security/lib/attack.ts",
        "apps/api/src/routes/posts.test.ts",
        "apps/api/vitest.config.ts",
        "apps/client/vitest.stories.config.ts",
        "apps/client/playwright.config.ts",
        "apps/api/src/types.d.ts",
        "apps/api/src/data/seed.json",
      ])
    ).toEqual([
      "apps/admin/lib/http/forwardedFor.ts",
      "apps/api/scripts/tool.ts",
      "apps/api/src/routes/posts.ts",
      "apps/client/app/[locale]/page.tsx",
      "apps/client/components/editor/Editor.tsx",
      "apps/client/hooks/useDraft.ts",
      "packages/core/posts/src/index.ts",
    ]);
  });

  it("leaves out the listed test infrastructure, by exact path and by glob, and keeps a production module only its own test imports", () => {
    expect(
      core.subjectModules([
        "infra/prisma/src/test-client.ts",
        "infra/prisma/src/vitest-entry.ts",
        "packages/vitest-shared/src/index.ts",
        "packages/vitest-shared/src/determinism/until.ts",
        "packages/providers/shared/src/test-utils/msw-helpers.ts",
        "apps/api/vitest.coverage-thresholds.ts",
        "apps/client/.storybook/vitest.setup.ts",
        "infra/prisma/src/client.ts",
        "apps/api/src/webhooks/webhookManager.ts",
      ])
    ).toEqual(["apps/api/src/webhooks/webhookManager.ts", "infra/prisma/src/client.ts"]);
  });
});

describe("hashes", () => {
  it("hashes the test's text and every subject module's path and text, whatever their order", () => {
    const subject = [
      { path: "b/src/b.ts", text: "export const b = 2;\n" },
      { path: "a/src/a.ts", text: "export const a = 1;\n" },
    ];
    const expected = sha256(
      `a/src/a.ts\0${sha256(subject[1]?.text ?? "")}\nb/src/b.ts\0${sha256(subject[0]?.text ?? "")}\n`
    );

    expect(core.hashes("test text", subject)).toEqual({
      testHash: sha256("test text"),
      subjectHash: expected,
    });
    expect(core.hashes("test text", [...subject].reverse()).subjectHash).toBe(expected);
  });
});

/** A ledger row of a file a vitest config collects. */
const row = (
  file: string,
  verdict: string,
  blocks: readonly LedgerBlock[],
  collectors: readonly string[] | null = ["vitest:apps/api/vitest.config.ts"]
): LedgerRow => ({ path: file, verdict, collectors, blocks });
const block = (file: string, title: string, blockClass: string): LedgerBlock => ({
  id: `${file}::${title}`,
  blockClass,
});
const ADJUDICATED = "apps/api/tests/unit/a.test.ts";
const KEPT = "apps/api/tests/unit/b.test.ts";
const BROWSER = "apps/client/tests/e2e/c.spec.ts";
const behaviourals = (file: string, count: number): LedgerBlock[] =>
  Array.from({ length: count }, (_, index) => block(file, `behaves ${index}`, "BEHAVIOURAL"));
const LEDGER: ProbeLedger = {
  files: [
    row(
      BROWSER,
      "ADJUDICATE",
      [block(BROWSER, "shows the page", "EXISTENCE-ONLY"), ...behaviourals(BROWSER, 20)],
      ["playwright:apps/client/playwright.config.ts"]
    ),
    row(KEPT, "KEEP", [block(KEPT, "exists", "EXISTENCE-ONLY"), ...behaviourals(KEPT, 39)]),
    row(ADJUDICATED, "ADJUDICATE", [
      block(ADJUDICATED, "exists", "EXISTENCE-ONLY"),
      block(ADJUDICATED, "branches", "CONDITIONAL-ONLY"),
      block(ADJUDICATED, "throws on bad input", "TITLE-CONTRADICTION"),
      block(ADJUDICATED, "skips itself", "SELF-SKIP"),
      block(ADJUDICATED, "is empty", "EMPTY"),
      block(ADJUDICATED, "adds", "BEHAVIOURAL"),
    ]),
    row("apps/api/tests/unit/helpers/make.ts", "KEEP", [], null),
  ],
};
const planned = (options: Partial<PlanOptions> = {}): Plan => {
  const plan = core.planProbes(LEDGER, { seed: 7, limit: null, only: null, ...options });
  if ("error" in plan) throw new Error(plan.error);
  return plan.value;
};

describe("planProbes", () => {
  it("probes every EXISTENCE-ONLY, CONDITIONAL-ONLY and TITLE-CONTRADICTION block of an ADJUDICATE file and 5 % of the runnable BEHAVIOURAL blocks, sorted by id", () => {
    const plan = planned();
    const targeted = plan.probes.filter((probe) => probe.sample === "targeted");
    const behavioural = plan.probes.filter((probe) => probe.sample === "behavioural");

    expect(plan.pool).toBe(40);
    expect(targeted).toEqual([
      {
        id: `${ADJUDICATED}::branches`,
        path: ADJUDICATED,
        blockClass: "CONDITIONAL-ONLY",
        sample: "targeted",
        runner: "vitest:apps/api/vitest.config.ts",
      },
      {
        id: `${ADJUDICATED}::exists`,
        path: ADJUDICATED,
        blockClass: "EXISTENCE-ONLY",
        sample: "targeted",
        runner: "vitest:apps/api/vitest.config.ts",
      },
      {
        id: `${ADJUDICATED}::throws on bad input`,
        path: ADJUDICATED,
        blockClass: "TITLE-CONTRADICTION",
        sample: "targeted",
        runner: "vitest:apps/api/vitest.config.ts",
      },
      {
        id: `${BROWSER}::shows the page`,
        path: BROWSER,
        blockClass: "EXISTENCE-ONLY",
        sample: "targeted",
        runner: null,
      },
    ]);
    expect(behavioural).toHaveLength(2);
    for (const probe of behavioural) {
      expect(probe.blockClass).toBe("BEHAVIOURAL");
      expect([KEPT, ADJUDICATED]).toContain(probe.path);
      expect(probe.runner).toBe("vitest:apps/api/vitest.config.ts");
    }
    expect(new Set(behavioural.map((probe) => probe.id)).size).toBe(2);
    const ids = plan.probes.map((probe) => probe.id);
    expect(ids).toEqual([...ids].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
  });

  it("draws the same sample from the same seed, and other samples from other seeds", () => {
    const picks = (seed: number): string[] =>
      planned({ seed })
        .probes.filter((probe) => probe.sample === "behavioural")
        .map((probe) => probe.id);

    expect(planned({ seed: 7 })).toEqual(planned({ seed: 7 }));
    expect(
      new Set(Array.from({ length: 10 }, (_, seed) => picks(seed).join("|"))).size
    ).toBeGreaterThan(1);
  });

  it.each([
    [100, 5],
    [1, 1],
    [0, 0],
  ])("samples %i runnable BEHAVIOURAL blocks down to %i", (count, expected) => {
    const plan = core.planProbes(
      { files: [row(KEPT, "KEEP", behaviourals(KEPT, count))] },
      { seed: 1, limit: null, only: null }
    );

    const probes = "value" in plan ? plan.value.probes : [];

    expect(plan).toEqual({
      value: { pool: count, probes: expect.any(Array) as unknown },
    });
    expect(probes).toHaveLength(expected);
    expect(probes.every((probe) => probe.sample === "behavioural")).toBe(true);
  });

  it("caps the plan at --limit, from the start of its order", () => {
    expect(planned({ limit: 3 }).probes).toEqual(planned().probes.slice(0, 3));
  });

  it("probes the one block --only names, whatever its class, and names an id the ledger lacks", () => {
    expect(planned({ only: `${ADJUDICATED}::skips itself` }).probes).toEqual([
      {
        id: `${ADJUDICATED}::skips itself`,
        path: ADJUDICATED,
        blockClass: "SELF-SKIP",
        sample: "only",
        runner: "vitest:apps/api/vitest.config.ts",
      },
    ]);
    expect(core.planProbes(LEDGER, { seed: 7, limit: null, only: `${ADJUDICATED}::nope` })).toEqual(
      { error: `--only ${ADJUDICATED}::nope names no block of the ledger` }
    );
  });
});

const SHA = "a".repeat(40);
const OPTIONS: PlanOptions = { limit: null, only: null, seed: 23 };
const entry = (id: string, blockClass: string, outcome: Outcome): ProbeEntry => ({
  id,
  blockClass,
  command: { argv: ["pnpm", "exec", "vitest"], cwd: "apps/api" },
  gutted: 1,
  outcome,
  partial: [],
  reason: outcome === "LOAD-ERROR" ? "load-error" : null,
  sample: blockClass === "BEHAVIOURAL" ? "behavioural" : "targeted",
  subject: ["apps/api/src/a.ts"],
  subjectHash: "s",
  testHash: "t",
});
const ENTRIES: readonly ProbeEntry[] = [
  ...Array.from({ length: 9 }, (_, index) =>
    entry(`x.test.ts::green ${index}`, "EXISTENCE-ONLY", "GREEN")
  ),
  entry("x.test.ts::red", "EXISTENCE-ONLY", "RED"),
  entry("y.test.ts::red", "BEHAVIOURAL", "RED"),
  entry("y.test.ts::load", "BEHAVIOURAL", "LOAD-ERROR"),
  entry("y.test.ts::green", "BEHAVIOURAL", "GREEN"),
];

/** Every object key of a parsed JSON value, each object's keys in their order. */
const keyLists = (value: unknown): string[][] => {
  if (Array.isArray(value)) return value.flatMap(keyLists);
  if (typeof value !== "object" || value === null) return [];
  return [Object.keys(value), ...Object.values(value).flatMap(keyLists)];
};

describe("probesRecord", () => {
  it("renders the same bytes whatever order the probes arrive in, every key sorted and no timestamp", async () => {
    const forward = await core.renderProbes(
      core.probesRecord({ sha: SHA, options: OPTIONS, entries: ENTRIES })
    );
    const backward = await core.renderProbes(
      core.probesRecord({ sha: SHA, options: OPTIONS, entries: [...ENTRIES].reverse() })
    );

    expect(backward).toBe(forward);
    const parsed = JSON.parse(forward) as ProbesRecord;
    for (const keys of keyLists(parsed)) {
      expect(keys).toEqual(
        [...keys].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      );
    }
    expect(forward).not.toMatch(/time|date|Date/);
    expect(parsed.version).toBe(1);
    expect(parsed.sha).toBe(SHA);
    expect(parsed.selection).toEqual({ fraction: 0.05, limit: null, only: null, seed: 23 });
    expect(Object.keys(parsed.probes)).toHaveLength(13);
    expect(parsed.probes["y.test.ts::load"]).toEqual({
      blockClass: "BEHAVIOURAL",
      command: { argv: ["pnpm", "exec", "vitest"], cwd: "apps/api" },
      gutted: 1,
      outcome: "LOAD-ERROR",
      partial: [],
      reason: "load-error",
      sample: "behavioural",
      sha: SHA,
      subject: ["apps/api/src/a.ts"],
      subjectHash: "s",
      testHash: "t",
    });
  });

  it("rates each class's GREEN over its conclusive probes, and marks one a lint-rule candidate at 90 %, whatever its LOAD-ERROR count", () => {
    const entries = [
      ...ENTRIES,
      ...Array.from({ length: 5 }, (_, index) =>
        entry(`x.test.ts::load ${index}`, "EXISTENCE-ONLY", "LOAD-ERROR")
      ),
    ];
    const record = core.probesRecord({ sha: SHA, options: OPTIONS, entries });

    expect(record.summary).toEqual({
      BEHAVIOURAL: {
        GREEN: 1,
        "LOAD-ERROR": 1,
        RED: 1,
        conclusive: 2,
        greenRate: 0.5,
        lintRule: false,
        probes: 3,
      },
      "EXISTENCE-ONLY": {
        GREEN: 9,
        "LOAD-ERROR": 5,
        RED: 1,
        conclusive: 10,
        greenRate: 0.9,
        lintRule: true,
        probes: 15,
      },
    });
    expect(core.summaryLines(record)).toEqual([
      "hard-probe: BEHAVIOURAL: 3 probes, 1 GREEN, 1 RED, 1 LOAD-ERROR, GREEN 50.0% of 2 conclusive",
      "hard-probe: EXISTENCE-ONLY: 15 probes, 9 GREEN, 1 RED, 5 LOAD-ERROR, GREEN 90.0% of 10 conclusive (>= 90 %: a lint-rule candidate)",
    ]);
  });

  it("rates and marks no class without a conclusive probe", () => {
    const entries = [entry("z.test.ts::load", "CONDITIONAL-ONLY", "LOAD-ERROR")];
    const record = core.probesRecord({ sha: SHA, options: OPTIONS, entries });

    expect(record.summary).toEqual({
      "CONDITIONAL-ONLY": {
        GREEN: 0,
        "LOAD-ERROR": 1,
        RED: 0,
        conclusive: 0,
        greenRate: null,
        lintRule: false,
        probes: 1,
      },
    });
    expect(core.summaryLines(record)).toEqual([
      "hard-probe: CONDITIONAL-ONLY: 1 probe, 0 GREEN, 0 RED, 1 LOAD-ERROR, GREEN n/a, no conclusive probe",
    ]);
  });

  it("marks no class that falls short of 90 %", () => {
    const entries = [
      ...ENTRIES.slice(0, 8),
      entry("x.test.ts::red 2", "EXISTENCE-ONLY", "RED"),
      ENTRIES[9],
    ].filter((probe): probe is ProbeEntry => probe !== undefined);

    expect(core.probesRecord({ sha: SHA, options: OPTIONS, entries }).summary).toEqual({
      "EXISTENCE-ONLY": {
        GREEN: 8,
        "LOAD-ERROR": 0,
        RED: 2,
        conclusive: 10,
        greenRate: 0.8,
        lintRule: false,
        probes: 10,
      },
    });
  });
});

describe("isProbesRecord", () => {
  it("accepts what renderProbes writes, and no other JSON", async () => {
    const written = await core.renderProbes(
      core.probesRecord({ sha: SHA, options: OPTIONS, entries: ENTRIES })
    );

    expect(core.isProbesRecord(written)).toBe(true);
    expect(core.isProbesRecord('{ "name": "@demo/pkg" }\n')).toBe(false);
    expect(core.isProbesRecord('{ "version": 1, "probes": [] }\n')).toBe(false);
    expect(core.isProbesRecord("not json")).toBe(false);
  });
});

/** Git without the variables a hook exports, which would point it at another repository. */
const GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
);
const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });

const TEST_FILE = "pkg/tests/math.test.ts";
const ORPHAN_FILE = "pkg/tests/orphan.test.ts";
const SUBJECT_FILE = "pkg/src/math.ts";
const SUBJECT_TEXT =
  "export function add(left: number, right: number): number {\n  return left + right;\n}\n";
const TEST_TEXT =
  'import { describe, expect, it } from "vitest";\nimport { add } from "../src/math";\n\n' +
  'describe("math", () => {\n  it("adds two numbers", () => {\n    expect(add(1, 2)).toBeDefined();\n  });\n});\n';
const ORPHAN_TEXT =
  'import { expect, it } from "vitest";\nimport { add } from "../src/math";\n\n' +
  'it("loads", () => {\n  expect(add).toBeDefined();\n});\n';
const BLOCK_ID = `${TEST_FILE}::adds two numbers`;
const ORPHAN_ID = `${ORPHAN_FILE}::loads`;

/**
 * A committed repository with one workspace, one subject module, two tests of it and any `extra`
 * files.
 */
const plantRepository = (
  extra: Readonly<Record<string, string>> = {}
): { root: string; sha: string } => {
  const root = scratchDir("hard-probe-repo-");
  writeFiles(root, {
    "package.json": '{ "name": "demo", "private": true }\n',
    "pnpm-workspace.yaml": 'packages:\n  - "pkg"\n',
    "pkg/package.json": '{ "name": "@demo/pkg" }\n',
    "pkg/vitest.config.ts": "export default {};\n",
    [SUBJECT_FILE]: SUBJECT_TEXT,
    [TEST_FILE]: TEST_TEXT,
    [ORPHAN_FILE]: ORPHAN_TEXT,
    ...extra,
  });
  git(root, "init", "--quiet");
  git(root, "add", "-A");
  git(
    root,
    "-c",
    "user.name=probe",
    "-c",
    "user.email=probe@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "plant"
  );
  return { root, sha: git(root, "rev-parse", "HEAD").trim() };
};

const PROBE_LEDGER: ProbeLedger = {
  files: [
    row(ORPHAN_FILE, "ADJUDICATE", [block(ORPHAN_FILE, "loads", "EXISTENCE-ONLY")], []),
    row(
      TEST_FILE,
      "ADJUDICATE",
      [block(TEST_FILE, "adds two numbers", "EXISTENCE-ONLY")],
      ["vitest:pkg/vitest.config.ts"]
    ),
  ],
};

/** A vitest report on one line: one block, which passed. */
const passingReport = (file: string, describe: string, title: string): string =>
  JSON.stringify({
    testResults: [
      {
        name: `/anywhere/${file}`,
        message: "",
        status: "passed",
        assertionResults: [
          {
            ancestorTitles: [describe],
            title,
            fullName: `${describe} ${title}`,
            status: "passed",
          },
        ],
      },
    ],
  });
const PASSING_REPORT = passingReport(TEST_FILE, "math", "adds two numbers");
const NAMED_FILE = "pkg/tests/named.test.ts";
const NAMED_TEXT =
  'import { describe, expect, it } from "vitest";\nimport { add } from "@demo/pkg/math";\n\n' +
  'describe("by name", () => {\n  it("adds by name", () => {\n    expect(add(1, 1)).toBeDefined();\n  });\n});\n';

interface Call {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

/** A replaced process that records its calls, installs nothing and runs `probe` for a block. */
const recorder = (
  probe: (cwd: string) => string
): { calls: Call[]; exec: NonNullable<ProbeSeams["exec"]> } => {
  const calls: Call[] = [];
  const exec = (command: string, args: readonly string[], cwd: string): Ran => {
    calls.push({ command, args: [...args], cwd });
    const stdout = args[0] === "install" ? "" : probe(cwd);
    return { status: 0, stdout, stderr: "", timedOut: false, spawnError: null };
  };
  return { calls, exec };
};

describe("main", () => {
  it.each([
    [["--limit", "0"], "--limit takes a positive integer"],
    [["--seed=-1"], "--seed takes an integer from 0 to 4294967295"],
    [["--seed", "x"], "--seed takes an integer from 0 to 4294967295"],
    [["--only", ""], "--only takes a non-empty value"],
    [["--limit", "2", "--only", "a.test.ts::b"], "--only probes one block and takes no --limit"],
    [["--bogus"], "Unknown option '--bogus'"],
    [["positional"], "Unexpected argument 'positional'"],
  ])("refuses %j as a usage error", async (argv, message) => {
    const result = await cli.main(argv);

    expect(result.code).toBe(2);
    expect(result.output).toContain(message);
    expect(result.output).toContain("usage: node scripts/testing/hard-probe.mjs");
  });

  it("refuses a source tree with uncommitted changes, naming them, before any worktree exists", async () => {
    const { root } = plantRepository();
    const worktrees = scratchDir("hard-probe-worktrees-");
    const out = path.join(scratchDir("hard-probe-out-"), "probes.json");
    writeFileSync(path.join(root, "stray.txt"), "x\n");
    writeFileSync(path.join(root, SUBJECT_FILE), "export const edited = true;\n");
    const before = git(root, "worktree", "list", "--porcelain");
    const { calls, exec } = recorder(() => "");

    const result = await cli.main(["--root", root, "--worktree-root", worktrees, "--out", out], {
      exec,
    });

    expect(result).toEqual({
      code: 3,
      output: `hard-probe: refused: the source tree is not clean: ${SUBJECT_FILE}, stray.txt\n`,
    });
    expect(git(root, "worktree", "list", "--porcelain")).toBe(before);
    expect(readdirSync(worktrees)).toEqual([]);
    expect(existsSync(out)).toBe(false);
    expect(calls).toEqual([]);
  });

  /** The private directory a run's worktree sat in, read from the install's working directory. */
  const parentOf = (calls: readonly Call[]): string => path.dirname(calls[0]?.cwd ?? "");

  it("puts its worktree in a private directory of its own under --worktree-root, never in a path planted there, and removes both", async () => {
    const { root, sha } = plantRepository();
    const worktrees = scratchDir("hard-probe-worktrees-");
    const planted = path.join(worktrees, `hard-probe-${sha}`);
    writeFiles(planted, { "keep.txt": "mine\n" });
    const out = path.join(scratchDir("hard-probe-out-"), "probes.json");
    const before = git(root, "worktree", "list", "--porcelain");
    let mode = 0;
    const { calls, exec } = recorder((cwd) => {
      mode = statSync(path.dirname(path.dirname(cwd))).mode & 0o777;
      return PASSING_REPORT;
    });

    const result = await cli.main(
      ["--root", root, "--worktree-root", worktrees, "--out", out, "--only", BLOCK_ID],
      { exec, buildLedger: () => ({ value: PROBE_LEDGER }), progress: () => undefined }
    );

    expect(result.code).toBe(0);
    const parent = parentOf(calls);
    expect(path.dirname(parent)).toBe(worktrees);
    expect(path.basename(parent)).toMatch(/^hard-probe-[A-Za-z0-9]{6}$/);
    expect(calls[0]?.cwd).toBe(path.join(parent, "tree"));
    expect(mode).toBe(0o700);
    expect(readdirSync(worktrees)).toEqual([`hard-probe-${sha}`]);
    expect(readdirSync(planted)).toEqual(["keep.txt"]);
    expect(readFileSync(path.join(planted, "keep.txt"), "utf8")).toBe("mine\n");
    expect(git(root, "worktree", "list", "--porcelain")).toBe(before);
  });

  it("removes its private directory when git cannot add the worktree, and calls no runner", async () => {
    const { root } = plantRepository();
    writeFileSync(path.join(root, ".git/worktrees"), "not a directory\n");
    const worktrees = scratchDir("hard-probe-worktrees-");
    const out = path.join(scratchDir("hard-probe-out-"), "probes.json");
    const { calls, exec } = recorder(() => PASSING_REPORT);

    const result = await cli.main(["--root", root, "--worktree-root", worktrees, "--out", out], {
      exec,
    });

    expect(result.code).toBe(3);
    expect(result.output).toMatch(/^hard-probe: unread: git worktree add --detach .+ failed: /);
    expect(readdirSync(worktrees)).toEqual([]);
    expect(calls).toEqual([]);
    expect(existsSync(out)).toBe(false);
    expect(git(root, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  });

  it("keeps its private directory, with the worktree in it, when git cannot remove the worktree, names the failure and writes no probes.json", async () => {
    const { root } = plantRepository();
    const worktrees = scratchDir("hard-probe-worktrees-");
    const out = path.join(scratchDir("hard-probe-out-"), "probes.json");
    const earlier = '{ "an earlier": "run" }\n';
    writeFileSync(out, earlier);
    const before = git(root, "worktree", "list", "--porcelain");
    const calls: Call[] = [];
    const exec = (command: string, args: readonly string[], cwd: string): Ran => {
      calls.push({ command, args: [...args], cwd });
      if (args[0] === "install") git(root, "worktree", "lock", cwd);
      const stdout = args[0] === "install" ? "" : PASSING_REPORT;
      return { status: 0, stdout, stderr: "", timedOut: false, spawnError: null };
    };

    const result = await cli.main(
      ["--root", root, "--worktree-root", worktrees, "--out", out, "--only", BLOCK_ID],
      { exec, buildLedger: () => ({ value: PROBE_LEDGER }), progress: () => undefined }
    );
    const target = calls[0]?.cwd ?? "";
    const parent = path.dirname(target);
    const kept = {
      entries: readdirSync(parent),
      registered: git(root, "worktree", "list", "--porcelain"),
    };
    git(root, "worktree", "unlock", target);
    git(root, "worktree", "remove", "--force", target);
    rmSync(parent, { recursive: true, force: true });

    expect(result.code).toBe(3);
    expect(result.output).toContain(
      `hard-probe: unread: git worktree remove --force ${target} failed: `
    );
    expect(result.output).not.toContain("hard-probe: wrote");
    expect(readFileSync(out, "utf8")).toBe(earlier);
    expect(kept.entries).toEqual(["tree"]);
    expect(kept.registered).toContain(`worktree ${target}\n`);
    expect(readdirSync(worktrees)).toEqual([]);
    expect(git(root, "worktree", "list", "--porcelain")).toBe(before);
  });

  it("exits 3 when probes.json cannot be written, after removing the worktree, and claims no write", async () => {
    const { root } = plantRepository();
    const worktrees = scratchDir("hard-probe-worktrees-");
    const out = path.join(scratchDir("hard-probe-out-"), "missing", "probes.json");
    const before = git(root, "worktree", "list", "--porcelain");
    const { exec } = recorder(() => PASSING_REPORT);

    const result = await cli.main(
      ["--root", root, "--worktree-root", worktrees, "--out", out, "--only", BLOCK_ID],
      { exec, buildLedger: () => ({ value: PROBE_LEDGER }), progress: () => undefined }
    );

    expect(result.code).toBe(3);
    expect(result.output).toMatch(
      new RegExp(`^hard-probe: unread: ${out} could not be written: ENOENT`)
    );
    expect(result.output).not.toContain("hard-probe: wrote");
    expect(existsSync(out)).toBe(false);
    expect(readdirSync(worktrees)).toEqual([]);
    expect(git(root, "worktree", "list", "--porcelain")).toBe(before);
  });

  it("leaves an earlier probes.json byte-identical, and no temp file, when the write fails after its file is open", async () => {
    const { root } = plantRepository();
    const worktrees = scratchDir("hard-probe-worktrees-");
    const out = path.join(scratchDir("hard-probe-out-"), "probes.json");
    const earlier = '{ "an earlier": "run" }\n';
    writeFileSync(out, earlier);
    const { exec } = recorder(() => PASSING_REPORT);
    const writeText = (fd: number, text: string): void => {
      writeSync(fd, text.slice(0, 10));
      throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
    };

    const result = await cli.main(
      ["--root", root, "--worktree-root", worktrees, "--out", out, "--only", BLOCK_ID],
      { exec, buildLedger: () => ({ value: PROBE_LEDGER }), progress: () => undefined, writeText }
    );

    expect(result).toEqual({
      code: 3,
      output: `hard-probe: unread: ${out} could not be written: ENOSPC: no space left on device, write\n`,
    });
    expect(readFileSync(out, "utf8")).toBe(earlier);
    expect(readdirSync(path.dirname(out))).toEqual(["probes.json"]);
    expect(readdirSync(worktrees)).toEqual([]);
  });

  it("removes its temp file and leaves --out as it was when the rename onto --out fails", async () => {
    const { root } = plantRepository();
    const worktrees = scratchDir("hard-probe-worktrees-");
    const directory = scratchDir("hard-probe-out-");
    const out = path.join(directory, "probes.json");
    writeFiles(out, { "keep.txt": "mine\n" });
    const { exec } = recorder(() => PASSING_REPORT);

    const result = await cli.main(
      ["--root", root, "--worktree-root", worktrees, "--out", out, "--only", BLOCK_ID],
      { exec, buildLedger: () => ({ value: PROBE_LEDGER }), progress: () => undefined }
    );

    expect(result.code).toBe(3);
    expect(result.output).toMatch(new RegExp(`^hard-probe: unread: ${out} could not be written: `));
    expect(result.output).not.toContain("hard-probe: wrote");
    expect(readdirSync(directory)).toEqual(["probes.json"]);
    expect(readdirSync(out)).toEqual(["keep.txt"]);
    expect(readdirSync(worktrees)).toEqual([]);
  });

  it("refuses a run beside a temp file an earlier run left behind, naming it, under this repository's ignore rules", async () => {
    const { root } = plantRepository({
      ".gitignore": readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8"),
    });
    const leftover = core.pendingTempPath(path.join(root, "probes.json"), "999.deadbeefcafe");
    writeFileSync(leftover, "{\n");
    const worktrees = scratchDir("hard-probe-worktrees-");
    const { calls, exec } = recorder(() => PASSING_REPORT);

    const result = await cli.main(["--root", root, "--worktree-root", worktrees], { exec });

    expect(result).toEqual({
      code: 3,
      output: `hard-probe: refused: the source tree is not clean: ${path.basename(leftover)}\n`,
    });
    expect(readdirSync(worktrees)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("follows a symlinked --out: the link stays a link, and the file it names gets the record", async () => {
    const { root } = plantRepository();
    const worktrees = scratchDir("hard-probe-worktrees-");
    const directory = scratchDir("hard-probe-out-");
    const real = path.join(directory, "kept", "probes.json");
    writeFiles(directory, { "kept/probes.json": '{ "an earlier": "run" }\n' });
    const link = path.join(directory, "probes.json");
    symlinkSync(real, link);
    const { exec } = recorder(() => PASSING_REPORT);

    const result = await cli.main(
      ["--root", root, "--worktree-root", worktrees, "--out", link, "--only", BLOCK_ID],
      { exec, buildLedger: () => ({ value: PROBE_LEDGER }), progress: () => undefined }
    );

    expect(result.code).toBe(0);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(real);
    expect(core.isProbesRecord(readFileSync(real, "utf8"))).toBe(true);
    expect(readdirSync(directory).sort()).toEqual(["kept", "probes.json"]);
    expect(readdirSync(path.dirname(real))).toEqual(["probes.json"]);
  });

  it("refuses a tracked symlinked --out whose file is a tracked file that is no probes.json, naming that file", async () => {
    const { root } = plantRepository();
    symlinkSync("../package.json", path.join(root, "pkg/out.json"));
    git(root, "add", "pkg/out.json");
    git(
      root,
      "-c",
      "user.name=probe",
      "-c",
      "user.email=probe@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "link"
    );
    const worktrees = scratchDir("hard-probe-worktrees-");
    const { calls, exec } = recorder(() => PASSING_REPORT);

    const result = await cli.main(
      ["--root", root, "--worktree-root", worktrees, "--out", path.join(root, "pkg/out.json")],
      { exec }
    );

    expect(result).toEqual({
      code: 3,
      output:
        "hard-probe: refused: --out names package.json, a tracked file that is no probes.json of this tool\n",
    });
    expect(readFileSync(path.join(root, "package.json"), "utf8")).toBe(
      '{ "name": "demo", "private": true }\n'
    );
    expect(calls).toEqual([]);
  });

  it("keeps the mode of an earlier probes.json it replaces", async () => {
    const { root } = plantRepository();
    const worktrees = scratchDir("hard-probe-worktrees-");
    const out = path.join(scratchDir("hard-probe-out-"), "probes.json");
    writeFileSync(out, '{ "an earlier": "run" }\n');
    chmodSync(out, 0o600);
    const { exec } = recorder(() => PASSING_REPORT);

    const result = await cli.main(
      ["--root", root, "--worktree-root", worktrees, "--out", out, "--only", BLOCK_ID],
      { exec, buildLedger: () => ({ value: PROBE_LEDGER }), progress: () => undefined }
    );

    expect(result.code).toBe(0);
    const record = readFileSync(out, "utf8");
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(core.isProbesRecord(record)).toBe(true);
    expect(readdirSync(path.dirname(out))).toEqual(["probes.json"]);
  });

  it("never gives two runs the same path", async () => {
    const { root } = plantRepository();
    const worktrees = scratchDir("hard-probe-worktrees-");
    const before = git(root, "worktree", "list", "--porcelain");
    const run = async (): Promise<string> => {
      const { calls, exec } = recorder(() => PASSING_REPORT);
      const out = path.join(scratchDir("hard-probe-out-"), "probes.json");
      const result = await cli.main(
        ["--root", root, "--worktree-root", worktrees, "--out", out, "--only", BLOCK_ID],
        { exec, buildLedger: () => ({ value: PROBE_LEDGER }), progress: () => undefined }
      );
      expect(result.code).toBe(0);
      return calls[0]?.cwd ?? "";
    };

    const first = await run();
    const second = await run();

    expect(first).not.toBe(second);
    expect(path.dirname(path.dirname(first))).toBe(worktrees);
    expect(path.dirname(path.dirname(second))).toBe(worktrees);
    expect(readdirSync(worktrees)).toEqual([]);
    expect(git(root, "worktree", "list", "--porcelain")).toBe(before);
  });

  it("refuses a --worktree-root it cannot create a private directory in, before any worktree exists", async () => {
    const { root } = plantRepository();
    const worktrees = path.join(scratchDir("hard-probe-worktrees-"), "missing");
    const out = path.join(scratchDir("hard-probe-out-"), "probes.json");
    const before = git(root, "worktree", "list", "--porcelain");
    const { calls, exec } = recorder(() => PASSING_REPORT);

    const result = await cli.main(["--root", root, "--worktree-root", worktrees, "--out", out], {
      exec,
    });

    expect(result.code).toBe(3);
    expect(result.output).toMatch(
      new RegExp(
        `^hard-probe: unread: --worktree-root ${worktrees} cannot hold a private directory: ENOENT`
      )
    );
    expect(existsSync(worktrees)).toBe(false);
    expect(git(root, "worktree", "list", "--porcelain")).toBe(before);
    expect(existsSync(out)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("probes in one detached worktree, guts the subject for the run, restores it, writes probes.json and removes the worktree", async () => {
    const { root, sha } = plantRepository();
    const worktrees = scratchDir("hard-probe-worktrees-");
    const out = path.join(scratchDir("hard-probe-out-"), "probes.json");
    const before = git(root, "worktree", "list", "--porcelain");
    const seen: string[] = [];
    const { calls, exec } = recorder((cwd) => {
      seen.push(readFileSync(path.join(cwd, "src/math.ts"), "utf8"));
      seen.push(git(path.dirname(cwd), "rev-parse", "HEAD").trim());
      return `noise\n${PASSING_REPORT}\n`;
    });
    const progress: string[] = [];

    const result = await cli.main(["--root", root, "--worktree-root", worktrees, "--out", out], {
      exec,
      buildLedger: () => ({ value: PROBE_LEDGER }),
      progress: (line) => progress.push(line),
    });

    expect(result).toEqual({
      code: 0,
      output:
        "hard-probe: EXISTENCE-ONLY: 2 probes, 1 GREEN, 0 RED, 1 LOAD-ERROR, GREEN 100.0% of 1 conclusive (>= 90 %: a lint-rule candidate)\n" +
        `hard-probe: wrote ${out}: 2 probes of ${sha}\n`,
    });
    const target = path.join(parentOf(calls), "tree");
    expect(calls).toEqual([
      { command: "pnpm", args: ["install", "--offline", "--frozen-lockfile"], cwd: target },
      {
        command: "pnpm",
        args: [
          "exec",
          "vitest",
          "run",
          "tests/math.test.ts",
          "--config",
          "vitest.config.ts",
          "-t",
          "^math adds two numbers$",
          "--reporter=json",
        ],
        cwd: path.join(target, "pkg"),
      },
    ]);
    expect(seen[0]).toContain(THROW);
    expect(seen[0]).not.toContain("return left + right");
    expect(seen[1]).toBe(sha);
    expect(progress).toEqual([
      `hard-probe: worktree ${target} at ${sha}`,
      "hard-probe: 2 probes planned: 2 targeted, 0 behavioural of a population of 0",
      `hard-probe: [1/2] ${TEST_FILE}::adds two numbers: GREEN`,
      `hard-probe: [2/2] ${ORPHAN_ID}: LOAD-ERROR (no-collector)`,
    ]);
    const record = JSON.parse(readFileSync(out, "utf8")) as ProbesRecord;
    const subjectHash = sha256(`${SUBJECT_FILE}\0${sha256(SUBJECT_TEXT)}\n`);
    expect(record).toEqual({
      probes: {
        [ORPHAN_ID]: {
          blockClass: "EXISTENCE-ONLY",
          command: null,
          gutted: 0,
          outcome: "LOAD-ERROR",
          partial: [],
          reason: "no-collector",
          sample: "targeted",
          sha,
          subject: [SUBJECT_FILE],
          subjectHash,
          testHash: sha256(ORPHAN_TEXT),
        },
        [BLOCK_ID]: {
          blockClass: "EXISTENCE-ONLY",
          command: {
            argv: [
              "pnpm",
              "exec",
              "vitest",
              "run",
              "tests/math.test.ts",
              "--config",
              "vitest.config.ts",
              "-t",
              "^math adds two numbers$",
              "--reporter=json",
            ],
            cwd: "pkg",
          },
          gutted: 1,
          outcome: "GREEN",
          partial: [],
          reason: null,
          sample: "targeted",
          sha,
          subject: [SUBJECT_FILE],
          subjectHash,
          testHash: sha256(TEST_TEXT),
        },
      },
      selection: { fraction: 0.05, limit: null, only: null, seed: 23 },
      sha,
      summary: {
        "EXISTENCE-ONLY": {
          GREEN: 1,
          "LOAD-ERROR": 1,
          RED: 0,
          conclusive: 1,
          greenRate: 1,
          lintRule: true,
          probes: 2,
        },
      },
      version: 1,
    });
    expect(readdirSync(path.dirname(out))).toEqual(["probes.json"]);
    expect(readdirSync(worktrees)).toEqual([]);
    expect(git(root, "worktree", "list", "--porcelain")).toBe(before);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(readFileSync(path.join(root, SUBJECT_FILE), "utf8")).toBe(SUBJECT_TEXT);
  });

  it("aborts with 3, naming the files, when a probe leaves the probe worktree dirty, and still removes it", async () => {
    const { root } = plantRepository();
    const worktrees = scratchDir("hard-probe-worktrees-");
    const out = path.join(scratchDir("hard-probe-out-"), "probes.json");
    const before = git(root, "worktree", "list", "--porcelain");
    const { exec } = recorder((cwd) => {
      writeFileSync(path.join(cwd, "stray.txt"), "left behind\n");
      return PASSING_REPORT;
    });

    const result = await cli.main(
      ["--root", root, "--worktree-root", worktrees, "--out", out, "--only", BLOCK_ID],
      { exec, buildLedger: () => ({ value: PROBE_LEDGER }), progress: () => undefined }
    );

    expect(result).toEqual({
      code: 3,
      output: `hard-probe: unread: the probe worktree is not clean after probing ${BLOCK_ID}: pkg/stray.txt\n`,
    });
    expect(existsSync(out)).toBe(false);
    expect(readdirSync(worktrees)).toEqual([]);
    expect(git(root, "worktree", "list", "--porcelain")).toBe(before);
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("returns 1 for an --only id the ledger lacks, writes nothing and removes the worktree", async () => {
    const { root } = plantRepository();
    const worktrees = scratchDir("hard-probe-worktrees-");
    const out = path.join(scratchDir("hard-probe-out-"), "probes.json");
    const before = git(root, "worktree", "list", "--porcelain");
    const { calls, exec } = recorder(() => PASSING_REPORT);

    const result = await cli.main(
      ["--root", root, "--worktree-root", worktrees, "--out", out, "--only", `${TEST_FILE}::nope`],
      { exec, buildLedger: () => ({ value: PROBE_LEDGER }), progress: () => undefined }
    );

    expect(result).toEqual({
      code: 1,
      output: `hard-probe: --only ${TEST_FILE}::nope names no block of the ledger\n`,
    });
    expect(calls).toHaveLength(1);
    expect(existsSync(out)).toBe(false);
    expect(readdirSync(worktrees)).toEqual([]);
    expect(git(root, "worktree", "list", "--porcelain")).toBe(before);
  });

  it("resolves a test's import of a workspace package by its name to the module it guts", async () => {
    const { root, sha } = plantRepository({ [NAMED_FILE]: NAMED_TEXT });
    const worktrees = scratchDir("hard-probe-worktrees-");
    const out = path.join(scratchDir("hard-probe-out-"), "probes.json");
    const id = `${NAMED_FILE}::adds by name`;
    const ledger: ProbeLedger = {
      files: [
        row(
          NAMED_FILE,
          "ADJUDICATE",
          [block(NAMED_FILE, "adds by name", "EXISTENCE-ONLY")],
          ["vitest:pkg/vitest.config.ts"]
        ),
      ],
    };
    const { exec } = recorder(() => passingReport(NAMED_FILE, "by name", "adds by name"));
    const progress: string[] = [];

    const result = await cli.main(
      ["--root", root, "--worktree-root", worktrees, "--out", out, "--only", id],
      { exec, buildLedger: () => ({ value: ledger }), progress: (line) => progress.push(line) }
    );

    expect(result.code).toBe(0);
    expect(progress[1]).toBe(`hard-probe: 1 probe planned: only ${id}`);
    const record = JSON.parse(readFileSync(out, "utf8")) as ProbesRecord;
    expect(record.probes[id]).toMatchObject({
      gutted: 1,
      outcome: "GREEN",
      sha,
      subject: [SUBJECT_FILE],
    });
  });

  it("ignores its own uncommitted --out inside the source tree, the default one, and probes", async () => {
    const { root, sha } = plantRepository();
    const worktrees = scratchDir("hard-probe-worktrees-");
    const out = path.join(root, "probes.json");
    writeFileSync(out, '{ "earlier": "run" }\n');
    const before = git(root, "worktree", "list", "--porcelain");
    const { exec } = recorder(() => PASSING_REPORT);

    const result = await cli.main(
      ["--root", root, "--worktree-root", worktrees, "--only", BLOCK_ID],
      {
        exec,
        buildLedger: () => ({ value: PROBE_LEDGER }),
        progress: () => undefined,
      }
    );

    expect(result).toEqual({
      code: 0,
      output:
        "hard-probe: EXISTENCE-ONLY: 1 probe, 1 GREEN, 0 RED, 0 LOAD-ERROR, GREEN 100.0% of 1 conclusive (>= 90 %: a lint-rule candidate)\n" +
        `hard-probe: wrote ${out}: 1 probes of ${sha}\n`,
    });
    expect(Object.keys((JSON.parse(readFileSync(out, "utf8")) as ProbesRecord).probes)).toEqual([
      BLOCK_ID,
    ]);
    expect(git(root, "status", "--porcelain")).toBe("?? probes.json\n");
    expect(git(root, "worktree", "list", "--porcelain")).toBe(before);
  });

  it("still refuses every other change beside its own committed and modified --out", async () => {
    const committed = await core.renderProbes(
      core.probesRecord({ sha: SHA, options: OPTIONS, entries: ENTRIES })
    );
    const earlier = await core.renderProbes(
      core.probesRecord({ sha: SHA, options: OPTIONS, entries: ENTRIES.slice(0, 2) })
    );
    const { root } = plantRepository({ "probes.json": committed });
    const worktrees = scratchDir("hard-probe-worktrees-");
    const out = path.join(root, "probes.json");
    writeFileSync(out, earlier);
    writeFileSync(path.join(root, "stray.txt"), "x\n");
    const before = git(root, "worktree", "list", "--porcelain");
    const { calls, exec } = recorder(() => PASSING_REPORT);

    const result = await cli.main(["--root", root, "--worktree-root", worktrees, "--out", out], {
      exec,
    });

    expect(result).toEqual({
      code: 3,
      output: "hard-probe: refused: the source tree is not clean: stray.txt\n",
    });
    expect(readFileSync(out, "utf8")).toBe(earlier);
    expect(readdirSync(worktrees)).toEqual([]);
    expect(git(root, "worktree", "list", "--porcelain")).toBe(before);
    expect(calls).toEqual([]);
  });

  it("refuses an uncommitted probes.json in the source tree when --out names another file", async () => {
    const { root } = plantRepository();
    const worktrees = scratchDir("hard-probe-worktrees-");
    writeFileSync(path.join(root, "probes.json"), "{}\n");
    const out = path.join(scratchDir("hard-probe-out-"), "probes.json");
    const { calls, exec } = recorder(() => PASSING_REPORT);

    const result = await cli.main(["--root", root, "--worktree-root", worktrees, "--out", out], {
      exec,
    });

    expect(result).toEqual({
      code: 3,
      output: "hard-probe: refused: the source tree is not clean: probes.json\n",
    });
    expect(existsSync(out)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("refuses an --out that names a tracked file which is no probes.json of this tool, and leaves it as it was", async () => {
    const { root } = plantRepository();
    const worktrees = scratchDir("hard-probe-worktrees-");
    const out = path.join(root, "pkg/package.json");
    const { calls, exec } = recorder(() => PASSING_REPORT);

    const result = await cli.main(["--root", root, "--worktree-root", worktrees, "--out", out], {
      exec,
    });

    expect(result).toEqual({
      code: 3,
      output:
        "hard-probe: refused: --out names pkg/package.json, a tracked file that is no probes.json of this tool\n",
    });
    expect(readFileSync(out, "utf8")).toBe('{ "name": "@demo/pkg" }\n');
    expect(readdirSync(worktrees)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("refuses a --worktree-root inside the source tree before any worktree exists", async () => {
    const { root } = plantRepository();
    const worktrees = path.join(root, "pkg/.probes");
    const before = git(root, "worktree", "list", "--porcelain");
    const { calls, exec } = recorder(() => PASSING_REPORT);

    const result = await cli.main(
      [
        "--root",
        root,
        "--worktree-root",
        worktrees,
        "--out",
        path.join(scratchDir("hard-probe-out-"), "probes.json"),
      ],
      { exec }
    );

    expect(result).toEqual({
      code: 3,
      output: `hard-probe: refused: --worktree-root ${worktrees} lies inside the source tree\n`,
    });
    expect(existsSync(worktrees)).toBe(false);
    expect(git(root, "worktree", "list", "--porcelain")).toBe(before);
    expect(calls).toEqual([]);
  });

  it("guts the production modules a re-export reaches, whichever module re-exports them", async () => {
    const storeTest = "pkg/tests/store.test.ts";
    const { root, sha } = plantRepository({
      "pkg/src/store.ts": 'export * from "./actions";\n',
      "pkg/src/actions.ts":
        "export function increment(value: number): number {\n  return value + 1;\n}\n",
      [storeTest]:
        'import { describe, expect, it } from "vitest";\nimport { increment } from "../src/store";\n\n' +
        'describe("store", () => {\n  it("increments", () => {\n    expect(increment).toBeDefined();\n  });\n});\n',
    });
    const worktrees = scratchDir("hard-probe-worktrees-");
    const out = path.join(scratchDir("hard-probe-out-"), "probes.json");
    const id = `${storeTest}::increments`;
    const ledger: ProbeLedger = {
      files: [
        row(
          storeTest,
          "ADJUDICATE",
          [block(storeTest, "increments", "EXISTENCE-ONLY")],
          ["vitest:pkg/vitest.config.ts"]
        ),
      ],
    };
    let actions = "";
    const { exec } = recorder((cwd) => {
      actions = readFileSync(path.join(cwd, "src/actions.ts"), "utf8");
      return passingReport(storeTest, "store", "increments");
    });

    const result = await cli.main(
      ["--root", root, "--worktree-root", worktrees, "--out", out, "--only", id],
      { exec, buildLedger: () => ({ value: ledger }), progress: () => undefined }
    );

    expect(result.code).toBe(0);
    expect(actions).toContain(THROW);
    const record = JSON.parse(readFileSync(out, "utf8")) as ProbesRecord;
    expect(record.probes[id]).toMatchObject({
      gutted: 1,
      outcome: "GREEN",
      partial: [],
      sha,
      subject: ["pkg/src/actions.ts", "pkg/src/store.ts"],
    });
  });

  it("guts the client a package's index re-exports beside the test client, keeps the test client, and guts a module only its test imports", async () => {
    const dbTest = "pkg/tests/db.test.ts";
    const { root, sha } = plantRepository({
      "pnpm-workspace.yaml": 'packages:\n  - "pkg"\n  - "infra/*"\n',
      "infra/prisma/package.json": '{ "name": "@infra/prisma" }\n',
      "infra/prisma/src/index.ts":
        'export { createClient } from "./client";\nexport { createTestPrismaClient } from "./test-client";\n',
      "infra/prisma/src/client.ts":
        'export function createClient(): string {\n  return "client";\n}\n',
      "infra/prisma/src/test-client.ts":
        'export function createTestPrismaClient(): string {\n  return "test client";\n}\n',
      "pkg/src/lonely.ts": "export function lonely(): number {\n  return 1;\n}\n",
      [dbTest]:
        'import { describe, expect, it } from "vitest";\n' +
        'import { createClient, createTestPrismaClient } from "@infra/prisma";\n' +
        'import { lonely } from "../src/lonely";\n\n' +
        "const db = createTestPrismaClient();\n\n" +
        'describe("db", () => {\n  it("connects", () => {\n    expect(db).toBeDefined();\n    expect(createClient).toBeDefined();\n    expect(lonely).toBeDefined();\n  });\n});\n',
    });
    const worktrees = scratchDir("hard-probe-worktrees-");
    const out = path.join(scratchDir("hard-probe-out-"), "probes.json");
    const id = `${dbTest}::connects`;
    const ledger: ProbeLedger = {
      files: [
        row(
          dbTest,
          "ADJUDICATE",
          [block(dbTest, "connects", "EXISTENCE-ONLY")],
          ["vitest:pkg/vitest.config.ts"]
        ),
      ],
    };
    const seen: Record<string, string> = {};
    const { exec } = recorder((cwd) => {
      for (const file of [
        "infra/prisma/src/client.ts",
        "infra/prisma/src/test-client.ts",
        "pkg/src/lonely.ts",
      ]) {
        seen[file] = readFileSync(path.join(cwd, "..", file), "utf8");
      }
      return passingReport(dbTest, "db", "connects");
    });

    const result = await cli.main(
      ["--root", root, "--worktree-root", worktrees, "--out", out, "--only", id],
      { exec, buildLedger: () => ({ value: ledger }), progress: () => undefined }
    );

    expect(result.code).toBe(0);
    expect(seen["infra/prisma/src/client.ts"]).toContain(THROW);
    expect(seen["infra/prisma/src/test-client.ts"]).toBe(
      'export function createTestPrismaClient(): string {\n  return "test client";\n}\n'
    );
    expect(seen["pkg/src/lonely.ts"]).toContain(THROW);
    const record = JSON.parse(readFileSync(out, "utf8")) as ProbesRecord;
    expect(record.probes[id]).toMatchObject({
      gutted: 2,
      outcome: "GREEN",
      sha,
      subject: ["infra/prisma/src/client.ts", "infra/prisma/src/index.ts", "pkg/src/lonely.ts"],
    });
  });

  /**
   * Probes one block of `test`, whose file imports `imports`, over a planted repository holding
   * `files`, and returns the record's probe and the subject modules' texts as the run saw them.
   */
  const probeWith = async (
    files: Readonly<Record<string, string>>,
    test: string,
    imports: string,
    watched: readonly string[]
  ): Promise<{ probe: RecordedProbe | undefined; seen: Record<string, string> }> => {
    const { root } = plantRepository({
      ...files,
      [test]:
        `import { describe, expect, it } from "vitest";\n${imports}\n\n` +
        'describe("chain", () => {\n  it("renders", () => {\n    expect(1).toBe(1);\n  });\n});\n',
    });
    const worktrees = scratchDir("hard-probe-worktrees-");
    const out = path.join(scratchDir("hard-probe-out-"), "probes.json");
    const id = `${test}::renders`;
    const ledger: ProbeLedger = {
      files: [
        row(
          test,
          "ADJUDICATE",
          [block(test, "renders", "CONDITIONAL-ONLY")],
          ["vitest:pkg/vitest.config.ts"]
        ),
      ],
    };
    const seen: Record<string, string> = {};
    const { exec } = recorder((cwd) => {
      for (const file of watched) seen[file] = readFileSync(path.join(cwd, "..", file), "utf8");
      return passingReport(test, "chain", "renders");
    });

    const result = await cli.main(
      ["--root", root, "--worktree-root", worktrees, "--out", out, "--only", id],
      { exec, buildLedger: () => ({ value: ledger }), progress: () => undefined }
    );

    expect(result.code).toBe(0);
    return { probe: (JSON.parse(readFileSync(out, "utf8")) as ProbesRecord).probes[id], seen };
  };

  it("guts every base class up a chain across modules, through a package's index, from a subclass the test imports", async () => {
    const root = 'export class Root {\n  render(): string {\n    return "root";\n  }\n}\n';
    const middle =
      'import { Root } from "@demo/base";\n\nexport class Middle extends Root {\n  middle(): string {\n    return "middle";\n  }\n}\n';
    const { probe, seen } = await probeWith(
      {
        "pnpm-workspace.yaml": 'packages:\n  - "pkg"\n  - "base"\n',
        "base/package.json": '{ "name": "@demo/base" }\n',
        "base/src/index.ts": 'export * from "./root";\n',
        "base/src/root.ts": root,
        "pkg/src/middle.ts": middle,
        "pkg/src/child.ts":
          'import { Middle } from "./middle";\n\nexport class Child extends Middle {}\n',
      },
      "pkg/tests/child.test.ts",
      'import { Child } from "../src/child";',
      ["base/src/root.ts", "pkg/src/middle.ts"]
    );

    expect(seen["base/src/root.ts"]).toContain(THROW);
    expect(seen["base/src/root.ts"]).not.toContain('return "root"');
    expect(seen["pkg/src/middle.ts"]).toContain(THROW);
    expect(probe).toMatchObject({
      gutted: 2,
      outcome: "GREEN",
      subject: ["base/src/root.ts", "pkg/src/child.ts", "pkg/src/middle.ts"],
    });
  });

  it("follows no base class a third-party package defines", async () => {
    const { probe } = await probeWith(
      {
        "pkg/src/bus.ts":
          'import { EventEmitter } from "node:events";\nimport { Widget } from "ui-toolkit";\n\n' +
          'export class Bus extends EventEmitter {\n  ping(): string {\n    return "pong";\n  }\n}\n' +
          "class Panel extends Widget {}\nexport const panel = new Panel();\n",
      },
      "pkg/tests/bus.test.ts",
      'import { Bus } from "../src/bus";',
      []
    );

    expect(probe).toMatchObject({ gutted: 1, subject: ["pkg/src/bus.ts"] });
  });

  it("follows a base class into a listed test-infrastructure module and leaves it as written", async () => {
    const client = 'export class TestClient {\n  query(): string {\n    return "rows";\n  }\n}\n';
    const { probe, seen } = await probeWith(
      {
        "pnpm-workspace.yaml": 'packages:\n  - "pkg"\n  - "infra/*"\n',
        "infra/prisma/package.json": '{ "name": "@infra/prisma" }\n',
        "infra/prisma/src/index.ts": 'export { TestClient } from "./test-client";\n',
        "infra/prisma/src/test-client.ts": client,
        "pkg/src/repo.ts":
          'import { TestClient } from "@infra/prisma";\n\nexport class Repo extends TestClient {\n  find(): string {\n    return "found";\n  }\n}\n',
      },
      "pkg/tests/repo.test.ts",
      'import { Repo } from "../src/repo";',
      ["infra/prisma/src/test-client.ts"]
    );

    expect(seen["infra/prisma/src/test-client.ts"]).toBe(client);
    expect(probe).toMatchObject({ gutted: 1, subject: ["pkg/src/repo.ts"] });
  });

  it("records the exports of its subject it leaves ungutted, so a GREEN there reads as partial", async () => {
    const { root } = plantRepository({
      [SUBJECT_FILE]:
        SUBJECT_TEXT +
        'class Hidden {\n  speak(): string {\n    return "hidden";\n  }\n}\nexport const hidden = new Hidden();\n',
    });
    const worktrees = scratchDir("hard-probe-worktrees-");
    const out = path.join(scratchDir("hard-probe-out-"), "probes.json");
    const { exec } = recorder(() => PASSING_REPORT);

    const result = await cli.main(
      ["--root", root, "--worktree-root", worktrees, "--out", out, "--only", BLOCK_ID],
      { exec, buildLedger: () => ({ value: PROBE_LEDGER }), progress: () => undefined }
    );

    expect(result.code).toBe(0);
    const record = JSON.parse(readFileSync(out, "utf8")) as ProbesRecord;
    expect(record.probes[BLOCK_ID]).toMatchObject({
      gutted: 1,
      outcome: "GREEN",
      partial: [`${SUBJECT_FILE}: hidden (an instance of Hidden)`],
    });
  });
});

describe("pendingTempPath", () => {
  it.each([["probes.json"], ["apps/api/probes.json"]])(
    "names a temp file beside %s that no ignore rule of this repository matches, so a leftover shows in git status",
    (out) => {
      const temp = path.relative(
        REPO_ROOT,
        core.pendingTempPath(path.join(REPO_ROOT, out), "12345.0123456789ab")
      );
      const ignored = spawnSync("git", ["check-ignore", "--no-index", "-q", temp], {
        cwd: REPO_ROOT,
        env: GIT_ENV,
      });

      expect(path.dirname(temp)).toBe(path.dirname(out));
      expect(path.basename(temp).startsWith(`.${path.basename(out)}.12345.0123456789ab.`)).toBe(
        true
      );
      expect(ignored.status).toBe(1);
    }
  );
});

/** Whether a process still runs: absent, a zombie or dead in `/proc` is not running. */
const running = (pid: number): boolean => {
  if (existsSync("/proc/self/stat")) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const state = stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
      return state !== "Z" && state !== "X";
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A node process that starts a worker of its own, prints the worker's pid, then ends or waits. */
const parentOfWorker = (then: "ends" | "waits"): string[] => [
  "-e",
  'const { spawn } = require("node:child_process");' +
    'const worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });' +
    'process.stdout.write(String(worker.pid) + "\\n");' +
    (then === "ends" ? "process.exit(0);" : "setInterval(() => {}, 1000);"),
];

describe("runTool", () => {
  let workers: number[] = [];

  afterEach(() => {
    for (const pid of workers.filter(running)) process.kill(pid, "SIGKILL");
    workers = [];
  });

  /** The pid the parent printed, kept for the cleanup. */
  const workerOf = (ran: Ran): number => {
    const pid = Number(ran.stdout.trim());
    workers.push(pid);
    return pid;
  };

  it(
    "kills the runner's whole process group when it times out, its workers included",
    { timeout: 20_000 },
    async () => {
      const ran = await cli.runTool(process.execPath, parentOfWorker("waits"), tmpdir(), 1_500);
      const worker = workerOf(ran);

      expect(ran).toMatchObject({ status: null, timedOut: true, spawnError: null });
      expect(Number.isInteger(worker) && worker > 0).toBe(true);
      await until(() => !running(worker), {
        description: `worker ${worker} to end with its timed-out runner`,
        timeoutMs: 5_000,
      });
    }
  );

  it(
    "kills a worker its runner leaves behind when the runner ends on its own",
    { timeout: 20_000 },
    async () => {
      const ran = await cli.runTool(process.execPath, parentOfWorker("ends"), tmpdir(), 60_000);
      const worker = workerOf(ran);

      expect(ran).toMatchObject({ status: 0, timedOut: false, spawnError: null, stderr: "" });
      expect(Number.isInteger(worker) && worker > 0).toBe(true);
      await until(() => !running(worker), {
        description: `worker ${worker} to end with its runner`,
        timeoutMs: 5_000,
      });
    }
  );

  it("names a command that cannot start", async () => {
    const ran = await cli.runTool("hard-probe-no-such-command", [], tmpdir(), 5_000);

    expect(ran).toMatchObject({ status: null, stdout: "", timedOut: false });
    expect(ran.spawnError).toContain("ENOENT");
  });
});

const HARD_PROBE = path.join(REPO_ROOT, "scripts/testing/hard-probe.mjs");
/**
 * A `pnpm` that installs nothing, prints a reach report naming the test's collector, and runs a
 * block as `runner` says, a shell command.
 */
const fakePnpm = (runner: string): string =>
  [
    "#!/bin/sh",
    'if [ "$1" = "install" ]; then exit 0; fi',
    `if [ "$1" = "--silent" ]; then printf '%s\\n' '${JSON.stringify({
      ok: true,
      violations: [],
      errors: [],
      reach: { [TEST_FILE]: ["vitest:pkg/vitest.config.ts"] },
    })}'; exit 0; fi`,
    runner,
    "",
  ].join("\n");
/** A runner that only waits, its pid written where the test reads it. */
const FAKE_PNPM = fakePnpm('printf "%s\\n" "$$" > "$HARD_PROBE_TEST_RUNNER_PID"\nexec sleep 30');

describe("a signal", () => {
  let leftovers: number[] = [];

  afterEach(() => {
    for (const pid of leftovers.filter(running)) process.kill(pid, "SIGKILL");
    leftovers = [];
  });

  it.each([
    ["SIGINT", 130, "SIGTERM"],
    ["SIGTERM", 143, "SIGINT"],
    ["SIGHUP", 129, "SIGTERM"],
  ] as const)(
    "%s kills the runner's process group, restores and removes the worktree whatever a second signal does, and exits %i",
    { timeout: 60_000 },
    async (signal, code, second) => {
      const { root } = plantRepository({
        "packages/test-contracts/quarantine.json": '{ "entries": [] }\n',
      });
      const worktrees = scratchDir("hard-probe-worktrees-");
      const bin = scratchDir("hard-probe-bin-");
      writeFileSync(path.join(bin, "pnpm"), FAKE_PNPM, { mode: 0o755 });
      const pidFile = path.join(scratchDir("hard-probe-pid-"), "runner.pid");
      const out = path.join(scratchDir("hard-probe-out-"), "probes.json");
      const before = git(root, "worktree", "list", "--porcelain");
      const tool = spawn(
        process.execPath,
        [
          HARD_PROBE,
          "--root",
          root,
          "--worktree-root",
          worktrees,
          "--out",
          out,
          "--only",
          BLOCK_ID,
        ],
        {
          env: {
            ...GIT_ENV,
            PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
            HARD_PROBE_TEST_RUNNER_PID: pidFile,
          },
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
      const toolPid = tool.pid ?? 0;
      leftovers.push(toolPid);
      let stderr = "";
      tool.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      const exited = new Promise<number | null>((resolve) => {
        tool.on("close", (status) => resolve(status));
      });
      const runner = await untilValue(
        () => {
          const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8").trim()) : 0;
          return pid > 0 ? pid : null;
        },
        {
          description: () => `the probe's runner to start; the tool printed: ${stderr}`,
          timeoutMs: 30_000,
        }
      );
      leftovers.push(runner);

      process.kill(toolPid, signal);
      await until(() => !running(runner), {
        description: `runner ${runner} to end with its process group`,
        timeoutMs: 10_000,
      });
      try {
        process.kill(toolPid, second);
      } catch {
        // The tool may already have ended; the first signal's cleanup is what is under test.
      }

      expect(await exited).toBe(code);
      expect(stderr).toContain(`hard-probe: stopped by ${signal}`);
      expect(git(root, "worktree", "list", "--porcelain")).toBe(before);
      expect(readdirSync(worktrees)).toEqual([]);
      expect(git(root, "status", "--porcelain")).toBe("");
      expect(readFileSync(path.join(root, SUBJECT_FILE), "utf8")).toBe(SUBJECT_TEXT);
      expect(existsSync(out)).toBe(false);
    }
  );

  it(
    "writes no probes.json, and leaves an earlier one as it was, when a signal arrives after the last probe",
    { timeout: 60_000 },
    async () => {
      const { root } = plantRepository({
        "packages/test-contracts/quarantine.json": '{ "entries": [] }\n',
      });
      const worktrees = scratchDir("hard-probe-worktrees-");
      const bin = scratchDir("hard-probe-bin-");
      const realGit = execFileSync("sh", ["-c", "command -v git"], {
        encoding: "utf8",
        env: GIT_ENV,
      }).trim();
      writeFileSync(path.join(bin, "pnpm"), fakePnpm("exit 0"), { mode: 0o755 });
      // The removal of the worktree is the run's first step after its last probe, and the write
      // follows it: a git that signals its parent there lands the signal in exactly that window.
      writeFileSync(
        path.join(bin, "git"),
        [
          "#!/bin/sh",
          'if [ "$1" = "worktree" ] && [ "$2" = "remove" ]; then kill -INT "$PPID"; fi',
          `exec '${realGit.replaceAll("'", "'\\''")}' "$@"`,
          "",
        ].join("\n"),
        { mode: 0o755 }
      );
      const out = path.join(scratchDir("hard-probe-out-"), "probes.json");
      const earlier = '{ "an earlier": "run" }\n';
      writeFileSync(out, earlier);
      const before = git(root, "worktree", "list", "--porcelain");
      const tool = spawn(
        process.execPath,
        [
          HARD_PROBE,
          "--root",
          root,
          "--worktree-root",
          worktrees,
          "--out",
          out,
          "--only",
          BLOCK_ID,
        ],
        {
          env: { ...GIT_ENV, PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}` },
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
      leftovers.push(tool.pid ?? 0);
      let stderr = "";
      tool.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      const code = await new Promise<number | null>((resolve) => {
        tool.on("close", (status) => resolve(status));
      });

      expect(code).toBe(130);
      expect(stderr).toContain(`hard-probe: [1/1] ${BLOCK_ID}: LOAD-ERROR (no-report)`);
      expect(stderr).toContain("hard-probe: stopped by SIGINT");
      expect(stderr).not.toContain("hard-probe: wrote");
      expect(readFileSync(out, "utf8")).toBe(earlier);
      expect(readdirSync(worktrees)).toEqual([]);
      expect(git(root, "worktree", "list", "--porcelain")).toBe(before);
    }
  );
});
