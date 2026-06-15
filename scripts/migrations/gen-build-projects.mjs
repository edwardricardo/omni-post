// canon-exception: migration:20260614
/**
 * @file gen-build-projects.mjs
 * @description One-off generator for the transpile-only production build model.
 *              Computes the runtime workspace-dependency closure of @apps/api +
 *              @apps/workers, then for every package in that closure (and the two
 *              apps) emits/updates a `tsconfig.build.json` (TS project-references
 *              project: composite, outDir ./dist, rootDir ./src, NodeNext,
 *              declaration; `references` derived from each package's own
 *              in-closure workspace dependencies — the graph is acyclic so the
 *              references form a valid DAG) and rewrites `package.json`
 *              build/main/types/exports from `src` to `dist`. Finally writes a
 *              root solution-style `tsconfig.build.json` that references every
 *              closure project so `tsc -b` builds the whole graph topologically.
 *
 *              Idempotent. Browser/Next-only packages (UI, browser-logger) and
 *              the two Next apps are NOT in the api/workers runtime closure and
 *              are therefore left untouched (Next resolves them from source via
 *              its own bundler). @infra/prisma keeps its bespoke build (it runs
 *              `prisma generate` first + includes generated/**) but is aligned
 *              to the shared exports shape and joined into the references graph.
 * @layer infrastructure
 */
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PKG_ROOTS = ["packages", "apps", "infra"];
const APPS = ["@apps/api", "@apps/workers"];
// Packages with a bespoke build that the generator must NOT overwrite, but which
// still participate in the references graph.
const BESPOKE = new Set(["@infra/prisma"]);

function findPackageJsons(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", "dist", ".next", ".stryker-tmp", "graphify-out"].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findPackageJsons(full, out);
    else if (entry === "package.json") out.push(full);
  }
  return out;
}

// 1. Load all named workspace packages.
const meta = new Map(); // name -> { dir, json, wsDeps:Set, pjPath }
for (const r of PKG_ROOTS) {
  for (const pj of findPackageJsons(join(ROOT, r))) {
    const json = JSON.parse(readFileSync(pj, "utf8"));
    if (!json.name) continue;
    const dir = dirname(pj);
    const wsDeps = new Set(
      Object.entries({ ...(json.dependencies || {}) })
        .filter(([, v]) => typeof v === "string" && v.startsWith("workspace:"))
        .map(([k]) => k),
    );
    meta.set(json.name, { dir, json, wsDeps, pjPath: pj });
  }
}

// 2. Closure from apps via PRODUCTION (runtime) workspace deps.
const closure = new Set();
function walk(name) {
  if (closure.has(name)) return;
  const m = meta.get(name);
  if (!m) return; // phantom dep with no package dir — skip
  closure.add(name);
  for (const d of m.wsDeps) walk(d);
}
for (const a of APPS) walk(a);

