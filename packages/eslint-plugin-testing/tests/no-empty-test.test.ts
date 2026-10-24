/**
 * @file no-empty-test.test.ts
 * @description RuleTester suite for `testing/no-empty-test`, which reports the classifier's EMPTY
 *              class: a test block in whose body no assertion runs passes whatever the code it
 *              calls does. The invalid cases are such blocks in vitest and in node:test, a
 *              node:test block written with no function (which vitest would read as a todo), and
 *              a file holding several, each reported on its own line and column. The valid cases
 *              are what the rule must not mistake for one: an `expect`, an `assert`, a
 *              `t.assert` and a `throw` in the body, a same-file helper that asserts, a helper
 *              named as asserting that the classifier cannot see into, a block that skips itself
 *              (a modifier, an option, a `t.skip()` call, vitest's block with no function), a
 *              block that prints success, which is a class of its own, and a `describe` that only
 *              holds blocks.
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
import rule from "../src/rules/no-empty-test.js";
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

const VITEST_FILE = "posts.test.ts";
const NODE_FILE = "posts.integration.test.ts";

const lines = (...source: string[]): string => source.join("\n");
const vitest = (...body: string[]) => ({
  code: lines('import { describe, expect, it, test } from "vitest";', ...body),
  filename: VITEST_FILE,
});
const nodeTest = (...body: string[]) => ({
  code: lines(
    'import { describe, it, test } from "node:test";',
    'import assert from "node:assert/strict";',
    ...body
  ),
  filename: NODE_FILE,
});
const empty = (title: string, line: number) => ({ messageId: "empty", data: { title }, line });

ruleTester.run("no-empty-test", rule, {
  valid: [
    vitest(
      'it("creates a post", async () => {',
      "  const post = await createPost();",
      '  expect(post.title).toBe("x");',
      "});"
    ),
    vitest(
      'it("rejects an empty title", () => {',
      '  if (!valid("")) throw new Error("accepted");',
      "});"
    ),
    vitest(
      "function expectSaved(post) {",
      "  expect(post.id).toBe(1);",
      "}",
      'it("saves the post", async () => {',
      "  expectSaved(await createPost());",
      "});"
    ),
    vitest(
      'import { verifyRendered } from "./helpers/render.js";',
      'it("renders the form", () => {',
      "  verifyRendered(render(form));",
      "});"
    ),
    vitest('it("creates a post", { skip: true }, async () => {', "  await createPost();", "});"),
    vitest('it.todo("creates a post");'),
    vitest('it("creates a post");'),
    vitest(
      'it("creates a post", async () => {',
      "  await createPost();",
      '  console.log("✅ created");',
      "});"
    ),
    vitest(
      'describe("posts", () => {',
      '  it("creates a post", () => {',
      "    expect(create()).toBe(1);",
      "  });",
      "});"
    ),
    nodeTest(
      'test("saves the record", async () => {',
      "  const saved = await save();",
      "  assert.equal(saved.id, 1);",
      "});"
    ),
    nodeTest(
      'test("counts one event", async (t) => {',
      "  t.assert.strictEqual(await count(), 1);",
      "});"
    ),
    nodeTest(
      'test("saves the record", async () => {',
      "  const saved = await save();",
      '  if (!saved) throw new Error("not saved");',
      "});"
    ),
    nodeTest(
      'test("saves the record", { skip: "no database" }, async () => {',
      "  await save();",
      "});"
    ),
    nodeTest('test("saves the record", async (t) => {', "  t.skip();", "  await save();", "});"),
  ],
  invalid: [
    {
      ...vitest('it("creates a post", async () => {', '  await createPost({ title: "x" });', "});"),
      errors: [{ ...empty("creates a post", 2), column: 1, endLine: 4, endColumn: 3 }],
    },
    {
      ...vitest(
        'describe("posts", () => {',
        '  it("creates a post", () => {',
        "    createPost();",
        "  });",
        '  test("deletes a post", () => {',
        "    deletePost(1);",
        "  });",
        "});"
      ),
      errors: [
        { ...empty("creates a post", 3), column: 3 },
        { ...empty("deletes a post", 6), column: 3 },
      ],
    },
    {
      ...nodeTest(
        'test("creates a post", async () => {',
        '  await createPost({ title: "x" });',
        "});"
      ),
      errors: [{ ...empty("creates a post", 3), column: 1, endLine: 5, endColumn: 3 }],
    },
    {
      ...nodeTest('test("is planned");'),
      errors: [empty("is planned", 3)],
    },
    {
      ...nodeTest(
        'describe("records", () => {',
        '  it("saves the record", async () => {',
        "    await save();",
        "  });",
        "});"
      ),
      errors: [{ ...empty("saves the record", 4), column: 3 }],
    },
    {
      ...vitest('it("creates a post", async () => {', '  await createPost({ title: "x" });', "});"),
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
