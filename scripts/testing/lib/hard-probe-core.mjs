// @ts-check
/**
 * @file hard-probe-core.mjs
 * @description The pure core of the hard probe: which blocks of the ledger it probes, the command
 *   that runs one block alone, the outcome that command's output reads as, the subject a test's
 *   import closure gives, and `probes.json` with its per-class summary. It spawns nothing and writes
 *   nothing; `scripts/testing/hard-probe.mjs` runs the commands in its probe worktree.
 *
 *   SAMPLING. Every EXISTENCE-ONLY, CONDITIONAL-ONLY and TITLE-CONTRADICTION block of a row whose
 *   verdict is ADJUDICATE, runnable or not, so the record accounts for each one; and a seeded random
 *   5 % (rounded up) of the BEHAVIOURAL blocks of the rows a vitest config or the node:test
 *   collector runs, the classifier's false-negative rate. The draw is a Fisher-Yates shuffle of the
 *   population in code-unit order of its ids, driven by mulberry32 from the seed, so a seed names
 *   one sample on every machine.
 *
 *   OUTCOMES. GREEN: the block passed with its subject gutted, so it is decorative. RED: it failed,
 *   which says it restricts something, a weak signal, since a block that fails ungutted is RED too.
 *   LOAD-ERROR: inconclusive, with the reason: `load-error` (the file did not load), `hook-failure`
 *   (a `beforeAll`, `afterAll`, `before` or `after` hook of its describe or of the file failed, so
 *   the block was skipped or cancelled, or passed inside a failed suite), `no-test-ran` (the pattern
 *   ran no block), `no-report` (no report for the file), `timeout`, and, without a run,
 *   `no-collector`, `no-subject` (the test reaches no first-party production module, the listed
 *   test infrastructure aside) and
 *   `nothing-gutted` (its subject exports no function or method). A class's GREEN rate counts its
 *   conclusive probes, GREEN and RED, alone.
 *
 *   DETERMINISTIC. Every object of the record is written with its keys in code-unit order, the
 *   probes keyed by block id, and nothing carries a clock, a path outside the repository or a
 *   duration, so one sample of one commit renders the same bytes.
 * @layer infrastructure
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BLOCK_CLASS } from "@packages/eslint-plugin-testing";
import { SOURCE_EXTENSIONS } from "./dependency-sites.mjs";
import { shapeOf } from "./ledger-core.mjs";
import { byCodeUnit, isObject, renderJson } from "./record-helpers.mjs";

/** The version of `probes.json`; a change of its shape raises it. */
const PROBES_VERSION = 1;

/** What a probe found. */
const OUTCOME = Object.freeze(
  /** @type {const} */ ({ GREEN: "GREEN", RED: "RED", LOAD_ERROR: "LOAD-ERROR" })
);

/** The block classes every block of an ADJUDICATE row is probed for. */
const TARGETED = Object.freeze([
  BLOCK_CLASS.EXISTENCE_ONLY,
  BLOCK_CLASS.CONDITIONAL_ONLY,
  BLOCK_CLASS.TITLE_CONTRADICTION,
]);

/** The share of the runnable BEHAVIOURAL blocks the sample draws. */
const BEHAVIOURAL_FRACTION = 0.05;

/** The share of GREEN probes at which a class becomes a lint-rule candidate. */
const LINT_RULE_RATE = 0.9;

/** The collectors whose runners take a name pattern: a vitest config, or node:test's runner. */
const RUNNABLE = /^(vitest|node):/;

/** The node:test reporter `apps/api/scripts/run-tests.sh` reads its verdict from. */
const SUMMARY_REPORTER = "scripts/testing/node-summary-reporter.mjs";

/** The per-test budget `run-tests.sh` gives node:test, in milliseconds. */
const NODE_TEST_TIMEOUT = 30_000;

/** The reporter's one machine line, as `run-tests.sh` matches it. */
const SUMMARY_LINE =
  /^@@SUMMARY tests=(\d+) pass=(\d+) fail=(\d+) cancelled=(\d+) skipped=(\d+) todo=(\d+)$/;

/** The reporter's line for a failed test: its name, then its location. */
const FAILED_LINE = /^failed: (.+) \([^()]*\)$/;

/** The reporter's detail line for a describe's or a file's own hook, never a per-test one. */
const SUITE_HOOK_FAILED = /^\s+hookFailed: failed running (before|after) hook$/;

