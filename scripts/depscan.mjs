/**
 * @file depscan.mjs
 * @description Boundary audit tool: scans every workspace package's src/ for
 *   cross-package workspace imports, maps each to the owning package by name,
 *   compares against declared dependencies, and detects cycles in the resulting
 *   package graph. Build-tooling script under scripts/ (not app/package source).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_ROOTS = ["packages", "apps", "infra"];

/** Recursively collect package.json files (skip node_modules / dist / .next). */
function findPackageJsons(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", "dist", ".next", ".stryker-tmp", "graphify-out"].includes(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) findPackageJsons(full, out);
    else if (entry === "package.json") out.push(full);
  }
  return out;
}

/** Recursively collect .ts/.tsx files under a dir. */
function findSources(dir, out = []) {
  if (!safeStat(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (["node_modules", "dist", ".next", ".stryker-tmp", "graphify-out"].includes(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) findSources(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

function safeStat(p) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

// 1. Build the set of all workspace package names (those with workspace:* somewhere or @-scoped local names).
const allPkgJsons = [];
for (const r of PKG_ROOTS) findPackageJsons(join(ROOT, r), allPkgJsons);

const nameToDir = new Map();
const pkgMeta = new Map(); // name -> {dir, deps:Set}
for (const pj of allPkgJsons) {
  const json = JSON.parse(readFileSync(pj, "utf8"));
  if (!json.name) continue;
  const dir = dirname(pj);
  nameToDir.set(json.name, dir);
  const deps = new Set([
    ...Object.keys(json.dependencies || {}),
    ...Object.keys(json.devDependencies || {}),
    ...Object.keys(json.peerDependencies || {}),
  ]);
  pkgMeta.set(json.name, { dir, deps, json });
}

const allNames = [...nameToDir.keys()].sort((a, b) => b.length - a.length); // longest-first for prefix match

/** Resolve an import specifier to an owning workspace package name, or null. */
function resolveSpecifier(spec) {
  for (const name of allNames) {
    if (spec === name || spec.startsWith(name + "/")) return name;
  }
  return null;
}

const importRe = /\bfrom\s+["']([^"']+)["']/g;

// 2. For each package, scan src imports, resolve to owning package.
const edges = new Map(); // name -> Set(depName)
const undeclared = []; // {importer, dep, sampleFile}

for (const [name, meta] of pkgMeta) {
  const srcDir = join(meta.dir, "src");
  // apps don't always have src as the only root, but packages do; for apps, scan whole dir minus excludes
  const scanDir = safeStat(srcDir) ? srcDir : meta.dir;
  const files = findSources(scanDir);
  const used = new Set();
  const usedSample = new Map();
  for (const f of files) {
    const content = readFileSync(f, "utf8");
    let m;
    while ((m = importRe.exec(content)) !== null) {
      const owner = resolveSpecifier(m[1]);
      if (owner && owner !== name) {
        used.add(owner);
        if (!usedSample.has(owner)) usedSample.set(owner, f.replace(ROOT + "/", ""));
      }
    }
  }
  edges.set(name, used);
  for (const dep of used) {
    if (!meta.deps.has(dep)) {
      undeclared.push({ importer: name, dep, sampleFile: usedSample.get(dep) });
    }
  }
}

// 3. Detect cycles among workspace packages (Tarjan-lite via DFS).
function findCycles() {
  const cycles = [];
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map();
  const stack = [];
  for (const n of edges.keys()) color.set(n, WHITE);
  function dfs(n) {
    color.set(n, GRAY);
    stack.push(n);
    for (const d of edges.get(n) || []) {
      if (!edges.has(d)) continue;
      if (color.get(d) === GRAY) {
        const idx = stack.indexOf(d);
        cycles.push(stack.slice(idx).concat(d));
      } else if (color.get(d) === WHITE) {
        dfs(d);
      }
    }
    stack.pop();
    color.set(n, BLACK);
  }
  for (const n of edges.keys()) if (color.get(n) === WHITE) dfs(n);
  return cycles;
}

const cycles = findCycles();

// Filter undeclared to the packages of interest (workspace cross-package only; skip apps importing packages — apps are not published, but still report).
console.log("=== UNDECLARED CROSS-PACKAGE EDGES (importer -> dep) ===");
const byImporter = new Map();
for (const u of undeclared) {
  if (!byImporter.has(u.importer)) byImporter.set(u.importer, []);
  byImporter.get(u.importer).push(u);
}
let undeclaredPkgCount = 0;
for (const [importer, list] of [...byImporter.entries()].sort()) {
  // Only report library packages (packages/*), not apps/*, for the "declare workspace:*" requirement.
  const isLib = pkgMeta.get(importer).dir.includes("/packages/");
  const tag = isLib ? "[LIB]" : "[APP]";
  for (const u of list) {
    console.log(`${tag} ${importer}  ->  ${u.dep}   (e.g. ${u.sampleFile})`);
    if (isLib) undeclaredPkgCount++;
  }
}
console.log(`\nUndeclared edges total: ${undeclared.length} (lib-package undeclared: ${undeclaredPkgCount})`);

console.log("\n=== CYCLES (workspace package graph) ===");
if (cycles.length === 0) console.log("none — ACYCLIC");
else for (const c of cycles) console.log(c.join(" -> "));

process.exit(0);
