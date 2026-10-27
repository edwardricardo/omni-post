// @ts-check
/**
 * @file ledger.mjs
 * @description The test ledger's command: one row per test-shaped file, runner, helper and
 *   dead-suffix file under the workspaces, `security/` and `performance/`, each test-shaped file
 *   joined to the reach engine's sources and its quarantine owner, its blocks classified, its
 *   stem's module and its copies of its siblings found, and each runner and helper joined to the
 *   live files that reference it, then the human overlay applied (the confirmations of
 *   `docs/development/testing-refoundation/adjudications.json`, the slices of `slices.json`
 *   beside it), written as `ledger.json` at the repository root and `LEDGER.md` beside the
 *   overlay, or checked against them. The rows, the verdict table, the duplicate scan, the
 *   summary and the rendering are `lib/ledger-core.mjs`'s; the overlay and the deletion a set of
 *   rows stands for are `lib/ledger-overlay.mjs`'s; the page is `lib/ledger-markdown.mjs`'s; the
 *   import graph is `lib/ledger-imports.mjs`'s, over every tracked module, TypeScript project and
 *   command line; the reach report and the quarantine are read through `lib/reach-report.mjs`,
 *   which `metrics.mjs` M5 shares.
 *
 *   MODES. Without `--check` it writes the ledger to `--out`, by default `ledger.json` at the
 *   root, and the page to `docs/development/testing-refoundation/LEDGER.md`, never a Markdown file
 *   at the root, or to `LEDGER.md` beside `--out`'s file when `--out` names one outside the root,
 *   so a scratch run writes nothing into the tree. With `--check` it compares the rendered
 *   ledger's bytes with that file and names each row that differs, then the page's with the
 *   committed page. `--area <glob>` writes
 *   nothing: it prints `file:line:title` for every block of the DELETE rows whose path the glob
 *   matches (a file with no block by its path), and the expected drop in files and blocks.
 *   `--reach <file>` reads a saved `reach --json` report instead of running the engine.
 *   Deterministic: no clock, no commit and no absolute path, so two runs over one tree write the
 *   same bytes.
 *
 *   EXIT CODES, fitness #48's: 0 written, or no drift; 1 drift, an overlay entry or slice
 *   assignment refused (write mode still writes, the refused entry left out), or an `--area` glob
 *   that matches no row; 2 a usage error (`--area` with `--check` among them); 3 an input could
 *   not be read (`git ls-files` failed or listed no test-shaped file, the workspace manifest, the
 *   quarantine or a listed file could not be read, the engine printed no report or reported an
 *   input of its own unread, the overlay or the slice assignment is no JSON, writes a key twice in
 *   one object or is not its one object, `--check` found no committed ledger or page or could not
 *   read one, the Prettier configuration could not be read) or the ledger or the page could not
 *   be written. 3 wins over 1: an unread
 *   input stops the run before anything is written or compared, so no drift is ever named from a
 *   partial read. A file the classifier cannot read is a row (`framework: null`, verdict
 *   ADJUDICATE) and a note, not an unread input; a module or project whose references cannot be
 *   read is a note too, and leaves every helper's and runner's importer count unmeasured, so a
 *   partial graph never names one dead.
 *
 *   Usage: `node scripts/testing/ledger.mjs [--root <dir>] [--out <file>] [--reach <file>]
 *   [--check | --area <glob>]`, or `pnpm ledger` and `pnpm check:ledger`.
 * @layer infrastructure
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { classifyFile } from "@packages/eslint-plugin-testing";
import { binaryTexts, workspaceManifests } from "./lib/dependency-manifests.mjs";
import { SOURCE_EXTENSIONS } from "./lib/dependency-sites.mjs";
import {
  CANONICAL_TEST_SHAPED,
  EXCLUDED_BY_DECISION,
  buildLedger,
  duplicatesOf,
  fileRow,
  render,
  shapeOf,
} from "./lib/ledger-core.mjs";
import {
  commandReferences,
  importClosure,
  liveImporters,
  moduleReferences,
  modulesByStem,
  projectReferences,
  subjectOf,
  workspaceOf,
} from "./lib/ledger-imports.mjs";
import { MARKDOWN_FILE, renderMarkdown } from "./lib/ledger-markdown.mjs";
import {
  ADJUDICATIONS_FILE,
  SLICES_FILE,
  applyOverlay,
  counted,
  deletionOf,
  dropWords,
} from "./lib/ledger-overlay.mjs";
import {
  parseReachReport,
  quarantineOwners,
  reachLabels,
  reachReport,
} from "./lib/reach-report.mjs";
import {
  EXIT,
  checkRecord,
  cliResult,
  isEntryPoint,
  isObject,
  listTrackedFiles,
  messageOf,
  readText,
  writeRecord,
} from "./lib/record-helpers.mjs";
import { WORKSPACE_FILE, readPackageGlobs } from "./workspace-block-reader.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const LEDGER_FILE = "ledger.json";
const ROOT_MANIFEST = "package.json";
const PROJECT = /(^|\/)tsconfig[^/]*\.json$/;
/** The directories outside the workspaces that hold test-shaped files of their own. */
const SUITE_ROOTS = Object.freeze(["security/", "performance/"]);
const USAGE =
  "usage: node scripts/testing/ledger.mjs [--root <dir>] [--out <file>] [--reach <file>] [--check | --area <glob>]";