/** A title's interpolations: a template literal's, a `.each` title's format and `$name`. */
const INTERPOLATION = /\$\{[^}]*\}|%[sdifjoO#$]|\$[A-Za-z_][\w.]*/g;

/** The directories that hold test code, never the code a test exercises. */
const TEST_CODE_DIRECTORY = /(^|\/)(tests|__tests__|e2e|fixtures|__mocks__)\//;

/** A test runner's configuration: `vitest.config.*`, `vitest.<name>.config.*`, `playwright.config.*`. */
const TEST_CONFIG = /^(vitest|playwright)\.config\.|^vitest\.[^/]+\.config\./;

/**
 * The modules that exist to support tests rather than to ship, never a subject: gutting one breaks
 * the suites that run on it, not the behaviour they test. Exact paths or narrow globs, each with
 * why; none of them is imported at run time by a production file (`infra/prisma/src/index.ts`
 * re-exports the test client for the suites, and only scripts and tests call it).
 */
const TEST_INFRASTRUCTURE = Object.freeze([
  // The Prisma client the integration suites seed and read through.
  "infra/prisma/src/test-client.ts",
  // The test-only entry vitest resolves `@infra/prisma` to (packages/vitest-shared/src/index.ts).
  "infra/prisma/src/vitest-entry.ts",
  // The vitest configuration factory and the determinism helpers every suite runs on.
  "packages/vitest-shared/**",
  // The MSW helpers the provider suites mock HTTP with.
  "packages/providers/shared/src/test-utils/**",
  // The coverage floors apps/api's vitest configuration reads.
  "apps/api/vitest.coverage-thresholds.ts",
  // The setup file the client's story tests run with.
  "apps/client/.storybook/vitest.setup.ts",
]);

/** The file the rendered record is committed as, whose Prettier configuration it is rendered under. */
const PROBES_FILE = fileURLToPath(new URL("../../../probes.json", import.meta.url));

/**
 * @template T
 * @typedef {{ value: T } | { error: string }} Result
 */

/**
 * @typedef {typeof OUTCOME[keyof typeof OUTCOME]} Outcome
 * @typedef {"targeted" | "behavioural" | "only"} Sample
 *
 * @typedef {object} ProbeBlock A ledger block, as far as the probe reads it.
 * @property {string} id `path::title`.
 * @property {string} blockClass
 *
 * @typedef {object} ProbeRow A ledger row, as far as the probe reads it.
 * @property {string} path
 * @property {string | null} verdict
 * @property {readonly string[] | null} collectors
 * @property {readonly ProbeBlock[]} blocks
 *
 * @typedef {object} ProbeLedger The ledger, as far as the probe reads it.
 * @property {readonly ProbeRow[]} files
 *
 * @typedef {object} PlannedProbe One block to probe.
 * @property {string} id
 * @property {string} path The test, repository-relative.
 * @property {string} blockClass
 * @property {Sample} sample Why it is probed.
 * @property {string | null} runner The collector label that runs it, `null` when none can.
 *
 * @typedef {object} Plan
 * @property {PlannedProbe[]} probes In code-unit order of their ids.
 * @property {number} pool The runnable BEHAVIOURAL blocks the sample was drawn from.
 *
 * @typedef {object} PlanOptions
 * @property {number} seed An unsigned 32-bit integer.
 * @property {number | null} limit At most this many probes, from the start of the plan.
 * @property {string | null} only The one block id to probe instead of the sample.
 *
 * @typedef {object} Command The command that runs one block.
 * @property {"vitest" | "node"} runner
 * @property {string} cwd Repository-relative, `.` for the root.
 * @property {string[]} argv
 * @property {string} file The test, relative to `cwd`.
 * @property {string} pattern The name pattern it passes.
 *
 * @typedef {object} Verdict
 * @property {Outcome} outcome
 * @property {string | null} reason Why a LOAD-ERROR is inconclusive, else `null`.
 *
 * @typedef {object} RecordedCommand
 * @property {string[]} argv
 * @property {string} cwd
 *
 * @typedef {object} ProbeEntry One probe, as the command hands it over.
 * @property {string} id
 * @property {string} blockClass
 * @property {RecordedCommand | null} command `null` when nothing ran.
 * @property {number} gutted How many functions and methods the subject had gutted.
 * @property {Outcome} outcome
 * @property {string[]} partial The subject's exports left ungutted, as `file: export`, sorted.
 * @property {string | null} reason
 * @property {Sample} sample
 * @property {string[]} subject
 * @property {string} subjectHash
 * @property {string} testHash
 *
 * @typedef {PlanOptions & { fraction: number }} Selection What a run selected its probes by: its
 *   options and the share of the BEHAVIOURAL population the sample draws.
 * @property {string | null} only
 * @property {number} seed
 *
 * @typedef {object} ClassSummary
 * @property {number} GREEN
 * @property {number} LOAD-ERROR
 * @property {number} RED
 * @property {number} conclusive GREEN plus RED.
 * @property {number | null} greenRate GREEN over the conclusive probes, to four decimals; `null`
 *   when there is none.
 * @property {boolean} lintRule Whether {@link LINT_RULE_RATE} of the probes are GREEN.
 * @property {number} probes
 *
 * @typedef {Omit<ProbeEntry, "id"> & { sha: string }} RecordedProbe
 *
 * @typedef {object} ProbesRecord `probes.json`.
 * @property {Record<string, RecordedProbe>} probes By block id.
 * @property {Selection} selection
 * @property {string} sha The probed commit.
 * @property {Record<string, ClassSummary>} summary By block class.
 * @property {number} version
 */

/**
 * @description mulberry32: a 32-bit generator whose sequence is the same on every engine, since it
 *   is built from `Math.imul` and unsigned shifts alone.
 * @param {number} seed
 * @returns {() => number} Each call a number in [0, 1).
 */
function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @description Draws `count` items with a seeded Fisher-Yates shuffle.
 * @template T
 * @param {readonly T[]} items In a fixed order.
 * @param {number} count
 * @param {number} seed
 * @returns {T[]}
 */
function draw(items, count, seed) {
  const random = generator(seed);
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    const held = /** @type {T} */ (shuffled[index]);
    shuffled[index] = /** @type {T} */ (shuffled[other]);
    shuffled[other] = held;
  }
  return shuffled.slice(0, count);
}

