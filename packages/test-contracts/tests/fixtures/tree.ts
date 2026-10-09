/**
 * @file tree.ts
 * @description Plants fixture trees for the reach engine's self-tests, under `os.tmpdir()`,
 *              outside the repository. A tree is written at run time instead of committed because
 *              its files would otherwise be tracked: a planted `x.test.ts` would be a test-shaped
 *              file of the real repository that no collector runs, and a planted
 *              `vitest.config.mjs` would be a tracked vitest config the real collector lists.
 *              Configs are plain objects with no import, so vitest loads them from a directory
 *              with no `node_modules`.
 * @layer infrastructure
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * A planted tree: its root and the repository-relative files written into it, named `tracked`
 * so a tree is itself the context a collector reads.
 */
export interface PlantedTree {
  readonly root: string;
  readonly tracked: string[];
}

/** The body every planted test file carries; the collectors under test never execute it. */
export const TEST_BODY = 'import { test } from "vitest";\ntest("planted", () => {});\n';

/**
 * @param include - The `include` globs of the config, relative to its directory.
 * @returns The source of a vitest config that collects exactly those globs.
 */
export function configCollecting(include: readonly string[]): string {
  return `export default { test: { include: ${JSON.stringify(include)} } };\n`;
}

/**
 * Writes a tree of files under a fresh directory of `os.tmpdir()`.
 *
 * @param contents - Repository-relative path → file content.
 * @returns The tree's root and its files, sorted.
 */
export function plantTree(contents: Readonly<Record<string, string>>): PlantedTree {
  const root = mkdtempSync(path.join(tmpdir(), "test-contracts-"));
  for (const [file, body] of Object.entries(contents)) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  return { root, tracked: Object.keys(contents).sort() };
}

/**
 * Deletes a planted tree.
 *
 * @param tree - The tree to delete.
 */
export function removeTree(tree: PlantedTree): void {
  rmSync(tree.root, { recursive: true, force: true });
}
