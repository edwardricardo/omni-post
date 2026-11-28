// @ts-check
/**
 * @file inventory.mjs
 * @description The generator of `pnpm check:deployment`: every name the tree asks an operator to
 *   provide (each `vars.X` and `secrets.X` a workflow of `.github/workflows/` reads and each
 *   variable of the four environment schemas), joined with the table rows of
 *   `docs/deployment/DEPLOYMENT_CHECKLIST.md` that name it and with
 *   `docs/deployment/classification/names.json`, and rendered as
 *   `docs/deployment/DEPLOYMENT_INVENTORY.md`. A missing schema, checklist or workflow directory,
 *   a schema that yields no name and a workflow directory that holds no workflow are a scope
 *   error; an entry of the workflow directory that cannot be read as a file and a workflow that
 *   reads `vars` or `secrets` through a form that names none are a problem, and a workflow that
 *   reads no name is none. The schemas are read from their syntax tree and never
 *   imported, an import is followed through `tsconfig.base.json` and never out of the tree or into
 *   an environment file, a citation is followed through its links before its file is opened, and
 *   only names leave a source: the page and every line printed carry no value. The page holds no
 *   count per source; `generate` prints those. Classification loading,
 *   rendering and hashing come from the inventory library under `scripts/legal/lib/`, which the
 *   legal, support and deployment generators share.
 * @layer infrastructure
 */
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  REPO_ROOT,
  loadClassification,
  renderInventory,
  sha256Of,
} from "../legal/lib/inventory.mjs";
import { citationsOf, tableRows } from "./lib/checklist.mjs";
import { schemaNames } from "./lib/schema-names.mjs";
import { workflowReferences } from "./lib/workflow-references.mjs";

const CHECKLIST = "docs/deployment/DEPLOYMENT_CHECKLIST.md";
const CLASSIFICATION = "docs/deployment/classification/names.json";
const PAGE = "docs/deployment/DEPLOYMENT_INVENTORY.md";
const WORKFLOWS = ".github/workflows";
const SCHEMAS = Object.freeze([
  "apps/api/src/config/env.ts",
  "apps/workers/src/config/env.ts",
  "apps/admin/lib/env.ts",
  "apps/client/lib/env.ts",
]);
export const COMMANDS = Object.freeze({
  label: "deployment-checklist",
  write: "pnpm deployment:inventory",
  check: "pnpm check:deployment",
});
const STATUSES = ["exempt", "pending", "shorthand"];
// `false` makes `row` not required by `loadClassification`: a known key, non-empty when present.
// This module requires it on a `shorthand` entry and refuses it on an entry of any other status.
const ALLOWED = {
  statuses: STATUSES,
  categories: [],
  subjects: [],
  extraFields: { row: false },
  optionalNote: ["pending", "shorthand"],
};
const ENV_FILE = /(?:^|\/)\.env(?:\.|$)/;
const WORKFLOW_FILE = /\.ya?ml$/;
const NONE = "—";
const ABOUT = [
  "- **What a name is.** A key of the `server`, `client` or `shared` block of the `createEnv` call of `apps/api/src/config/env.ts`, `apps/workers/src/config/env.ts`, `apps/admin/lib/env.ts` or `apps/client/lib/env.ts`, read from the module's syntax tree with every spread followed to the module that declares it; and a `vars.X` or `secrets.X`, or its index form `secrets['X']`, anywhere in the whole text of a workflow of `.github/workflows/`, its comments included, and inside an expression (a `${{ … }}` span or an `if:` condition) the same with whitespace, line breaks or wrapping parentheses around the context, such as `secrets . X` or `(secrets)['X']`.",
  "- **How it is held.** A table row of the checklist that names it in a code span holds it, and the row's heading is its section here. A name no row names is classified in `docs/deployment/classification/names.json`: `shorthand` with the `row` that names in full another member of its family, which shares a prefix with it and writes its own suffix in a code span (`PLATFORM_ENCRYPTION_KEY_V1`, `_V2` and `_V3`); `exempt` with the reason no row is owed; or `pending` until its row is written. `pendingBaseline` equals the pending count, so it falls with every row written and a new name cannot land unclassified.",
  "- **What else the check holds.** Every `path:line` and `path:a-b` citation of the checklist names, by its path from the root and through any link, a file of the repository that has those lines. A citation of an environment file, written or reached through a link, is refused and never read. A workflow that reads `vars` or `secrets` with no name (`secrets: inherit`, `toJSON(secrets)`, `secrets.*`, an index that is no string literal, or inside an expression a context that resolves to no name) fails the check, since what it reads cannot be listed.",
];