/**
 * @description Names the collector that runs a row by a name pattern.
 * @param {readonly string[] | null} collectors The row's reach labels.
 * @returns {string | null}
 */
function runnerOf(collectors) {
  return (collectors ?? []).find((label) => RUNNABLE.test(label)) ?? null;
}

/**
 * @description Plans a run: the targeted blocks and the BEHAVIOURAL sample, in code-unit order of
 *   their ids and capped at `limit`, or the one block `only` names, whatever its class.
 * @param {ProbeLedger} ledger
 * @param {PlanOptions} options
 * @returns {Result<Plan>} The plan, or why `only` names no block.
 */
export function planProbes(ledger, { seed, limit, only }) {
  const blocks = ledger.files.flatMap((row) =>
    row.blocks.map((entry) => ({ row, entry, runner: runnerOf(row.collectors) }))
  );
  /** @type {(item: typeof blocks[number], sample: Sample) => PlannedProbe} */
  const planned = ({ row, entry, runner }, sample) => ({
    id: entry.id,
    path: row.path,
    blockClass: entry.blockClass,
    sample,
    runner,
  });
  const pool = blocks
    .filter(({ entry, runner }) => entry.blockClass === BLOCK_CLASS.BEHAVIOURAL && runner !== null)
    .sort((left, right) => byCodeUnit(left.entry.id, right.entry.id));
  if (only !== null) {
    const found = blocks.find(({ entry }) => entry.id === only);
    if (found === undefined) return { error: `--only ${only} names no block of the ledger` };
    return { value: { probes: [planned(found, "only")], pool: pool.length } };
  }
  const targeted = blocks.filter(
    ({ row, entry }) => row.verdict === "ADJUDICATE" && TARGETED.includes(entry.blockClass)
  );
  const sampled = draw(pool, Math.ceil(pool.length * BEHAVIOURAL_FRACTION), seed);
  const probes = [
    ...targeted.map((item) => planned(item, "targeted")),
    ...sampled.map((item) => planned(item, "behavioural")),
  ].sort((left, right) => byCodeUnit(left.id, right.id));
  return { value: { probes: limit === null ? probes : probes.slice(0, limit), pool: pool.length } };
}

/**
 * @description Escapes a title segment for a regular expression; an interpolation matches any text.
 * @param {string} segment
 * @returns {string}
 */
function segmentPattern(segment) {
  return segment
    .split(INTERPOLATION)
    .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
}