/** How the command names its ledger in what it prints, and how the ledger lists its rows. */
const SPEC = Object.freeze({
  label: "ledger",
  noun: "ledger",
  command: "pnpm ledger",
  list: "files",
  id: "path",
});

/**
 * @template T
 * @typedef {import("./lib/record-helpers.mjs").Result<T>} Result
 */

/**
 * @typedef {import("./lib/reach-report.mjs").ReachReport} ReachReport
 * @typedef {import("./lib/ledger-core.mjs").FileRow} FileRow
 * @typedef {import("./lib/ledger-core.mjs").Ledger} Ledger
 * @typedef {import("../../packages/eslint-plugin-testing/src/classify.js").FileClassification} FileClassification
 * @typedef {import("./lib/ledger-imports.mjs").ImportContext} ImportContext
 * @typedef {import("./lib/ledger-imports.mjs").WorkspacePackage} WorkspacePackage
 *
 * @typedef {object} Graph What the tracked files name.
 * @property {Map<string, string[]>} references Each scanned file's references.
 * @property {Map<string, string[]>} imports Each source module's run-time imports.
 * @property {string[]} notes One per module or project whose references could not be read.
 *
 * @typedef {object} LedgerSeams What the suite replaces; the command passes none.
 * @property {(root: string) => Result<string[]>} [listFiles] Replaces `git ls-files`.
 * @property {(root: string) => ReachReport | string} [runReach] Replaces the reach engine's run.
 * @property {(ledger: Ledger) => Promise<string>} [render] Replaces the rendering of the ledger.
 * @property {typeof renderMarkdown} [renderMarkdown] Replaces the rendering of the page.
 *
 * @typedef {object} Read One file's classification.
 * @property {FileClassification | null} classification
 * @property {string | null} note Why the classifier could not read the file, else `null`.
 *
 * @typedef {object} Built
 * @property {Ledger} ledger
 * @property {string[]} notes One per file the classifier could not read.
 * @property {string[]} problems One per overlay entry or slice assignment refused.
 * @property {Map<string, FileRow["verdict"]>} machine Each row's verdict before the overlay.
 *
 * @typedef {object} Options
 * @property {string} root Absolute.
 * @property {string} out Absolute: the ledger written, or checked.
 * @property {string | null} reach A saved reach report, as given, or `null` to run the engine.
 * @property {boolean} check
 * @property {string | null} area The `--area` glob, or `null`.
 * @property {string} markdown Absolute: the page written, or checked.
 *
 * @typedef {import("./lib/record-helpers.mjs").CliResult} CliResult
 */

/**
 * @description The directories the ledger lists: the first segment of every `packages:` glob of
 *   the workspace manifest (a negated glob narrows and adds none), then `security/` and
 *   `performance/`. Derived, so a workspace root added to the manifest is listed with no edit; a
 *   line the reader cannot read fails rather than being skipped.
 * @param {string} text The text of the workspace manifest.
 * @returns {Result<string[]>} Sorted, each ending in `/`.
 */
