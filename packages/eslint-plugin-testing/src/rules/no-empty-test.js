// @ts-check
/**
 * @file no-empty-test.js
 * @description ESLint rule `testing/no-empty-test`: every test block asserts something. A block
 *   with no assertion passes whatever the code it calls does, so it reads as coverage while it
 *   restricts nothing; the only failure it can report is a throw it never asked for.
 *
 *   What the rule reports is the classifier's EMPTY class (`classifyFile` in `../classify.js`), in
 *   vitest and node:test alike: a block holding no other block, with no skip marker, in whose body
 *   no assertion runs. An assertion is an `expect` chain, an `assert` call under any name it is
 *   imported as, node:test's `t.assert`, a `throw` written in the block's own body, an assertion
 *   in a same-file helper the block calls, or a call of a helper the classifier cannot see into
 *   and whose name says it asserts (`expect*`, `assert*`, `verify*`, `check*`).
 *
 *   Not reported: a block that skips itself (a skip or todo modifier or option, a skip call in its
 *   body, vitest's block with no function), and a block with no assertion that prints success,
 *   which is a class of its own.
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
    docs: { description: "Disallow a test block in which no assertion runs" },
    schema: [],
    messages: {
      empty:
        "`{{title}}` asserts nothing: no assertion, `throw` or asserting helper runs in its " +
        "body, so it passes whatever the code it calls does. Assert the outcome its title " +
        "names, or delete the block.",
      classifierError: CLASSIFIER_ERROR_MESSAGE,
    },
  },
  create(context) {
    return {
      Program() {
        for (const block of classifiedBlocks(context)) {
          if (block.blockClass !== BLOCK_CLASS.EMPTY) continue;
          context.report({
            loc: blockLoc(block),
            messageId: "empty",
            data: { title: block.title },
          });
        }
      },
    };
  },
};

export default rule;
