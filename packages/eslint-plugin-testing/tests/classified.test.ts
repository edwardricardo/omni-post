/**
 * @file classified.test.ts
 * @description Suite for `src/classified.js`, which the rules that report the classifier's classes
 *              read their blocks through. `classifyFile` is replaced by a spy that runs the real
 *              classifier unless a case gives it a result: no ESLint input makes the classifier
 *              fail on its own, because the parser overflows first (`tests/fixtures/unreadable.ts`).
 *              The helper runs inside a real ESLint context, through a probe rule, so a case sees
 *              exactly what a rule sees: the blocks it gets and the reports it leaves. The cases: a
 *              file the classifier could not read, and a result with no block list, each give one
 *              `classifierError` at the file's start and no block; a readable file gives its
 *              blocks and no report; `blockLoc` turns the classifier's 1-based columns into ESLint's
 *              0-based ones.
 * @layer infrastructure
 */
import { Linter } from "eslint";
import type { Rule } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLASSIFIER_ERROR_MESSAGE, blockLoc, classifiedBlocks } from "../src/classified.js";
import { classifyFile } from "../src/classify.js";
import type { BlockFinding } from "../src/classify.js";
import { CLASSIFIER_RANGE_ERROR, unreadableFile } from "./fixtures/unreadable.js";

vi.mock("../src/classify.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/classify.js")>();
  return { ...actual, classifyFile: vi.fn(actual.classifyFile) };
});

const FILE = "posts.test.ts";
const SOURCE = [
  'import { expect, it } from "vitest";',
  'it("creates a post", async () => {',
  "  await createPost();",
  "});",
].join("\n");

/** Runs `classifiedBlocks` from a probe rule over `code` and returns what the rule saw. */
const runHelper = (code: string) => {
  let blocks: BlockFinding[] = [];
  const probe: Rule.RuleModule = {
    meta: { schema: [], messages: { classifierError: CLASSIFIER_ERROR_MESSAGE } },
    create: (context) => ({
      Program() {
        blocks = classifiedBlocks(context);
      },
    }),
  };
  const messages = new Linter({ configType: "flat" }).verify(
    code,
    [
      {
        files: ["**/*.ts"],
        languageOptions: { parser: tsParser },
        plugins: { probe: { rules: { helper: probe } } },
        rules: { "probe/helper": "error" },
      },
    ],
    FILE
  );
  return { blocks, messages };
};

describe("classifiedBlocks", () => {
  afterEach(() => {
    vi.mocked(classifyFile).mockReset();
  });

  it("reports one classifier error at the file start and returns no block when the classifier could not read the file", () => {
    vi.mocked(classifyFile).mockReturnValue(unreadableFile(FILE));

    const { blocks, messages } = runHelper(SOURCE);

    expect(blocks).toEqual([]);
    expect(
      messages.map(({ ruleId, line, column, message }) => ({ ruleId, line, column, message }))
    ).toEqual([
      {
        ruleId: "probe/helper",
        line: 1,
        column: 1,
        message: `The test-block classifier could not read \`${FILE}\`: ${CLASSIFIER_RANGE_ERROR}. This rule checks none of its blocks until the classifier can read it.`,
      },
    ]);
  });

  it("reports one classifier error naming the missing block list and returns no block when the result has no blocks array", () => {
    const noBlockList = { ...unreadableFile(FILE), error: null };
    Reflect.deleteProperty(noBlockList, "blocks");
    vi.mocked(classifyFile).mockReturnValue(noBlockList);

    const { blocks, messages } = runHelper(SOURCE);

    expect(blocks).toEqual([]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain(
      "could not read `posts.test.ts`: it returned no block list."
    );
  });

  it("returns the classifier's blocks and reports nothing when the file is readable", () => {
    const { blocks, messages } = runHelper(SOURCE);

    expect(messages).toEqual([]);
    expect(blocks.map(({ title, blockClass }) => ({ title, blockClass }))).toEqual([
      { title: "creates a post", blockClass: "EMPTY" },
    ]);
  });
});

describe("blockLoc", () => {
  it("returns the block's span with 0-based columns when given the classifier's 1-based location", () => {
    const [block] = runHelper(SOURCE).blocks;

    expect(block && blockLoc(block)).toEqual({
      start: { line: 2, column: 0 },
      end: { line: 4, column: 2 },
    });
  });
});
