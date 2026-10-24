// @ts-check
/**
 * @file dependency-ledger.mjs
 * @description The dependency-usage ledger's command: one row per direct dependency the workspace
 *   manifests declare, its declarations, its `bin` names, and for each name under the floor of
 *   real sites the sites by kind and path class, joined with the owner's decisions in
 *   `scripts/testing/dependency-decisions.json` and written as `dependency-ledger.json` at the
 *   repository root, or checked against it. The site reader is `lib/dependency-sites.mjs`, the
 *   manifest side `lib/dependency-manifests.mjs`, the rows, the decisions and the record
 *   `lib/dependency-ledger-core.mjs`, the reads, the exit codes, the drift and the write and check
 *   tail `lib/record-helpers.mjs`; the declarations and the production scope are the legal scan's,
 *   `scanManifests` of `scripts/legal/subprocessors.mjs`.
 *
 *   MODES. Without `--check` it writes the record to `--out`, by default `dependency-ledger.json`
 *   at the root, and prints every problem of the decisions. With `--check` it compares the rendered
 *   record's bytes with that file and names each part that differs. `--sites <name>` prints a
 *   declared name's sites, one `<kind>\t<class>\t<file>` line each in code-unit order, above the
 *   floor too. The record is rendered with this repository's Prettier configuration for its record
 *   file, whatever root it describes and wherever `--out` writes it, the test ledger's rule too.
 *
 *   OWN FILES. A config string in one of the ledger's own files, its modules and its two suites
 *   alike ({@link LEDGER_FILES}), is not a site: those files name the package.json blocks,
 *   catalog protocols, tools and files the ledger reads, and plant packages as fixtures, which
 *   describes what the ledger measures rather than using it. Their imports still count.
 *
 *   EXIT CODES, the test ledger's: 0 written or current; 1 a problem of the decisions or a drift of
 *   the record (write mode still writes it); 2 a usage error; 3 an input that could not be read in
 *   full (the git listing, a tracked module or stylesheet, a command line's source (a manifest's
 *   scripts, a hook, a workflow, a composite action, a tracked shell script), the workspace
 *   manifest, a manifest or the legal classification, an installed copy, the decisions file, the
 *   committed record, the Prettier configuration, an exception the legal scan's walk of the
 *   workspace roots throws, or any reader result the core cannot classify) or a record that could
 *   not be written. 3 wins over 1: nothing is written or compared from a partial read.
 *
 *   RESIDUAL. The legal scan walks the filesystem and the derived manifests read git's listing, so
 *   an untracked `package.json` under `apps/`, `packages/` or `infra/` makes the two disagree and
 *   exits 3: fail-closed by design, cleared by tracking or deleting the file.
 *
 *   Usage: `node scripts/testing/dependency-ledger.mjs [--root <dir>] [--out <file>] [--check]
 *   [--sites <name>]`, or `pnpm deps:ledger` and `pnpm check:deps-ledger`.
 * @layer infrastructure
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CLASSIFICATION, readToolingList, scanManifests } from "../legal/subprocessors.mjs";
import {
  RECORD_FILE,
  buildLedger,
  buildRows,
  loadDecisions,
  render,
} from "./lib/dependency-ledger-core.mjs";
import {
  WORKSPACE_FILE,
  binarySites,
  binaryTexts,
  cssSites,
  declaredBins,
  manifestDisagreement,
  readCatalogs,
  workspaceManifests,
} from "./lib/dependency-manifests.mjs";
import {
  SITE_KINDS,
  SOURCE_EXTENSIONS,
  attributeSites,
  readSpecifiers,
  typedTargetOf,
} from "./lib/dependency-sites.mjs";
import {
  EXIT,
  byCodeUnit,
  checkRecord,
  cliResult,
  isEntryPoint,
  listTrackedFiles,
  messageOf,
  readText,
  writeRecord,
} from "./lib/record-helpers.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const USAGE =
  "usage: node scripts/testing/dependency-ledger.mjs [--root <dir>] [--out <file>] [--check] [--sites <name>]";
/** How the command names its record in what it prints, and how the record lists its rows. */
const SPEC = Object.freeze({
  label: "dependency-ledger",
  noun: "record",
  command: "pnpm deps:ledger",
  list: "names",
  id: "name",
});
/**
 * The ledger's own files, repository-relative: the command, its site reader, its manifest side,
 * its core, the record helpers, and the two suites that pin them. A config string in one of them
 * names what the ledger reads or plants as a fixture, so it is not a site; an import in one of
 * them is.
 */
