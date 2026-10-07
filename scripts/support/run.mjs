// @ts-check
/**
 * @file run.mjs
 * @description Runs the support documentation generators with the support commands:
 *   `pnpm support:index` writes every page, `pnpm check:support` (`--check`) exits 1 when a page is
 *   stale or a support doc breaks the template, `--only <name>` runs one generator.
 * @layer infrastructure
 */
import { runGenerators } from "../legal/lib/inventory.mjs";
import { COMMANDS, generator as index } from "./index.mjs";
import { generator as nonFeatures } from "./non-features.mjs";

const args = process.argv.slice(2);
const at = args.indexOf("--only");
const only = at === -1 ? null : (args[at + 1] ?? null);
// The --only pair is accepted only when --only is present: with `at` at -1, `at + 1` would name
// the first position and let any token there through to the generators.
const paired = (/** @type {number} */ i) => at !== -1 && (i === at || i === at + 1);
const known = args.every((arg, i) => arg === "--check" || paired(i));
if (!known || (at !== -1 && (only === null || only.startsWith("--")))) {
  throw new Error(`usage: run.mjs [--check] [--only <name>]; got ${args.join(" ")}`);
}
const check = args.includes("--check");
process.exitCode = await runGenerators([index, nonFeatures], { check, only, commands: COMMANDS });