function scopePrefixes(text) {
  const globs = readPackageGlobs(text);
  if ("error" in globs) return globs;
  /** @type {Set<string>} */
  const prefixes = new Set(SUITE_ROOTS);
  for (const glob of globs.value.positive) {
    const first = glob.split("/").find((part) => part.length > 0);
    if (first !== undefined) prefixes.add(`${first}/`);
  }
  return { value: [...prefixes].sort() };
}

/**
 * @description Reads the workspace packages a specifier may name: the name, the directory and the
 *   declared dependency names of every manifest the workspace globs reach, the root's left out,
 *   since no specifier names it.
 * @param {string} root
 * @param {string} text The text of the workspace manifest.
 * @param {readonly string[]} tracked
 * @returns {Result<WorkspacePackage[]>}
 */
function workspacePackages(root, text, tracked) {
  const manifests = workspaceManifests(text, tracked);
  if ("error" in manifests) return manifests;
  /** @type {WorkspacePackage[]} */
  const packages = [];
  const fields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  for (const manifest of manifests.value.filter((file) => file !== ROOT_MANIFEST)) {
    const read = readText(root, manifest);
    if ("error" in read) return read;
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(read.value);
    } catch (error) {
      return { error: `${manifest} is not JSON: ${messageOf(error)}` };
    }
    const data = parsed;
    if (!isObject(data) || typeof data["name"] !== "string") continue;
    const depends = fields.flatMap((field) => {
      const declared = data[field];
      return isObject(declared) ? Object.keys(declared) : [];
    });
    packages.push({ name: data["name"], dir: path.posix.dirname(manifest), depends });
  }
  return { value: packages };
}

/**
 * @description Reads what every tracked file names: each source module's specifiers and relative
 *   strings, each TypeScript project's collected candidates, and each command line's source
 *   files. A module or a project the parser cannot read is a note.
 * @param {string} root
 * @param {readonly string[]} files Every tracked path.
 * @param {ImportContext} context
 * @param {readonly string[]} candidates The helpers and runners.
 * @returns {Result<Graph>}
 */
function importGraph(root, files, context, candidates) {
  /** @type {Graph} */
  const graph = { references: new Map(), imports: new Map(), notes: [] };
  for (const file of files) {
    const project = PROJECT.test(file);
    if (!project && !SOURCE_EXTENSIONS.some((extension) => file.endsWith(extension))) continue;
    const text = readText(root, file);
    if ("error" in text) return text;
    try {
      if (project) {
        graph.references.set(file, projectReferences(file, text.value, candidates));
      } else {
        const read = moduleReferences(file, text.value, context);
        graph.references.set(file, read.references);
        graph.imports.set(file, read.imports);
      }
    } catch (error) {
      graph.notes.push(`${file}: its references could not be read: ${messageOf(error)}`);
    }
  }
  const commands = binaryTexts(root, files);
  if ("error" in commands) return commands;
  for (const [file, text] of commands.value) {
    graph.references.set(file, commandReferences(file, text, context.tracked));
  }
  return { value: graph };
}

/** A runner, a helper or a dead-suffix file: listed, not classified. */
const UNCLASSIFIED = Object.freeze({ value: { classification: null, note: null } });

/**
 * @description Classifies one test-shaped file. A file that cannot be read is an unread input; a
 *   file the classifier cannot read, by its own `error` or by a throw, is a row with no framework
 *   and a note.
 * @param {string} root
 * @param {string} file Repository-relative.
 * @returns {Result<Read>}
 */
function classified(root, file) {
  const text = readText(root, file);
  if ("error" in text) return text;
  try {
    const classification = classifyFile(text.value, file);
    const { error } = classification;
    const note = error === null ? null : `${file}: the classifier could not read it: ${error}`;
    return { value: { classification, note } };
  } catch (error) {
    const note = `${file}: the classifier failed: ${messageOf(error)}`;
    return { value: { classification: null, note } };
  }
}

/**
 * @description Reads a file of the overlay, which may be absent.
 * @param {string} root
 * @param {string} file Repository-relative.
 * @returns {Result<string | null>} Its text, `null` when it does not exist, or why it is unread.
 */
function optionalText(root, file) {
  try {
    return { value: readFileSync(path.join(root, file), "utf8") };
  } catch (error) {
    if (isObject(error) && error["code"] === "ENOENT") return { value: null };
    return { error: `${file} could not be read: ${messageOf(error)}` };
  }
}

