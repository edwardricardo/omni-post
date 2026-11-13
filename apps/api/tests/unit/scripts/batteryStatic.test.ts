/**
 * @file batteryStatic.test.ts
 * @description Pins `staticReport` in `scripts/testing/battery-static.mjs`, which turns the verdict
 *   of a static battery run (`battery.sh --static`) into the lines it prints and its exit code.
 *   `batteryModes.test.ts` drives the whole static run through the script; this suite covers the
 *   verdicts that run does not reach cheaply: a failing step and a warning line together, a verdict
 *   whose reasons go beyond the failing steps and the warnings, and a GREEN one. Each input is a
 *   verdict object shaped like `evaluateBattery`'s, so the suite reads no log and runs no gate.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const STATIC_MODULE = path.join(REPO_ROOT, "scripts", "testing", "battery-static.mjs");

interface StepRecord {
  readonly name: string;
  readonly exit: number;
}

interface WarningLine {
  readonly log: string;
  readonly line: number;
  readonly text: string;
}

interface Verdict {
  readonly status: "GREEN" | "RED";
  readonly reasons: readonly string[];
  readonly steps: readonly StepRecord[];
  readonly warnings: readonly WarningLine[];
  readonly appWarnRecords: { readonly total: number; readonly messages: readonly object[] };
  readonly apiRuns: readonly object[];
}

interface StaticReport {
  readonly lines: readonly string[];
  readonly exitCode: number;
}

/**
 * The module's surface as the suite uses it. It is loaded by a computed path because a literal
 * import of an untyped `.mjs` would leave the tests' typecheck scope an implicit-any module.
 */
interface BatteryStaticModule {
  readonly staticReport: (verdict: Verdict) => StaticReport;
}

const loadBatteryStatic = async (): Promise<BatteryStaticModule> =>
  (await import(STATIC_MODULE)) as BatteryStaticModule;

const verdictOf = (overrides: Partial<Verdict>): Verdict => ({
  status: "RED",
  reasons: [],
  steps: [
    { name: "lint", exit: 0 },
    { name: "knip", exit: 0 },
  ],
  warnings: [],
  appWarnRecords: { total: 0, messages: [] },
  apiRuns: [],
  ...overrides,
});

describe("staticReport", () => {
  it("returns exit 1 and a last line naming the failing step and the warning log when both occur", async () => {
    const { staticReport } = await loadBatteryStatic();

    const report = staticReport(
      verdictOf({
        reasons: ["step lint exit 1", "1 warning line(s)"],
        steps: [
          { name: "lint", exit: 1 },
          { name: "knip", exit: 0 },
        ],
        warnings: [{ log: "knip.log", line: 3, text: "1 warning" }],
      })
    );

    expect(report.exitCode).toBe(1);
    expect(report.lines).toEqual([
      "warning lines: 1",
      "  knip.log:3:1 warning",
      "RED because step lint exit 1",
      "RED because 1 warning line(s)",
      "STATIC RED: 1 of 2 static steps failed: lint; 1 warning line(s) in knip.log; a static run certifies nothing",
    ]);
  });

  it("returns a last line counting the other reasons when the reasons go beyond the failing steps and the warnings", async () => {
    const { staticReport } = await loadBatteryStatic();

    const report = staticReport(
      verdictOf({
        reasons: ["step lint exit 1", "expected 3 steps, found 2", "step knip left no log"],
        steps: [
          { name: "lint", exit: 1 },
          { name: "knip", exit: 0 },
        ],
      })
    );

    expect(report.exitCode).toBe(1);
    expect(report.lines).toEqual([
      "RED because step lint exit 1",
      "RED because expected 3 steps, found 2",
      "RED because step knip left no log",
      "STATIC RED: 1 of 2 static steps failed: lint; 2 other reason(s) above; a static run certifies nothing",
    ]);
  });

  it("returns exit 0 and the STATIC GREEN line when the verdict is GREEN", async () => {
    const { staticReport } = await loadBatteryStatic();

    const report = staticReport(verdictOf({ status: "GREEN" }));

    expect(report.exitCode).toBe(0);
    expect(report.lines).toEqual([
      "STATIC GREEN: all 2 static steps exited 0 and no log holds a warning line; a static run certifies nothing",
    ]);
  });
});
