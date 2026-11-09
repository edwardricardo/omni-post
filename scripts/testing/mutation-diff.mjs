// @ts-check
/**
 * @file mutation-diff.mjs
 * @description The differential mutation tool: does a rewritten test catch a mutation its base
 *   form did not, and does a deleted block take with it a mutation nothing else catches? For each
 *   case of a case file it makes one realistic mutation of a subject (its `search`, replaced at the
 *   first occurrence by its `replace`) and runs the case's whole scope four times with the collector the ledger names for its test, a
 *   vitest config or node:test's integration tier: the
 *   test files at the base and at the head, each unmutated and mutated. The test files' base
 *   content (`git show <base>:<path>`), and the head's when `--head` is given, is served in memory
 *   by a Vite plugin (`lib/mutation-diff-plugin.mjs`), which also mutates the subject, always the
 *   working tree's file, in memory; nothing in the tree is changed. A node:test run gets the same from
 *   loader hooks (`lib/mutation-diff-hooks.mjs`, registered by `lib/mutation-diff-register.mjs`
 *   ahead of tsx) and is read through `node-results-reporter.mjs`, from the package directory and
 *   with the flags the integration collector uses. The verdict table, the scope
 *   and the record are `lib/mutation-diff-core.mjs`'s. A rewrite counts (GAIN) only when no scope
 *   test is red at the base under the mutation and every listed block is red at the head; a
 *   deletion counts (SAFE) only when the deleted block is red at the base and a kept test is red at
 *   the head. Either kind is BEHAVIOUR-CHANGED when the base clean run is red on its listed blocks
 *   alone and the head clean run is green: the old test fails on the new code, measured. A scope
 *   file that fails to load on a clean run, with no test at all, leaves the case UNDECIDED by the
 *   side it failed on: `base-unreadable`, `head-unreadable`, or `both-unreadable` when it failed on
 *   both, which points at the environment the runs share (a missing test env file, say) rather than
 *   at either side's content. Each such file is named on its side's red list as
 *   `<file>::(the file failed): <line>`, the line being the first non-empty one of the message
 *   the runner reports for the file, trimmed and cut at 200 characters, since the JSON report keeps
 *   the load error there and nowhere else.
 *
 *   ANY ROLE MAY RUN IT, the verifier included: it does no git write, creates no worktree and
 *   installs nothing. Git is only read (`rev-parse`, `ls-tree`, `show`), so git stays with the
 *   orchestrator (D19). The generated vitest configs, their options and the JSON reports live in a
 *   directory the run creates with `mkdtemp` under the system temp dir and removes when it ends.
 *   The record is written last, to `--out`, through a temp file renamed onto it. A slice commits its
 *   case file and its record under
 *   `docs/development/testing-refoundation/mutations/<slice>.cases.json` and
 *   `<slice>.record.json`; the unit that added this tool commits none.
 *
 *   SCOPE, on each side from that side's tree. The case's test, the files its `scope` names, and
 *   every test file the same collector runs (a vitest project, or node:test's integration tier, as
 *   `ledger.json` at that side names it,
 *   today's when the side holds none) whose import specifiers, read statically and
 *   resolved relative to the file, name the subject. A test that reaches the subject through
 *   another module, or through an alias, is outside the default scope unless the case names it.
 *
 *   EXIT CODES: 0 every case is decided, BEHAVIOUR-CHANGED included; 1 any BROKEN or UNDECIDED,
 *   with `--require gain` any NO-GAIN or BEHAVIOUR-CHANGED, with `--require safe` any LOST, VACUOUS
 *   or BEHAVIOUR-CHANGED; 2 a usage error, or a case file refused (an
 *   unknown key, a missing field, a duplicate id, a block outside its `test`, a test neither the
 *   working tree's ledger nor its base's runs with a vitest config or node:test's integration tier,
 *   a test of node:test's live tier or one no collector runs, an `--only` that names no case); 3 the environment: an empty `DATABASE_URL` before a
 *   node:test run, the case file or
 *   the ledger cannot be read, git fails, the scratch directory cannot be made, the runner does not
 *   start, or the record cannot be written. Nothing is written on 2 or 3.
 *
 *   RESIDUAL LIMITS, stated rather than implied: (1) one search string, replaced at its first
 *   occurrence; (2) the realistic mutation stays a human choice, and the tool proves only what that
 *   one mutation shows; (3) whole files run, so a test's neighbours run with it; (4) node:test's live tier and a
 *   row no collector runs are refused, never run; (5) a flaky clean run is UNDECIDED, never a verdict, unless its red
 *   falls on the listed blocks alone at the base, which reads as BEHAVIOUR-CHANGED; (6) a test file
 *   the working tree lacks (a test the head deleted whole, say) runs from a copy under the scratch
 *   directory, its imports and mocks resolved from its own path, so `import.meta.url`, `__dirname`
 *   and a path it reads relative to itself see the copy, and a glob character in its path is
 *   residual; (7) a mutation that makes a test
 *   file fail to load leaves its blocks without a result, which is `block-missing`, the file named
 *   on the mutated side's red list with its message's first line; (8) a node:test run hands
 *   its options path to its child alone through POSIX `env(1)`, which must be on PATH.
 *
 *   Usage: `node scripts/testing/mutation-diff.mjs --cases <file.json> --out <record.json>
 *   [--base <sha>] [--head <ref>] [--only <id>]... [--require gain|safe] [--root <dir>]`, or
 *   `pnpm mutation-diff`. `--base` defaults to `HEAD`; without `--head` the head is the working
 *   tree. The environment the runs need (the test database's URL, for one) is the caller's.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runTool } from "./hard-probe.mjs";
import {
  NODE_TEST_TIMEOUT,
  RUNNABLE,
  pendingTempPath,
  probeCommand,
} from "./lib/hard-probe-core.mjs";
import {
  blocksOf,
  bodyHashes,
  caseEntry,
  decide,
  exitOf,
  parseCases,
  recordOf,
  reportOf,
  resolveBlock,
  scopeOf,
} from "./lib/mutation-diff-core.mjs";
import { PLUGIN_FILE, mutationPlugin } from "./lib/mutation-diff-plugin.mjs";
import { REGISTER_FILE } from "./lib/mutation-diff-register.mjs";
import {
  EXIT,
  byCodeUnit,
  cliResult,
  isEntryPoint,
  messageOf,
  renderJson,
} from "./lib/record-helpers.mjs";
import { RESULTS_REPORTER_FILE } from "./node-results-reporter.mjs";

/** This repository's root. */
const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

