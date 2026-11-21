// @ts-check
/**
 * @file index.js
 * @description The `errors` ESLint plugin: rules that keep an error's code, status and text in the
 *   central error registry instead of at the site that raises or answers the failure. ESM source
 *   with no build step, loaded by jiti from `eslint.config.ts` and importable by node as is.
 * @layer infrastructure
 */
import noInlineError from "./rules/no-inline-error.js";

/** @type {import("eslint").ESLint.Plugin} */
const plugin = {
  meta: { name: "@packages/eslint-plugin-errors" },
  rules: {
    "no-inline-error": noInlineError,
  },
};

export default plugin;