export const LEDGER_FILES = Object.freeze([
  "apps/api/tests/unit/scripts/dependencyLedger.test.ts",
  "apps/api/tests/unit/scripts/dependencySites.test.ts",
  "scripts/testing/dependency-ledger.mjs",
  "scripts/testing/lib/dependency-ledger-core.mjs",
  "scripts/testing/lib/dependency-manifests.mjs",
  "scripts/testing/lib/dependency-sites.mjs",
  "scripts/testing/lib/record-helpers.mjs",
]);

/**
 * @template T
 * @typedef {import("./lib/record-helpers.mjs").Result<T>} Result
 */

/**
 * @typedef {import("./lib/dependency-ledger-core.mjs").Ledger} Ledger
 * @typedef {import("./lib/dependency-ledger-core.mjs").Row} Row
 * @typedef {import("./lib/dependency-sites.mjs").Site} Site
 * @typedef {import("./lib/record-helpers.mjs").CliResult} CliResult
 *
 * @typedef {object} DependencyLedgerSeams What the suite replaces; the command passes none.
 * @property {(root: string) => Result<string[]>} [listFiles] Replaces `git ls-files`.
 * @property {(ledger: Ledger) => Promise<string>} [render] Replaces the rendering of the record.
 *
 * @typedef {object} Built
 * @property {Ledger} ledger The record.
 * @property {string[]} problems The decisions' problems, worded.
 * @property {Row[]} rows Every row with all its sites, for `--sites`.
 * @property {number} manifests The workspace manifests read.
 * @property {number} pendingBaseline The decisions file's baseline.
 *
 * @typedef {object} Options
 * @property {string} root Absolute.
 * @property {string} out Absolute: the record written, or checked.
 * @property {boolean} check Whether to compare instead of write.
 * @property {string | null} sites The name whose sites to print, or `null`.
 */

/**
 * @description Reads the `tooling` list of the legal classification, the workspaces whose
 *   dependencies are not production. A file that cannot be read, is no JSON or holds a list the
 *   legal reader refuses is an error: the legal reader returns an empty list for a text that is no
 *   JSON, and the production scope would then be guessed.
 * @param {string} root The repository root.
 * @returns {Result<string[]>} The listed workspace names.
 */
function toolingList(root) {
  const text = readText(root, CLASSIFICATION);
  if ("error" in text) return text;
  try {
    JSON.parse(text.value);
  } catch (error) {
    return { error: `${CLASSIFICATION} is not JSON: ${messageOf(error)}` };
  }
  const { listed, problems } = readToolingList(text.value);
  return problems.length > 0 ? { error: problems.join("; ") } : { value: listed };
}

/**
 * @description Reads every module and binary site of the declared names: each module parsed and
 *   attributed, a ledger file's config strings left out, then the bins' command-line sites.
 * @param {string} root The repository root.
 * @param {readonly string[]} modules The tracked JavaScript and TypeScript files.
 * @param {readonly string[]} tracked Every tracked file, for the bins' command-line sources.
 * @param {ReadonlySet<string>} declared Every declared name.
 * @param {ReadonlyMap<string, Result<string[] | null>>} bins Each name's `declaredBins` result.
 * @returns {Result<Site[]>} The sites, or the first file that could not be read or parsed.
 */