/** Where a slice's record lives, the path its rendering reads the formatting rules for. */
const RENDERED_AS = "docs/development/testing-refoundation/mutations/record.json";

/** How long one run may take before its process group is killed. */
const RUN_TIMEOUT = 600_000;

/** The variable a node:test run's options path reaches its child in. */
const OPTIONS_VARIABLE = "MUTATION_DIFF_OPTIONS";

/** node:test's live tier, whose tests need a running API. */
const LIVE_TIER = /^node:.*#live$/;

/** node:test's integration tier, the one node:test collector this tool runs. */
const INTEGRATION_TIER = /^node:.*#integration$/;

/** The integration collector's own words when the test database is missing (`run-tests.sh`). */
const NO_DATABASE =
  "DATABASE_URL is empty, so there is no test database to run the integration suites against";

const USAGE =
  "usage: node scripts/testing/mutation-diff.mjs --cases <file.json> --out <record.json> [--base <sha>] [--head <ref>] [--only <id>]... [--require gain|safe] [--root <dir>]";

/**
 * @typedef {import("./lib/mutation-diff-core.mjs").Case} Case
 * @typedef {import("./lib/mutation-diff-core.mjs").Run} Run
 * @typedef {import("./lib/mutation-diff-core.mjs").Side} Side
 * @typedef {import("./lib/mutation-diff-core.mjs").Resolution} Resolution
 * @typedef {import("./lib/record-helpers.mjs").CliResult} CliResult
 */

/**
 * @typedef {object} Ran What a run's process did.
 * @property {number | null} status
 * @property {string} stdout
 * @property {string} stderr
 * @property {boolean} timedOut
 * @property {string | null} spawnError
 */

/**
 * @typedef {object} ScopeRun One run of a case's files, as the `exec` seam receives it.
 * @property {string} root The repository root, absolute.
 * @property {string} command
 * @property {string[]} args
 * @property {string} cwd The package directory the runner runs from, absolute.
 * @property {Side} side
 * @property {boolean} mutated
 * @property {string[]} files The test files, repository-relative.
 * @property {Record<string, string>} paths Each file's absolute path as vitest runs it: its own,
 *   or its copy's under the scratch directory when the working tree lacks it.
 * @property {Record<string, string>} served Each served test file's text, by absolute path.
 * @property {string} report Where the JSON reporter writes.
 * @property {string | null} marker Where the plugin marks the mutation applied.
 * @property {string} servedLog Where the plugin logs each served id.
 * @property {Readonly<Record<string, string>> | null} env The variables the run sets for its child
 *   alone: a node:test run's options path, `null` for vitest.
 */

