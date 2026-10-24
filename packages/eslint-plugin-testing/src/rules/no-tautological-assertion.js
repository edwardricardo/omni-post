// @ts-check
/**
 * @file no-tautological-assertion.js
 * @description ESLint rule `testing/no-tautological-assertion`: a test block asserts something
 *   that can fail. A block whose every assertion is true by construction passes whatever the code
 *   it calls does, and its assertion count makes it read as a checked one.
 *
 *   What the rule reports is the classifier's TAUTOLOGY-ONLY class (`classifyFile` in
 *   `../classify.js`), in vitest and node:test alike: a block holding no other block, with no skip
 *   marker, whose every assertion is a tautology. A tautology is a literal asserted against a
 *   literal (an object or array literal counts when every value in it is one), and a length, size
 *   or count asserted `>= 0` or `> -1`, through `expect`, `assert` or node:test's `t.assert`.
 *
 *   Not reported: a block where a tautology sits beside any assertion that can fail, which is
 *   judged by that assertion; a block whose tautologies sit beside assertions that run only on
 *   some paths, which is a class of its own; and a block that prints success after its last
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
    docs: { description: "Disallow a test block whose every assertion is true by construction" },
    schema: [],
    messages: {
      tautology:
        "`{{title}}` asserts only what cannot fail: every assertion compares a literal with a " +
        "literal, or a length, size or count with zero, so it passes whatever the code it calls " +
        "does. Assert the outcome its title names, or delete the block.",
      classifierError: CLASSIFIER_ERROR_MESSAGE,
    },
  },
  create(context) {
    return {
      Program() {
        for (const block of classifiedBlocks(context)) {
          if (block.blockClass !== BLOCK_CLASS.TAUTOLOGY_ONLY) continue;
          context.report({
            loc: blockLoc(block),
            messageId: "tautology",
            data: { title: block.title },
          });
        }
      },
    };
  },
};

export default rule;