function siteList(root, modules, tracked, declared, bins) {
  /** @type {Map<string, string>} */
  const typesRows = new Map();
  for (const name of declared) {
    const target = typedTargetOf(name);
    if (target !== null) typesRows.set(target, name);
  }
  /** @type {Site[]} */
  const sites = [];
  for (const file of modules) {
    const text = readText(root, file);
    if ("error" in text) return text;
    /** @type {import("./lib/dependency-sites.mjs").Specifier[]} */
    let specifiers;
    try {
      specifiers = readSpecifiers(file, text.value);
    } catch (error) {
      return { error: `${file} could not be parsed: ${messageOf(error)}` };
    }
    const found = attributeSites(file, specifiers, declared, typesRows);
    sites.push(
      ...(LEDGER_FILES.includes(file)
        ? found.filter((site) => site.kind !== SITE_KINDS.CONFIG_STRING)
        : found)
    );
  }
  const texts = binaryTexts(root, tracked);
  if ("error" in texts) return texts;
  for (const [name, read] of bins) {
    if ("value" in read && read.value !== null) {
      sites.push(...binarySites(name, read.value, texts.value));
    }
  }
  return { value: sites };
}

/**
 * @description Builds the record of a repository: lists its tracked files, reads the workspace
 *   manifest once for its globs and its catalogs, derives the workspace manifests and holds them
 *   to the legal scan's, reads the bins, the module, binary and stylesheet sites and the
 *   decisions, and assembles the ledger. Any input that cannot be read in full, and any reader
 *   result the core cannot classify, is the error; the decisions' problems travel beside the
 *   ledger. A listing with no file, or with no module to read, is an error too: every name would
 *   read as unused.
 * @param {string} root The repository root.
 * @param {DependencyLedgerSeams} [seams] Replacements for the suite; the command passes none.
 * @returns {Result<Built>} The built record, or why an input is unread.
 */
export function build(root, seams = {}) {
  const listed = (seams.listFiles ?? listTrackedFiles)(root);
  if ("error" in listed) return listed;
  const tracked = listed.value;
  if (tracked.length === 0) return { error: `git ls-files listed nothing in ${root}` };
  const modules = tracked.filter((file) => SOURCE_EXTENSIONS.includes(path.extname(file)));
  if (modules.length === 0) {
    return { error: "zero JavaScript or TypeScript files among the tracked files" };
  }
  const workspace = readText(root, WORKSPACE_FILE);
  if ("error" in workspace) return workspace;
  const catalogs = readCatalogs(workspace.value);
  if ("error" in catalogs) return catalogs;
  const derived = workspaceManifests(workspace.value, tracked);
  if ("error" in derived) return derived;
  const tooling = toolingList(root);
  if ("error" in tooling) return tooling;
  /** @type {ReturnType<typeof scanManifests>} */
  let scan;
  try {
    scan = scanManifests(root, tooling.value);
  } catch (error) {
    return { error: `the legal scan could not walk the workspace roots: ${messageOf(error)}` };
  }
  const scope = /** @type {Array<[boolean, string]>} */ ([
    [scan.missing.length === 0, `${scan.missing.join(", ")} does not exist`],
    [scan.unreadable.length === 0, `${scan.unreadable.join(", ")} is not a JSON object`],
    [scan.manifests.length > 1, "the legal scan read zero manifests beyond the root"],
    [scan.names.size > 0, "the manifests declare zero dependency names"],
    [scan.problems.length === 0, scan.problems.join("; ")],
  ]).find(([whole]) => !whole)?.[1];
  if (scope !== undefined) return { error: scope };
  const disagreement = manifestDisagreement(derived.value, scan.manifests);
  if (disagreement !== null) return { error: disagreement };
  const declared = new Set(scan.names.keys());
  /** @type {Map<string, Result<string[] | null>>} */
  const bins = new Map(
    [...declared].map((name) => [name, declaredBins(root, scan.declarations, name)])
  );
  const sites = siteList(root, modules, tracked, declared, bins);
  if ("error" in sites) return sites;
  const rows = buildRows({
    scan,
    catalogs: catalogs.value,
    sites: sites.value,
    css: cssSites(root, tracked, declared),
    bins,
    workspaceDirs: derived.value.map((file) => path.posix.dirname(file)),
  });
  if ("error" in rows) return rows;
  const decisions = loadDecisions(root);
  if ("error" in decisions) return decisions;
  const { ledger, problems } = buildLedger(rows.value, decisions.value);
  return {
    value: {
      ledger,
      problems,
      rows: rows.value,
      manifests: derived.value.length,
      pendingBaseline: decisions.value.pendingBaseline,
    },
  };
}

