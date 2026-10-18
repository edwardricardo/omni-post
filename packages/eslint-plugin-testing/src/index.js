// @ts-check
/**
 * @file index.js
 * @description The `testing` ESLint plugin: rules that hold properties of test files a test runner
 *   cannot report on its own. ESM source with no build step, loaded by jiti from
 *   `eslint.config.ts` and importable by node as is.
 * @layer infrastructure
 */
import noChildProcessInUnit from "./rules/no-child-process-in-unit.js";
import noFixedTimeWait from "./rules/no-fixed-time-wait.js";
import noStdoutInNodeTest from "./rules/no-stdout-in-node-test.js";
import noUnownedHandleUnref from "./rules/no-unowned-handle-unref.js";

/** @type {import("eslint").ESLint.Plugin} */
const plugin = {
  meta: { name: "@packages/eslint-plugin-testing" },
  rules: {
    "no-child-process-in-unit": noChildProcessInUnit,
    "no-fixed-time-wait": noFixedTimeWait,
    "no-stdout-in-node-test": noStdoutInNodeTest,
    "no-unowned-handle-unref": noUnownedHandleUnref,
  },
};

export default plugin;