/**
 * @description Builds the ledger of a repository: lists its tracked paths, keeps the candidates
 *   under the listed directories (a path `shapeOf` names, or one a decision excludes), reads the
 *   quarantine, the reach report and the import graph of every tracked file, classifies every
 *   test-shaped file, finds the duplicates among them, the module each stem names and each
 *   helper's and runner's live importers, assembles the rows, then applies the overlay and the
 *   slice assignment when they exist. Any input that cannot be read in full, the reach engine's
 *   own and the overlay's included, is the error; an overlay entry or a slice assignment that is
 *   refused is a problem.
 * @param {string} root The repository root.
 * @param {LedgerSeams} [seams] Replacements for the suite; the command passes none.
 * @returns {Result<Built>}
 */
export function build(root, seams = {}) {
  const listed = (seams.listFiles ?? listTrackedFiles)(root);
  if ("error" in listed) return listed;
  const workspace = readText(root, WORKSPACE_FILE);
  if ("error" in workspace) return workspace;
  const prefixes = scopePrefixes(workspace.value);
  if ("error" in prefixes) return prefixes;
  const candidates = listed.value.filter(
    (file) =>
      prefixes.value.some((prefix) => file.startsWith(prefix)) &&
      (shapeOf(file) !== null || Object.hasOwn(EXCLUDED_BY_DECISION, file))
  );
  if (!candidates.some((file) => CANONICAL_TEST_SHAPED.test(file))) {
    return { error: `git ls-files listed no test-shaped file under ${prefixes.value.join(", ")}` };
  }
  const owners = quarantineOwners(root);
  if (typeof owners === "string") return { error: owners };
  const report = (seams.runReach ?? reachReport)(root);
  if (typeof report === "string") return { error: report };
  const labels = reachLabels(report);
  if (typeof labels === "string") return { error: labels };
  const packages = workspacePackages(root, workspace.value, listed.value);
  if ("error" in packages) return packages;
  const context = { tracked: new Set(listed.value), packages: packages.value };
  /** @param {string} file */
  const carries = (file) => ["runner", "helper"].includes(shapeOf(file) ?? "");
  const helpers = candidates.filter(carries);
  const graph = importGraph(root, listed.value, context, helpers);
  if ("error" in graph) return graph;
  const notes = [...graph.value.notes];
  /** @type {Map<string, FileClassification | null>} */
  const classifications = new Map();
  for (const file of candidates) {
    const read = CANONICAL_TEST_SHAPED.test(file) ? classified(root, file) : UNCLASSIFIED;
    if ("error" in read) return read;
    if (read.value.note !== null) notes.push(read.value.note);
    classifications.set(file, read.value.classification);
  }
  const duplicates = duplicatesOf(
    [...classifications].flatMap(([file, classification]) =>
      classification === null
        ? []
        : [
            {
              path: file,
              group: workspaceOf(file, packages.value)?.dir ?? file.split("/")[0] ?? "",
              collected: (labels.get(file) ?? []).length > 0,
              blocks: classification.blocks,
            },
          ]
    )
  );
  const counts =
    graph.value.notes.length === 0 ? liveImporters(helpers, graph.value.references) : new Map();
  const index = modulesByStem(
    listed.value.filter(
      (file) =>
        shapeOf(file) === null && SOURCE_EXTENSIONS.some((extension) => file.endsWith(extension))
    )
  );
  /** @type {FileRow[]} */
  const rows = [];
  for (const file of candidates) {
    const testShaped = CANONICAL_TEST_SHAPED.test(file);
    const imports = graph.value.imports.has(file)
      ? importClosure(file, graph.value.imports, carries)
      : undefined;
    const row = fileRow({
      path: file,
      classification: classifications.get(file) ?? null,
      collectors: testShaped ? (labels.get(file) ?? []) : [],
      quarantined: owners.get(file) ?? null,
      subject:
        imports === undefined
          ? null
          : subjectOf(file, shapeOf(file), imports, index, packages.value),
      duplicate: duplicates.get(file) ?? null,
      importers: counts.get(file) ?? null,
    });
    if ("error" in row) return row;
    rows.push(row.value);
  }
  const machine = new Map(rows.map((entry) => [entry.path, entry.verdict]));
  const adjudications = optionalText(root, ADJUDICATIONS_FILE);
  if ("error" in adjudications) return adjudications;
  const slices = optionalText(root, SLICES_FILE);
  if ("error" in slices) return slices;
  const overlaid = applyOverlay(rows, { adjudications: adjudications.value, slices: slices.value });
  if ("error" in overlaid) return overlaid;
  const ledger = buildLedger(overlaid.value.rows, overlaid.value.slices);
  if ("error" in ledger) return ledger;
  const { problems } = overlaid.value;
  return { value: { ledger: ledger.value, notes, problems, machine } };
}

