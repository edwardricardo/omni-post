// @ts-check
/**
 * @file record-helpers.mjs
 * @description The helpers the committed machine records of `scripts/testing/` share: the
 *   code-unit order their rows are sorted in, the plain-object test their readers apply to parsed
 *   JSON, and the Prettier rendering that makes a record's bytes the ones `pnpm format:check`
 *   accepts. One copy each, so two records cannot drift apart in how they sort or render.
 * @layer infrastructure
 */
import prettier from "prettier";

/**
 * @description Orders two strings by UTF-16 code unit. `localeCompare` would follow the ICU
 *   collation of the Node that runs it, which folds case and punctuation (`post` before `Post`)
 *   and may change with the ICU version or the locale; `<` is the same on every machine and, for
 *   the ASCII paths and package names git lists here, is byte order.
 * @param {string} left One string.
 * @param {string} right The other.
 * @returns {number} Negative, zero or positive, as `Array.prototype.sort` reads it.
 */
export function byCodeUnit(left, right) {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/**
 * @description Says whether a value is a plain object: what a JSON reader expects where a file
 *   may hold `null`, a number, a string or an array instead.
 * @param {unknown} value Any value.
 * @returns {value is Record<string, unknown>} `true` for an object that is not an array.
 */
export function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @description Renders a value as the JSON text a committed record holds: `JSON.stringify`
 *   formatted by Prettier with the configuration that applies to the record's own path (the
 *   `.prettierrc` and the `.editorconfig`, as the CLI reads them). It orders nothing: equal values
 *   render equal bytes, and the caller owns the order of every list and key.
 * @param {string} file The record's absolute path, whose Prettier configuration applies.
 * @param {unknown} value The record.
 * @returns {Promise<string>} The text, ending in a newline.
 */
export async function renderJson(file, value) {
  const config = await prettier.resolveConfig(file, { editorconfig: true });
  return prettier.format(JSON.stringify(value, null, 2), { ...config, parser: "json" });
}
