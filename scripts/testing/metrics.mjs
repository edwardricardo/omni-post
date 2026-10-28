// @ts-check
/**
 * @file metrics.mjs
 * @description Prints the metric table of `docs/development/TESTING_REFOUNDATION.md`. One line per
 *   metric, tab separated: `M<n>\t<value>\t<class>: <source>`.
 *
 *   The classes are the point of this script. `derived` means the value was computed from the tree
 *   right now and is comparable to the tracker byte for byte. `pasted` means the number lives in a
 *   runner summary or a named run and the script REFUSES to invent it. `network` means it needs a
 *   remote read (skipped under `--offline`). `unavailable` means the artefact the metric is
 *   computed from does not exist yet, and names it. A metric therefore never degrades into a
 *   confident-looking number: it degrades into a class that says why.
 *
 *   Deterministic: no timestamps, no clock, no ordering that depends on the filesystem. Read-only:
 *   the git calls are plumbing (`rev-parse`, `ls-files`), the reach engine behind M5 only lists
 *   what each collector runs, and nothing is written anywhere. Only the selected metrics are
 *   computed, so `--m8` alone does not pay for the reach engine's run.
 *
 *   Usage: `node scripts/testing/metrics.mjs --all [--offline]`
 *          `node scripts/testing/metrics.mjs --m8`
 *
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { reachReport } from "./lib/reach-report.mjs";

const UNKNOWN = "—";

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const TRACKER = path.join(REPO_ROOT, "docs", "development", "TESTING_REFOUNDATION.md");

/** The quarantine fitness #30 passes to the reach engine, and the one `run-tests.sh` reads. */
const QUARANTINE = path.join(REPO_ROOT, "packages", "test-contracts", "quarantine.json");

/**
 * A basename that names a test by convention, `.k6.js` being a tier of its own. It is deliberately
 * ANCHORED at the end: the two files carrying a trailing `.disabled` / `.old` suffix do not match,
 * and they are not meant to — they are tracked, they run nowhere, and the demolition ledger owns
 * their verdict, so counting them inside the live population would overstate it by two.
 */
const CANONICAL_TEST_SHAPED = /(\.(test|spec)\.[cm]?[jt]sx?|\.k6\.js)$/;
const VITEST_CONFIG = /(^|\/)vitest\.config\.[cm]?[jt]s$/;

/**
 * @typedef {object} Metric
 * @property {string} id
 * @property {string} value
 * @property {string} source
 */

/** @type {string[] | null} */
let trackedCache = null;

/** @returns {string[]} Every path tracked by git, repository-relative. */
function trackedFiles() {
  if (trackedCache === null) {
    const out = execFileSync("git", ["ls-files", "-z"], {
      encoding: "utf8",
      cwd: REPO_ROOT,
      maxBuffer: 64 * 1024 * 1024,
    });
    trackedCache = out.split("\0").filter((line) => line.length > 0);
  }
  return trackedCache;
}

/**
 * The directory prefixes the pnpm workspace globs cover, derived rather than listed: a new
 * workspace root added to `pnpm-workspace.yaml` is covered here with no edit.
 *
 * @returns {string[]}
 */
function workspacePrefixes() {
  const manifest = readFileSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
  /** @type {Set<string>} */
  const prefixes = new Set();
  let inPackages = false;
  for (const line of manifest.split("\n")) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const entry = /^\s+-\s+"?([^"\s]+)"?\s*$/.exec(line);
      if (entry === null) break;
      const glob = entry[1] ?? "";
      const star = glob.indexOf("*");
      const dir = star === -1 ? glob : glob.slice(0, star);
      const root = dir.split("/").filter((part) => part.length > 0)[0];
      if (root !== undefined) prefixes.add(`${root}/`);
    }
  }
  return [...prefixes].sort();
}

/**
 * Reads a Markdown table's data rows under a heading. Cells are trimmed; the header and the
 * separator are dropped.
 *
 * @param {string} markdown
 * @param {string} heading Exact heading line, for example `### Gates`.
 * @returns {string[][]}
 */
