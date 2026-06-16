// canon-exception: migration:20260616
/**
 * @file add-development-condition.mjs
 * @description One-off codemod for the dev/prod resolution-model fix
 *              (change `dev-prod-resolution-model`, on PR #91). The
 *              transpile-only pivot (ADR-0017) flipped every workspace package's
 *              `package.json` `exports` to point UNCONDITIONALLY at `./dist`.
 *              That is correct for the production image (which builds `dist`
 *              first) but leaks a production decision into dev/test/CI, where
 *              `dist` is not built — so any Node-family source consumer (`tsx`,
 *              `node --import tsx --test`) that touches a workspace package by
 *              its bare specifier against an unbuilt tree fails with
 *              `ERR_MODULE_NOT_FOUND .../dist/...`.
 *
 *              This script adds a strictly-additive `development`->`src` branch
 *              to every dist-pointing `exports` entry, ordered FIRST (Node key
 *              order is significant: most-specific first, `default` always
 *              LAST). The branch is inert in production: it is only selected
 *              when a consumer opts in via `--conditions development` on the
 *              invocation (the four core conditions node/default/import/require
 *              always apply and are never removed). Mirrored on the root `.`
 *              AND every subpath the package publishes.
 *
 *              dist->src rule: strip `dist/` then map the extension —
 *              `dist/index.js`->`src/index.ts`, `dist/*.d.ts` stays as the
 *              `types` key (dist), `dist/*`->`src/*`. The ONE exception is
 *              `@infra/prisma`, which emits to `dist/src/*`: strip `dist/src/`
 *              ->`src/` (`dist/src/index.js`->`src/index.ts`,
 *              `dist/src/extensions/*`->`src/extensions/*`).
 *
 *              Skip-list (left untouched):
 *                - packages with NO `exports` (src-only `main`/`types`, or apps)
 *                - packages whose `exports` already point at `src` (src-only
 *                  frontend pkgs — no dist to map from)
 *                - `@shared/types` (the B-NEXT Turbopack boundary — MUST stay
 *                  dist-only; Turbopack ignores custom export conditions)
 *                - any entry that already carries a `development` key
 *                  (idempotency)
 *
 *              Idempotent: re-running is a no-op once every dist entry carries
 *              `development`. Edits `package.json` `exports` only; never touches
 *              import statements (so fitness #26 stays at zero).
 * @layer infrastructure
 */
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const roots = process.argv.length > 2 ? process.argv.slice(2) : ["packages", "infra"];

/**
 * The B-NEXT boundary package — consumed as `dist` by Turbopack (Option B),
 * MUST keep its `exports` dist-only. Excluded from the codemod by name.
 */
const SKIP_BY_NAME = new Set(["@shared/types"]);

const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  ".stryker-tmp",
  ".stryker",
  "coverage",
  ".git",
]);

/**
 * Derive the `development`->`src` target from a dist-pointing target string.
 * Returns `null` when the target does not point at `dist` (already src, or some
 * other shape we should not rewrite).
 *
 * @param {string} target - an `exports` target string, e.g. `./dist/index.js`
 * @returns {string|null} the src-pointing target, e.g. `./src/index.ts`
 */