/** @typedef {import("../legal/lib/inventory.mjs").Entry & { row?: string }} Classified */
/** @typedef {import("../legal/lib/inventory.mjs").Inventory & { summary?: string }} Built */
/** @typedef {import("./lib/schema-names.mjs").LoadModule} LoadModule */
/** @typedef {{ names: Map<string, string[]>, problems: string[], scope: string[], counts: Record<string, number> }} Derived */

/** The failures that mean a path names nothing of the kind read: none, no directory, a directory, a link loop. */
const ABSENT = new Set(["ENOENT", "ENOTDIR", "EISDIR", "ELOOP"]);

/**
 * What a read answers when its path names nothing of the kind it reads, `null`, and any other
 * failure rethrown. The read itself answers, so nothing is checked first and read after.
 * @type {<T>(read: () => T) => T | null}
 */
function readOrNull(read) {
  try {
    return read();
  } catch (error) {
    const code = error instanceof Error ? /** @type {NodeJS.ErrnoException} */ (error).code : "";
    if (ABSENT.has(String(code))) return null;
    throw error;
  }
}

/** @type {(root: string, file: string) => string | null} a file's text, `null` when it is none */
const readText = (root, file) => readOrNull(() => readFileSync(path.join(root, file), "utf8"));

/** @type {(root: string, file: string) => boolean} whether a path, its links followed, is a file; it is not opened */
const isFile = (root, file) => readOrNull(() => statSync(path.join(root, file)).isFile()) === true;

/** @type {(root: string, dir: string) => string[] | null} a directory's entries, `null` when it is none */
const entriesOf = (root, dir) => readOrNull(() => readdirSync(path.join(root, dir)).sort());

/**
 * Resolves an import of a schema as the tree's TypeScript resolves it, through the `paths` of
 * `tsconfig.base.json`, to a module of the tree: never one outside it, under `node_modules` or
 * named as an environment file.
 * @type {(root: string) => LoadModule}
 */
function moduleLoader(root) {
  const config = ts.readConfigFile(path.join(root, "tsconfig.base.json"), ts.sys.readFile).config;
  const compilerOptions =
    typeof config === "object" && config !== null ? config.compilerOptions : {};
  const parsed = ts.parseJsonConfigFileContent({ compilerOptions, files: [] }, ts.sys, root);
  return (specifier, from) => {
    const resolution = ts.resolveModuleName(
      specifier,
      path.join(root, from),
      parsed.options,
      ts.sys
    );
    const resolved = resolution.resolvedModule;
    if (resolved === undefined || resolved.isExternalLibraryImport) return null;
    const file = path.relative(root, resolved.resolvedFileName).split(path.sep).join("/");
    if (file.startsWith("../") || path.isAbsolute(file) || ENV_FILE.test(file)) return null;
    const text = readText(root, file);
    return text === null ? null : { file, text };
  };
}

/**
 * Every name the tree reads, sorted, each with the sorted files that read it: a schema's path,
 * or a workflow's path followed by the context it reads, `(vars)` or `(secrets)`.
 * @param {string} root - The repository root.
 * @returns {Derived} the names, what a reader could not read, each reason of a scope error, the counts
 */
function deriveNames(root) {
  /** @type {Map<string, Set<string>>} */
  const sources = new Map();
  /** @type {string[]} */
  const [problems, scope] = [[], []];
  /** @type {Record<string, Set<string>>} */
  const kinds = { vars: new Set(), secrets: new Set(), schemas: new Set() };
  /** @type {(name: string, source: string, kind: string) => void} */
  const add = (name, source, kind) => {
    sources.set(name, (sources.get(name) ?? new Set()).add(source));
    kinds[kind]?.add(name);
  };
  const load = moduleLoader(root);
  for (const file of SCHEMAS) {
    const text = readText(root, file);
    const found = text === null ? { names: [], problems: [] } : schemaNames({ file, text }, load);
    if (text === null) scope.push(`${file} does not exist`);
    else if (found.names.length === 0) scope.push(`${file} yielded no name`);
    found.names.forEach((name) => add(name, file, "schemas"));
    problems.push(...found.problems);
  }
  const listed = entriesOf(root, WORKFLOWS);
  if (listed === null) scope.push(`${WORKFLOWS} does not exist`);
  else if (!listed.some((name) => WORKFLOW_FILE.test(name)))
    scope.push(`${WORKFLOWS} holds no workflow`);
  for (const name of listed ?? []) {
    const file = `${WORKFLOWS}/${name}`;
    // A workflow is read for its names; any other entry is only stat'ed, so a file that is no
    // workflow is never opened, and an entry that is no file still fails the check.
    const text = WORKFLOW_FILE.test(name) ? readText(root, file) : isFile(root, file) ? "" : null;
    if (text === null) {
      problems.push(
        `${file} cannot be read as a file: an entry the check cannot read is not clean`
      );
      continue;
    }
    const references = workflowReferences(text);
    references.vars.forEach((found) => add(found, `${file} (vars)`, "vars"));
    references.secrets.forEach((found) => add(found, `${file} (secrets)`, "secrets"));
    for (const { line, context, form } of references.nameless)
      problems.push(
        `${file}:${line} reads ${context} through \`${form}\`, which names none: a read the check cannot name is not clean`
      );
  }
  const names = new Map(
    [...sources.keys()].sort().map((name) => [name, [...(sources.get(name) ?? [])].sort()])
  );
  const counts = Object.fromEntries(Object.entries(kinds).map(([kind, set]) => [kind, set.size]));
  return { names, problems, scope, counts };
}