function tableRows(markdown, heading) {
  const lines = markdown.split("\n");
  const start = lines.indexOf(heading);
  if (start === -1) return [];
  /** @type {string[][]} */
  const rows = [];
  let seenHeader = false;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.startsWith("#")) break;
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (!seenHeader) {
      seenHeader = true;
      continue;
    }
    if (cells.every((cell) => /^-{2,}$/.test(cell))) continue;
    rows.push(cells);
  }
  return rows;
}

/**
 * Extracts the `lines` literal of a config's GLOBAL coverage thresholds block. Only the top level
 * of `thresholds: {` counts, so a per-scope block nested deeper is ignored on purpose.
 *
 * @param {string} source
 * @returns {string | null}
 */
function globalLinesFloor(source) {
  const lines = source.split("\n");
  let depth = 0;
  let started = false;
  for (const line of lines) {
    if (!started) {
      if (/(^|[^A-Za-z0-9_$])thresholds\s*:\s*\{/.test(line)) {
        started = true;
        depth = 1;
      }
      continue;
    }
    if (depth === 1) {
      const hit = /^\s*lines:\s*([0-9]+(?:\.[0-9]+)?)\s*,?\s*$/.exec(line);
      if (hit !== null) return hit[1] ?? null;
    }
    for (const ch of line) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
    if (depth <= 0) break;
  }
  return null;
}

/**
 * @param {string} artefact
 * @returns {Metric["source"]}
 */
function absent(artefact) {
  return `unavailable: ${artefact} is not present in the tree yet`;
}

/** @returns {Metric} */
function m1() {
  const prefixes = workspacePrefixes();
  let inside = 0;
  let outside = 0;
  for (const file of trackedFiles()) {
    if (!CANONICAL_TEST_SHAPED.test(file)) continue;
    if (prefixes.some((prefix) => file.startsWith(prefix))) inside += 1;
    else outside += 1;
  }
  return {
    id: "M1",
    value: `${inside} + ${outside}`,
    source: "derived: git ls-files over the whole repository",
  };
}

/**
 * M5: the orphan test files, which no required check runs (every quarantine entry, plus every file
 * the reach engine reports unreached outside the quarantine), and the files collected more than
 * once. Both read R1's messages, `unreached: …` and `collected <n> times: …` (`rules.ts`). A
 * quarantine entry that is untracked or collected breaks R3 and fails fitness #30 itself, so the
 * orphan count does not correct for it.
 *
 * @returns {Metric}
 */
function m5() {
  if (!existsSync(QUARANTINE)) {
    return { id: "M5", value: UNKNOWN, source: absent("packages/test-contracts/quarantine.json") };
  }
  const report = reachReport(REPO_ROOT);
  if (typeof report === "string")
    return { id: "M5", value: UNKNOWN, source: `unavailable: ${report}` };
  /** @type {{ entries?: unknown }} */
  const quarantine = JSON.parse(readFileSync(QUARANTINE, "utf8"));
  const quarantined = Array.isArray(quarantine.entries) ? quarantine.entries.length : 0;
  const r1 = report.violations.filter((violation) => violation.rule === "R1");
  const unreached = r1.filter((violation) => violation.message.startsWith("unreached")).length;
  const twice = r1.filter((violation) => violation.message.startsWith("collected ")).length;
  return {
    id: "M5",
    value: `${quarantined + unreached} · ${twice}`,
    source:
      `derived: test-contracts reach --json, ${unreached} unreached outside the quarantine ` +
      `and ${quarantined} quarantined`,
  };
}

/** @returns {Metric} */
function m7() {
  if (!existsSync(TRACKER)) {
    return { id: "M7", value: UNKNOWN, source: absent("the tracker's Gates table") };
  }
  const rows = tableRows(readFileSync(TRACKER, "utf8"), "### Gates");
  const proven = rows.filter((cells) => {
    const redProof = cells[2] ?? "";
    return redProof.length > 0 && redProof !== UNKNOWN;
  }).length;
  return {
    id: "M7",
    value: `${proven}/${rows.length}`,
    source: "derived: the Gates table of docs/development/TESTING_REFOUNDATION.md",
  };
}

/** @returns {Metric} */
function m8() {
  const configs = trackedFiles().filter((file) => VITEST_CONFIG.test(file));
  let measured = 0;
  /** @type {number[]} */
  const floors = [];
  let api = UNKNOWN;
  for (const config of configs) {
    const source = readFileSync(path.join(REPO_ROOT, config), "utf8");
    if (/(^|[^A-Za-z0-9_$])coverage\s*:/.test(source)) measured += 1;
    const floor = globalLinesFloor(source);
    if (floor === null) continue;
    floors.push(Number(floor));
    if (config === "apps/api/vitest.config.ts") api = floor;
  }
  floors.sort((a, b) => a - b);
  // A minimum and a median over a single sample are not a distribution; they stay unknown until
  // more than one package carries a floor.
  const spread =
    floors.length < 2
      ? `${UNKNOWN}/${UNKNOWN}`
      : `${String(floors[0])}/${String(floors[Math.floor(floors.length / 2)])}`;
  return {
    id: "M8",
    value: `${measured}/${configs.length} · ${spread}/${api}`,
    source: "derived: the tracked vitest configs and their global thresholds blocks",
  };
}

/**
 * @param {boolean} offline
 * @returns {Metric}
 */
function m15(offline) {
  const command = "gh issue list --label nightly-failure --state open";
  if (offline) {
    return { id: "M15", value: UNKNOWN, source: `network: ${command} (skipped by --offline)` };
  }
  try {
    const out = execFileSync(
      "gh",
      ["issue", "list", "--label", "nightly-failure", "--state", "open", "--limit", "200"],
      { encoding: "utf8", cwd: REPO_ROOT }
    );
    const open = out.split("\n").filter((line) => line.trim().length > 0).length;
    return {
      id: "M15",
      value: `${open} · ${UNKNOWN}`,
      source: `network: ${command}; identities need the environment-identity check`,
    };
  } catch {
    return {
      id: "M15",
      value: UNKNOWN,
      source: `network: ${command} is unavailable or unauthenticated`,
    };
  }
}

/**
 * The lint rules whose suppressed violations each metric counts. M3 counts the test blocks that
 * cannot fail, the classes of `packages/eslint-plugin-testing`; the `vitest/*` rules and
 * `no-console` share the file and are not decorative blocks. M13's rules do not exist yet.
 */
const SUPPRESSED_RULES = Object.freeze({
  M3: Object.freeze([
    "testing/no-empty-test",
    "testing/no-existence-only-test",
    "testing/no-tautological-assertion",
  ]),
  M13: Object.freeze([]),
});

/**
 * Sums the suppressed violations of the named rules in the bulk-suppression file. The file is
 * absent at the baseline commit, and a metric whose rules are not written yet names none, so both
 * are reported rather than guessed at: a sum over no rule would read as a measured zero.
 *
 * @param {string} id
 * @param {readonly string[]} rules
 * @returns {Metric}
 */
function fromSuppressions(id, rules) {
  if (rules.length === 0) {
    return { id, value: UNKNOWN, source: `unavailable: no lint rule counts ${id} yet` };
  }
  const file = path.join(REPO_ROOT, "eslint-suppressions.json");
  if (!existsSync(file)) return { id, value: UNKNOWN, source: absent("eslint-suppressions.json") };
  /** @type {Record<string, Record<string, { count?: number }>>} */
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const counted = new Set(rules);
  let total = 0;
  for (const perFile of Object.values(parsed)) {
    for (const [rule, entry] of Object.entries(perFile)) {
      if (counted.has(rule)) total += entry.count ?? 0;
    }
  }
  return {
    id,
    value: String(total),
    source: `derived: eslint-suppressions.json, the suppressed violations of ${rules.join(", ")}`,
  };
}

/**
 * @param {string} id
 * @param {string} artefact
 * @param {string} pending What the present artefact does not hold yet, completing the reason.
 * @returns {Metric}
 */
function fromArtefact(id, artefact, pending) {
  const file = path.join(REPO_ROOT, artefact);
  if (!existsSync(file)) return { id, value: UNKNOWN, source: absent(artefact) };
  return { id, value: UNKNOWN, source: `unavailable: ${artefact} ${pending}` };
}

/** The committed test ledger, `scripts/testing/ledger.mjs`'s output, which M4, M6 and M14 read. */
const LEDGER = "ledger.json";

/**
 * M6: the ledger's rows as `machine / confirmed / total`, the counts its `summary.rows` holds once
 * the owner's overlay is applied. A file that is no JSON, or a summary without the three integer
 * counts, is reported as unreadable rather than read as zeros, and leaves the other metrics printed.
 *
 * @returns {Metric}
 */
function m6() {
  const file = path.join(REPO_ROOT, LEDGER);
  if (!existsSync(file)) return { id: "M6", value: UNKNOWN, source: absent(LEDGER) };
  /** @type {unknown} */
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { id: "M6", value: UNKNOWN, source: `unavailable: ${LEDGER} is not JSON` };
  }
  const summary =
    typeof ledger === "object" && ledger !== null
      ? /** @type {{ summary?: { rows?: Record<string, unknown> } }} */ (ledger).summary
      : undefined;
  const rows = summary?.rows;
  const counts = ["machine", "confirmed", "total"].map((key) => rows?.[key]);
  if (!counts.every((count) => Number.isInteger(count))) {
    return { id: "M6", value: UNKNOWN, source: `unavailable: ${LEDGER} holds no summary.rows` };
  }
  return {
    id: "M6",
    value: counts.join(" / "),
    source: `derived: ${LEDGER} summary.rows, machine / confirmed / total`,
  };
}

