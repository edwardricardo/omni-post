/**
 * @file playwright-collector.test.ts
 * @description Self-tests of the Playwright report reader: how a `playwright test --list
 *              --reporter=json` report is read, and every way it fails closed.
 * @layer infrastructure
 */
import { describe, expect, it } from "vitest";
import { ok } from "@shared/types";
import { parsePlaywrightList } from "../src/lib/playwright-collector.js";

const ROOT_DIR = "/repo/app/tests/e2e";

/** A report in the shape Playwright 1.63.0 prints: nested suites, one spec run by two projects. */
function report(overrides: Record<string, unknown> = {}): string {
  const spec = (file: string) => ({
    file,
    tests: [{ projectName: "chromium" }, { projectName: "firefox" }],
  });
  return JSON.stringify({
    config: { rootDir: ROOT_DIR },
    suites: [
      { file: "a.spec.ts", specs: [], suites: [{ file: "a.spec.ts", specs: [spec("a.spec.ts")] }] },
      { file: "sub/b.spec.ts", specs: [spec("sub/b.spec.ts"), spec("sub/b.spec.ts")] },
    ],
    errors: [],
    stats: { expected: 0 },
    ...overrides,
  });
}

describe("Playwright report parsing", () => {
  it("returns every spec file once, resolved against the report's rootDir", () => {
    expect(parsePlaywrightList(report())).toEqual(
      ok([`${ROOT_DIR}/a.spec.ts`, `${ROOT_DIR}/sub/b.spec.ts`])
    );
  });

  it.each([
    ["text before the report", `Running…\n${report()}`, "printed no JSON report"],
    ["a report that is not valid JSON", "{ not json", "printed a report that is not valid JSON"],
    ["no rootDir", report({ config: {} }), "no absolute config.rootDir"],
    ["a relative rootDir", report({ config: { rootDir: "tests" } }), "no absolute config.rootDir"],
    ["no errors list", report({ errors: null }), "no errors list"],
    [
      "a load error",
      report({ errors: [{ message: "Error: cannot find module" }] }),
      "reported 1 errors: Error: cannot find module",
    ],
    ["no suites list", report({ suites: {} }), "no suites list"],
    [
      "a spec with no file",
      report({ suites: [{ specs: [{ tests: [] }] }] }),
      "a spec with no file",
    ],
    ["a suite that is not an object", report({ suites: [3] }), "a suite that is not an object"],
  ])("returns a failure for %s", (_label, stdout, expected) => {
    const parsed = parsePlaywrightList(stdout);

    expect(parsed.ok ? "" : parsed.error).toContain(expected);
  });
});