/**
 * @description The pattern that selects one block by its full name, the titles of the blocks
 *   around it and its own joined by spaces, which is what vitest's `-t` and node:test's
 *   `--test-name-pattern` both match.
 * @param {readonly string[]} describe The titles around the block, outermost first.
 * @param {string} title
 * @returns {string}
 */
export function testNamePattern(describe, title) {
  return `^${[...describe, title].map(segmentPattern).join(" ")}$`;
}

/**
 * @description Builds the command that runs one block alone: vitest from its config's directory
 *   with the JSON reporter, or node:test the way `run-tests.sh` runs one file, from the package
 *   directory above the runner's `scripts/`.
 * @param {string} file The test, repository-relative.
 * @param {string} runner A `vitest:<config>` or `node:<runner>#<tier>` label.
 * @param {string} pattern
 * @returns {Command}
 */
export function probeCommand(file, runner, pattern) {
  if (runner.startsWith("vitest:")) {
    const config = runner.slice("vitest:".length);
    const cwd = path.posix.dirname(config);
    const relative = path.posix.relative(cwd, file);
    return {
      runner: "vitest",
      cwd,
      file: relative,
      pattern,
      argv: [
        "pnpm",
        "exec",
        "vitest",
        "run",
        relative,
        "--config",
        path.posix.basename(config),
        "-t",
        pattern,
        "--reporter=json",
      ],
    };
  }
  const script = runner.slice("node:".length).split("#")[0] ?? "";
  const cwd = path.posix.dirname(path.posix.dirname(script));
  const relative = path.posix.relative(cwd, file);
  const reporter = path.posix.relative(cwd, SUMMARY_REPORTER);
  return {
    runner: "node",
    cwd,
    file: relative,
    pattern,
    argv: [
      "node",
      "--conditions",
      "development",
      "--import",
      "tsx",
      "--test",
      `--test-reporter=${reporter.startsWith("../") ? reporter : `./${reporter}`}`,
      "--test-reporter-destination=stdout",
      "--test-force-exit",
      "--test-concurrency=1",
      `--test-timeout=${NODE_TEST_TIMEOUT}`,
      `--test-name-pattern=${pattern}`,
      relative,
    ],
  };
}

/** @param {string | null} reason @returns {Verdict} */
const inconclusive = (reason) => ({ outcome: OUTCOME.LOAD_ERROR, reason });

/**
 * @description Says whether a name a runner reports is the test file, as an absolute path or as the
 *   argument it was given.
 * @param {unknown} name
 * @param {string} file Relative to the command's directory.
 * @returns {boolean}
 */
function namesFile(name, file) {
  return typeof name === "string" && (name === file || name.endsWith(`/${file}`));
}

/**
 * @description Finds vitest's JSON report in what a run printed: the last line that parses as an
 *   object holding a `testResults` list. A suite's own JSON log lines share stdout with it, before
 *   and after it, so a line that merely parses is not the report.
 * @param {string} stdout
 * @returns {unknown[] | null} Its `testResults`, or `null` when no line is the report.
 */
function reportedResults(stdout) {
  /** @type {unknown[] | null} */
  let results = null;
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const listed = isObject(parsed) ? parsed["testResults"] : undefined;
    if (Array.isArray(listed)) results = listed;
  }
  return results;
}

/**
 * @description Reads vitest's JSON report. A failed run of a test the pattern matches is RED: vitest
 *   charges a failed `beforeEach` to the test itself. Then the file's own state: a failed file that
 *   collected the block, skipped or passed, failed a `beforeAll` or `afterAll` of its describe or
 *   of the file, a hook failure; a failed file that collected no test did not load. Else a passed
 *   block is GREEN.
 * @param {Command} command
 * @param {string} stdout
 * @returns {Verdict}
 */
function vitestOutcome(command, stdout) {
  const files = (reportedResults(stdout) ?? [])
    .filter(isObject)
    .filter((result) => namesFile(result["name"], command.file));
  if (files.length === 0) return inconclusive("no-report");
  const matcher = new RegExp(command.pattern);
  const tests = files.flatMap((result) => {
    const listed = result["assertionResults"];
    return Array.isArray(listed) ? listed.filter(isObject) : [];
  });
  const matched = tests.filter(
    (test) => typeof test["fullName"] === "string" && matcher.test(test["fullName"])
  );
  if (matched.some((test) => test["status"] === "failed")) {
    return { outcome: OUTCOME.RED, reason: null };
  }
  const failed = files.some((result) => result["status"] === "failed");
  if (failed && matched.length > 0) return inconclusive("hook-failure");
  if (failed && tests.length === 0) return inconclusive("load-error");
  if (matched.some((test) => test["status"] === "passed")) {
    return { outcome: OUTCOME.GREEN, reason: null };
  }
  return inconclusive("no-test-ran");
}

