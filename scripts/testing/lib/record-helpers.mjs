// @ts-check
/**
 * @file record-helpers.mjs
 * @description The helpers the committed machine records of `scripts/testing/` share: the
 *   code-unit order their rows are sorted in and the plain-object test their readers apply to
 *   parsed JSON. One copy each, so two records cannot drift apart in how they sort or read.
 * @layer infrastructure
 */
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
