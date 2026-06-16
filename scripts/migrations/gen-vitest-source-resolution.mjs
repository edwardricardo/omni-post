// canon-exception: migration:20260615
/**
 * @file gen-vitest-source-resolution.mjs
 * @description One-off codemod for the transpile-only build pivot. The build model points each
 *              package's `package.json` `exports` at `./dist`, which is correct for production but
 *              breaks the test runners: `vitest run` executes from SOURCE against an unbuilt tree,
 *              so `@core/X/sub/Thing.js` resolves via `exports` -> `dist` -> ERR_MODULE_NOT_FOUND.
 *              The fix is a workspace-wide Vitest `resolve.alias` map (built from `tsconfig.base.json`
 *              `paths`) that points every workspace specifier at `.ts` source, bypassing `exports`.
 *
 *              This codemod writes/normalizes a `vitest.config.ts` for every package that runs
 *              `vitest`, delegating to the shared `defineWorkspaceVitestConfig` factory while
 *              preserving each package's own `test`-block options (the `test: { ... }` object literal
 *              extracted verbatim from any pre-existing config; a sensible `include` default is used
 *              when no config exists). Idempotent: re-running regenerates identical files.
 * @layer infrastructure
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

/**
 * Packages that run vitest. Discovered by scanning workspace globs for a vitest `test` script.
 * `apps/*` are intentionally excluded: each app already carries a complete, hand-tuned vitest
 * config (full source-alias map, coverage thresholds, sharding hooks, env setup) and was never
 * affected by the exports->dist regression. Regenerating them would drop their bespoke imports.
 */
const WORKSPACE_GLOBS = [
  "packages",
  "packages/providers",
  "packages/adapters",
  "packages/core",
  "packages/monitoring",
  "packages/observability",
];

/**
 * Lists immediate subdirectories of a workspace glob root that contain a package.json.
 *
 * @param {string} globRoot - Relative workspace glob root (e.g. "packages/core").
 * @returns {string[]} Relative package directories.
 */
function listPackages(globRoot) {
  const abs = join(ROOT, globRoot);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const name of readdirSync(abs)) {
    const dir = join(abs, name);
    if (!statSync(dir).isDirectory()) continue;
    if (existsSync(join(dir, "package.json"))) out.push(relative(ROOT, dir));
  }
  return out;
}

/**
 * Extracts the `test: { ... }` object-literal body from an existing vitest config source.
 * Uses brace-balancing from the `test:` key so nested objects (coverage, poolOptions) survive.
 *
 * @param {string} src - Existing config file source.
 * @returns {string | undefined} The inner body of the `test` object (without braces), or undefined.
 */
function extractTestBlock(src) {
  const m = src.match(/\btest\s*:\s*\{/);
  if (!m) return undefined;
  const open = src.indexOf("{", m.index);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i).trim();
    }
  }
  return undefined;
}

/**
 * Detects whether a package's tests include `.tsx` files (jsdom/component tests).
 *
 * @param {string} pkgDir - Absolute package directory.
 * @returns {boolean} True when at least one `*.test.tsx` exists under tests/.
 */
function hasTsxTests(pkgDir) {
  const testsDir = join(pkgDir, "tests");
  if (!existsSync(testsDir)) return false;
  const stack = [testsDir];
  while (stack.length) {
    const d = stack.pop();
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) stack.push(p);
      else if (name.endsWith(".test.tsx")) return true;
    }
  }
  return false;
}

/**
 * Builds the relative import path from a package dir to the root `vitest.shared.js`.
 *
 * @param {string} pkgDirRel - Package directory relative to root.
 * @returns {string} POSIX relative import specifier.
 */
function sharedImport(pkgDirRel) {
  const rel = relative(join(ROOT, pkgDirRel), ROOT) || ".";
  const posix = rel.split(/[\\/]/).join("/");
  return `${posix}/vitest.shared.js`;
}

let created = 0;
let rewritten = 0;
const touched = [];

for (const glob of WORKSPACE_GLOBS) {
  for (const pkgDirRel of listPackages(glob)) {
    const pkgDir = join(ROOT, pkgDirRel);
    const pj = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    const testScript = pj.scripts?.test ?? "";
    if (!/vitest/.test(testScript)) continue;

    const configPath = join(pkgDir, "vitest.config.ts");
    const existed = existsSync(configPath);

    let testBody;
    if (existed) {
      testBody = extractTestBlock(readFileSync(configPath, "utf8"));
    }
    if (testBody === undefined) {
      const include = hasTsxTests(pkgDir)
        ? `["tests/**/*.test.ts", "tests/**/*.test.tsx"]`
        : `["tests/**/*.test.ts"]`;
      testBody = `    include: ${include},`;
    }

    const importSpecifier = sharedImport(pkgDirRel);
    const content = `/**
 * @file vitest.config.ts
 * @description Vitest config for ${pj.name}. Delegates to the shared workspace factory so
 *              \`@core/*\` and the other workspace specifiers resolve to TypeScript SOURCE (not the
 *              production \`dist/\` \`exports\` target) when tests run against an unbuilt tree.
 * @layer infrastructure
 */
import { defineWorkspaceVitestConfig } from "${importSpecifier}";

export default defineWorkspaceVitestConfig(import.meta.dirname, {
  test: {
${testBody}
  },
});
`;

    writeFileSync(configPath, content, "utf8");
    touched.push(pkgDirRel);
    if (existed) rewritten++;
    else created++;
  }
}

console.log(`vitest source-resolution: ${created} created, ${rewritten} rewritten`);
for (const t of touched.sort()) console.log(`  ${t}`);
