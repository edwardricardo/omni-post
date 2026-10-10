/**
 * @file source-resolution.ts
 * @description The source-resolution contract's command line: every workspace package a
 *              vitest-collected test imports resolves to its `src/` (see
 *              `lib/source-resolution.ts`). It runs in a process of its own because vite decides
 *              `isProduction` from `NODE_ENV` when a config is resolved, so a check of both modes
 *              needs two processes rather than a mutation of the caller's environment. Usage:
 *              `node --conditions development --import tsx src/source-resolution.ts [--root
 *              <dir>]`, with `NODE_ENV` naming the mode. It prints one JSON report and exits 0
 *              clean, 1 on any violation or error.
 * @layer infrastructure
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { listTrackedFiles } from "./lib/disk.js";
import { checkSourceResolution, type SourceResolutionReport } from "./lib/source-resolution.js";

/**
 * Runs the check over a repository.
 *
 * @param argv - The arguments after the script path: nothing, or `--root <dir>`.
 * @returns The report and the exit code.
 */
export async function main(
  argv: readonly string[]
): Promise<{ code: number; report: SourceResolutionReport }> {
  const rootFlag = argv[0] === "--root" ? argv[1] : undefined;
  const root = realpathSync(rootFlag ?? findMonorepoRoot(import.meta.dirname));
  const tracked = listTrackedFiles(root);
  const report: SourceResolutionReport = tracked.ok
    ? await checkSourceResolution(root, tracked.value)
    : { configs: 0, checked: 0, violations: [], errors: [tracked.error.message] };
  const clean = report.violations.length === 0 && report.errors.length === 0;
  return { code: clean ? 0 : 1, report };
}

const invokedAsScript =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  const { code, report } = await main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = code;
}
