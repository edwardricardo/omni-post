// @ts-check
/**
 * @file index.js
 * @description The `testing` ESLint plugin: rules that hold properties of test files a test runner
 *   cannot report on its own, and the assertion classifier, `classifyFile`, that names the test
 *   blocks that cannot fail, three of whose classes the rules report as lint errors. ESM source
 *   with no build step, loaded by jiti from `eslint.config.ts` and importable by node as is.
 * @layer infrastructure
 */
import noChildProcessInUnit from "./rules/no-child-process-in-unit.js";
import noEmptyTest from "./rules/no-empty-test.js";
import noExistenceOnlyTest from "./rules/no-existence-only-test.js";
import noFixedTimeWait from "./rules/no-fixed-time-wait.js";
import noStdoutInNodeTest from "./rules/no-stdout-in-node-test.js";
import noTautologicalAssertion from "./rules/no-tautological-assertion.js";
import noUnownedHandleUnref from "./rules/no-unowned-handle-unref.js";

export { ASSERTION_CLASS } from "./assertions.js";
export { BLOCK_CLASS, CRITERIA, classifyFile } from "./classify.js";

/** @type {import("eslint").ESLint.Plugin} */
const plugin = {
  meta: { name: "@packages/eslint-plugin-testing" },
  rules: {
    "no-child-process-in-unit": noChildProcessInUnit,
    "no-empty-test": noEmptyTest,
    "no-existence-only-test": noExistenceOnlyTest,
    "no-fixed-time-wait": noFixedTimeWait,
    "no-stdout-in-node-test": noStdoutInNodeTest,
    "no-tautological-assertion": noTautologicalAssertion,
    "no-unowned-handle-unref": noUnownedHandleUnref,
  },
};

export default plugin;