/** @type {(text: string) => number} the lines of a text, a final newline ending the last one */
const lineCount = (text) =>
  text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

/** @type {(relative: string) => boolean} whether a path relative to the root leaves it */
const leaves = (relative) =>
  relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);

/**
 * One problem per citation of the checklist that does not resolve: a path outside the tree or an
 * environment file, as written or where its links land (refused before the file is opened), no
 * range, no file, or a file shorter than the range. A file is opened at the real path that was
 * checked, never at the path as written.
 * @type {(root: string, text: string) => string[]}
 */
function citationProblems(root, text) {
  /** @type {Map<string, number | null>} */
  const lines = new Map();
  const realRoot = realpathSync(root);
  const outside = (/** @type {string} */ cites) => [`${cites}, a path outside the repository`];
  const environment = (/** @type {string} */ cites) => [
    `${cites}, an environment file this check never reads`,
  ];
  return citationsOf(text).flatMap(({ line, path: file, from, to }) => {
    const range = from === to ? `${from}` : `${from}-${to}`;
    const cites = `${CHECKLIST}:${line} cites ${file}:${range}`;
    const normalized = path.posix.normalize(file);
    if (normalized.startsWith("../") || path.posix.isAbsolute(normalized)) return outside(cites);
    if (ENV_FILE.test(normalized)) return environment(cites);
    if (from < 1 || to < from) return [`${cites}, which is no range of lines`];
    const real = readOrNull(() => realpathSync(path.join(root, normalized)));
    if (real === null) return [`${cites}, which is no file of the repository`];
    const landed = path.relative(realRoot, real);
    if (leaves(landed)) return outside(cites);
    if (ENV_FILE.test(landed.split(path.sep).join("/"))) return environment(cites);
    if (!lines.has(real)) {
      const content = readOrNull(() => readFileSync(real, "utf8"));
      lines.set(real, content === null ? null : lineCount(content));
    }
    const count = lines.get(real) ?? null;
    if (count === null) return [`${cites}, which is no file of the repository`];
    return to > count ? [`${cites}, which has ${count} lines`] : [];
  });
}

/**
 * What refuses a `shorthand` entry: no `row`; a `row` no table row names; a `row` that shares no
 * prefix of whole words with the name, so the two are no family; or no row naming `row` that
 * writes the name's own suffix in a code span. The declaration says which row; the suffix the
 * row must write is the part of the name after the prefix the two share, never guessed from a
 * range the row writes in prose.
 * @type {(name: string, row: string | undefined, rows: import("./lib/checklist.mjs").Row[]) => string[]}
 */
function shorthandProblems(name, row, rows) {
  if (row === undefined) return [`${name} is shorthand and names no row`];
  const naming = rows.filter(({ words }) => words.has(row));
  if (naming.length === 0) return [`${name} is shorthand for ${row}, which no checklist row names`];
  const [own, theirs] = [name.split("_"), row.split("_")];
  let shared = 0;
  while (shared < own.length - 1 && own[shared] === theirs[shared]) shared += 1;
  if (shared === 0) return [`${name} is shorthand for ${row}, but the two names share no prefix`];
  const suffix = `_${own.slice(shared).join("_")}`;
  if (naming.some(({ words }) => words.has(suffix))) return [];
  return [`${name} is shorthand for ${row}, but no row that names ${row} writes ${suffix}`];
}

/** @type {(source: string) => string} a source in a cell: the path in code, its context after it */
const sourceCell = (source) => source.replace(/^(\S+)/, "`$1`");
const code = (/** @type {string} */ text) => `\`${text}\``;

/**
 * Derives the names, joins them with the checklist and the classification, and renders the page.
 * @param {{ root?: string }} [options] - The repository root, the real one by default.
 * @returns {Promise<Built>} the page, the problems, and the counts `generate` prints
 */
