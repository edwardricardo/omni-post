// canon-exception: migration:20260614
/**
 * @file add-js-extensions.mjs
 * @description One-off codemod for the transpile-only build pivot. Node ESM
 *              (moduleResolution NodeNext, the production emit target) requires
 *              explicit file extensions on relative import/export specifiers;
 *              the codebase historically omitted them because dev runs under
 *              `moduleResolution: bundler` (tsx/vitest) which tolerates the
 *              omission. This script appends the correct extension to every
 *              extensionless relative specifier, resolving each against the
 *              filesystem: `./foo` -> `./foo.js` when `foo.ts(x)` exists, or
 *              `./foo/index.js` when `foo/` is a directory with an index. It is
 *              non-breaking for dev: bundler-mode tsc and tsx both accept the
 *              explicit `.js` form on `.ts` sources (verified empirically).
 *
 *              Idempotent. Covers `import ... from`, `export ... from`,
 *              side-effect `import "..."`, and dynamic `import("...")`. Leaves
 *              specifiers that already carry an extension (.js/.json/.css/...)
 *              untouched. Type-only imports are handled identically (NodeNext
 *              still requires the extension on emitted .d.ts re-exports).
 * @layer infrastructure
 */
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("usage: node add-js-extensions.mjs <dir-or-file> [...]");
  process.exit(1);
}

/** Collect candidate .ts/.tsx files (excluding declaration + build outputs). */
function collect(target, acc) {
  const st = statSync(target);
  if (st.isFile()) {
    if (/\.(ts|tsx)$/.test(target) && !target.endsWith(".d.ts")) acc.push(target);
    return acc;
  }
  for (const entry of readDir(target)) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === ".next" ||
      entry.name === ".turbo" ||
      entry.name === ".stryker-tmp" ||
      entry.name === "coverage"
    )
      continue;
    collect(resolve(target, entry.name), acc);
  }
  return acc;
}
import { readdirSync } from "node:fs";
function readDir(d) {
  return readdirSync(d, { withFileTypes: true });
}

/**
 * Resolve the on-disk extension for a relative specifier from a source file.
 * Returns the specifier WITH extension, or null if it cannot be resolved
 * (leave untouched — likely an asset handled by a bundler/loader).
 */
function resolveSpecifier(spec, fromFile) {
  const base = resolve(dirname(fromFile), spec);
  // Already a concrete file with a known extension we should not touch.
  if (/\.(js|jsx|json|css|scss|svg|png|jpg|mjs|cjs|node)$/.test(spec)) return null;
  // Direct file match.
  for (const ext of [".ts", ".tsx"]) {
    if (existsSync(base + ext)) return spec + ".js";
  }
  // Directory with an index.
  if (existsSync(base) && statSync(base).isDirectory()) {
    for (const ext of [".ts", ".tsx"]) {
      if (existsSync(resolve(base, "index" + ext))) {
        return spec.replace(/\/?$/, "/index.js");
      }
    }
  }
  // .json data import without extension -> add .json if present.
  if (existsSync(base + ".json")) return spec + ".json";
  return null;
}

const SPEC_RE = /(\bfrom\s*|\bimport\s*|\bimport\s*\(\s*)(["'])(\.\.?\/[^"']*?)\2/g;

let filesChanged = 0;
let sitesChanged = 0;
const files = [];
for (const r of roots) collect(resolve(r), files);

for (const file of files) {
  const src = readFileSync(file, "utf8");
  let changed = false;
  const out = src.replace(SPEC_RE, (full, lead, quote, spec) => {
    const resolved = resolveSpecifier(spec, file);
    if (resolved && resolved !== spec) {
      changed = true;
      sitesChanged += 1;
      return `${lead}${quote}${resolved}${quote}`;
    }
    return full;
  });
  if (changed) {
    writeFileSync(file, out);
    filesChanged += 1;
  }
}

console.log(`add-js-extensions: ${sitesChanged} specifiers rewritten across ${filesChanged} files`);
