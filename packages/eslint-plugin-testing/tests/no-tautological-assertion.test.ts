/**
 * @file no-tautological-assertion.test.ts
 * @description RuleTester suite for `testing/no-tautological-assertion`, which reports the
 *              classifier's TAUTOLOGY-ONLY class: a test block whose every assertion is true by
 *              construction passes whatever the code it calls does. The invalid cases are such
 *              blocks in vitest (a literal against a literal, an object literal against an equal
 *              one, a length asserted `>= 0`) and in node:test (`assert.ok(true)`,
 *              `assert.equal(1, 1)`, `t.assert.ok(count >= 0)`), one per block of a file. The
 *              valid cases are what the rule must not mistake for one: a tautology beside an
 *              assertion that can fail, which decides the block; a tautology beside an assertion
 *              that runs on one path only, which is the conditional class; a block that skips
 *              itself; and a block with no assertion at all, which is the empty class.
 *
 *              A last invalid case stands in for the classifier, through the case's `before` and
 *              `after` hooks, with the result of a file it cannot read: the rule reports one
 *              `classifierError` at the file's start and none of its blocks, though the block
 *              would otherwise be reported.
 * @layer infrastructure
 */
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { describe, it, vi } from "vitest";
import rule from "../src/rules/no-tautological-assertion.js";
import { classifyFile } from "../src/classify.js";
import { classifierError, unreadableFile } from "./fixtures/unreadable.js";

vi.mock("../src/classify.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/classify.js")>();
  return { ...actual, classifyFile: vi.fn(actual.classifyFile) };
});

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
});

const VITEST_FILE = "alerts.test.ts";
const NODE_FILE = "alerts.integration.test.ts";

const lines = (...source: string[]): string => source.join("\n");
const vitest = (...body: string[]) => ({
  code: lines('import { describe, expect, it } from "vitest";', ...body),
  filename: VITEST_FILE,
});
const nodeTest = (...body: string[]) => ({
  code: lines(
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    ...body
  ),
  filename: NODE_FILE,
});
const tautology = (title: string, line: number) => ({
  messageId: "tautology",
  data: { title },
  line,
});

ruleTester.run("no-tautological-assertion", rule, {
  valid: [
    vitest(
      'it("records the alert", () => {',
      '  const alert = recordAlert("warning");',
      "  expect(true).toBe(true);",
      '  expect(alert.level).toBe("warning");',
      "});"
    ),
    vitest(
      'it("records the alert", () => {',
      '  const alert = recordAlert("warning");',
      "  expect(true).toBe(true);",
      '  if (alert) expect(alert.level).toBe("warning");',
      "});"
    ),
    vitest('it("records the alert", { skip: true }, () => {', "  expect(true).toBe(true);", "});"),
    vitest('it("records the alert", () => {', '  recordAlert("warning");', "});"),
    nodeTest(
      'test("retries one event", async (t) => {',
      "  const count = await handler.retryFailedEvents();",
      "  t.assert.strictEqual(count, 1);",
      "});"
    ),
    nodeTest(
      'test("retries the events", async () => {',
      "  const count = await handler.retryFailedEvents();",
      "  assert.ok(true);",
      "  assert.equal(count, 2);",
      "});"
    ),
    nodeTest('test("retries the events", { todo: true }, () => {', "  assert.ok(true);", "});"),
  ],
  invalid: [
    {
      ...vitest(
        'describe("alerts", () => {',
        '  it("handles alerts", () => {',
        '    recordAlert("warning");',
        "    expect(true).toBe(true);",
        "    expect(1).toEqual(1);",
        "  });",
        '  it("lists the alerts", async () => {',
        "    const alerts = await listAlerts();",
        "    expect(alerts.length).toBeGreaterThanOrEqual(0);",
        "  });",
        '  it("keeps the settings", () => {',
        "    saveSettings();",
        "    expect({ enabled: true }).toEqual({ enabled: true });",
        "  });",
        "});"
      ),
      errors: [
        { ...tautology("handles alerts", 3), column: 3, endLine: 7, endColumn: 5 },
        tautology("lists the alerts", 8),
        tautology("keeps the settings", 12),
      ],
    },
    {
      ...nodeTest(
        'test("handles alerts", () => {',
        '  recordAlert("warning");',
        "  assert.ok(true);",
        "  assert.equal(1, 1);",
        "});",
        'test("counts retried events", async (t) => {',
        "  const count = await handler.retryFailedEvents();",
        "  t.assert.ok(count >= 0);",
        "});"
      ),
      errors: [
        { ...tautology("handles alerts", 3), column: 1, endLine: 7, endColumn: 3 },
        tautology("counts retried events", 8),
      ],
    },
    {
      ...vitest(
        'it("handles alerts", () => {',
        '  recordAlert("warning");',
        "  expect(true).toBe(true);",
        "});"
      ),
      before: () => {
        vi.mocked(classifyFile).mockReturnValue(unreadableFile(VITEST_FILE));
      },
      after: () => {
        vi.mocked(classifyFile).mockReset();
      },
      errors: [classifierError(VITEST_FILE)],
    },
  ],
});
