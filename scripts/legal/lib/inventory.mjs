// @ts-check
/**
 * @file inventory.mjs
 * @description The library of the legal inventory generators run by `scripts/legal/run.mjs`: it
 *   validates a classification file, renders a page through Prettier, compares it with the
 *   committed one and runs the generators. A page carries the sha256 prefix of each source and no
 *   timestamp, so a clean checkout regenerates it byte for byte. A generator that read nothing
 *   reports a scope error, which exits 1 in both modes rather than rendering a clean inventory.
 * @layer infrastructure
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** @typedef {{ status: string, category?: string, subject?: string, note: string, manual?: boolean }} Entry */
/** @typedef {{ statuses: readonly string[], categories: readonly string[], subjects: readonly string[] }} Allowed */
/** @typedef {{ entries: Map<string, Entry>, pendingBaseline: number, problems: string[], text: string }} Classification */
/** @typedef {{ pagePath: string, markdown: string, problems: string[], scopeError?: string }} Inventory */
/** @typedef {{ name: string, generate: () => Promise<Inventory> }} Generator */
/** @typedef {{ title: string, intro: string[], generatorPath: string, pagePath: string, sources: Record<string, string>, summary: Record<string, number>, columns: string[], rows: string[][] }} Page */

/** @type {(value: unknown) => value is Record<string, unknown>} */
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const NONE = /** @type {Record<string, unknown>} */ (Object.freeze({}));
const ENTRY_KEYS = ["status", "category", "subject", "note", "manual"];

/** @type {(text: string) => string} */
export const sha256Of = (text) => createHash("sha256").update(text).digest("hex").slice(0, 12);

/**
 * Reads `{ pendingBaseline, entries: { "<Model.field>": Entry } }`. Every entry needs a valid
 * status and a note; a `personal` one also needs a category and a subject. `manual` is `true` or
 * absent, and a key outside `Entry` is refused, so a misspelt field never reads as a valid entry.
 * @type {(root: string, file: string, allowed: Allowed) => Classification}
 */
export function loadClassification(root, file, { statuses, categories, subjects }) {
  const target = path.join(root, file);
  const text = existsSync(target) ? readFileSync(target, "utf8") : "";
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    const problem = `${file} is not JSON: ${error instanceof Error ? error.message : error}`;
    return { entries: new Map(), pendingBaseline: 0, problems: [problem], text };
  }
  const { pendingBaseline, entries } = isObject(data) ? data : NONE;
  const raw = isObject(entries) ? entries : NONE;
  const problems = raw === entries ? [] : [`${file} holds no object of entries`];
  if (!Number.isInteger(pendingBaseline) || Number(pendingBaseline) < 0) {
    problems.push(`${file}: pendingBaseline is not a non-negative integer`);
  }
  /** @type {(key: string, field: string, value: unknown, allowed: readonly string[]) => unknown} */
  const oneOf = (key, field, value, allowed) =>
    allowed.includes(String(value)) ||
    problems.push(
      `${file}: ${key} has ${field} ${JSON.stringify(value)}, not ${allowed.join("|")}`
    );
  for (const [key, entry] of Object.entries(raw)) {
    const fields = isObject(entry) ? entry : NONE;
    const { status, category, subject, note, manual } = fields;
    const personal = status === "personal";
    const unknown = Object.keys(fields).filter((name) => !ENTRY_KEYS.includes(name));
    if (unknown.length > 0) problems.push(`${file}: ${key} has unknown keys ${unknown.join(", ")}`);
    if (manual !== undefined && manual !== true) {
      problems.push(`${file}: ${key} has manual ${JSON.stringify(manual)}, not true or absent`);
    }
    oneOf(key, "status", status, statuses);
    if (personal || category !== undefined) oneOf(key, "category", category, categories);
    if (personal || subject !== undefined) oneOf(key, "subject", subject, subjects);
    if (typeof note !== "string" || note === "") problems.push(`${file}: ${key} has no note`);
  }
  const sorted = Object.keys(raw).sort();
  const map = new Map(sorted.map((key) => [key, /** @type {Entry} */ (raw[key])]));
  return { entries: map, pendingBaseline: Number(pendingBaseline) || 0, problems, text };
}

/**
 * Renders a page through the repository's Prettier configuration (`.editorconfig` included, as the
 * CLI reads it), so the page is already what the pre-commit formatter writes.
 *
 * @type {(page: Page) => Promise<string>}
 */
export async function renderInventory(page) {
  const cell = (/** @type {string} */ text) => text.replaceAll("|", "\\|").replaceAll("\n", " ");
  /** @type {(head: string[], body: string[][]) => string} */
  const table = (head, body) =>
    [head, head.map(() => "---"), ...body].map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n");
  const from = Object.entries(page.sources).map(([file, sha]) => `\`${file}\` (sha256 \`${sha}\`)`);
  const generated =
    `> Generated by \`${page.generatorPath}\` from ${from.join(" and ")}; never edit it by hand. ` +
    "`pnpm legal:inventory` regenerates it and `pnpm check:legal` fails when it is stale.";
  const counts = Object.entries(page.summary).map(([measure, count]) => [measure, `${count}`]);
  const summary = table(["Measure", "Count"], counts);
  const body = [`# ${page.title}`, ...page.intro, generated, "## Summary", summary, "## Inventory"];
  const markdown = [...body, table(page.columns, page.rows)].join("\n\n");
  const target = path.join(REPO_ROOT, page.pagePath);
  const config = await prettier.resolveConfig(target, { editorconfig: true });
  return prettier.format(markdown, { ...config, parser: "markdown" });
}

/** @type {(input: Inventory & { root?: string }) => { ok: boolean, problems: string[] }} */
export function checkInventory({ root = REPO_ROOT, pagePath, markdown, problems }) {
  const file = path.join(root, pagePath);
  const committed = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (committed === markdown) return { ok: problems.length === 0, problems };
  const stale = committed === null ? "is missing" : "differs from the regenerated page";
  return { ok: false, problems: [...problems, `${pagePath} ${stale}: run pnpm legal:inventory`] };
}

/**
 * Writes every page, or with `check` compares each with the committed one; every problem prints
 * as `legal-inventory <name>: <problem>` and makes the exit code 1.
 * @type {(generators: Generator[], options?: { check?: boolean, only?: string | null, root?: string }) => Promise<number>}
 */
export async function runGenerators(generators, options = {}) {
  const { check = false, only = null, root = REPO_ROOT } = options;
  const selected = generators.filter((generator) => only === null || generator.name === only);
  let exitCode = selected.length === 0 ? 1 : 0;
  if (exitCode === 1) process.stderr.write(`legal-inventory: no generator is named ${only}\n`);
  for (const { name, generate } of selected) {
    /** @type {(line: string, failed?: boolean) => void} */
    const say = (line, failed = true) => {
      (failed ? process.stderr : process.stdout).write(`legal-inventory ${name}: ${line}\n`);
      if (failed) exitCode = 1;
    };
    const inventory = await generate();
    if (inventory.scopeError !== undefined) {
      say(`scope error: ${inventory.scopeError}`);
    } else if (check) {
      const verdict = checkInventory({ root, ...inventory });
      verdict.problems.forEach((problem) => say(problem));
      if (verdict.ok) say(`${inventory.pagePath} is current`, false);
    } else {
      mkdirSync(path.dirname(path.join(root, inventory.pagePath)), { recursive: true });
      writeFileSync(path.join(root, inventory.pagePath), inventory.markdown);
      say(`wrote ${inventory.pagePath}`, false);
      inventory.problems.forEach((problem) => say(problem));
    }
  }
  return exitCode;
}
