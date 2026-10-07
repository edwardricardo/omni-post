// @ts-check
/**
 * @file run.mjs
 * @description Runs the legal inventory generators. `pnpm legal:inventory` writes every page;
 *   `pnpm check:legal` (`--check`) exits 1 when a page is stale or its classification incomplete.
 *   `--only <name>` runs one generator. A new generator is registered in `GENERATORS`.
 * @layer infrastructure
 */
import { runGenerators } from "./lib/inventory.mjs";
import { generator as personalData } from "./personal-data.mjs";

/** Every registered generator, run in this order. */
const GENERATORS = [personalData];

const args = process.argv.slice(2);
const only = args.includes("--only") ? (args[args.indexOf("--only") + 1] ?? "") : null;
const extra = args.filter((a, i) => !["--check", "--only"].includes(a) && args[i - 1] !== "--only");
if (extra.length > 0) throw new Error(`usage: run.mjs [--check] [--only <name>]; got ${extra}`);
process.exitCode = await runGenerators(GENERATORS, { check: args.includes("--check"), only });
