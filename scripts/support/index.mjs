// @ts-check
/**
 * @file index.mjs
 * @description Checks each `docs/support/<feature>.md` against the contract of `_TEMPLATE.md` and
 *   renders one row of `docs/support/README.md` per doc. The front matter grammar and the generic
 *   checks live in `lib/front-matter.mjs`; this module holds the contract: the keys, statuses and
 *   eight sections, the stamp line and the `legal` references. A missing directory or template is
 *   a scope error; zero docs renders an empty index. Nothing is time-based, and `generate` prints
 *   how many docs it read.
 * @layer infrastructure
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, renderInventory, sha256Of } from "../legal/lib/inventory.mjs";
import { headingsOf, isCommitSha, isIsoDate, keyProblems } from "./lib/front-matter.mjs";
import { parseFrontMatter, pathProblem, sectionProblem } from "./lib/front-matter.mjs";

export const DIR = "docs/support";
export const PAGE = `${DIR}/README.md`;
export const TEMPLATE = `${DIR}/_TEMPLATE.md`;
export const COMPANIONS = ["README.md", "_TEMPLATE.md", "NON_FEATURES.md", "EXCEPTIONS.md"];
const write = "pnpm support:index";
export const COMMANDS = { label: "support-docs", write, check: "pnpm check:support" };
export const KEYS = ["feature", "owner", "status", "verified", "paths", "covers", "legal"];
export const STATUSES = ["live", "partial", "planned"];
export const SECTIONS = [
  "What it does for the user",
  "How it works end to end",
  "Where to look when a ticket opens",
  "Known failure modes",
  "Configuration",
  "Data and privacy",
  "Related documents",
  "Verification",
];
const REGISTER = "docs/legal/REGISTER.md";
const INTRO = [
  "One page per support-facing feature: how it works today, by code path, and where an operator looks when a ticket opens. Each page lists the code it describes in `paths`, so a change to that code shows which page to re-read.",
  "## What this directory is not\n\nTarget behaviour lives in `docs/features/` and the ADRs, the endpoint reference in `docs/api/`, alert procedures in `docs/runbooks/` and legal facts in `docs/legal/`. A support page links them and never repeats them.",
  "## Writing a support page\n\n1. Copy `_TEMPLATE.md` to `<feature>.md`, a kebab-case slug that its `feature` key repeats.\n2. Fill the front matter: `owner`, `status` (`live`, `partial` or `planned`), the `verified` stamp (`sha`, `date`, `by`), the `paths` it describes, the capabilities it `covers` and its `legal` references (`register:<N>` for a section of the register, `<inventory>:<row key>` for an inventory row, or `none`).\n3. Write the eight sections in the template's order; `## Verification` holds the one line `Last verified against main <sha> on <date> by <who>`, equal to the stamp.\n4. Run `pnpm support:index` and commit the regenerated pages.",
  "## What the check verifies\n\n`pnpm check:support` refuses a support page that misses a template key or adds one, has an unknown status, a stamp that is no 40-hex sha, `YYYY-MM-DD` date and author, a `paths` entry that does not exist, a repeated capability, a `legal` reference that names no register section or inventory row, or headings other than the eight in order; and it refuses this page when it differs from the one regenerated. It reads structure only: no date is compared with today and no commit is counted.",
];

/** @typedef {import("../legal/lib/inventory.mjs").Inventory & { docs?: number }} Built */

/** @type {(root: string, ref: string) => boolean} whether it names a register section or an inventory row */
function resolves(root, ref) {
  const [, kind = "", key = ""] = /^([a-z-]+):(.+)$/.exec(ref) ?? [];
  const page = kind === "register" ? REGISTER : `docs/legal/inventories/${kind}.generated.md`;
  if (kind === "" || !existsSync(path.join(root, page))) return false;
  const text = readFileSync(path.join(root, page), "utf8");
  return text.includes(kind === "register" ? `\n## ${key}. ` : `\`${key}\``);
}

/**
 * Checks one support doc against the template and returns its row of the index.
 * @type {(root: string, file: string, text: string) => { row: string[], problems: string[] }}
 */
