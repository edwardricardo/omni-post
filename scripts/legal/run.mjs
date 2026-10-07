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
const onlyAt = args.indexOf("--only");
const only = onlyAt === -1 ? null : (args[onlyAt + 1] ?? null);
const extra = args.filter((a, i) => !["--check", "--only"].includes(a) && i !== onlyAt + 1);
// A missing or flag-shaped value after --only is a usage error, never a generator name: refusing it
// here keeps "--only --check" from being read as a request to run a generator called "--check".
const onlyMisused = onlyAt !== -1 && (only === null || only.startsWith("--"));
if (extra.length > 0 || onlyMisused) {
  const got = onlyMisused
    ? `--only needs a generator name, got ${JSON.stringify(only)}`
    : `got ${extra}`;
  throw new Error(`usage: run.mjs [--check] [--only <name>]; ${got}`);
}
process.exitCode = await runGenerators(GENERATORS, { check: args.includes("--check"), only });
