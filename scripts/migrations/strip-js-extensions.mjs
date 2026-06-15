// canon-exception: migration:20260615
/**
 * @file strip-js-extensions.mjs
 * @description One-off codemod — the inverse of add-js-extensions.mjs — for
 *              bundler-compiled FRONTEND code only. Turbopack (and Next's
 *              `moduleResolution: bundler`) cannot resolve a `.js` specifier
 *              back to its `.ts`/`.tsx` source (Next issue #82945, no config
 *              knob), so the NodeNext `.js` convention that is correct for the
 *              backend (api, workers, @core/*, NodeNext-built packages) is WRONG
 *              for the frontend, where source is consumed extensionless. The
 *              path-agnostic add-js-extensions sweep wrongly added `.js` to
 *              frontend sources; this script strips it back off.
 *
 *              It removes the trailing `.js` from a RELATIVE import/export
 *              specifier (`import ... from "./x.js"`, `export * from "./x.js"`,
 *              `export { y } from "../z.js"`, side-effect `import "./x.js"`,
 *              dynamic `import("./x.js")`) ONLY when the real on-disk target is a
 *              `.ts`/`.tsx` sibling (`./x.ts` or `./x.tsx`) — i.e. the `.js` was
 *              a NodeNext alias for a TS source, never an actual emitted/checked
 *              `.js` file. A specifier whose `.js` points at a genuine `.js`
 *              file on disk is left untouched (those resolve fine under bundler
 *              resolution and stripping them would break the import).
 *
 *              Directory-index specifiers (`./x/index.js`) are also handled:
 *              `./x/index.js` -> `./x` when `./x/index.ts(x)` exists and no
 *              real `./x/index.js` file is present.
 *
 *              Idempotent. Run ONLY on verified frontend-only roots — never on
 *              backend / NodeNext code whose `.js` is required by the dist emit.
 * @layer infrastructure
 */
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("usage: node strip-js-extensions.mjs <dir-or-file> [...]");
  process.exit(1);
}

/** Collect candidate .ts/.tsx files (excluding declaration + build outputs). */
function collect(target, acc) {
  const st = statSync(target);
  if (st.isFile()) {
    if (/\.(ts|tsx)$/.test(target) && !target.endsWith(".d.ts")) acc.push(target);
    return acc;
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
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

/**
 * Given a relative specifier ending in `.js` and the source file it appears in,
 * return the stripped specifier when (and only when) the `.js` is a NodeNext
 * alias for a real `.ts`/`.tsx` source. Return null to leave it untouched
 * (real `.js` target, or unresolvable — likely an asset/loader path).
 */
function stripSpecifier(spec, fromFile) {
  // Only relative specifiers that end in `.js`.
  if (!/^\.\.?\//.test(spec) || !spec.endsWith(".js")) return null;

  const withoutJs = spec.slice(0, -".js".length);
  const baseAbs = resolve(dirname(fromFile), withoutJs);

  // Direct-file case: `./x.js` aliasing `./x.ts` or `./x.tsx`.
  // Handle the `./x/index.js` directory-index case separately below.
  const isIndex = /(^|\/)index$/.test(withoutJs);

  if (!isIndex) {
    // If a REAL sibling `.js` file exists on disk, the specifier targets it —
    // never strip (bundler resolves it directly; stripping breaks the import).
    if (existsSync(baseAbs + ".js")) return null;
    for (const ext of [".ts", ".tsx"]) {
      if (existsSync(baseAbs + ext)) return withoutJs;
    }
    return null;
  }

  // Directory-index case: `./dir/index.js` -> `./dir`.
  // Only collapse when the real index source is `.ts(x)` and there is no
  // genuine `index.js` file.
  if (existsSync(baseAbs + ".js")) return null;
  const dirAbs = dirname(baseAbs); // strips the trailing `/index`
  const dirRel = withoutJs.replace(/\/?index$/, "");
  for (const ext of [".ts", ".tsx"]) {
    if (existsSync(resolve(dirAbs, "index" + ext))) {
      // Preserve `./` vs `../` vs `./x/...`; collapse `./x/index.js` to `./x`.
      // If the directory portion is empty (specifier was `./index.js`), the
      // result is `.` which TS/bundler resolve to the current dir's index.
      return dirRel === "" || dirRel === "." || dirRel === ".." ? dirRel || "." : dirRel;
    }
  }
  return null;
}

const SPEC_RE = /(\bfrom\s*|\bimport\s*|\bimport\s*\(\s*)(["'])(\.\.?\/[^"']*?)\2/g;

let filesChanged = 0;
let sitesChanged = 0;
const perRoot = {};
for (const r of roots) {
  const rootAbs = resolve(r);
  const files = [];
  collect(rootAbs, files);
  let rootSites = 0;
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    let changed = false;
    const out = src.replace(SPEC_RE, (full, lead, quote, spec) => {
      const stripped = stripSpecifier(spec, file);
      if (stripped !== null && stripped !== spec) {
        changed = true;
        sitesChanged += 1;
        rootSites += 1;
        return `${lead}${quote}${stripped}${quote}`;
      }
      return full;
    });
    if (changed) {
      writeFileSync(file, out);
      filesChanged += 1;
    }
  }
  perRoot[r] = rootSites;
}

for (const [r, n] of Object.entries(perRoot)) {
  console.log(`strip-js-extensions: ${n} specifiers stripped in ${r}`);
}
console.log(
  `strip-js-extensions: ${sitesChanged} specifiers stripped across ${filesChanged} files (total)`
);
