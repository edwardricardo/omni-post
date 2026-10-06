// @ts-check
/**
 * @file story-per-component-gate.mjs
 * @description The gate behind `pnpm check:stories`: every component file has a sibling story.
 *   Under each of `ROOTS`, a `.tsx` file that is not a test (`*.test.tsx`, `*.spec.tsx`) or a story
 *   is a component, and only a `<basename>.stories.tsx` in its own directory covers it.
 *
 *   A ratchet while the backfill runs: `BASELINE` holds each root's count of components without a
 *   story. A count above it fails, listing that root's uncovered files; a count below it fails as a
 *   stale baseline, lowered in the same change, so the file always states the tree. Once every
 *   count is 0 the file is deleted, and without it the gate requires 0 in every root.
 *
 *   FAIL-CLOSED: a root that is not a directory or holds no component file, and a baseline that is
 *   not an object naming exactly the roots with non-negative integer counts, each exit 1.
 *
 *   RESIDUALS. (1) A count, not a ledger: a change that gives one component its story and adds
 *   another without one keeps the count and passes; the printed list and the review of the diff
 *   are the defence (fitness #38's tradeoff). (2) A component is known by its file name, never by
 *   its content: a hook written as `use*.tsx` under a root would need a story; none exists today.
 *
 *   Usage: `node scripts/testing/story-per-component-gate.mjs`. Exit 0 when every root's count
 *   equals its baseline; 1 otherwise.
 * @layer infrastructure
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const NOT_COMPONENTS = [".test.tsx", ".spec.tsx", ".stories.tsx"];

/** The directories whose component files need a story, relative to the root: fitness #12's. */
export const ROOTS = Object.freeze([
  "packages/ui/src/components",
  "apps/client/components",
  "apps/admin/components",
]);

/** The committed count, per root, of component files without a sibling story. */
export const BASELINE = "scripts/testing/story-coverage-baseline.json";

/** @typedef {{ exitCode: number, messages: string[] }} Outcome */
/** @typedef {{ components: number, uncovered: string[] }} Scan */

/** @type {(message: string) => Outcome} */
const refuse = (message) => ({ exitCode: 1, messages: [message] });

/** @type {(name: string) => boolean} */
const isComponent = (name) =>
  name.endsWith(".tsx") && !NOT_COMPONENTS.some((suffix) => name.endsWith(suffix));

/**
 * Counts the component files under `dir` and lists, relative to `root`, those with no sibling
 * story. Dot-files, dot-directories and `node_modules` are skipped.
 *
 * @type {(root: string, dir: string) => Scan}
 */
function scan(root, dir) {
  /** @type {Scan} */
  const found = { components: 0, uncovered: [] };
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const inner = scan(root, full);
      found.components += inner.components;
      found.uncovered.push(...inner.uncovered);
    } else if (entry.isFile() && isComponent(entry.name)) {
      found.components += 1;
      if (!files.has(entry.name.replace(/\.tsx$/, ".stories.tsx"))) {
        found.uncovered.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  }
  return found;
}

/**
 * Reads the committed counts: an object naming exactly the roots, each a non-negative integer.
 *
 * @type {(file: string) => { counts: Map<string, number> } | { error: string }}
 */
function readBaseline(file) {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    return { error: `${BASELINE} could not be read as JSON: ${reason}` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: `${BASELINE} is not an object of counts per root` };
  }
  const counts = /** @type {Record<string, unknown>} */ (value);
  const missing = ROOTS.filter((scope) => !Object.hasOwn(counts, scope));
  if (missing.length > 0) return { error: `${BASELINE} has no count for ${missing.join(", ")}` };
  const unknown = Object.keys(counts).filter((key) => !ROOTS.includes(key));
  if (unknown.length > 0) return { error: `${BASELINE} names ${unknown.join(", ")}: not a root` };
  const bad = ROOTS.find((scope) => {
    const count = counts[scope];
    return typeof count !== "number" || !Number.isInteger(count) || count < 0;
  });
  if (bad !== undefined) return { error: `${BASELINE}: ${bad} is not a non-negative integer` };
  return { counts: new Map(ROOTS.map((scope) => [scope, Number(counts[scope])])) };
}

/**
 * Runs the gate over a repository root. Everything it reads lives under `root`, so the suite
 * drives the rule on fixture trees.
 *
 * @param {{ root?: string }} [input]
 * @returns {Outcome}
 */
export function runGate({ root = REPO_ROOT } = {}) {
  /** @type {Map<string, string[]>} */
  const uncovered = new Map();
  let components = 0;
  for (const scope of ROOTS) {
    const dir = path.join(root, scope);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      return refuse(`${scope} is not a directory, so nothing would be measured there`);
    }
    const found = scan(root, dir);
    if (found.components === 0) {
      return refuse(`${scope} holds no component file: a scan that reads nothing is not clean`);
    }
    components += found.components;
    uncovered.set(scope, found.uncovered.sort());
  }
  const files = (/** @type {string} */ scope) => uncovered.get(scope) ?? [];
  const hasBaseline = existsSync(path.join(root, BASELINE));
  /** @type {Map<string, number>} */
  let allowed = new Map(ROOTS.map((scope) => [scope, 0]));
  if (hasBaseline) {
    const read = readBaseline(path.join(root, BASELINE));
    if ("error" in read) return refuse(read.error);
    if (ROOTS.every((scope) => files(scope).length === 0)) {
      return refuse(
        `every component has a sibling story: delete ${BASELINE} in this change, and the gate ` +
          `requires 0 in every root from then on`
      );
    }
    allowed = read.counts;
  }
  const messages = ROOTS.flatMap((scope) => {
    const was = allowed.get(scope) ?? 0;
    const now = files(scope).length;
    const limit = hasBaseline ? `baseline ${was}` : "no baseline, so 0 is required";
    const stated = `${now} components without a sibling story, ${limit}`;
    if (now === was) return [];
    if (now < was) {
      return [`${scope}: stale baseline: ${stated}. Lower it to ${now} in ${BASELINE}`];
    }
    return [
      `${scope}: ${stated}. A new component lands with its <basename>.stories.tsx; no count ` +
        `rises to absorb one:`,
      ...files(scope).map((file) => `no sibling story: ${file}`),
    ];
  });
  if (messages.length > 0) return { exitCode: 1, messages };
  const counts = ROOTS.map((scope) => `${scope} ${files(scope).length}`).join(", ");
  const summary = hasBaseline
    ? `those without a sibling story equal ${BASELINE}: ${counts}`
    : "each with a sibling story";
  return { exitCode: 0, messages: [`${components} components; ${summary}`] };
}

/** @type {(argv: string[]) => number} */
function main(argv) {
  if (argv.length > 0) {
    process.stderr.write("usage: node scripts/testing/story-per-component-gate.mjs\n");
    return 1;
  }
  /** @type {Outcome} */
  let outcome;
  try {
    outcome = runGate();
  } catch (error) {
    outcome = refuse(`the scan failed: ${error instanceof Error ? error.message : "unknown"}`);
  }
  const stream = outcome.exitCode === 0 ? process.stdout : process.stderr;
  for (const message of outcome.messages) stream.write(`story-per-component-gate: ${message}\n`);
  return outcome.exitCode;
}

/** True only when this file is the process entry point, so importing its exports runs nothing. */
const entryPoint = process.argv[1];
if (entryPoint !== undefined && existsSync(entryPoint)) {
  if (realpathSync(entryPoint) === fileURLToPath(import.meta.url)) {
    process.exitCode = main(process.argv.slice(2));
  }
}