/**
 * @description Reads node:test's summary reporter: its last `@@SUMMARY` line; a failure named by
 *   the file itself, which is how node reports a file that did not load; and a `hookFailed` detail
 *   of a `before` or `after` hook, which a describe's or the file's own hook fails with, whether it
 *   cancels the block, fails it or lets it pass. A failed `beforeEach` names its own hook and fails
 *   the block, which is RED.
 * @param {Command} command
 * @param {string} stdout
 * @returns {Verdict}
 */
function nodeOutcome(command, stdout) {
  const lines = stdout.split("\n");
  const counts = lines.map((line) => SUMMARY_LINE.exec(line)).findLast((match) => match !== null);
  if (counts === undefined || counts === null) return inconclusive("no-report");
  const loadFailed = lines.some((line) => namesFile(FAILED_LINE.exec(line)?.[1], command.file));
  if (loadFailed) return inconclusive("load-error");
  if (lines.some((line) => SUITE_HOOK_FAILED.test(line))) return inconclusive("hook-failure");
  const [, , pass, fail, cancelled] = counts.map(Number);
  if ((fail ?? 0) > 0 || (cancelled ?? 0) > 0) return { outcome: OUTCOME.RED, reason: null };
  if ((pass ?? 0) > 0) return { outcome: OUTCOME.GREEN, reason: null };
  return inconclusive("no-test-ran");
}

/**
 * @description Reads the outcome of one block's run from what its runner printed.
 * @param {Command} command
 * @param {string} stdout
 * @returns {Verdict}
 */
export function outcomeOf(command, stdout) {
  return command.runner === "vitest"
    ? vitestOutcome(command, stdout)
    : nodeOutcome(command, stdout);
}

/**
 * @description The subject of a test: the production code it exercises, every first-party source
 *   module its import closure reaches, wherever it lives (`src/` of a package, or `lib/`,
 *   `components/`, `hooks/` and `app/` of a Next app), a module only its own test imports
 *   included. Left out: a test-shaped file, a helper or a runner the ledger lists (`shapeOf`), a
 *   test runner's configuration, anything under a `tests/`, `__tests__/`, `e2e/`, `fixtures/` or
 *   `__mocks__/` directory, a module of {@link TEST_INFRASTRUCTURE}, a declaration file and a file
 *   that is no source module.
 * @param {readonly string[]} closure What the import closure reached: tracked, so first-party,
 *   files only.
 * @returns {string[]} Sorted.
 */
export function subjectModules(closure) {
  return closure
    .filter(
      (file) =>
        SOURCE_EXTENSIONS.includes(path.posix.extname(file)) &&
        !file.endsWith(".d.ts") &&
        shapeOf(file) === null &&
        !TEST_CODE_DIRECTORY.test(file) &&
        !TEST_CONFIG.test(path.posix.basename(file)) &&
        !TEST_INFRASTRUCTURE.some((pattern) => path.posix.matchesGlob(file, pattern))
    )
    .sort(byCodeUnit);
}

/** @param {string} text @returns {string} */
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/**
 * @description Hashes what a probe's outcome depends on: the test file's text, and each subject
 *   module's path with the hash of its text, in code-unit order of the paths.
 * @param {string} testText
 * @param {ReadonlyArray<{ readonly path: string, readonly text: string }>} subject
 * @returns {{ testHash: string, subjectHash: string }}
 */
export function hashes(testText, subject) {
  const lines = [...subject]
    .sort((left, right) => byCodeUnit(left.path, right.path))
    .map((module) => `${module.path}\0${sha256(module.text)}\n`);
  return { testHash: sha256(testText), subjectHash: sha256(lines.join("")) };
}

/**
 * @description Copies a JSON value with every object's keys in code-unit order.
 * @param {unknown} value
 * @returns {unknown}
 */
function sortedKeys(value) {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => byCodeUnit(left, right))
      .map(([key, entry]) => [key, sortedKeys(entry)])
  );
}

