/**
 * @file batteryVerdict.test.ts
 * @description Pins `scripts/testing/battery-verdict.mjs`, the rules of the local battery's
 *   verdict. The battery leaves one `<step>.log` per step and a `steps.tsv` of
 *   `<step>\t<exit code>` rows in a log directory; `evaluateBattery` reads that directory and
 *   decides GREEN or RED.
 *
 *   Every input is a fixture log directory built in a temp dir, so the suite measures the RULE and
 *   never runs a gate. The rule is fail-closed: GREEN needs every planned step recorded with exit 0,
 *   no toolchain warning line in any log, no unhandled error in an api run and a tree that did not
 *   change. Each way of being RED is driven here, the missing-input ones included, because a
 *   verdict computed over inputs that were never written must not read as GREEN.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const VERDICT_MODULE = path.join(REPO_ROOT, "scripts", "testing", "battery-verdict.mjs");

/** The steps every fixture plans; `api-1` is the one whose log and report carry test counts. */
const STEP_NAMES = ["install", "hooks", "lint", "api-1"] as const;

interface StepRecord {
  readonly name: string;
  readonly exit: number;
}

interface WarningLine {
  readonly log: string;
  readonly line: number;
  readonly text: string;
}

interface ApiRun {
  readonly run: number;
  readonly files: number | null;
  readonly tests: number | null;
  readonly passed: number | null;
  readonly pending: number | null;
  readonly failed: number | null;
  readonly unhandled: number;
}

interface Verdict {
  readonly status: "GREEN" | "RED";
  readonly reasons: readonly string[];
  readonly steps: readonly StepRecord[];
  readonly warnings: readonly WarningLine[];
  readonly appWarnRecords: {
    readonly total: number;
    readonly messages: readonly { readonly msg: string; readonly count: number }[];
  };
  readonly apiRuns: readonly ApiRun[];
}

interface VerdictInput {
  readonly outDir: string;
  readonly expectedSteps: number;
  readonly dirtyAtEnd: boolean;
}

/**
 * The module's surface as the suite uses it. It is loaded by a computed path because a literal
 * import of an untyped `.mjs` would leave the tests' typecheck scope an implicit-any module.
 */
interface BatteryVerdictModule {
  readonly evaluateBattery: (input: VerdictInput) => Verdict;
}

interface LogDirFixture {
  /** Rows written to `steps.tsv`; `null` leaves the file out. Defaults to every step at exit 0. */
  readonly steps?: readonly StepRecord[] | null;
  /** Log contents by file name; a recorded step with no entry here gets one neutral line. */
  readonly logs?: Readonly<Record<string, string>>;
  /** Vitest JSON reports by file name; `null` leaves that report out. */
  readonly reports?: Readonly<Record<string, object | null>>;
}

let scratchRoot = "";

beforeEach(() => {
  scratchRoot = mkdtempSync(path.join(tmpdir(), "battery-verdict-"));
});

