/**
 * @file vitest.shared.ts
 * @description Single source of truth for BOTH the shared Vitest config factory and the workspace
 *              `resolve.alias` map. The alias map points every workspace specifier (`@core/*`,
 *              `@adapters/*`, `@ports/*`, `@shared/*`, `@infra/*`, `@providers/*`,
 *              `@observability/*`, `@monitoring/*`, `@api-common/*`) at TypeScript SOURCE rather
 *              than the published `dist/` build. The transpile-only build model points each
 *              package's `package.json` `exports` at `./dist`, which is correct for production (the
 *              image runs compiled `.js`) but breaks tests that run from source against an unbuilt
 *              tree. These directory aliases bypass `exports` so Vite/esbuild resolves the `.ts`
 *              files directly (mapping `.js` import specifiers to their `.ts` source via Vite's
 *              extension resolution).
 *
 *              The map is derived from `tsconfig.base.json` `compilerOptions.paths` (the repo's
 *              single source of truth) so it stays in sync automatically: a new workspace alias
 *              added there is covered here with no edit. Packages call
 *              `defineWorkspaceVitestConfig(import.meta.dirname, { ...overrides })` to inherit the
 *              alias map and the standard node/forks defaults while keeping their own `include`
 *              globs, setup files, and coverage settings. Apps (`apps/api`, `apps/client`,
 *              `apps/admin`) import `findMonorepoRoot` + `buildWorkspaceAliases` directly and
 *              compose the derived workspace map with their own app-local aliases.
 * @layer infrastructure
 */
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { defineConfig, mergeConfig, type UserConfig } from "vitest/config";

/**
 * Walks up from a directory until it finds the monorepo root (the directory containing
 * `pnpm-workspace.yaml`). Handles deep sandboxes (e.g. Stryker's `.stryker-tmp/sandbox-xxx/`)
 * where the usual relative `../../` offset is wrong.
 *
 * @param startDir - Directory to begin the upward search from.
 * @returns Absolute path to the monorepo root.
 */
export function findMonorepoRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 12; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir, "../../");
}

interface TsconfigPaths {
  compilerOptions?: { paths?: Record<string, string[]> };
}

/**
 * Reads `tsconfig.base.json` and converts its `paths` into a Vitest `resolve.alias` map.
 *
 * Each `@scope/name/*` glob becomes a directory alias (`@scope/name` → `<root>/.../src`) so both
 * the bare import and every subpath resolve to source. Bare `@scope/name` entries that point at an
 * `index.ts` map directly to that file. The list is sorted longest-key-first so specific subpath
 * aliases win over their generic parents (Vite matches in array order).
 *
 * @param root - Absolute monorepo root.
 * @returns Ordered list of `{ find, replacement }` alias entries for `resolve.alias`.
 */
export function buildWorkspaceAliases(root: string): { find: string; replacement: string }[] {
  const tsconfig = JSON.parse(
    readFileSync(path.join(root, "tsconfig.base.json"), "utf8")
  ) as TsconfigPaths;
  const paths = tsconfig.compilerOptions?.paths ?? {};

  const aliases = new Map<string, string>();

  // Pass 1 — glob aliases `@x/y/*` → directory `@x/y`. A directory alias resolves BOTH the bare
  // import and every subpath to source, and lets Vite map `.js` specifiers to their `.ts` files.
  // These take precedence over the bare-index form, so they are applied first and never overwritten.
  for (const [key, targets] of Object.entries(paths)) {
    const target = targets[0];
    if (target === undefined || !key.endsWith("/*")) continue;
    const find = key.slice(0, -2);
    const replacement = target.endsWith("/*") ? target.slice(0, -2) : target;
    aliases.set(find, replacement);
  }

  // Pass 2 — bare aliases `@x/y` → index file, ONLY when no directory alias already covers them
  // (e.g. `@shared/types`, `@ports/core`, `@infra/prisma`, `@packages/api-errors`).
  for (const [key, targets] of Object.entries(paths)) {
    const target = targets[0];
    if (target === undefined || key.endsWith("/*")) continue;
    if (!aliases.has(key)) aliases.set(key, target);
  }

  const list = Array.from(aliases.entries()).map(([find, rel]) => ({
    find,
    replacement: path.join(root, rel.replace(/^\.\//, "")),
  }));

  // `@infra/prisma` must resolve to the test-only entry (`vitest-entry.ts`) instead of the
  // production `index.ts` — the Prisma 7 generated client splits Node vs browser, and the entry
  // forces the Node path. The `@infra/prisma/extensions` subpath must win over the bare alias.
  const infraExtensions = path.join(root, "infra/prisma/src/extensions");
  const infraEntry = path.join(root, "infra/prisma/src/vitest-entry.ts");
  const filtered = list.filter(
    (a) => a.find !== "@infra/prisma" && a.find !== "@infra/prisma/extensions"
  );
  filtered.push({ find: "@infra/prisma/extensions", replacement: infraExtensions });
  filtered.push({ find: "@infra/prisma", replacement: infraEntry });

  // Longest find first so specific subpath aliases match before generic parents.
  filtered.sort((a, b) => b.find.length - a.find.length);
  return filtered;
}

/**
 * Builds a Vitest config that resolves workspace specifiers to source.
 *
 * @param packageDir - The calling package directory (used to locate the monorepo root).
 * @param overrides - Package-specific config merged on top of the shared defaults.
 * @returns A Vitest `UserConfig` with workspace source aliases applied.
 */
export function defineWorkspaceVitestConfig(packageDir: string, overrides: UserConfig = {}) {
  const root = findMonorepoRoot(packageDir);

  const base = defineConfig({
    resolve: {
      alias: buildWorkspaceAliases(root),
      // Prisma 7's generated client ships both Node (`client.ts`) and browser (`browser.ts`)
      // entries; force the Node condition so the workspace alias resolves to the Node client.
      conditions: ["node"],
    },
    test: {
      environment: "node",
      globals: true,
      pool: "forks",
    },
  });

  return mergeConfig(base, overrides);
}