/**
 * @description Counts each class's outcomes, its GREEN rate over its conclusive probes (GREEN and
 *   RED; a LOAD-ERROR says nothing either way) and whether it is a lint-rule candidate, which a
 *   class with no conclusive probe never is.
 * @param {readonly ProbeEntry[]} entries
 * @returns {Record<string, ClassSummary>}
 */
function summaryOf(entries) {
  /** @type {Record<string, ClassSummary>} */
  const summary = {};
  for (const blockClass of [...new Set(entries.map((probe) => probe.blockClass))]) {
    const own = entries.filter((probe) => probe.blockClass === blockClass);
    /** @param {Outcome} outcome */
    const count = (outcome) => own.filter((probe) => probe.outcome === outcome).length;
    const conclusive = count(OUTCOME.GREEN) + count(OUTCOME.RED);
    const rate = conclusive === 0 ? null : count(OUTCOME.GREEN) / conclusive;
    summary[blockClass] = {
      GREEN: count(OUTCOME.GREEN),
      "LOAD-ERROR": count(OUTCOME.LOAD_ERROR),
      RED: count(OUTCOME.RED),
      conclusive,
      greenRate: rate === null ? null : Math.round(rate * 10_000) / 10_000,
      lintRule: rate !== null && rate >= LINT_RULE_RATE,
      probes: own.length,
    };
  }
  return summary;
}

/**
 * @description Builds `probes.json`: each probe by its block id with the probed commit, the
 *   options the run planned with and the fraction its sample drew, and the summary derived from
 *   the probes, every key in code-unit order.
 * @param {{ sha: string, options: PlanOptions, entries: readonly ProbeEntry[] }} input
 * @returns {ProbesRecord}
 */
export function probesRecord({ sha, options, entries }) {
  /** @type {Record<string, RecordedProbe>} */
  const probes = {};
  for (const { id, ...probe } of entries) probes[id] = { ...probe, sha };
  const selection = { ...options, fraction: BEHAVIOURAL_FRACTION };
  return /** @type {ProbesRecord} */ (
    sortedKeys({ probes, selection, sha, summary: summaryOf(entries), version: PROBES_VERSION })
  );
}

/**
 * @description The summary the command prints: one line per class, in code-unit order.
 * @param {ProbesRecord} record
 * @returns {string[]}
 */
export function summaryLines(record) {
  return Object.entries(record.summary).map(([blockClass, counts]) => {
    const rate =
      counts.greenRate === null
        ? "n/a, no conclusive probe"
        : `${(counts.greenRate * 100).toFixed(1)}% of ${counts.conclusive} conclusive`;
    const noun = counts.probes === 1 ? "probe" : "probes";
    const flag = counts.lintRule ? " (>= 90 %: a lint-rule candidate)" : "";
    return (
      `hard-probe: ${blockClass}: ${counts.probes} ${noun}, ${counts.GREEN} GREEN, ` +
      `${counts.RED} RED, ${counts["LOAD-ERROR"]} LOAD-ERROR, GREEN ${rate}${flag}`
    );
  });
}

/**
 * @description Names the temp file a run writes `probes.json` to before renaming it onto the
 *   target: beside the target, hidden, carrying the run's unique suffix, and ending in `.partial`,
 *   which no ignore rule of this repository matches (`*.tmp` is ignored at the root and in
 *   apps/api), so a temp a killed run leaves in the source tree shows in `git status`.
 * @param {string} target The file the rename lands on.
 * @param {string} suffix Unique to the run: its pid and a random part.
 * @returns {string}
 */
export function pendingTempPath(target, suffix) {
  return path.join(path.dirname(target), `.${path.basename(target)}.${suffix}.partial`);
}

/**
 * @description Says whether a text is a `probes.json` of this tool, of this version: the one kind of
 *   tracked file `--out` may overwrite.
 * @param {string} text
 * @returns {boolean}
 */
export function isProbesRecord(text) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  return (
    isObject(parsed) &&
    parsed["version"] === PROBES_VERSION &&
    isObject(parsed["probes"]) &&
    isObject(parsed["selection"]) &&
    isObject(parsed["summary"]) &&
    typeof parsed["sha"] === "string"
  );
}

/**
 * @description Renders `probes.json` as the JSON text Prettier formats under the configuration that
 *   applies to it at the repository root, wherever it is written.
 * @param {ProbesRecord} record
 * @returns {Promise<string>} The text, ending in a newline.
 */
export function renderProbes(record) {
  return renderJson(PROBES_FILE, record);
}

export { OUTCOME };
