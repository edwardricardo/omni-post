/**
 * @file index.ts
 * @description The shared vitest config factory. It is a PACKAGE, not a file at
 *   the repository root, and that is load-bearing rather than tidy. A relative
 *   `../../vitest.shared` resolves against the importing file's location, so any
 *   run whose working directory is a copy of the tree — a sandbox, a nested
 *   checkout, a tool that relocates the package before invoking vitest — points
 *   the specifier outside the copy and the bundler cannot resolve it, in every
 *   spelling (`.js`, `.ts`, extensionless). A PACKAGE specifier resolves through
 *   `node_modules`, which such a copy symlinks back to the real tree, so it works
 *   from inside and outside alike. Do not collapse this back into a root file.
 *
 *   Its `exports` names TypeScript SOURCE and it has no build step. This is
 *   config-time tooling: vitest configs import it before anything is compiled,
 *   and vite's bundler reads `.ts` directly. A `dist` here could only go stale.
 *
 *   Single source of truth for BOTH the shared Vitest config factory and the workspace
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
import { defineConfig, mergeConfig, type ViteUserConfig } from "vitest/config";
import type { BuiltinReporters } from "vitest/reporters";

/**
 * Walks up from a directory until it finds the monorepo root (the directory containing
 * `pnpm-workspace.yaml`). Searching for the marker rather than counting `../..` is what
 * makes this correct from a copied, nested or relocated working directory — any place
 * where a fixed relative offset silently resolves somewhere else.
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
 * The reporters this workspace installs, by name: the one typed source for them. vitest's own
 * `reporters` option accepts any string, so a misspelled name there type-checks and then loads
 * nothing. Every value here must instead be one of the names vitest exports as `BuiltinReporters`,
 * which turns a misspelling into a `tsc` error at this line. The suites under `tests/` pin the
 * exact strings at run time.
 */
const REPORTER = {
  /** Prints the file, the test name and the diff of every failure. Never conditional. */
  READABLE: "default",
  /** Turns each failure into a `::error` annotation on the GitHub Actions run. */
  ANNOTATIONS: "github-actions",
  /** Writes the machine-readable shard report the coverage-merge job reads back. */
  BLOB: "blob",
} as const satisfies Record<string, BuiltinReporters>;

/** A reporter name {@link workspaceReporters} can return, derived from the names above. */
export type WorkspaceReporterName = (typeof REPORTER)[keyof typeof REPORTER];

/**
 * The only two variables that decide a reporter. Naming them in the signature keeps a caller
 * from believing that anything else in the environment is read.
 */
export interface ReporterSignals {
  /** `"true"` on a GitHub Actions runner. */
  readonly GITHUB_ACTIONS?: string | undefined;
  /** `"true"` in a run whose blob a later merge step reads back. */
  readonly VITEST_SHARDED?: string | undefined;
}

/**
 * Decides which reporters a run installs, from the environment alone.
 *
 * This lives in configuration rather than in a command-line flag at one call site, and the
 * difference is not tidiness. A `--reporter=blob` flag REPLACES the default reporter instead of
 * adding to it, so the sharded CI job that carried that flag wrote a machine-readable blob and
 * printed nothing a human could read: a failing shard named no file, no test and no diff, and
 * the only way to see what broke was to download an artifact and merge it. Selecting here means
 * every invocation of a config that uses it — shard, merge, laptop — reports the same way.
 *
 * The comparison is against the exact string `"true"` on purpose. `"1"` and `"false"` are the
 * two spellings a hand-written workflow reaches for first, and neither is what the runner sets;
 * treating either as truthy would install a blob reporter in a run whose blob nobody collects.
 * The same exact-string test governs `VITEST_SHARDED` in `apps/api/vitest.config.ts`.
 *
 * @param env - Environment to read; injected so callers and tests stay hermetic. Defaults to
 *   `process.env`, which is the only place this module touches the ambient process.
 * @returns A fresh array, ordered `default` first, so one caller cannot mutate another's list.
 */
export function workspaceReporters(env: ReporterSignals = process.env): WorkspaceReporterName[] {
  const reporters: WorkspaceReporterName[] = [REPORTER.READABLE];
  if (env.GITHUB_ACTIONS === "true") reporters.push(REPORTER.ANNOTATIONS);
  if (env.VITEST_SHARDED === "true") reporters.push(REPORTER.BLOB);
  return reporters;
}

/**
 * Builds a Vitest config that resolves workspace specifiers to source.
 *
 * @param packageDir - The calling package directory (used to locate the monorepo root).
 * @param overrides - Package-specific config merged on top of the shared defaults.
 * @returns A Vitest `ViteUserConfig` with workspace source aliases applied.
 */
export function defineWorkspaceVitestConfig(packageDir: string, overrides: ViteUserConfig = {}) {
  const root = findMonorepoRoot(packageDir);

  // Read the caller's reporters BEFORE the base is built, because `mergeConfig` CONCATENATES
  // arrays. Deciding here rather than post-processing the merged result keeps `mergeConfig` the
  // single merge step, with nothing downstream to undo.
  const callerReporters = overrides.test?.reporters;

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
      // Named reporters for every package, derived from the environment rather than from a flag
      // at one call site — but written ONLY when the caller named none, so a package that asks
      // for `["junit"]` gets exactly that instead of `["default", "junit"]`. Replacement, not
      // concatenation, is the whole semantics of this key.
      ...(callerReporters === undefined ? { reporters: workspaceReporters() } : {}),
      // `.only` is deliberately NOT configured here. vitest already refuses a
      // committed `.only` in CI through `allowOnly`, whose default is
      // `!process.env.CI`, and the static half of the rule is fitness #32.
      // `forbidOnly` is a PLAYWRIGHT option: it appears nowhere in vitest
      // 4.1.11 — no config key, no CLI flag — so setting it guarded nothing
      // while reading like a guard. Do not reintroduce it.
    },
  });

  return mergeConfig(base, overrides);
}