afterEach(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

const passingSteps = (): StepRecord[] => STEP_NAMES.map((name) => ({ name, exit: 0 }));

const vitestReport = (overrides: Readonly<Record<string, unknown>> = {}): object => ({
  numTotalTests: 3,
  numPassedTests: 3,
  numPendingTests: 0,
  numFailedTests: 0,
  testResults: [{ name: "first.test.ts" }, { name: "second.test.ts" }],
  ...overrides,
});

/** Writes one battery log directory and returns its path. */
const makeLogDir = (fixture: LogDirFixture = {}): string => {
  const dir = path.join(scratchRoot, "logs");
  mkdirSync(dir, { recursive: true });
  const steps = fixture.steps === undefined ? passingSteps() : fixture.steps;
  if (steps !== null) {
    const rows = steps.map((step) => `${step.name}\t${String(step.exit)}\n`).join("");
    writeFileSync(path.join(dir, "steps.tsv"), rows);
    for (const step of steps) writeFileSync(path.join(dir, `${step.name}.log`), "done\n");
  }
  for (const [name, content] of Object.entries(fixture.logs ?? {})) {
    writeFileSync(path.join(dir, name), content);
  }
  const reports: Record<string, object | null> = {
    "api-1.json": vitestReport(),
    ...fixture.reports,
  };
  for (const [name, report] of Object.entries(reports)) {
    if (report !== null) writeFileSync(path.join(dir, name), JSON.stringify(report));
  }
  return dir;
};

const loadBatteryVerdict = async (): Promise<BatteryVerdictModule> =>
  (await import(VERDICT_MODULE)) as BatteryVerdictModule;

const evaluate = async (
  outDir: string,
  overrides: Partial<Omit<VerdictInput, "outDir">> = {}
): Promise<Verdict> => {
  const batteryVerdict = await loadBatteryVerdict();
  return batteryVerdict.evaluateBattery({
    outDir,
    expectedSteps: overrides.expectedSteps ?? STEP_NAMES.length,
    dirtyAtEnd: overrides.dirtyAtEnd ?? false,
  });
};

describe("battery verdict", () => {
  describe("a clean battery", () => {
    it("returns GREEN with no reasons when every planned step exits 0 over clean logs", async () => {
      const outDir = makeLogDir();

      const verdict = await evaluate(outDir);

      expect(verdict.reasons).toEqual([]);
      expect(verdict.status).toBe("GREEN");
      expect(verdict.steps).toEqual(passingSteps());
      expect(verdict.warnings).toEqual([]);
      expect(verdict.apiRuns).toEqual([
        { run: 1, files: 2, tests: 3, passed: 3, pending: 0, failed: 0, unhandled: 0 },
      ]);
    });
  });

  describe("a failing step", () => {
    it("returns RED naming the step when one step exits non-zero", async () => {
      const outDir = makeLogDir({
        steps: passingSteps().map((step) => (step.name === "lint" ? { ...step, exit: 1 } : step)),
      });

      const verdict = await evaluate(outDir);

      expect(verdict.status).toBe("RED");
      expect(verdict.reasons).toContain("step lint exit 1");
    });
  });

  describe("toolchain lines", () => {
    it("returns RED recording the line with its log name and line number", async () => {
      const outDir = makeLogDir({
        logs: { "install.log": "Progress: resolved 10\n WARN  deprecated eslint@9.39.5\nDone\n" },
      });

      const verdict = await evaluate(outDir);

      expect(verdict.status).toBe("RED");
      expect(verdict.warnings).toEqual([
        { log: "install.log", line: 2, text: " WARN  deprecated eslint@9.39.5" },
      ]);
      expect(verdict.reasons).toContain("1 warning line(s)");
    });

    it("returns RED for the singular, plural and capitalised forms alike", async () => {
      const outDir = makeLogDir({
        logs: {
          "hooks.log": "ok\n(node:1) Warning: a deprecated API\n2 warnings\nwarn: slow\n",
        },
      });

      const verdict = await evaluate(outDir);

      expect(verdict.status).toBe("RED");
      expect(verdict.warnings.map((line) => line.line)).toEqual([2, 3, 4]);
    });

    it("records the text cut at 220 characters", async () => {
      const outDir = makeLogDir({ logs: { "lint.log": `warning: ${"x".repeat(400)}\n` } });

      const verdict = await evaluate(outDir);

      expect(verdict.warnings[0]?.text).toHaveLength(220);
    });

    it("returns GREEN over a --max-warnings 0 command echo", async () => {
      const outDir = makeLogDir({ logs: { "lint.log": "> eslint . --max-warnings 0\nok\n" } });

      const verdict = await evaluate(outDir);

      expect(verdict.reasons).toEqual([]);
      expect(verdict.status).toBe("GREEN");
    });

    it("returns GREEN over file paths and file names that carry warn or warning", async () => {
      const outDir = makeLogDir({
        logs: {
          "lint.log": [
            " - apps/client/components/warning-banner.ts [1:1 - 14:2] (13 lines, 100 tokens)",
            "src/warnings/index.ts",
            "apps/client/hooks/useWarn.tsx",
            "warning-banner.ts",
            "warnings.ts:12:5",
            "packages/ui/src/DeprecationWarning.tsx",
            "",
          ].join("\n"),
        },
      });

      const verdict = await evaluate(outDir);

      expect(verdict.warnings).toEqual([]);
      expect(verdict.reasons).toEqual([]);
      expect(verdict.status).toBe("GREEN");
    });

    it("returns GREEN over command-line flags that carry the word", async () => {
      const outDir = makeLogDir({
        logs: {
          "lint.log": [
            "> eslint . --max-warnings=0",
            "> madge --circular --warning apps/api/src/",
            "$ node --trace-warnings server.js",
            "",
          ].join("\n"),
        },
      });

      const verdict = await evaluate(outDir);

      expect(verdict.warnings).toEqual([]);
      expect(verdict.status).toBe("GREEN");
    });

    it.each([
      ["npm's", "npm warn deprecated inflight@1.0.6: This module is not supported"],
      ["pnpm's", " WARN  deprecated eslint@9.39.5"],
      ["a compiler's", "warning: unused import"],
      ["a bracketed", "[WARN] 1 deprecated subdependencies found: @effect/schema@0.69.0"],
      [
        "a plugin's",
        "[boundaries][warning]: Some element descriptors appear to use file patterns.",
      ],
      ["a bundler's", "(!) Warning: some chunks are larger than 500 kB"],
      [
        "eslint's column",
        "  12:5  warning  'x' is assigned a value but never used  no-unused-vars",
      ],
      ["eslint's summary", "✖ 3 problems (0 errors, 3 warnings)"],
      ["madge's summary", "Processed 1566 files (6.5s) (422 warnings)"],
      ["node's hint", "(Use `node --trace-deprecation ...` to show where the warning was created)"],
      ["a sentence-ending", "Compiled with 1 warning."],
      ["a path-prefixed", "apps/client/components/warning-banner.ts:3:1: warning: Unexpected any"],
      [
        "a --max-warnings 0 carrying",
        'npm warn Unknown cli config "--max-warnings 0". This will stop working soon.',
      ],
    ])("returns RED over %s warning line", async (_form, line) => {
      const outDir = makeLogDir({ logs: { "lint.log": `ok\n${line}\n` } });

      const verdict = await evaluate(outDir);

      expect(verdict.status).toBe("RED");
      expect(verdict.warnings).toEqual([{ log: "lint.log", line: 2, text: line }]);
    });

    it.each([
      ["node's", "(node:1824577) [DEP0040] DeprecationWarning: The punycode module is deprecated."],
      ["python's", "/root/hooks/mod.py:6: DeprecationWarning: x is old"],
      ["an experimental", "(node:7) ExperimentalWarning: VM Modules is an experimental feature"],
    ])("returns RED over %s runtime warning category", async (_form, line) => {
      const outDir = makeLogDir({ logs: { "hooks.log": `ok\n${line}\n` } });

      const verdict = await evaluate(outDir);

      expect(verdict.status).toBe("RED");
      expect(verdict.warnings).toEqual([{ log: "hooks.log", line: 2, text: line }]);
    });

    it("returns GREEN over the application's own pino records and counts them per message", async () => {
      const longMessage = "m".repeat(120);
      const outDir = makeLogDir({
        logs: {
          "api-1.log": [
            '{"level":"warn","msg":"token refresh failed"}',
            '{"level":"warn","msg":"token refresh failed"}',
            '{"level":"warn","msg":"queue paused"}',
            '{"level":"warn","time":1}',
            `{"level":"warn","msg":"${longMessage}"}`,
            "Test Files  2 passed (2)",
            "",
          ].join("\n"),
        },
      });

      const verdict = await evaluate(outDir);

      expect(verdict.reasons).toEqual([]);
      expect(verdict.status).toBe("GREEN");
      expect(verdict.appWarnRecords).toEqual({
        total: 5,
        messages: [
          { msg: "token refresh failed", count: 2 },
          { msg: "<no msg field>", count: 1 },
          { msg: "m".repeat(80), count: 1 },
          { msg: "queue paused", count: 1 },
        ],
      });
    });
  });

  describe("missing inputs", () => {
    it("returns RED when fewer steps were recorded than planned", async () => {
      const outDir = makeLogDir();

      const verdict = await evaluate(outDir, { expectedSteps: STEP_NAMES.length + 1 });

      expect(verdict.status).toBe("RED");
      expect(verdict.reasons).toContain(
        `expected ${String(STEP_NAMES.length + 1)} steps, found ${String(STEP_NAMES.length)}`
      );
    });

    it("returns RED when steps.tsv is missing", async () => {
      const outDir = makeLogDir({ steps: null });

      const verdict = await evaluate(outDir);

      expect(verdict.status).toBe("RED");
      expect(verdict.reasons.join("\n")).toContain("steps.tsv is missing");
    });

    it("returns RED when the log directory does not exist at all", async () => {
      const verdict = await evaluate(path.join(scratchRoot, "never-written"));

      expect(verdict.status).toBe("RED");
      expect(verdict.reasons.join("\n")).toContain("steps.tsv is missing");
    });

    it("returns RED when a steps.tsv row is not a name and an exit code", async () => {
      const outDir = makeLogDir();
      writeFileSync(path.join(outDir, "steps.tsv"), "install\t0\nhooks\t0\nlint\tok\napi-1\t0\n");

      const verdict = await evaluate(outDir);

      expect(verdict.status).toBe("RED");
      expect(verdict.reasons.join("\n")).toContain("steps.tsv line 3");
    });

    it("returns RED with one reason naming a step recorded twice, keeping its first record", async () => {
      const outDir = makeLogDir();
      writeFileSync(
        path.join(outDir, "steps.tsv"),
        "install\t0\nhooks\t0\nlint\t0\nlint\t1\napi-1\t0\n"
      );

      const verdict = await evaluate(outDir);

      expect(verdict.status).toBe("RED");
      expect(verdict.reasons).toEqual(["step lint recorded twice"]);
      expect(verdict.steps).toEqual(passingSteps());
    });

    it("returns one reason for a step recorded three times", async () => {
      const outDir = makeLogDir();
      writeFileSync(
        path.join(outDir, "steps.tsv"),
        "install\t0\nhooks\t0\nlint\t0\nlint\t0\nlint\t0\napi-1\t0\n"
      );

      const verdict = await evaluate(outDir);

      expect(verdict.reasons).toEqual(["step lint recorded twice"]);
      expect(verdict.steps.map((step) => step.name)).toEqual([...STEP_NAMES]);
    });

    it("returns RED when a recorded step left no log", async () => {
      const outDir = makeLogDir();
      rmSync(path.join(outDir, "lint.log"));

      const verdict = await evaluate(outDir);

      expect(verdict.status).toBe("RED");
      expect(verdict.reasons).toContain("step lint left no log");
    });

    it("returns RED when an api run left no JSON report", async () => {
      const outDir = makeLogDir({ reports: { "api-1.json": null } });

      const verdict = await evaluate(outDir);

      expect(verdict.status).toBe("RED");
      expect(verdict.reasons).toContain("api-1.json is missing or unreadable");
      expect(verdict.apiRuns[0]?.tests).toBeNull();
    });

    it("returns RED when an api report is valid JSON but not a vitest report", async () => {
      const outDir = makeLogDir();
      writeFileSync(path.join(outDir, "api-1.json"), "null");

      const verdict = await evaluate(outDir);

      expect(verdict.status).toBe("RED");
      expect(verdict.reasons).toContain("api-1.json is missing or unreadable");
    });
  });

  describe("api runs", () => {
    it("returns RED when an api log carries Unhandled Error", async () => {
      const outDir = makeLogDir({
        logs: { "api-1.log": "⎯⎯⎯ Unhandled Errors ⎯⎯⎯\nUnhandled Error\nTypeError: boom\n" },
      });

      const verdict = await evaluate(outDir);

      expect(verdict.status).toBe("RED");
      expect(verdict.apiRuns[0]?.unhandled).toBe(2);
      expect(verdict.reasons.join("\n")).toContain("api-1: 2 line(s)");
    });

    it("returns RED when an api log carries Worker exited", async () => {
      const outDir = makeLogDir({
        logs: { "api-1.log": "Error: [vitest-pool]: Worker exited unexpectedly\n" },
      });

      const verdict = await evaluate(outDir);

      expect(verdict.status).toBe("RED");
      expect(verdict.apiRuns[0]?.unhandled).toBe(1);
    });

    it("returns RED when an api report counts a failed test", async () => {
      const outDir = makeLogDir({
        reports: { "api-1.json": vitestReport({ numPassedTests: 2, numFailedTests: 1 }) },
      });

      const verdict = await evaluate(outDir);

      expect(verdict.status).toBe("RED");
      expect(verdict.reasons).toContain("api-1: 1 failed test(s)");
    });
  });

  describe("the tree", () => {
    it("returns RED when the tree changed during the battery", async () => {
      const outDir = makeLogDir();

      const verdict = await evaluate(outDir, { dirtyAtEnd: true });

      expect(verdict.status).toBe("RED");
      expect(verdict.reasons).toEqual(["tree changed during the battery"]);
    });
  });
});