/**
 * @param {string} id
 * @param {string} where
 * @returns {Metric}
 */
function pasted(id, where) {
  return { id, value: UNKNOWN, source: `pasted: ${where}` };
}

/**
 * @typedef {object} MetricEntry
 * @property {string} id
 * @property {() => Metric} compute
 */

/**
 * Every metric, in the tracker's order, each computed only when it is selected.
 *
 * @param {boolean} offline
 * @returns {MetricEntry[]}
 */
function metricTable(offline) {
  return [
    { id: "M1", compute: m1 },
    {
      id: "M2",
      compute: () => pasted("M2", "the local vitest run summary and the integration tier summary"),
    },
    { id: "M3", compute: () => fromSuppressions("M3", SUPPRESSED_RULES.M3) },
    {
      id: "M4",
      compute: () =>
        fromArtefact("M4", LEDGER, "records no deletion yet: summary.deleted stays at zero"),
    },
    { id: "M5", compute: m5 },
    { id: "M6", compute: m6 },
    { id: "M7", compute: m7 },
    { id: "M8", compute: m8 },
    {
      id: "M9",
      compute: () =>
        pasted("M9", "the integration tier run summary, plus the syntax-tree skip scan"),
    },
    { id: "M10", compute: () => pasted("M10", "the named CI run of the end-to-end job") },
    { id: "M11", compute: () => pasted("M11", "the named CI run of the load job") },
    {
      id: "M12",
      compute: () => fromArtefact("M12", "mutation-floors.json", "needs its own reader"),
    },
    { id: "M13", compute: () => fromSuppressions("M13", SUPPRESSED_RULES.M13) },
    {
      id: "M14",
      compute: () => fromArtefact("M14", LEDGER, "records no slice's real drop yet"),
    },
    { id: "M15", compute: () => m15(offline) },
    {
      id: "M16",
      compute: () => ({
        id: "M16",
        value: UNKNOWN,
        source: absent("a per-package coverage-final.json report"),
      }),
    },
  ];
}

/**
 * @param {string[]} argv
 * @returns {number} Process exit code.
 */
function main(argv) {
  const offline = argv.includes("--offline");
  const selectors = argv.filter((arg) => arg !== "--offline");
  const table = metricTable(offline);
  const known = new Set(table.map((entry) => entry.id.toLowerCase()));

  /** @type {MetricEntry[]} */
  let selected;
  if (selectors.length === 1 && selectors[0] === "--all") {
    selected = table;
  } else if (selectors.length > 0 && selectors.every((arg) => known.has(arg.replace(/^--/, "")))) {
    const wanted = new Set(selectors.map((arg) => arg.replace(/^--/, "")));
    selected = table.filter((entry) => wanted.has(entry.id.toLowerCase()));
  } else {
    process.stderr.write(
      `usage: node scripts/testing/metrics.mjs --all|--m<n> [--offline]\n` +
        `known metrics: ${[...known].join(", ")}\n`
    );
    return 1;
  }

  for (const entry of selected) {
    const metric = entry.compute();
    process.stdout.write(`${metric.id}\t${metric.value}\t${metric.source}\n`);
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