// 3. Per-package tsconfig.build.json + package.json rewrite.
function refPath(fromDir, toDir) {
  let rel = relative(fromDir, join(toDir, "tsconfig.build.json"));
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

let tsconfigWritten = 0;
let pkgRewritten = 0;
const buildableLibs = [];

for (const name of closure) {
  if (APPS.includes(name)) continue;
  const m = meta.get(name);
  buildableLibs.push(name);
  const refs = [...m.wsDeps]
    .filter((d) => closure.has(d) && meta.has(d))
    .sort()
    .map((d) => ({ path: refPath(m.dir, meta.get(d).dir) }));

  if (!BESPOKE.has(name)) {
    // tsconfig.build.json — honor the package's own source-level excludes so the
    // build compiles exactly the surface the package typechecks/ships in dev. A
    // package may deliberately exclude unreachable/dead subtrees (e.g.
    // @providers/facebook excludes src/analytics|features|media, which are not
    // reachable from its barrel); re-compiling them would surface latent errors
    // in code the runtime artifact never imports.
    const baseExcludes = ["node_modules", "dist", "**/*.test.ts", "**/*.test.tsx", "**/*.stories.tsx"];
    let srcExcludes = [];
    // Preserve a hand-tuned source-exclude set from a prior tsconfig.build.json
    // (e.g. @providers/facebook's precise dead-code carve-out that keeps the
    // reachable features/stories+reels while dropping unreachable subtrees).
    const existingBuildPath = join(m.dir, "tsconfig.build.json");
    if (existsSync(existingBuildPath)) {
      try {
        const prev = JSON.parse(readFileSync(existingBuildPath, "utf8"));
        srcExcludes = (prev.exclude || []).filter((ex) => /^src\//.test(ex));
      } catch {
        /* unreadable prior build config — fall through to dev-derived excludes */
      }
    }
    if (srcExcludes.length === 0) {
      const devTsconfigPath = join(m.dir, "tsconfig.json");
      if (existsSync(devTsconfigPath)) {
        try {
          const devTs = JSON.parse(readFileSync(devTsconfigPath, "utf8"));
          for (const ex of devTs.exclude || []) {
            // carry only source-tree carve-outs (under src/), never tooling globs
            if (/^src\//.test(ex)) srcExcludes.push(ex);
          }
        } catch {
          /* malformed dev tsconfig — fall back to base excludes */
        }
      }
    }
    const extendsRel = relative(m.dir, join(ROOT, "tsconfig.build.base.json")).replace(/\\/g, "/");
    const tsb = {
      extends: extendsRel.startsWith(".") ? extendsRel : "./" + extendsRel,
      compilerOptions: { outDir: "./dist", rootDir: "./src" },
      include: ["src/**/*"],
      exclude: [...baseExcludes, ...srcExcludes],
      ...(refs.length ? { references: refs } : {}),
    };
    writeFileSync(join(m.dir, "tsconfig.build.json"), JSON.stringify(tsb, null, 2) + "\n");
    tsconfigWritten++;

    // package.json: build/main/types/exports -> dist
    const j = m.json;
    j.scripts = j.scripts || {};
    j.scripts.build = "tsc -b tsconfig.build.json";
    if (!j.scripts.typecheck) j.scripts.typecheck = "tsc --noEmit";
    j.main = "./dist/index.js";
    j.types = "./dist/index.d.ts";
    const newExports = {
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    };
    // preserve subpath exports, repointed to dist
    if (j.exports && typeof j.exports === "object") {
      for (const [k, v] of Object.entries(j.exports)) {
        if (k === "." ) continue;
        if (k === "./*") { newExports["./*"] = "./dist/*"; continue; }
        // e.g. "./components/*" or "./test-utils/msw-helpers"
        if (typeof v === "string") {
          newExports[k] = v.replace(/^\.\/src\//, "./dist/").replace(/\.tsx?$/, ".js");
        }
      }
    } else {
      newExports["./*"] = "./dist/*";
    }
    j.exports = newExports;
    writeFileSync(m.pjPath, JSON.stringify(j, null, 2) + "\n");
    pkgRewritten++;
  } else {
    // bespoke (@infra/prisma): only update references in its existing tsconfig.build.json
    const tsbPath = join(m.dir, "tsconfig.build.json");
    if (existsSync(tsbPath)) {
      const tsb = JSON.parse(readFileSync(tsbPath, "utf8"));
      tsb.compilerOptions = tsb.compilerOptions || {};
      tsb.compilerOptions.composite = true;
      if (refs.length) tsb.references = refs;
      else delete tsb.references;
      writeFileSync(tsbPath, JSON.stringify(tsb, null, 2) + "\n");
      tsconfigWritten++;
    }
  }
}

// 4. Apps: tsconfig.build.json with references to their in-closure deps. package.json build handled by hand (tsup removal) elsewhere; here only emit the tsconfig + references.
for (const app of APPS) {
  const m = meta.get(app);
  const refs = [...m.wsDeps]
    .filter((d) => closure.has(d) && meta.has(d))
    .sort()
    .map((d) => ({ path: refPath(m.dir, meta.get(d).dir) }));
  const extendsRel = relative(m.dir, join(ROOT, "tsconfig.build.base.json")).replace(/\\/g, "/");
  const tsb = {
    extends: extendsRel.startsWith(".") ? extendsRel : "./" + extendsRel,
    // Apps are terminal artifacts — nothing references their emitted `.d.ts`, so
    // they are NOT composite and do not emit declarations. This avoids the
    // declaration-portability strictness (TS2742/TS4055) that only matters for
    // libraries whose public types must be nameable by dependents.
    compilerOptions: { outDir: "./dist", rootDir: "./src", composite: false, declaration: false, declarationMap: false },
    include: ["src/**/*"],
    exclude: ["node_modules", "dist", "tests", "**/*.test.ts", "**/*.test.tsx"],
    ...(refs.length ? { references: refs } : {}),
  };
  writeFileSync(join(m.dir, "tsconfig.build.json"), JSON.stringify(tsb, null, 2) + "\n");
  tsconfigWritten++;
}

// 5. Root solution-style tsconfig.build.json referencing every closure project.
const allRefs = [...closure]
  .map((n) => meta.get(n).dir)
  .sort()
  .map((dir) => ({ path: "./" + relative(ROOT, join(dir, "tsconfig.build.json")).replace(/\\/g, "/") }));
const rootSolution = {
  files: [],
  references: allRefs,
};
writeFileSync(join(ROOT, "tsconfig.build.json"), JSON.stringify(rootSolution, null, 2) + "\n");

console.log(`closure size (incl ${APPS.length} apps): ${closure.size}`);
console.log(`buildable lib packages: ${buildableLibs.length}`);
console.log(`tsconfig.build.json written/updated: ${tsconfigWritten}`);
console.log(`package.json rewritten (exports/build->dist): ${pkgRewritten}`);
console.log(`root solution tsconfig.build.json references: ${allRefs.length}`);
