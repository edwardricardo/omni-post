// canon-exception: migration:20260614
/**
 * @file fix-ioredis-import.mjs
 * @description One-off codemod for the transpile-only build pivot. ioredis is a
 *              CommonJS package whose default export, under NodeNext module
 *              resolution, is seen by TypeScript as a namespace object rather
 *              than the constructable `Redis` class — so `import Redis from
 *              "ioredis"` yields TS2709 ("Cannot use namespace 'Redis' as a
 *              type") and TS2351 ("not constructable"). `bundler` resolution
 *              (dev/tsx/vitest) tolerated the default form. The canonical
 *              NodeNext-safe form is the named import `import { Redis } from
 *              "ioredis"` (ioredis re-exports the class as a named `Redis`).
 *              Rewrites `import Redis from "ioredis"` -> `import { Redis } from
 *              "ioredis"` and `import type Redis from "ioredis"` -> `import type
 *              { Redis } from "ioredis"`. Idempotent; the already-named form is
 *              left untouched. Specifier value+type usages of `Redis` are
 *              unchanged (the binding name stays `Redis`).
 * @layer infrastructure
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("usage: node fix-ioredis-import.mjs <dir> [...]");
  process.exit(1);
}

function collect(target, acc) {
  const st = statSync(target);
  if (st.isFile()) {
    if (/\.(ts|tsx)$/.test(target) && !target.endsWith(".d.ts")) acc.push(target);
    return acc;
  }
  for (const e of readdirSync(target, { withFileTypes: true })) {
    if (["node_modules", "dist", ".next", ".turbo", ".stryker-tmp", "coverage"].includes(e.name))
      continue;
    collect(resolve(target, e.name), acc);
  }
  return acc;
}

// `import Redis from "ioredis"` and `import type Redis from "ioredis"`.
const RE = /import\s+(type\s+)?Redis\s+from\s+(["'])ioredis\2/g;

let sites = 0;
let files = 0;
const all = [];
for (const r of roots) collect(resolve(r), all);
for (const f of all) {
  const src = readFileSync(f, "utf8");
  let n = 0;
  const out = src.replace(RE, (_m, typeKw, q) => {
    n++;
    return `import ${typeKw ? "type " : ""}{ Redis } from ${q}ioredis${q}`;
  });
  if (n > 0) {
    writeFileSync(f, out);
    sites += n;
    files++;
  }
}
console.log(`fix-ioredis-import: ${sites} imports rewritten across ${files} files`);