/**
 * @description Says whether a file lies outside the repository root.
 * @param {string} root Absolute.
 * @param {string} file Absolute.
 * @returns {boolean}
 */
function outside(root, file) {
  const relative = path.relative(root, file);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

/**
 * @description Reads the command line. Every flag takes its value but `--check`; an unknown flag,
 *   a positional argument, an empty value and `--area` with `--check` are usage errors.
 * @param {readonly string[]} argv The arguments after the script path.
 * @returns {Result<Options>}
 */
function parseArguments(argv) {
  /** @type {{ root?: string, out?: string, reach?: string, check?: boolean, area?: string }} */
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        root: { type: "string" },
        out: { type: "string" },
        reach: { type: "string" },
        check: { type: "boolean" },
        area: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    return { error: messageOf(error) };
  }
  for (const flag of /** @type {const} */ (["root", "out", "reach", "area"])) {
    if (values[flag] === "") return { error: `--${flag} takes a non-empty value` };
  }
  if (values.area !== undefined && values.check === true) {
    return { error: "--area lists a deletion and takes no --check" };
  }
  const root = path.resolve(values.root ?? ROOT);
  const out = path.resolve(values.out ?? path.join(root, LEDGER_FILE));
  return {
    value: {
      root,
      out,
      reach: values.reach ?? null,
      check: values.check === true,
      area: values.area ?? null,
      markdown:
        values.out !== undefined && outside(root, out)
          ? path.join(path.dirname(out), path.basename(MARKDOWN_FILE))
          : path.join(root, MARKDOWN_FILE),
    },
  };
}

/**
 * @description Reads the saved report `--reach` names, in place of a run of the engine.
 * @param {string} file As given on the command line, resolved against the working directory.
 * @returns {ReachReport | string} The report, or why there is none.
 */
function savedReach(file) {
  try {
    return parseReachReport(readFileSync(path.resolve(file), "utf8"));
  } catch (error) {
    return `--reach ${file} could not be read: ${messageOf(error)}`;
  }
}

/**
 * @description The counts a written ledger is reported with.
 * @param {Ledger} ledger
 * @returns {string}
 */
function counts(ledger) {
  const testShaped = ledger.files.filter((row) => row.collectors !== null).length;
  const { total, decorative } = ledger.summary.blocks;
  return (
    `${counted(ledger.summary.files.total, "file")}, ${testShaped} test-shaped, ` +
    `${counted(total, "block")}, ${decorative} with a criterion`
  );
}

/**
 * @description `--area`: the blocks a deletion of the DELETE rows whose path the glob matches
 *   would remove, and the drop it expects. A glob that matches no row of the ledger is a verdict,
 *   so a mistyped glob never reads as an empty deletion.
 * @param {Ledger} ledger
 * @param {string} glob A `path.matchesGlob` pattern over repository-relative paths.
 * @param {readonly string[]} lines The notes and problems, printed first.
 * @param {boolean} failing Whether the problems fail the run.
 * @returns {CliResult}
 */
function area(ledger, glob, lines, failing) {
  const matching = ledger.files.filter((row) => path.posix.matchesGlob(row.path, glob));
  if (matching.length === 0) {
    return cliResult(EXIT.VERDICT, [...lines, `ledger: area ${glob} matches no row of the ledger`]);
  }
  const drop = deletionOf(matching);
  return cliResult(failing ? EXIT.VERDICT : EXIT.CLEAN, [
    ...lines,
    ...drop.lines,
    `ledger: area ${glob}: expected drop ${dropWords(drop)}`,
  ]);
}

