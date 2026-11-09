// @ts-check
/**
 * @file mutation-diff-register.mjs
 * @description The `--import` shim of a node:test run of the differential mutation tool: it
 *   registers `mutation-diff-hooks.mjs` as module customization hooks, handing them the path of the
 *   run's options JSON that `scripts/testing/mutation-diff.mjs` puts in `MUTATION_DIFF_OPTIONS` for
 *   the child alone. The tool passes it before `--import tsx` on purpose: Node runs the hooks
 *   registered last first, and their `nextLoad` reaches the earlier ones, so tsx's `load` runs
 *   first and transforms the TypeScript these hooks return. Node hands `--import` to every test
 *   file's child process with the rest of `execArgv`, so each file's process registers them too.
 *   Any role may run it. With the variable unset, as in the tool's own process, which imports it
 *   for its path, it registers nothing.
 * @layer infrastructure
 */
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { HOOKS_URL } from "./mutation-diff-hooks.mjs";

/** This module's absolute path, which a node:test run passes to `--import`. */
export const REGISTER_FILE = fileURLToPath(import.meta.url);

const options = process.env["MUTATION_DIFF_OPTIONS"];
if (options !== undefined) register(HOOKS_URL, { data: { options } });