async function buildDeploymentInventory({ root = REPO_ROOT } = {}) {
  const classification = loadClassification(root, CLASSIFICATION, ALLOWED);
  const derived = deriveNames(root);
  const checklist = readText(root, CHECKLIST);
  const scope =
    checklist === null ? [`${CHECKLIST} does not exist`, ...derived.scope] : derived.scope;
  const problems = [...classification.problems, ...derived.problems];
  if (scope.length > 0) {
    const scopeError = `${scope.join("; ")}: a scan that cannot read its whole scope is not clean`;
    return { pagePath: PAGE, markdown: "", problems, scopeError };
  }
  const text = checklist ?? "";
  const rows = tableRows(text);
  const entries = /** @type {Map<string, Classified>} */ (classification.entries);
  const sectionsOf = (/** @type {string} */ name) => [
    ...new Set(rows.filter(({ words }) => words.has(name)).map(({ section }) => section)),
  ];
  const statusOf = (/** @type {string} */ name) =>
    sectionsOf(name).length > 0 ? "named" : (entries.get(name)?.status ?? "unclassified");
  const names = [...derived.names.keys()];
  for (const name of names.filter((n) => statusOf(n) === "unclassified"))
    problems.push(
      `${name} has no row in the checklist and no entry in ${CLASSIFICATION}: name it in a row or classify it`
    );
  for (const [name, { status, row, note }] of entries) {
    if (!derived.names.has(name))
      problems.push(`${name} is classified but the tree reads no such name`);
    else if (statusOf(name) === "named")
      problems.push(
        `${name} is classified ${status}, but a checklist row names it: drop its entry`
      );
    if (typeof note === "string" && note !== "" && note.trim() === "")
      problems.push(`${CLASSIFICATION}: ${name} has no note`);
    if (status === "shorthand") problems.push(...shorthandProblems(name, row, rows));
    else if (row !== undefined)
      problems.push(`${name}: row belongs on a shorthand entry, and only there`);
  }
  const { pendingBaseline } = classification;
  const pending = names.filter((name) => statusOf(name) === "pending").length;
  if (pending > pendingBaseline)
    problems.push(`${pending} pending exceed pendingBaseline ${pendingBaseline}`);
  if (pending < pendingBaseline)
    problems.push(`stale pendingBaseline ${pendingBaseline}: lower it to ${pending}`);
  problems.push(...citationProblems(root, text));
  const checklistCell = (/** @type {string} */ name) => {
    const row = entries.get(name)?.row;
    if (statusOf(name) === "shorthand" && row !== undefined)
      return `${sectionsOf(row).join(", ") || NONE}, as ${code(row)}`;
    return sectionsOf(name).join(", ") || NONE;
  };
  const classificationCell = (/** @type {string} */ name) => {
    const note = statusOf(name) === "named" ? undefined : entries.get(name)?.note;
    return note === undefined ? statusOf(name) : `${statusOf(name)}: ${note}`;
  };
  const measures = ["named", ...STATUSES, "unclassified"];
  const markdown = await renderInventory({
    title: "Deployment inventory",
    intro: [
      "Every name the tree asks an operator to provide: each `vars.X` and `secrets.X` a workflow of `.github/workflows/` reads, and each variable of the four environment schemas. Each row says which files read it, which section of the [deployment checklist](DEPLOYMENT_CHECKLIST.md) names it and how it is classified. A pending name has no row in the checklist.",
      "## About this page",
      ABOUT.join("\n"),
    ],
    generatorPath: "scripts/deployment/inventory.mjs",
    pagePath: PAGE,
    sources: {
      "derived names": sha256Of(
        names.map((name) => `${name} ${derived.names.get(name)?.join(" ")}`).join("\n")
      ),
      [CLASSIFICATION]: sha256Of(classification.text),
    },
    summary: Object.fromEntries([
      ["names the tree reads", names.length],
      ...measures.map((measure) => [measure, names.filter((n) => statusOf(n) === measure).length]),
    ]),
    columns: ["Name", "Read by", "Checklist", "Classification"],
    rows: names.map((name) => [
      code(name),
      (derived.names.get(name) ?? []).map(sourceCell).join(", "),
      checklistCell(name),
      classificationCell(name),
    ]),
    commands: COMMANDS,
    heading: "Names",
  });
  const { vars = 0, secrets = 0, schemas = 0 } = derived.counts;
  const cited = citationsOf(text).length;
  const summary = `${names.length} names (${vars} vars, ${secrets} secrets, ${schemas} in the schemas), ${cited} citations`;
  return { pagePath: PAGE, markdown, problems, summary };
}

/** @type {import("../legal/lib/inventory.mjs").Generator} */
export const generator = {
  name: "inventory",
  generate: async (/** @type {{ root?: string }} */ options = {}) => {
    const built = await buildDeploymentInventory(options);
    if (built.summary !== undefined)
      process.stdout.write(`${COMMANDS.label} inventory: ${built.summary}\n`);
    return built;
  },
};
