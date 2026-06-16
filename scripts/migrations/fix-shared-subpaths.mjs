// canon-exception: migration:20260614
/**
 * @file fix-shared-subpaths.mjs
 * @description One-off codemod for the transpile-only build pivot. The shared
 *              package is named `@shared/types`, but historically several
 *              subtrees were imported via the dev-only path alias `@shared/<x>`
 *              (`@shared/cqrs`, `@shared/events`, `@shared/saga`,
 *              `@shared/orchestration`, `@shared/analytics`) which `tsconfig`
 *              `paths` mapped to `packages/shared/src/<x>`. Under NodeNext (the
 *              production emit) those specifiers do not resolve — the scope+name
 *              is `@shared/<x>`, which is not a real package. Rewrite each to the
 *              canonical `@shared/types/<x>` form, which resolves through the
 *              package's `./*` export to `dist/<x>.js`. Specifier-string-only;
 *              idempotent (already-canonical `@shared/types/...` untouched).
 * @layer infrastructure
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("usage: node fix-shared-subpaths.mjs <dir> [...]");
  process.exit(1);
}

const SUBPATHS = ["orchestration", "analytics", "cqrs", "events", "saga"];
// Match `@shared/<sub>` (dev alias) AND the already-half-migrated
// `@shared/types/<sub>` (extensionless), normalizing both to the canonical
// `@shared/types/<sub>.js` form. NodeNext subpath-pattern exports (`./*` ->
// `./dist/*`) do NOT append extensions, so the specifier must carry `.js` to
// resolve to the emitted `dist/<sub>.js`. Never touches `@shared/types`
// (the package root) or specifiers that already end in `.js`.
const RE = new RegExp(
  `(["'])@shared/(?:types/)?(${SUBPATHS.join("|")})((?:/[^"']*?)?)(\\.js)?\\1`,
  "g"
);

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

let sites = 0;
let files = 0;
const all = [];
for (const r of roots) collect(resolve(r), all);
for (const f of all) {
  const src = readFileSync(f, "utf8");
  let n = 0;
  const out = src.replace(RE, (_m, q, sub, rest) => {
    n++;
    // Only append `.js` when the subpath resolves to a single emitted module
    // (no deeper segment). Deeper segments keep their own resolution.
    const tail = rest ? `${rest}.js` : ".js";
    return `${q}@shared/types/${sub}${tail}${q}`;
  });
  if (n > 0) {
    writeFileSync(f, out);
    sites += n;
    files++;
  }
}
console.log(`fix-shared-subpaths: ${sites} specifiers rewritten across ${files} files`);
