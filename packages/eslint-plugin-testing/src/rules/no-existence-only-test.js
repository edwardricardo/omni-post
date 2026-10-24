// @ts-check
/**
 * @file no-existence-only-test.js
 * @description ESLint rule `testing/no-existence-only-test`: a test block restricts a value. A
 *   block that only checks that a result exists, has a type or is truthy passes for any result of
 *   the right shape, so a defect that returns the wrong value keeps it green.
 *
 *   What the rule reports is the classifier's EXISTENCE-ONLY class (`classifyFile` in
 *   `../classify.js`), in vitest and node:test alike: a block holding no other block, with no skip
 *   marker, in which no assertion that runs on every path restricts a value or a snapshot, at
 *   least one such assertion checks presence, type or truthiness, and no helper the classifier
 *   cannot see into is called. A presence check is `toBeDefined`, `not.toBeNull`, `toBeTruthy`
 *   or `assert.ok` over a value, `toBeInstanceOf`, `toHaveProperty` with one argument,
 *   `toBeTypeOf`, a `typeof`, `Array.isArray`, `instanceof` or `in` test asserted true, and an
 *   `expect.any` or `expect.anything` as the whole expected value.
 *
 *   Not reported: a value named as a boolean predicate (`isDeleted()`, `has(...)`,
 *   `includes(...)`), whose truthiness asserts a state, not a presence; a block whose title the
 *   assertions contradict, which goes to a human; and a block that prints success after its last
 *   assertion.
 *
 *   A file the classifier cannot read is reported once, at its first line, by `classifiedBlocks`
 *   (`../classified.js`), and none of its blocks is checked.
 * @layer infrastructure
 */
import { CLASSIFIER_ERROR_MESSAGE, blockLoc, classifiedBlocks } from "../classified.js";
import { BLOCK_CLASS } from "../classify.js";

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow a test block that checks only that values exist" },
    schema: [],
    messages: {
      existenceOnly:
        "`{{title}}` restricts no value: what it asserts on every path is presence, type or " +
        "truthiness, so any result of the right shape passes. Assert the value its title " +
        "names, or delete the block.",
      classifierError: CLASSIFIER_ERROR_MESSAGE,
    },
  },
  create(context) {
    return {
      Program() {
        for (const block of classifiedBlocks(context)) {
          if (block.blockClass !== BLOCK_CLASS.EXISTENCE_ONLY) continue;
          context.report({
            loc: blockLoc(block),
            messageId: "existenceOnly",
            data: { title: block.title },
          });
        }
      },
    };
  },
};

export default rule;