/**
 * @description Reads the command line. `--root`, `--out` and `--sites` take a non-empty value;
 *   an unknown flag, a positional argument and `--sites` with `--check` are usage errors.
 * @param {readonly string[]} argv The arguments after the script path.
 * @returns {Result<Options>} The options, or the usage error.
 */
function parseArguments(argv) {
  /** @type {{ root?: string, out?: string, check?: boolean, sites?: string }} */
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        root: { type: "string" },
        out: { type: "string" },
        check: { type: "boolean" },
        sites: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    return { error: messageOf(error) };
  }
  for (const flag of /** @type {const} */ (["root", "out", "sites"])) {
    if (values[flag] === "") return { error: `--${flag} takes a non-empty value` };
  }
  if (values.check === true && values.sites !== undefined) {
    return { error: "--sites cannot be combined with --check" };
  }
  const root = path.resolve(values.root ?? ROOT);
  return {
    value: {
      root,
      out: path.resolve(values.out ?? path.join(root, RECORD_FILE)),
      check: values.check === true,
      sites: values.sites ?? null,
    },
  };
}

/**
 * @description The counts a written record is reported with: the manifests read, the names, the
 *   verdicts and the pending count against its baseline.
 * @param {Built} built The built record.
 * @returns {string} The counts, worded.
 */
function counts(built) {
  const { summary } = built.ledger;
  return (
    `${built.manifests} manifests, ${summary.names} names, ${summary.aboveFloor} at or above the ` +
    `floor, ${summary.underFloor} under it (${summary.atZero} at zero); pending ` +
    `${summary.pending} of baseline ${built.pendingBaseline}`
  );
}

/**
 * @description `--sites`: prints a declared name's sites, one `<kind>\t<class>\t<file>` line
 *   each, in code-unit order; a declared name with no site prints nothing.
 * @param {Built} built The built record.
 * @param {string} name The name asked for.
 * @returns {CliResult} The lines, or a usage error for a name no manifest declares.
 */
function sitesOf(built, name) {
  const row = built.rows.find((candidate) => candidate.name === name);
  if (row === undefined) {
    return cliResult(EXIT.USAGE, [
      `${SPEC.label}: --sites ${name}: no manifest declares ${name}`,
      USAGE,
    ]);
  }
  const lines = Object.entries(row.sites).flatMap(([kind, byClass]) =>
    Object.entries(byClass).flatMap(([pathClass, files]) =>
      files.map((file) => `${kind}\t${pathClass}\t${file}`)
    )
  );
  return cliResult(EXIT.CLEAN, lines.sort(byCodeUnit));
}

/**
 * @description The command line, as a function: parse, build, then write, check or print a name's
 *   sites.
 * @param {readonly string[]} argv The arguments after the script path.
 * @param {DependencyLedgerSeams} [seams] Replacements for the suite; the command passes none.
 * @returns {Promise<CliResult>} The text to print and the exit code.
 */
export async function main(argv, seams = {}) {
  const parsed = parseArguments(argv);
  if ("error" in parsed) return cliResult(EXIT.USAGE, [`${SPEC.label}: ${parsed.error}`, USAGE]);
  const options = parsed.value;
  const built = build(options.root, seams);
  if ("error" in built) return cliResult(EXIT.UNREAD, [`${SPEC.label}: unread: ${built.error}`]);
  if (options.sites !== null) return sitesOf(built.value, options.sites);
  const { ledger, problems } = built.value;
  const run = {
    root: options.root,
    out: options.out,
    record: ledger,
    render: seams.render ?? render,
    lines: problems.map((problem) => `${SPEC.label}: ${problem}`),
    failing: problems.length > 0,
  };
  return options.check ? checkRecord(SPEC, run) : writeRecord(SPEC, run, counts(built.value));
}

if (isEntryPoint(import.meta.url)) {
  const { code, output } = await main(process.argv.slice(2));
  (code === EXIT.CLEAN ? process.stdout : process.stderr).write(output);
  process.exitCode = code;
}