function distToSrc(target) {
  if (typeof target !== "string") return null;
  if (!target.includes("/dist/") && !target.startsWith("./dist")) return null;

  // `@infra/prisma` exception: emits to `dist/src/*` — strip `dist/src/`->`src/`.
  let mapped = target.replace(/\.\/dist\/src\//, "./src/");
  // General case: strip `dist/`->`src/`.
  mapped = mapped.replace(/\.\/dist\//, "./src/");

  // Map the extension: compiled `.js` -> source `.ts`. `.d.ts` declaration
  // files are never a `development` target (they stay as the dist `types` key).
  if (mapped.endsWith(".js")) mapped = mapped.slice(0, -3) + ".ts";

  return mapped;
}

/**
 * Rewrite a single `exports` entry to add the `development`->`src` branch,
 * ordered first. Handles both string entries (`"./dist/*"`) and object entries
 * (`{ types, default }`).
 *
 * @param {string|object} entry - the value of one `exports` key
 * @returns {{value: string|object, changed: boolean}} rewritten entry + flag
 */
function rewriteEntry(entry) {
  // String subpath entry, e.g. `"./*": "./dist/*"` ->
  //   `{ "development": "./src/*", "default": "./dist/*" }`.
  if (typeof entry === "string") {
    const dev = distToSrc(entry);
    if (dev === null) return { value: entry, changed: false };
    return { value: { development: dev, default: entry }, changed: true };
  }

  if (entry && typeof entry === "object") {
    // Idempotency: already carries `development` -> skip.
    if ("development" in entry) return { value: entry, changed: false };

    // Derive src from the `default` (preferred) or `types` target.
    const distTarget =
      typeof entry.default === "string"
        ? entry.default
        : typeof entry.types === "string"
          ? entry.types.replace(/\.d\.ts$/, ".js")
          : null;
    const dev = distTarget === null ? null : distToSrc(distTarget);
    if (dev === null) return { value: entry, changed: false };

    // Rebuild with key order: development -> types -> default (default LAST).
    /** @type {Record<string, unknown>} */
    const next = { development: dev };
    for (const [k, v] of Object.entries(entry)) {
      if (k === "default") continue; // re-added last
      next[k] = v;
    }
    if ("default" in entry) next.default = entry.default;
    return { value: next, changed: true };
  }

  return { value: entry, changed: false };
}

/**
 * Process a package's `exports` object, mirroring the development branch on the
 * root `.` and every subpath.
 *
 * @param {object} exportsObj - the `exports` object
 * @returns {{exports: object, changed: number}} new exports + count of entries changed
 */
function rewriteExports(exportsObj) {
  /** @type {Record<string, unknown>} */
  const next = {};
  let changed = 0;
  for (const [key, entry] of Object.entries(exportsObj)) {
    const { value, changed: did } = rewriteEntry(entry);
    next[key] = value;
    if (did) changed++;
  }
  return { exports: next, changed };
}

/**
 * Decide whether a package's exports are dist-pointing (codemod target) or
 * already src-only (skip).
 *
 * @param {object} exportsObj
 * @returns {boolean} true when at least one target points at `dist`
 */
function hasDistTarget(exportsObj) {
  const targets = [];
  const walk = (v) => {
    if (typeof v === "string") targets.push(v);
    else if (v && typeof v === "object") for (const k of Object.keys(v)) walk(v[k]);
  };
  walk(exportsObj);
  return targets.some((t) => t.includes("/dist/") || t.startsWith("./dist"));
}

/**
 * Recursively collect workspace `package.json` paths under a root.
 *
 * @param {string} dir
 * @param {string[]} acc
 * @returns {string[]}
 */
function collectPackageJsons(dir, acc) {
  let st;
  try {
    st = statSync(dir);
  } catch {
    return acc;
  }
  if (st.isFile()) {
    if (basename(dir) === "package.json") acc.push(dir);
    return acc;
  }
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && IGNORE_DIRS.has(e.name)) continue;
    collectPackageJsons(join(dir, e.name), acc);
  }
  return acc;
}

const files = [];
for (const r of roots) collectPackageJsons(resolve(r), files);

const summary = { rewritten: [], skipped: [] };

for (const file of files.sort()) {
  const raw = readFileSync(file, "utf8");
  const pkg = JSON.parse(raw);
  const name = pkg.name || "(unnamed)";

  if (!pkg.exports || typeof pkg.exports !== "object") {
    summary.skipped.push(`${name} (no exports)`);
    continue;
  }
  if (SKIP_BY_NAME.has(name)) {
    summary.skipped.push(`${name} (B-NEXT boundary — must stay dist-only)`);
    continue;
  }
  if (!hasDistTarget(pkg.exports)) {
    summary.skipped.push(`${name} (already src-only exports)`);
    continue;
  }

  const { exports: nextExports, changed } = rewriteExports(pkg.exports);
  if (changed === 0) {
    summary.skipped.push(`${name} (already has development on all entries)`);
    continue;
  }

  pkg.exports = nextExports;
  // Preserve trailing newline if present (most package.json files have one).
  const trailing = raw.endsWith("\n") ? "\n" : "";
  writeFileSync(file, JSON.stringify(pkg, null, 2) + trailing);
  summary.rewritten.push(`${name}  (+${changed} ${changed === 1 ? "entry" : "entries"})`);
}

console.log(`add-development-condition: rewrote ${summary.rewritten.length} package(s)`);
for (const s of summary.rewritten) console.log(`  ✓ ${s}`);
console.log(`skipped ${summary.skipped.length} package(s):`);
for (const s of summary.skipped) console.log(`  · ${s}`);