/**
 * @typedef {object} Seams What the suite replaces.
 * @property {(run: ScopeRun) => Promise<Ran>} [exec] Runs one run.
 * @property {Readonly<Record<string, string | undefined>>} [env] The environment the database
 *   check of a node:test case reads, `process.env` by default.
 */

/**
 * @typedef {object} Options
 * @property {string} root
 * @property {string} cases
 * @property {string} out
 * @property {string} base
 * @property {string | null} head
 * @property {string[]} only
 * @property {"gain" | "safe" | null} requirement
 */

/** A failure that ends the run with its code. */
class Stop extends Error {
  /**
   * @param {number} code
   * @param {string} line
   */
  constructor(code, line) {
    super(line);
    this.code = code;
  }
}

/**
 * @description Reads the command line.
 * @param {readonly string[]} argv
 * @returns {{ value: Options } | { error: string }}
 */
function parseArguments(argv) {
  /** @type {Record<string, string | string[] | undefined>} */
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        cases: { type: "string" },
        out: { type: "string" },
        base: { type: "string" },
        head: { type: "string" },
        only: { type: "string", multiple: true },
        require: { type: "string" },
        root: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    return { error: messageOf(error) };
  }
  for (const [flag, value] of Object.entries(values)) {
    if ([value].flat().includes("")) return { error: `--${flag} takes a non-empty value` };
  }
  const { cases, out, base, head, only, require, root } = values;
  if (typeof cases !== "string" || typeof out !== "string") {
    return { error: "--cases and --out are required" };
  }
  if (require !== undefined && require !== "gain" && require !== "safe") {
    return { error: "--require takes gain or safe" };
  }
  return {
    value: {
      root: path.resolve(typeof root === "string" ? root : ROOT),
      cases: path.resolve(cases),
      out: path.resolve(out),
      base: typeof base === "string" ? base : "HEAD",
      head: typeof head === "string" ? head : null,
      only: Array.isArray(only) ? only : [],
      requirement: require === "gain" || require === "safe" ? require : null,
    },
  };
}

/**
 * @description Runs git in a directory, read-only.
 * @param {string} cwd
 * @param {readonly string[]} args
 * @returns {string} What it printed.
 * @throws {Stop} Exit 3 when git fails.
 */
