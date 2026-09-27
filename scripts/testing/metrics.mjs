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
 *   the git calls are plumbing (`rev-parse`, `ls-files`) and nothing is written anywhere.
 *
 *   Usage: `node scripts/testing/metrics.mjs --all [--offline]`
 *          `node scripts/testing/metrics.mjs --m8`
 *
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const UNKNOWN = "—";

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const TRACKER = path.join(REPO_ROOT, "docs", "development", "TESTING_REFOUNDATION.md");

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
 * Counts, per rule, the entries of the bulk-suppression file. Absent at the baseline commit, which
 * is why the absence is reported rather than guessed at.
 *
 * @param {string} id
 * @returns {Metric}
 */
function fromSuppressions(id) {
  const file = path.join(REPO_ROOT, "eslint-suppressions.json");
  if (!existsSync(file)) return { id, value: UNKNOWN, source: absent("eslint-suppressions.json") };
  /** @type {Record<string, Record<string, { count?: number }>>} */
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  /** @type {Map<string, number>} */
  const perRule = new Map();
  for (const rules of Object.values(parsed)) {
    for (const [rule, entry] of Object.entries(rules)) {
      perRule.set(rule, (perRule.get(rule) ?? 0) + (entry.count ?? 0));
    }
  }
  const total = [...perRule.values()].reduce((sum, n) => sum + n, 0);
  return {
    id,
    value: String(total),
    source: "derived: eslint-suppressions.json counts per rule",
  };
}

/**
 * @param {string} id
 * @param {string} artefact
 * @returns {Metric}
 */
function fromArtefact(id, artefact) {
  const file = path.join(REPO_ROOT, artefact);
  if (!existsSync(file)) return { id, value: UNKNOWN, source: absent(artefact) };
  return { id, value: UNKNOWN, source: `unavailable: ${artefact} needs its own reader` };
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
 * @param {boolean} offline
 * @returns {Metric[]}
 */
function allMetrics(offline) {
  return [
    m1(),
    pasted("M2", "the local vitest run summary and the integration tier summary"),
    fromSuppressions("M3"),
    fromArtefact("M4", "ledger.json"),
    {
      id: "M5",
      value: UNKNOWN,
      source: absent("the reach engine of packages/test-contracts"),
    },
    fromArtefact("M6", "ledger.json"),
    m7(),
    m8(),
    pasted("M9", "the integration tier run summary, plus the syntax-tree skip scan"),
    pasted("M10", "the named CI run of the end-to-end job"),
    pasted("M11", "the named CI run of the load job"),
    fromArtefact("M12", "mutation-floors.json"),
    fromSuppressions("M13"),
    fromArtefact("M14", "ledger.json"),
    m15(offline),
    {
      id: "M16",
      value: UNKNOWN,
      source: absent("a per-package coverage-final.json report"),
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
  const metrics = allMetrics(offline);
  const known = new Set(metrics.map((metric) => metric.id.toLowerCase()));

  /** @type {Metric[]} */
  let selected;
  if (selectors.length === 1 && selectors[0] === "--all") {
    selected = metrics;
  } else if (selectors.length > 0 && selectors.every((arg) => known.has(arg.replace(/^--/, "")))) {
    const wanted = new Set(selectors.map((arg) => arg.replace(/^--/, "")));
    selected = metrics.filter((metric) => wanted.has(metric.id.toLowerCase()));
  } else {
    process.stderr.write(
      `usage: node scripts/testing/metrics.mjs --all|--m<n> [--offline]\n` +
        `known metrics: ${[...known].join(", ")}\n`
    );
    return 1;
  }

  for (const metric of selected) {
    process.stdout.write(`${metric.id}\t${metric.value}\t${metric.source}\n`);
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