/**
 * @description Names the page in a message: relative to the root when it lies inside it.
 * @param {Options} options
 * @returns {string}
 */
function pageShown({ root, markdown }) {
  return outside(root, markdown) ? markdown : path.relative(root, markdown);
}

/**
 * @description Writes the rendered page, or compares it with the committed one, and adds its lines
 *   to the ledger's result; the code is the higher of the two, so 3 wins. A committed page that is
 *   missing or unreadable is an unread input, as a committed ledger is: it replaces the ledger's
 *   comparison, so no drift is named from a partial read.
 * @param {CliResult} result The ledger's write or check.
 * @param {Options} options
 * @param {string} page The rendered page.
 * @param {readonly string[]} lines The notes and problems the run printed first.
 * @returns {CliResult}
 */
function withPage(result, options, page, lines) {
  const shown = pageShown(options);
  /** @type {(code: number, lines: string[]) => CliResult} */
  const joined = (code, lines) => {
    const added = cliResult(code, lines);
    return { code: Math.max(result.code, code), output: result.output + added.output };
  };
  if (!options.check) {
    try {
      mkdirSync(path.dirname(options.markdown), { recursive: true });
      writeFileSync(options.markdown, page);
    } catch (error) {
      return joined(EXIT.UNREAD, [`ledger: ${shown} could not be written: ${messageOf(error)}`]);
    }
    return joined(EXIT.CLEAN, [`ledger: wrote ${shown}`]);
  }
  const committed = optionalText(path.dirname(options.markdown), path.basename(options.markdown));
  if ("error" in committed)
    return cliResult(EXIT.UNREAD, [...lines, `ledger: unread: ${committed.error}`]);
  if (committed.value === null) {
    return cliResult(EXIT.UNREAD, [
      ...lines,
      `ledger: unread: no committed page at ${shown}; run \`${SPEC.command}\` and commit it`,
    ]);
  }
  if (committed.value === page) return joined(EXIT.CLEAN, [`ledger: ${shown} is current`]);
  return joined(EXIT.VERDICT, [
    `ledger: drift: ${shown} differs from the rendered ledger`,
    `ledger: ${shown} is stale; run \`${SPEC.command}\` and commit the result`,
  ]);
}

/**
 * @description The command line, as a function: parse, build, then list an area, or render the
 *   page, write or check the ledger and then the page.
 * @param {readonly string[]} argv The arguments after the script path.
 * @param {LedgerSeams} [seams] Replacements for the suite; the command passes none.
 * @returns {Promise<CliResult>} The text to print and the exit code.
 */
export async function main(argv, seams = {}) {
  const parsed = parseArguments(argv);
  if ("error" in parsed) return cliResult(EXIT.USAGE, [`ledger: ${parsed.error}`, USAGE]);
  const options = parsed.value;
  const { reach } = options;
  const built = build(
    options.root,
    reach === null ? seams : { ...seams, runReach: () => savedReach(reach) }
  );
  if ("error" in built) return cliResult(EXIT.UNREAD, [`ledger: unread: ${built.error}`]);
  const { ledger, machine, problems } = built.value;
  const lines = [
    ...built.value.notes.map((note) => `ledger: note: ${note}`),
    ...problems.map((problem) => `ledger: refused: ${problem}`),
  ];
  const failing = problems.length > 0;
  if (options.area !== null) return area(ledger, options.area, lines, failing);
  /** @type {string} */
  let page;
  try {
    page = await (seams.renderMarkdown ?? renderMarkdown)(ledger, machine);
  } catch (error) {
    return cliResult(EXIT.UNREAD, [
      ...lines,
      `ledger: unread: ${pageShown(options)} could not be rendered: ${messageOf(error)}`,
    ]);
  }
  const run = {
    root: options.root,
    out: options.out,
    record: ledger,
    render: seams.render ?? render,
    lines,
    failing,
  };
  const result = options.check
    ? await checkRecord(SPEC, run)
    : await writeRecord(SPEC, run, counts(ledger));
  return result.code === EXIT.UNREAD ? result : withPage(result, options, page, lines);
}

if (isEntryPoint(import.meta.url)) {
  const { code, output } = await main(process.argv.slice(2));
  (code === EXIT.CLEAN ? process.stdout : process.stderr).write(output);
  process.exitCode = code;
}
