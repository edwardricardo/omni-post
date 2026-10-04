// @ts-check
/**
 * @file index.js
 * @description The `testing` ESLint plugin: rules that hold properties of test files a test runner
 *   cannot report on its own. ESM source with no build step, loaded by jiti from
 *   `eslint.config.ts` and importable by node as is.
 * @layer infrastructure
 */
import noUnownedHandleUnref from "./rules/no-unowned-handle-unref.js";

/** @type {import("eslint").ESLint.Plugin} */
const plugin = {
  meta: { name: "@packages/eslint-plugin-testing" },
  rules: { "no-unowned-handle-unref": noUnownedHandleUnref },
};

export default plugin;