function git(cwd, args) {
  try {
    return execFileSync("git", [...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (error) {
    throw new Stop(
      EXIT.UNREAD,
      `mutation-diff: unread: git ${args.join(" ")} failed: ${messageOf(error)}`
    );
  }
}

/**
 * @description Whether a commit holds a file, read from the commit's tree listing. Only
 *   a path the listing lacks is absence: a git failure stops the run (exit 3), so a file
 *   that cannot be read never silently leaves a scope.
 * @param {string} root
 * @param {string} ref
 * @param {string} file
 * @returns {boolean}
 * @throws {Stop} Exit 3 when git cannot list the commit's tree.
 */
function presentAt(root, ref, file) {
  return git(root, ["ls-tree", "--name-only", ref, "--", file]).split("\n").includes(file);
}

/**
 * @description A file's text at a commit, or `null` when the commit does not hold it.
 * @param {string} root
 * @param {string} ref
 * @param {string} file
 * @returns {string | null}
 * @throws {Stop} Exit 3 when the commit holds the file and git cannot show it.
 */
function showAt(root, ref, file) {
  if (!presentAt(root, ref, file)) return null;
  return git(root, ["show", `${ref}:${file}`]);
}

/**
 * @description A file's text in the working tree, or `null` when it cannot be read.
 * @param {string} file Absolute.
 * @returns {string | null}
 */
function readOrNull(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * @description Reads the ledger's rows.
 * @param {unknown} ledger The parsed `ledger.json`.
 * @returns {Record<string, unknown>[]}
 */
function rowsOf(ledger) {
  const listed =
    ledger !== null && typeof ledger === "object" ? Reflect.get(ledger, "files") : undefined;
  return Array.isArray(listed)
    ? listed.filter((row) => row !== null && typeof row === "object")
    : [];
}

/**
 * @description The runner a ledger runs a test with: its row's first `vitest:` or `node:`
 *   collector label, else its first label of another kind, `""` for a row no collector runs, or
 *   `null` when the ledger has no row for the test.
 * @param {readonly Record<string, unknown>[]} rows The ledger's `files`.
 * @param {string} test
 * @returns {string | null}
 */
function runnerOf(rows, test) {
  const row = rows.find((each) => each["path"] === test);
  if (row === undefined) return null;
  const listed = row["collectors"];
  const labels = Array.isArray(listed) ? listed.filter((each) => typeof each === "string") : [];
  return labels.find((label) => RUNNABLE.test(label)) ?? labels[0] ?? "";
}

/**
 * @typedef {object} Context What every case of one run reads.
 * @property {string} root
 * @property {readonly Record<string, unknown>[]} rows The working tree's ledger rows.
 * @property {string} scratch
 * @property {ReadonlyMap<string, string>} bases Each base ref, resolved to its sha.
 * @property {string} base `--base`, as given.
 * @property {string | null} head `--head`, resolved, or `null` for the working tree.
 * @property {(run: ScopeRun) => Promise<Ran>} exec
 * @property {Map<string, Run>} clean The clean runs made so far, shared between cases.
 * @property {{ count: number }} runs
 * @property {Map<string, string | null>} texts Each file's text at a side, read once.
 * @property {Map<string, Set<string>>} listings Each directory's files at a ref, listed once.
 * @property {Map<string, Record<string, unknown>[]>} ledgers Each ref's ledger rows, read once.
 */

/**
 * @description A file's text on one side: the working tree's when `ref` is `null`, else git's at
 *   the ref; `null` when the side does not hold it. Each is read once per run.
 * @param {Context} context
 * @param {string | null} ref
 * @param {string} file
 * @returns {string | null}
 */
function textAt(context, ref, file) {
  const key = `${ref ?? "worktree"}\u0000${file}`;
  const known = context.texts.get(key);
  if (known !== undefined) return known;
  const text =
    ref === null ? readOrNull(path.join(context.root, file)) : showAt(context.root, ref, file);
  context.texts.set(key, text);
  return text;
}

/**
 * @description The files a ref holds below a directory, listed once per run.
 * @param {Context} context
 * @param {string} ref
 * @param {string} dir Repository-relative.
 * @returns {Set<string>}
 */
function listedAt(context, ref, dir) {
  const key = `${ref}\u0000${dir}`;
  const known = context.listings.get(key);
  if (known !== undefined) return known;
  const listed = new Set(
    git(context.root, ["ls-tree", "-r", "--name-only", ref, "--", dir]).split("\n")
  );
  context.listings.set(key, listed);
  return listed;
}

/**
 * @description The ledger rows a side reads: `ledger.json` at its ref, or the working tree's when
 *   the side is the working tree or the ref holds no readable ledger.
 * @param {Context} context
 * @param {string | null} ref
 * @returns {readonly Record<string, unknown>[]}
 */
function rowsAt(context, ref) {
  if (ref === null) return context.rows;
  const known = context.ledgers.get(ref);
  if (known !== undefined) return known;
  const text = showAt(context.root, ref, "ledger.json");
  /** @type {Record<string, unknown>[]} */
  let rows = [...context.rows];
  try {
    if (text !== null) rows = rowsOf(JSON.parse(text));
  } catch {
    rows = [...context.rows];
  }
  context.ledgers.set(ref, rows);
  return rows;
}

/**
 * @description The runner a case's test runs with: the working tree's ledger's, else the ledger's
 *   at the case's base, so a test the head deleted whole is still a case.
 * @param {Context} context
 * @param {Case} spec
 * @param {string} baseRef
 * @returns {string | null}
 */
function runnerFor(context, spec, baseRef) {
  return runnerOf(context.rows, spec.test) ?? runnerOf(rowsAt(context, baseRef), spec.test);
}

/**
 * @description Why a case cannot run, or `null` when its runner is a vitest config or node:test's
 *   integration tier: no row on either side, a row no collector runs, node:test's live tier, which
 *   needs a running API, or a runner of another kind.
 * @param {Case} spec
 * @param {string | null} runner
 * @returns {string | null}
 */
function runnerRefusal(spec, runner) {
  const named = `case ${spec.id}: field "test" names ${spec.test}`;
  if (runner === null) {
    return `${named}, which neither the working tree's ledger nor its base's runs with a vitest config or node:test's integration tier`;
  }
  if (runner === "") return `${named}, and no collector runs it`;
  if (LIVE_TIER.test(runner)) {
    return `${named}: a live-tier test needs a running API, which this tool does not start`;
  }
  if (runner.startsWith("vitest:") || INTEGRATION_TIER.test(runner)) return null;
  return `${named}, which runs with ${runner}: this tool runs a vitest config or node:test's integration tier`;
}

/**
 * @description One side of a case: its default scope, computed from that side's tree (the
 *   candidates are the tests its own ledger runs with the case's runner, read at that side), and
 *   the text of each scope file the side holds. A listed file git cannot show makes the side
 *   unreadable.
 * @param {Context} context
 * @param {string | null} ref `null` for the working tree.
 * @param {Case} spec
 * @param {string} runner
 * @returns {{ files: string[], texts: Map<string, string>, unreadable: boolean }}
 */
function sideOf(context, ref, spec, runner) {
  const dir = probeCommand(spec.test, runner, "").cwd;
  const held = ref === null ? null : listedAt(context, ref, dir);
  const candidates = rowsAt(context, ref).flatMap((row) => {
    const file = row["path"];
    if (typeof file !== "string" || file === spec.test) return [];
    if (runnerOf([row], file) !== runner || (held !== null && !held.has(file))) return [];
    const text = textAt(context, ref, file);
    return text === null ? [] : [{ path: file, text }];
  });
  const scope = scopeOf({
    test: spec.test,
    scope: spec.scope ?? [],
    subject: spec.subject,
    candidates,
  });
  const listed =
    ref === null
      ? null
      : new Set(
          git(context.root, ["ls-tree", "-r", "--name-only", ref, "--", ...scope]).split("\n")
        );
  /** @type {Map<string, string>} */
  const texts = new Map();
  let unreadable = false;
  for (const file of scope) {
    if (listed !== null && !listed.has(file)) continue;
    const text = textAt(context, ref, file);
    if (text !== null) texts.set(file, text);
    else if (listed !== null) unreadable = true;
  }
  return { files: [...texts.keys()].sort(byCodeUnit), texts, unreadable };
}

/**
 * @description Says whether the subject holds the search, by the same transform the mutated runs
 *   apply, which throws when it is absent.
 * @param {string} subject Absolute.
 * @param {string} text
 * @param {string} search
 * @returns {boolean}
 */
function holdsSearch(subject, text, search) {
  const probe = mutationPlugin({
    subject,
    search,
    replace: "",
    marker: null,
    served: {},
    servedLog: null,
    aliases: {},
  });
  try {
    probe.transform(text, subject);
    return true;
  } catch {
    return false;
  }
}

/**
 * @description The config one run loads: the package's own config, imported by absolute path and
 *   spread, with its root set to the package's directory, the plugin prepended, and the copies of
 *   the files the working tree lacks added to its `include`.
 * @param {string} config The package's config, absolute.
 * @param {string} root The package's directory, absolute.
 * @param {string} options The run's plugin options, absolute.
 * @returns {string}
 */
function configText(config, root, options) {
  return [
    'import { readFileSync } from "node:fs";',
    `import base from ${JSON.stringify(config)};`,
    `import { mutationPlugin } from ${JSON.stringify(PLUGIN_FILE)};`,
    `const options = JSON.parse(readFileSync(${JSON.stringify(options)}, "utf8"));`,
    'const include = options.include.length === 0 ? null : [...(base.test?.include ?? ["**/*.{test,spec}.?(c|m)[jt]s?(x)"]), ...options.include];',
    `export default { ...base, root: ${JSON.stringify(root)}, plugins: [mutationPlugin(options), ...(base.plugins ?? [])], ...(include === null ? {} : { test: { ...base.test, include } }) };`,
    "",
  ].join("\n");
}

/**
 * @description Makes one run of a case's files on one side, the way the hard probe runs its
 *   collector (vitest from the config's directory with the JSON reporter, node:test from the
 *   package directory with the results reporter and the loader hooks), and reads what it gave: a
 *   timeout, no report, a mutated run with no marker, or a served file the plugin never
 *   transformed, is a failure, never a verdict. A file the working tree lacks runs from a copy
 *   under the scratch directory, its imports resolved from its own path by the plugin.
 * @param {Context} context
 * @param {{ runner: string, side: Side, ref: string | null, mutated: boolean, files: readonly string[], texts: ReadonlyMap<string, string>, serve: boolean, spec: Case }} wanted
 *   `serve` serves the side's content for the files the working tree holds.
 * @returns {Promise<Run>}
 * @throws {Stop} Exit 3 when the runner does not start.
 */
async function scopeRun(context, { runner, side, ref, mutated, files, texts, serve, spec }) {
  if (files.length === 0) return { failure: null, report: new Map() };
  const { root, scratch } = context;
  context.runs.count += 1;
  const stem = path.join(scratch, `run-${context.runs.count}`);
  const report = `${stem}.report.json`;
  const marker = mutated ? `${stem}.applied` : null;
  const servedLog = `${stem}.served`;
  /** @type {Record<string, string>} */
  const paths = {};
  /** @type {Record<string, string>} */
  const served = {};
  /** @type {Record<string, string>} */
  const aliases = {};
  /** @type {Record<string, string>} */
  const named = {};
  for (const file of files) {
    const original = path.join(root, file);
    const text = texts.get(file) ?? "";
    if (existsSync(original)) {
      paths[file] = original;
      if (serve) served[original] = text;
      continue;
    }
    const copy = path.join(scratch, `at-${ref ?? "worktree"}`, file);
    mkdirSync(path.dirname(copy), { recursive: true });
    writeFileSync(copy, text);
    paths[file] = copy;
    served[copy] = text;
    aliases[copy] = original;
    named[copy] = file;
  }
  const options = `${stem}.options.json`;
  writeFileSync(
    options,
    JSON.stringify({
      subject: mutated ? path.join(root, spec.subject) : null,
      search: spec.search,
      replace: spec.replace,
      marker,
      served,
      servedLog,
      aliases,
      include: Object.keys(aliases),
    })
  );
  const probe = probeCommand(files[0] ?? "", runner, "");
  const cwd = path.join(root, probe.cwd);
  const targets = files.map((file) =>
    paths[file] === path.join(root, file)
      ? path.posix.relative(probe.cwd, file)
      : (paths[file] ?? file)
  );
  /** @type {{ args: string[], env: Record<string, string> | null }} */
  let how;
  if (runner.startsWith("vitest:")) {
    const generated = `${stem}.config.mjs`;
    const config = path.join(root, runner.slice("vitest:".length));
    writeFileSync(generated, configText(config, cwd, options));
    how = {
      args: [
        path.join(ROOT, "node_modules/vitest/vitest.mjs"),
        "run",
        ...targets,
        "--config",
        generated,
        "--reporter=json",
        `--outputFile=${report}`,
      ],
      env: null,
    };
  } else {
    how = {
      args: [
        "--conditions",
        "development",
        "--import",
        REGISTER_FILE,
        "--import",
        "tsx",
        "--test",
        `--test-reporter=${RESULTS_REPORTER_FILE}`,
        `--test-reporter-destination=${report}`,
        "--test-force-exit",
        "--test-concurrency=1",
        `--test-timeout=${NODE_TEST_TIMEOUT}`,
        ...targets,
      ],
      env: { [OPTIONS_VARIABLE]: options },
    };
  }
  const ran = await context.exec({
    root,
    command: process.execPath,
    args: how.args,
    cwd,
    side,
    mutated,
    files: [...files],
    paths,
    served,
    report,
    marker,
    servedLog,
    env: how.env,
  });
  if (ran.spawnError !== null) {
    throw new Stop(
      EXIT.UNREAD,
      `mutation-diff: unread: the runner did not start: ${ran.spawnError}`
    );
  }
  if (ran.timedOut) return { failure: "timeout", report: new Map() };
  const text = readOrNull(report);
  /** @type {unknown} */
  let json = null;
  try {
    json = text === null ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  const read = reportOf(json, root, named);
  if ("error" in read) return { failure: "runner-failed", report: new Map() };
  if (marker !== null && !existsSync(marker)) return { failure: "not-applied", report: read.value };
  const logged = new Set((readOrNull(servedLog) ?? "").split("\n"));
  if (Object.keys(served).some((file) => !logged.has(file))) {
    return { failure: "not-served", report: read.value };
  }
  return { failure: null, report: read.value };
}

/**
 * @description Decides one case: its scope on each side, its blocks on each side, its four runs (the
 *   clean ones shared with any case of the same side, ref, runner and scope) and its verdict. A case
 *   whose search, base scope or blocks already decide it runs nothing.
 * @param {Context} context
 * @param {Case} spec
 * @returns {Promise<{ entry: Record<string, unknown>, decided: import("./lib/mutation-diff-core.mjs").Decided }>}
 */
async function decideCase(context, spec) {
  const { root } = context;
  const baseRef = context.bases.get(spec.base ?? context.base) ?? "";
  const runner = runnerFor(context, spec, baseRef) ?? "";
  const subjectPath = path.join(root, spec.subject);
  const subjectText = readOrNull(subjectPath);
  const searchFound = subjectText !== null && holdsSearch(subjectPath, subjectText, spec.search);
  const base = sideOf(context, baseRef, spec, runner);
  const head = sideOf(context, context.head, spec, runner);
  /** @type {(texts: ReadonlyMap<string, string>) => ReturnType<typeof blocksOf> | null} */
  const blocksAt = (texts) => {
    const text = texts.get(spec.test);
    return text === undefined ? null : blocksOf(spec.test, text);
  };
  const blocks = { base: blocksAt(base.texts), head: blocksAt(head.texts) };
  /** @type {Record<string, Record<Side, Resolution>>} */
  const resolutions = Object.fromEntries(
    spec.blocks.map((id) => [
      id,
      {
        base: blocks.base === null ? { state: "missing" } : resolveBlock(blocks.base, id),
        head: blocks.head === null ? { state: "missing" } : resolveBlock(blocks.head, id),
      },
    ])
  );
  const files = { base: base.files, head: head.files };
  const ready =
    searchFound &&
    files.base.length > 0 &&
    spec.blocks.every((id) => {
      const resolution = resolutions[id];
      if (resolution === undefined || resolution.base.state !== "found") return false;
      return spec.kind === "rewrite"
        ? resolution.head.state === "found"
        : resolution.head.state === "missing";
    });
  const idle = { failure: null, report: new Map() };
  let runs = { base: { clean: idle, mutated: idle }, head: { clean: idle, mutated: idle } };
  if (ready) {
    /** @type {(each: Side, mutated: boolean) => Promise<Run>} */
    const make = async (each, mutated) => {
      const held = each === "base" ? base : head;
      if (held.unreadable) {
        return {
          failure: each === "base" ? "base-unreadable" : "runner-failed",
          report: new Map(),
        };
      }
      const ref = each === "base" ? baseRef : context.head;
      const key = [each, ref ?? "worktree", runner, ...files[each]].join("\u0000");
      const shared = mutated ? undefined : context.clean.get(key);
      if (shared !== undefined) return shared;
      const made = await scopeRun(context, {
        runner,
        side: each,
        ref,
        mutated,
        files: files[each],
        texts: held.texts,
        serve: each === "base" || context.head !== null,
        spec,
      });
      if (!mutated) context.clean.set(key, made);
      return made;
    };
    const baseClean = await make("base", false);
    const headClean = await make("head", false);
    const baseMutated = await make("base", true);
    const headMutated = await make("head", true);
    runs = {
      base: { clean: baseClean, mutated: baseMutated },
      head: { clean: headClean, mutated: headMutated },
    };
  }
  const decided = decide({
    kind: spec.kind,
    test: spec.test,
    blocks: spec.blocks,
    searchFound,
    resolutions,
    runs,
    files,
  });
  const ownBase = spec.base === undefined ? null : baseRef;
  return {
    entry: caseEntry(spec, files, decided, ownBase, bodyHashes(spec.blocks, blocks)),
    decided,
  };
}

/**
 * @description Runs one run in its own process group under `RUN_TIMEOUT`. A run with variables of
 *   its own goes through POSIX `env(1)`, which sets them for that child alone, since the hard
 *   probe's `runTool` hands every child this process's environment.
 * @param {ScopeRun} run
 * @returns {Promise<Ran>}
 */
function spawnRun(run) {
  if (run.env === null) return runTool(run.command, run.args, run.cwd, RUN_TIMEOUT);
  const assignments = Object.entries(run.env).map(([name, value]) => `${name}=${value}`);
  return runTool("env", [...assignments, run.command, ...run.args], run.cwd, RUN_TIMEOUT);
}

/**
 * @description Writes the record without ever truncating an earlier one: the text goes to a temp
 *   file beside the target, created exclusively under `pendingTempPath`'s name, and is then renamed
 *   onto it; a failure removes the temp file and leaves the target as it was.
 * @param {string} out
 * @param {string} text
 * @returns {string | null} Why the write failed, or `null`.
 */
function writeOut(out, text) {
  const target = existsSync(out) ? realpathSync(out) : out;
  const temp = pendingTempPath(target, `${process.pid}.${randomBytes(6).toString("hex")}`);
  let created = false;
  try {
    const fd = openSync(temp, "wx");
    created = true;
    try {
      writeSync(fd, text);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, target);
    return null;
  } catch (error) {
    if (created) rmSync(temp, { force: true });
    return messageOf(error);
  }
}

/**
 * @description Reads the case file and the ledger, resolves the bases and the head, refuses a case
 *   whose runner this tool does not run (`runnerRefusal`), stops on an empty `DATABASE_URL`
 *   before a node:test case, refuses an
 *   `--only` that names no case, and decides every selected case in a scratch directory it removes.
 * @param {Options} options
 * @param {Seams} seams
 * @returns {Promise<CliResult>}
 * @throws {Stop} Exit 3 on any input or environment failure.
 */
async function mutationRun(options, seams) {
  /** @type {string} */
  let text;
  try {
    text = readFileSync(options.cases, "utf8");
  } catch (error) {
    throw new Stop(EXIT.UNREAD, `mutation-diff: unread: ${options.cases}: ${messageOf(error)}`);
  }
  const parsed = parseCases(text);
  if ("error" in parsed) return cliResult(EXIT.USAGE, [`mutation-diff: refused: ${parsed.error}`]);
  const unknown = options.only.filter((id) => !parsed.value.some((spec) => spec.id === id));
  if (unknown.length > 0) {
    return cliResult(EXIT.USAGE, [
      `mutation-diff: refused: --only names no case: ${unknown.join(", ")}`,
    ]);
  }
  const selected =
    options.only.length === 0
      ? parsed.value
      : parsed.value.filter((spec) => options.only.includes(spec.id));
  /** @type {Record<string, unknown>[]} */
  let rows;
  try {
    rows = rowsOf(JSON.parse(readFileSync(path.join(options.root, "ledger.json"), "utf8")));
  } catch (error) {
    throw new Stop(EXIT.UNREAD, `mutation-diff: unread: ledger.json: ${messageOf(error)}`);
  }
  /** @type {(ref: string) => string} */
  const commit = (ref) =>
    git(options.root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim();
  const refs = new Set([
    options.base,
    ...selected.flatMap((spec) => (spec.base === undefined ? [] : [spec.base])),
  ]);
  const bases = new Map([...refs].map((ref) => [ref, commit(ref)]));
  const head = options.head === null ? null : commit(options.head);
  /** @type {Context} */
  const context = {
    root: options.root,
    rows,
    scratch: "",
    bases,
    base: options.base,
    head,
    exec: seams.exec ?? spawnRun,
    clean: new Map(),
    runs: { count: 0 },
    texts: new Map(),
    listings: new Map(),
    ledgers: new Map(),
  };
  /** @type {(spec: Case) => string | null} */
  const runnerOfCase = (spec) =>
    runnerFor(context, spec, bases.get(spec.base ?? options.base) ?? "");
  for (const spec of selected) {
    const refusal = runnerRefusal(spec, runnerOfCase(spec));
    if (refusal !== null) return cliResult(EXIT.USAGE, [`mutation-diff: refused: ${refusal}`]);
  }
  const environment = seams.env ?? process.env;
  const needsDatabase = selected.some((spec) => runnerOfCase(spec)?.startsWith("node:") === true);
  if (needsDatabase && (environment["DATABASE_URL"] ?? "") === "") {
    throw new Stop(
      EXIT.UNREAD,
      `mutation-diff: unread: ${NO_DATABASE}; export the test environment before a node:test case`
    );
  }
  try {
    context.scratch = mkdtempSync(path.join(tmpdir(), "mutation-diff-"));
  } catch (error) {
    throw new Stop(EXIT.UNREAD, `mutation-diff: unread: no scratch directory: ${messageOf(error)}`);
  }
  try {
    const results = [];
    for (const spec of selected) results.push(await decideCase(context, spec));
    const baseSha = bases.get(options.base) ?? "";
    const record = recordOf({
      head: head ?? "worktree",
      base: baseSha,
      cases: results.map((result) => result.entry),
    });
    const rendered = await renderJson(path.join(ROOT, RENDERED_AS), record);
    const failed = writeOut(options.out, rendered);
    if (failed !== null) {
      throw new Stop(
        EXIT.UNREAD,
        `mutation-diff: unread: ${options.out} could not be written: ${failed}`
      );
    }
    const lines = results.map(({ decided }, index) => {
      const reason = decided.reason === null ? "" : ` (${decided.reason})`;
      return `mutation-diff: ${selected[index]?.id}: ${decided.verdict}${reason}`;
    });
    return cliResult(
      exitOf(
        results.map((result) => result.decided),
        options.requirement
      ),
      [...lines, `mutation-diff: wrote ${options.out}: ${results.length} cases against ${baseSha}`]
    );
  } finally {
    rmSync(context.scratch, { recursive: true, force: true });
  }
}

/**
 * @description Runs the command.
 * @param {readonly string[]} argv
 * @param {Seams} [seams]
 * @returns {Promise<CliResult>} The text to print and the exit code.
 */
export async function main(argv, seams = {}) {
  const parsed = parseArguments(argv);
  if ("error" in parsed) return cliResult(EXIT.USAGE, [`mutation-diff: ${parsed.error}`, USAGE]);
  try {
    return await mutationRun(parsed.value, seams);
  } catch (error) {
    if (error instanceof Stop) return cliResult(error.code, [error.message]);
    return cliResult(EXIT.UNREAD, [`mutation-diff: unread: the run failed: ${messageOf(error)}`]);
  }
}

if (isEntryPoint(import.meta.url)) {
  const { code, output } = await main(process.argv.slice(2));
  (code === EXIT.CLEAN ? process.stdout : process.stderr).write(output, () => process.exit(code));
}
