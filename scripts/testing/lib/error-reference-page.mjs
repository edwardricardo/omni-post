// @ts-check
/**
 * @file error-reference-page.mjs
 * @description Renders `docs/api/ERROR_CODES.md`, the reference page of the error registry
 *   (ADR-0047): every code by domain, with its category, its status, its developer message, its
 *   parameters and the portals that can receive it, then the existing sites the `errors/` lint
 *   rules still count, per context, at their birth and now, and every row of their history. The
 *   registry gate writes it with `--write` and fails when the committed page is not what this
 *   module renders (its rule R9). The page is rendered through the repository's Prettier
 *   configuration, so it is already what the formatter writes and `prettier --check` leaves it.
 *
 *   The module reads nothing: the gate hands it the domains it loaded and the history it read, so
 *   one reader of each source exists.
 * @layer infrastructure
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

/** The page, relative to the root. */
export const PAGE = "docs/api/ERROR_CODES.md";
/** The command that rewrites the page. */
export const WRITE_COMMAND = "node scripts/testing/error-registry-gate.mjs --write";
/** The command that fails when the page is stale. */
export const CHECK_COMMAND = "node scripts/testing/error-registry-gate.mjs";

const GENERATOR = "scripts/testing/error-registry-gate.mjs";
const HISTORY = "scripts/testing/error-sites-history/";
/** The repository this module lives in, whose Prettier configuration the page is written with. */
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const NONE = "None.";

/**
 * @typedef {object} PageCode One entry of a table, as the registry holds it.
 * @property {string} code
 * @property {unknown} category
 * @property {unknown} status
 * @property {unknown} message
 * @property {unknown} params
 * @property {unknown} fronts
 */

/**
 * @typedef {object} PageDomain
 * @property {string} name
 * @property {PageCode[]} codes
 */

/**
 * @typedef {object} PageMove
 * @property {string} from
 * @property {string} to
 * @property {number} count
 */

/**
 * @typedef {object} PageRow One row of the history.
 * @property {string} file The row's file, relative to the root.
 * @property {{ rule: string, contexts: Record<string, number> } | undefined} born
 * @property {Record<string, number> | undefined} fixed
 * @property {PageMove[] | undefined} moved
 */

/**
 * @typedef {object} PageSites The history and the state it yields.
 * @property {PageRow[]} rows
 * @property {ReadonlyMap<string, number>} births The count per context the births hold.
 * @property {ReadonlyMap<string, number>} now The count per context the whole history yields.
 */

/**
 * @description Writes text as one table cell: a line break becomes a space, and every character
 *   Markdown would read as syntax is escaped, so a message shows as written: `&` would start an
 *   entity (`&amp;` renders as `&`) and `~` a strikethrough.
 * @param {string} text The text.
 * @returns {string} The cell.
 */
