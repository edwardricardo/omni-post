/**
 * @file no-existence-only-test.test.ts
 * @description RuleTester suite for `testing/no-existence-only-test`, which reports the
 *              classifier's EXISTENCE-ONLY class: a test block whose every assertion on every
 *              path checks presence, type or truthiness passes for any result of the right shape.
 *              The invalid cases are such blocks in vitest (`toBeDefined`, `not.toBeNull`,
 *              `toBeInstanceOf`, `toHaveProperty` with one argument, `expect.any`, a rendered
 *              element found by role) and in node:test (`assert.ok`, `typeof`, `instanceof` under
 *              `t.assert`), and a presence check beside a value check that runs on one path only.
 *              The valid cases are what the rule must not mistake for one: a presence check beside
 *              an assertion that restricts a value, `toHaveProperty` with a value, a role query
 *              with a name, a boolean predicate's truthiness, a helper the classifier cannot see
 *              into, a block that skips itself, and a block whose title promises an absence, which
 *              the title-contradiction class leaves to a human.
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
import rule from "../src/rules/no-existence-only-test.js";
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

const VITEST_FILE = "users.test.tsx";
const NODE_FILE = "users.integration.test.ts";

const lines = (...source: string[]): string => source.join("\n");
const vitest = (...body: string[]) => ({
  code: lines(
    'import { describe, expect, it } from "vitest";',
    'import { render, screen } from "@testing-library/react";',
    ...body
  ),
  filename: VITEST_FILE,
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
});
const nodeTest = (...body: string[]) => ({
  code: lines(
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    ...body
  ),
  filename: NODE_FILE,
});
const existenceOnly = (title: string, line: number) => ({
  messageId: "existenceOnly",
  data: { title },
  line,
});

ruleTester.run("no-existence-only-test", rule, {
  valid: [
    vitest(
      'it("returns the user\'s email", async () => {',
      '  const user = await findUser("u1");',
      "  expect(user).toBeDefined();",
      '  expect(user.email).toBe("a@b.c");',
      "});"
    ),
    vitest(
      'it("returns the user\'s email", async () => {',
      '  const user = await findUser("u1");',
      '  expect(user).toHaveProperty("email", "a@b.c");',
      "});"
    ),
    vitest(
      'it("renders the save button", () => {',
      "  render(<Form />);",
      '  expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();',
      "});"
    ),
    vitest(
      'it("marks the comment deleted", () => {',
      "  comment.delete();",
      "  expect(comment.isDeleted()).toBeTruthy();",
      "});"
    ),
    vitest(
      'import { expectValidUser } from "./helpers/users.js";',
      'it("returns the user", async () => {',
      '  const user = await findUser("u1");',
      "  expect(user).toBeDefined();",
      "  expectValidUser(user);",
      "});"
    ),
    vitest(
      'it("returns the user", { skip: true }, async () => {',
      '  expect(await findUser("u1")).toBeDefined();',
      "});"
    ),
    nodeTest(
      'test("returns the user\'s email", async () => {',
      '  const user = await findUser("u1");',
      "  assert.ok(user);",
      '  assert.equal(user.email, "a@b.c");',
      "});"
    ),
    nodeTest(
      'test("grants the admin role", async () => {',
      '  const roles = await rolesOf("u1");',
      '  assert.ok(roles.includes("admin"));',
      "});"
    ),
    nodeTest(
      'test("does not return a deleted user", async () => {',
      '  const user = await findUser("deleted");',
      "  assert.ok(user);",
      "});"
    ),
  ],
  invalid: [
    {
      ...vitest(
        'describe("users", () => {',
        '  it("returns the user", async () => {',
        '    const user = await findUser("u1");',
        "    expect(user).toBeDefined();",
        "    expect(user).not.toBeNull();",
        "    expect(user).toBeInstanceOf(User);",
        '    expect(user).toHaveProperty("email");',
        "    expect(user.id).toEqual(expect.any(String));",
        "  });",
        '  it("renders the form", () => {',
        "    render(<Form />);",
        '    expect(screen.getByRole("button")).toBeInTheDocument();',
        "  });",
        "});"
      ),
      errors: [
        { ...existenceOnly("returns the user", 4), column: 3, endLine: 11, endColumn: 5 },
        existenceOnly("renders the form", 12),
      ],
    },
    {
      ...vitest(
        'it("returns the user\'s email", async () => {',
        '  const user = await findUser("u1");',
        "  expect(user).toBeDefined();",
        '  if (user.email) expect(user.email).toBe("a@b.c");',
        "});"
      ),
      errors: [existenceOnly("returns the user's email", 3)],
    },
    {
      ...nodeTest(
        'test("returns the user", async (t) => {',
        '  const user = await findUser("u1");',
        "  assert.ok(user);",
        "  assert.notEqual(user, undefined);",
        '  assert.equal(typeof user.name, "string");',
        "  t.assert.ok(user.roles instanceof Array);",
        "});"
      ),
      errors: [{ ...existenceOnly("returns the user", 3), column: 1, endLine: 9, endColumn: 3 }],
    },
    {
      ...vitest(
        'it("returns the user", async () => {',
        '  const user = await findUser("u1");',
        "  expect(user).toBeDefined();",
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
