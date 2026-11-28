// @ts-check
/**
 * @file run.mjs
 * @description Runs the deployment inventory generator with the deployment commands:
 *   `pnpm deployment:inventory` writes `docs/deployment/DEPLOYMENT_INVENTORY.md`, and
 *   `pnpm check:deployment` (`--check`) exits 1 when that page is stale, a name the tree reads is
 *   held by neither a checklist row nor the classification, the pending count is off its
 *   baseline, or a citation of the checklist does not resolve.
 * @layer infrastructure
 */
import { runGenerators } from "../legal/lib/inventory.mjs";
import { COMMANDS, generator } from "./inventory.mjs";

const args = process.argv.slice(2);
if (!args.every((arg) => arg === "--check") || args.length > 1) {
  throw new Error(`usage: run.mjs [--check]; got ${args.join(" ")}`);
}
process.exitCode = await runGenerators([generator], {
  check: args.length === 1,
  commands: COMMANDS,
});