export function readDoc(root, file, text) {
  const { data, body, problems } = parseFrontMatter(file, text);
  const say = (/** @type {string} */ problem) => problems.push(`${file}: ${problem}`);
  const get = (/** @type {string} */ key) => data.get(key);
  const str = (/** @type {string} */ key) => (typeof get(key) === "string" ? String(get(key)) : "");
  const list = (/** @type {string} */ k) => [get(k)].flat(1).filter((v) => typeof v === "string");
  const slug = path.basename(file, ".md");
  const value = get("verified");
  /** @type {Record<string, string>} */
  const stamp = typeof value === "object" && !Array.isArray(value) ? value : {};
  const { sha = "", date = "", by = "" } = stamp;
  const [paths, covers, refs] = [list("paths"), list("covers"), list("legal")];
  const none = refs.join() === "none";
  const distinct = new Set(covers).size === covers.length && !covers.includes("");
  const stampKeys = Object.keys(stamp).sort().join() === "by,date,sha" && by !== "";
  /** @type {Array<[string, boolean, string]>} */
  const rules = [
    ["feature", str("feature") === slug, `is "${str("feature")}", not the file name ${slug}`],
    ["owner", str("owner") !== "", "is empty"],
    ["status", STATUSES.includes(str("status")), `is "${str("status")}", not live|partial|planned`],
    ["verified", stampKeys, "must hold sha, date and by, and no other key"],
    ["verified", isCommitSha(sha), `sha "${sha}" is no 40-hex commit`],
    ["verified", isIsoDate(date), `date "${date}" is no YYYY-MM-DD date`],
    ["paths", paths.length > 0 && paths.join() !== "", "is no list of paths"],
    ["covers", covers.length > 0 && distinct, "is no list of distinct capabilities"],
    ["legal", none || (refs.length > 0 && !refs.includes("none")), "is no list nor none"],
  ];
  keyProblems(data.keys(), KEYS).forEach(say);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) say("the file name is no kebab-case slug");
  for (const [key, ok, why] of rules) if (data.has(key) && !ok) say(`${key} ${why}`);
  paths.flatMap((entry) => pathProblem(root, entry) ?? []).forEach((why) => say(`paths: ${why}`));
  const dangling = none ? [] : refs.filter((ref) => !resolves(root, ref));
  dangling.forEach((ref) => say(`legal ${ref} names no register section or inventory row`));
  const headings = headingsOf(body);
  const order = sectionProblem(
    headings.map(({ title }) => title),
    SECTIONS
  );
  const line = `Last verified against main ${sha} on ${date} by ${by}`;
  const last = body.slice((headings.at(-1)?.index ?? 0) + 1).filter((l) => l.trim() !== "");
  if (order !== null) say(order);
  else if (last.join("\n") !== line) say(`## Verification must be the one line "${line}"`);
  const [link, verified] = [`[${slug}](${slug}.md)`, `\`${sha.slice(0, 10)}\` on ${date} by ${by}`];
  const row = [link, str("status"), verified, covers.join("; "), refs.join(", "), str("owner")];
  return { row, problems };
}

/** @type {(text: string) => string[]} how the template drifts from `KEYS` and `SECTIONS` */
export function templateProblems(text) {
  const { data, body, problems } = parseFrontMatter(TEMPLATE, text);
  const keys = [...data.keys()].join(", ");
  if (keys !== KEYS.join(", ")) problems.push(`${TEMPLATE}: its keys ${keys} are not ${KEYS}`);
  const order = sectionProblem(
    headingsOf(body).map(({ title }) => title),
    SECTIONS
  );
  return order === null ? problems : [...problems, `${TEMPLATE}: ${order}`];
}

/** @type {(root: string) => string[]} the repo-relative support docs, sorted; no companion page */
export const listDocs = (root) =>
  readdirSync(path.join(root, DIR), { withFileTypes: true })
    .filter((item) => item.isFile() && item.name.endsWith(".md"))
    .flatMap((item) => (COMPANIONS.includes(item.name) ? [] : [`${DIR}/${item.name}`]))
    .sort();

/** @type {(options?: { root?: string }) => Promise<Built>} reads the support docs and renders the index */
export async function buildIndex({ root = REPO_ROOT } = {}) {
  const missing = [DIR, TEMPLATE].find((file) => !existsSync(path.join(root, file)));
  if (missing !== undefined) {
    const scopeError = `${missing} does not exist: an index without its contract is not clean`;
    return { pagePath: PAGE, markdown: "", problems: [], scopeError };
  }
  const read = (/** @type {string} */ file) => readFileSync(path.join(root, file), "utf8");
  const docs = listDocs(root).map((file) => readDoc(root, file, read(file)));
  const problems = [...templateProblems(read(TEMPLATE)), ...docs.flatMap((doc) => doc.problems)];
  const rows = docs.map(({ row }) => row);
  const count = (/** @type {string} */ status) => rows.filter((row) => row[1] === status).length;
  const markdown = await renderInventory({
    title: "Support documentation",
    intro: INTRO,
    generatorPath: "scripts/support/index.mjs",
    pagePath: PAGE,
    sources: { [`${DIR}/*.md`]: sha256Of(rows.map((row) => row.join("\t")).join("\n")) },
    summary: Object.fromEntries(STATUSES.map((status) => [status, count(status)])),
    columns: ["Feature", "Status", "Verified", "Covers", "Legal", "Owner"],
    rows,
    commands: COMMANDS,
    heading: "Index",
  });
  return { pagePath: PAGE, markdown, problems, docs: rows.length };
}

/** @type {import("../legal/lib/inventory.mjs").Generator} */
export const generator = {
  name: "index",
  generate: async (/** @type {{ root?: string }} */ options = {}) => {
    const built = await buildIndex(options);
    if (!built.scopeError)
      process.stdout.write(`support-docs index: support docs read: ${built.docs}\n`);
    return built;
  },
};
