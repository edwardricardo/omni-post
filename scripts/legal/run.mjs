// @ts-check
/**
 * @file run.mjs
 * @description Runs the legal inventory generators. `pnpm legal:inventory` writes every page;
 *   `pnpm check:legal` (`--check`) exits 1 when a page is stale or its classification incomplete.
 *   `--only <name>` runs one generator. A new generator is registered in `GENERATORS`.
 * @layer infrastructure
 */
import { runGenerators } from "./lib/inventory.mjs";
import { generator as cookiesAndStorage } from "./cookies-and-storage.mjs";
import { generator as oauthScopes } from "./oauth-scopes.mjs";
import { generator as personalData } from "./personal-data.mjs";
import { generator as subprocessors } from "./subprocessors.mjs";

/** Every registered generator, run in this order. */
const GENERATORS = [personalData, cookiesAndStorage, oauthScopes, subprocessors];

const args = process.argv.slice(2);
const onlyAt = args.indexOf("--only");
const only = onlyAt === -1 ? null : (args[onlyAt + 1] ?? null);
// Only the token after a present --only is exempt; with --only absent no position is, so an unknown
// first token cannot slip through as the value of an --only that was never given.
const onlyValueAt = onlyAt === -1 ? -1 : onlyAt + 1;
const extra = args.filter((a, i) => !["--check", "--only"].includes(a) && i !== onlyValueAt);
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