function cell(text) {
  return text.replace(/\r\n|\r|\n/g, " ").replace(/[\\`*_[\]<>|&~]/g, "\\$&");
}

/**
 * @description Writes a name as code, or as escaped text when it holds a backtick.
 * @param {string} name The name.
 * @returns {string} The cell.
 */
function code(name) {
  return name.includes("`") || name === "" ? cell(name) : `\`${name}\``;
}

/**
 * @description Writes any value as a cell: a string as text, anything else as JSON.
 * @param {unknown} value The value.
 * @returns {string} The cell.
 */
function text(value) {
  if (typeof value === "string") return cell(value);
  return cell(JSON.stringify(value) ?? String(value));
}

/**
 * @description Renders a Markdown table, or `None.` when it has no row, so an empty section never
 *   reads as a header waiting for rows.
 * @param {string[]} head The header.
 * @param {string[][]} body The rows, as cells.
 * @returns {string} The table.
 */
function table(head, body) {
  if (body.length === 0) return NONE;
  return [head, head.map(() => "---"), ...body].map((row) => `| ${row.join(" | ")} |`).join("\n");
}

/**
 * @description A code's parameters: each name with its kind.
 * @param {unknown} params The entry's `params`.
 * @returns {string} The cell.
 */
function parametersOf(params) {
  if (params === null || typeof params !== "object" || Array.isArray(params)) return text(params);
  const entries = Object.entries(params);
  if (entries.length === 0) return "none";
  return entries.map(([name, kind]) => `${code(name)} (${text(kind)})`).join(", ");
}

/**
 * @description The portals that can receive a code.
 * @param {unknown} fronts The entry's `fronts`.
 * @returns {string} The cell: the portals, or `logs only` when no portal receives it.
 */
function portalsOf(fronts) {
  if (!Array.isArray(fronts)) return text(fronts);
  return fronts.length === 0 ? "logs only" : fronts.map((front) => text(front)).join(", ");
}

/**
 * @description Sums the values of a count object.
 * @param {Record<string, number> | ReadonlyMap<string, number>} counts The counts.
 * @returns {number} Their sum.
 */
function total(counts) {
  const values = counts instanceof Map ? [...counts.values()] : Object.values(counts);
  return values.reduce((sum, count) => sum + count, 0);
}

/**
 * @description What one row of the history did, as two cells: what it fixed (or the birth it
 *   holds) and what it moved.
 * @param {PageRow} row The row.
 * @returns {[string, string]} The cells.
 */
function changeOf(row) {
  const fixed =
    row.born !== undefined
      ? `birth of ${code(row.born.rule)}: ${String(total(row.born.contexts))} sites`
      : Object.entries(row.fixed ?? {})
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([context, count]) => `${String(count)} in ${code(context)}`)
          .join(", ") || "none";
  const moved =
    (row.moved ?? [])
      .map((move) => `${String(move.count)} from ${code(move.from)} to ${code(move.to)}`)
      .join(", ") || "none";
  return [fixed, moved];
}

/**
 * @description The section on existing sites: the counts per context at the birth and now, and
 *   every row of the history in name order.
 * @param {PageSites | null} sites The history and its state, or null when there is no history.
 * @returns {string[]} The section's blocks.
 */
function sitesSection(sites) {
  if (sites === null) {
    return [
      "## Existing sites",
      `None yet: no \`errors/\` lint rule has been turned on, so ${HISTORY} does not exist and no existing site is counted.`,
    ];
  }
  const rules = [...new Set(sites.rows.flatMap((row) => (row.born ? [row.born.rule] : [])))].sort();
  const contexts = [...new Set([...sites.births.keys(), ...sites.now.keys()])].sort();
  const counts = contexts.map((context) => [
    code(context),
    String(sites.births.get(context) ?? 0),
    String(sites.now.get(context) ?? 0),
  ]);
  if (counts.length > 0) {
    counts.push(["**Total**", String(total(sites.births)), String(total(sites.now))]);
  }
  const rows = [...sites.rows]
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    .map((row) => [code(path.posix.basename(row.file)), ...changeOf(row)]);
  return [
    "## Existing sites",
    `The sites ${rules.map(code).join(" and ") || "no rule"} counted when ${rules.length === 1 ? "it was" : "they were"} turned on, per context: how many there were at the birth and how many still build or answer an error outside the registry now. The list only shrinks: \`scripts/testing/error-sites-gate.mjs\` refuses a rise, and each row of ${HISTORY} records what one change fixed or moved.`,
    table(["Context", "At the birth", "Now"], counts),
    "### Rows",
    table(["Row", "Fixed", "Moved"], rows),
  ];
}

/**
 * @description Renders the reference page from the registry's domains and the history of existing
 *   sites, through the repository's Prettier configuration.
 * @param {{ domains: PageDomain[], sites: PageSites | null }} input The domains, each with its
 *   codes, and the history with its state, or null when there is no history.
 * @returns {Promise<string>} The page, as the committed file must hold it.
 */
export async function renderReferencePage({ domains, sites }) {
  const ordered = [...domains].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const codeCount = ordered.reduce((sum, domain) => sum + domain.codes.length, 0);
  const summary = ordered.map((domain) => [code(domain.name), String(domain.codes.length)]);
  if (summary.length > 0) summary.push(["**Total**", String(codeCount)]);
  const blocks = [
    "# Error codes",
    "Every code of the error registry, `packages/shared/src/error-registry/`, by domain: its category, the status the API answers with it, the message developers and logs read, the parameters it carries and the portals that can receive it. A portal shows its own catalog's text for a code (`errorCodes.<CODE>`), never this message.",
    `> Generated by \`${GENERATOR}\` from the error registry and ${HISTORY}; never edit it by hand. \`${WRITE_COMMAND}\` regenerates it and \`${CHECK_COMMAND}\` fails when it is stale.`,
    "## Summary",
    table(["Domain", "Codes"], summary),
    ...ordered.flatMap((domain) => [
      `## Domain ${code(domain.name)}`,
      table(
        ["Code", "Category", "Status", "Message", "Parameters", "Portals"],
        [...domain.codes]
          .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
          .map((entry) => [
            code(entry.code),
            text(entry.category),
            text(entry.status),
            text(entry.message),
            parametersOf(entry.params),
            portalsOf(entry.fronts),
          ])
      ),
    ]),
    ...sitesSection(sites),
  ];
  const config = await prettier.resolveConfig(path.join(REPOSITORY_ROOT, PAGE), {
    editorconfig: true,
  });
  return prettier.format(`${blocks.join("\n\n")}\n`, { ...config, parser: "markdown" });
}
