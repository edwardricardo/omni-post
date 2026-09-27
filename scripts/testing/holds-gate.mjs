// @ts-check
/**
 * @file holds-gate.mjs
 * @description Refuses an UNDOCUMENTED toolchain lag. For every direct testing dependency in
 *   `scripts/testing/toolchain-population.json`, it compares the installed version against the
 *   latest MATURE published version (stable, and at least 7 days old — ADR-0018's buffer) and
 *   requires a row naming that package in `docs/security/SECURITY_CANON.md`
 *   §"Build-tool version holds & dated-debt overrides". A lag with no row exits 1.
 *
 *   The comparator is "latest mature", never `latest`: the newest release is frequently younger
 *   than the buffer, and pulling it converts the buffer into decoration.
 *
 *   FAIL-CLOSED, deliberately, in every direction a silent pass could hide a lag: zero parsed hold
 *   rows, an unreadable table, a population package that is not installed and declares no absence,
 *   a declared absence that is stale because the package IS installed, an unrecognised absence
 *   reason, an unreadable registry document for a package the outdated report flags, an installed
 *   version that does not parse, or two different installed versions of one name. A gate that
 *   reports a clean zero over inputs it never read asserts an invariant nobody measured.
 *
 *   Every input is injectable so the suite can drive the rule with fixtures and never touch the
 *   registry: `--installed`, `--outdated`, `--registry`, `--population`, `--canon`, `--instant`.
 *   With none of them the live inputs are read from pnpm and the clock. An unrecognised flag exits 1
 *   rather than being ignored, because an ignored flag would silently read the live tree in a suite
 *   that must not reach it.
 *
 *   TWO RESIDUALS, stated rather than discovered later. (1) The population is DIRECT dependencies:
 *   `pnpm ls --depth 0` cannot see a transitive, so `playwright`, `playwright-core` and `jest` carry
 *   `absence: "transitive"` and are documented rather than gated. (2) It does NOT check that the
 *   installed version sits at or below a hold's own ceiling, because the `Hold / floor` column
 *   carries BOTH ceilings (holds) and minimums (CVE floors) and several cells are prose; reading one
 *   as the other would fail the wrong trees. That check needs a typed column first.
 *
 *   Usage: `node scripts/testing/holds-gate.mjs`
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const UNKNOWN = "—";
const MATURITY_MS = 7 * 24 * 60 * 60 * 1000;
const HOLDS_HEADING = "### Build-tool version holds & dated-debt overrides";
const RECOGNISED_ABSENCE = new Set(["candidate", "transitive"]);
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

/** @type {string | null} */
let repoRootCache = null;

/**
 * The repository root, resolved LAZILY. With every input injected the gate needs neither git nor
 * pnpm, which is what lets its own suite drive the rule from fixtures in a directory that is not a
 * repository at all.
 *
 * @returns {string}
 */
function repoRoot() {
  if (repoRootCache === null) {
    repoRootCache = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
  }
  return repoRootCache;
}

/**
 * @typedef {object} Options
 * @property {string | null} installed
 * @property {string | null} outdated
 * @property {string | null} registry
 * @property {string | null} population
 * @property {string | null} canon
 * @property {string | null} instant
 */

/**
 * @typedef {object} HoldRow
 * @property {string} packages The raw `Package` cell, reported verbatim so the reader can find it.
 * @property {string[]} patterns One pattern per backticked token, `*` allowed.
 * @property {string} removeWhen
 */

/**
 * Parses a three-number version with an optional prerelease or build suffix. Registry keys are
 * well-formed semver, so a key that does not parse is reported rather than ranked.
 *
 * @param {string} version
 * @returns {{ parts: number[], stable: boolean } | null}
 */
function parseVersion(version) {
  const hit = SEMVER.exec(version);
  if (hit === null) return null;
  return {
    parts: [Number(hit[1]), Number(hit[2]), Number(hit[3])],
    stable: !version.includes("-"),
  };
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {number} Negative when `left` precedes `right`; prereleases are never compared here.
 */
function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a === null || b === null) return 0;
  for (let i = 0; i < 3; i += 1) {
    const diff = (a.parts[i] ?? 0) - (b.parts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * @param {string} token A backticked cell token, possibly carrying `*`.
 * @returns {RegExp}
 */
function tokenToPattern(token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll("\\*", "[^\\s]*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Reads the hold rows of the canon's build-tool section. Only the FIRST markdown table after the
 * heading counts, so prose between the two is skipped rather than parsed.
 *
 * @param {string} markdown
 * @returns {HoldRow[]}
 */
function parseHolds(markdown) {
  const lines = markdown.split("\n");
  const start = lines.indexOf(HOLDS_HEADING);
  if (start === -1) return [];
  /** @type {HoldRow[]} */
  const rows = [];
  let seenHeader = false;
  let inTable = false;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.startsWith("#")) break;
    if (!line.startsWith("|")) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (!seenHeader) {
      seenHeader = true;
      continue;
    }
    if (cells.every((cell) => /^-{2,}$/.test(cell))) continue;
    const packages = cells[0] ?? "";
    const tokens = [...packages.matchAll(/`([^`]+)`/g)].map((hit) => hit[1] ?? "");
    rows.push({
      packages,
      patterns: tokens,
      removeWhen: cells[3] ?? "",
    });
  }
  return rows;
}

/**
 * @param {string} file
 * @returns {unknown}
 */
function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Runs a pnpm subcommand and returns its stdout even when it exits non-zero: `pnpm outdated` exits
 * 1 to mean "outdated dependencies found", which is this gate's normal input, not a failure.
 *
 * @param {string[]} args
 * @returns {string}
 */
function pnpmStdout(args) {
  try {
    return execFileSync("pnpm", args, {
      encoding: "utf8",
      cwd: repoRoot(),
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stdout = /** @type {{ stdout?: string }} */ (error).stdout ?? "";
    if (stdout.trim().length === 0) throw error;
    return stdout;
  }
}

/**
 * name → the one installed semver version. `pnpm ls` also reports workspace-hoisted `link:` values
 * for the same name; those are not versions and are dropped.
 *
 * @param {unknown} document
 * @returns {{ versions: Map<string, string>, ambiguous: string[] }}
 */
function installedVersions(document) {
  /** @type {Map<string, Set<string>>} */
  const seen = new Map();
  const importers = Array.isArray(document) ? document : [];
  for (const importer of importers) {
    if (typeof importer !== "object" || importer === null) continue;
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
      const entries = /** @type {Record<string, unknown>} */ (
        /** @type {Record<string, unknown>} */ (importer)[section] ?? {}
      );
      for (const [name, body] of Object.entries(entries)) {
        if (typeof body !== "object" || body === null) continue;
        const version = /** @type {{ version?: unknown }} */ (body).version;
        if (typeof version !== "string" || parseVersion(version) === null) continue;
        const bucket = seen.get(name) ?? new Set();
        bucket.add(version);
        seen.set(name, bucket);
      }
    }
  }
  /** @type {Map<string, string>} */
  const versions = new Map();
  /** @type {string[]} */
  const ambiguous = [];
  for (const [name, bucket] of seen) {
    const sorted = [...bucket].sort(compareVersions);
    if (bucket.size > 1) ambiguous.push(`${name}: ${sorted.join(", ")}`);
    versions.set(name, sorted[0] ?? "");
  }
  return { versions, ambiguous };
}

/**
 * @param {string} name
 * @returns {string} The registry cache file name, `@scope/name` → `_scope_name.json`.
 */
function registryFileName(name) {
  return `${name.replaceAll("@", "_").replaceAll("/", "_")}.json`;
}

/**
 * The highest STABLE version published on or before the maturity boundary.
 *
 * @param {Record<string, unknown>} times
 * @param {number} boundary
 * @returns {string | null}
 */
function latestMature(times, boundary) {
  /** @type {string | null} */
  let best = null;
  for (const [version, published] of Object.entries(times)) {
    if (version === "created" || version === "modified") continue;
    if (typeof published !== "string") continue;
    const parsed = parseVersion(version);
    if (parsed === null || !parsed.stable) continue;
    if (Date.parse(published) > boundary) continue;
    if (best === null || compareVersions(version, best) > 0) best = version;
  }
  return best;
}

/**
 * @param {string[]} argv
 * @returns {Options | null}
 */
function parseOptions(argv) {
  /** @type {Options} */
  const options = {
    installed: null,
    outdated: null,
    registry: null,
    population: null,
    canon: null,
    instant: null,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = (argv[i] ?? "").replace(/^--/, "");
    const value = argv[i + 1];
    if (!(flag in options) || value === undefined) return null;
    options[/** @type {keyof Options} */ (flag)] = value;
  }
  return options;
}

/**
 * @param {Options} options
 * @returns {{ lines: string[], violations: string[] }}
 */
function evaluate(options) {
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const violations = [];

  const canonPath = options.canon ?? path.join(repoRoot(), "docs", "security", "SECURITY_CANON.md");
  const populationPath =
    options.population ?? path.join(repoRoot(), "scripts", "testing", "toolchain-population.json");

  const holds = parseHolds(readFileSync(canonPath, "utf8"));
  if (holds.length === 0) {
    violations.push(
      `zero hold rows parsed from ${canonPath} §"${HOLDS_HEADING.replace(/^#+\s*/, "")}" — the ` +
        `heading moved, the table moved, or it was commented out. Failing closed rather than ` +
        `reporting a clean zero over a table that was never read.`
    );
    return { lines, violations };
  }
  for (const row of holds) {
    if (row.removeWhen.length === 0 || row.removeWhen === UNKNOWN) {
      violations.push(
        `the hold row for ${row.packages} carries no remove-when — a hold without an observable ` +
          `exit condition is permanent debt that reads as tracked.`
      );
    }
  }

  const population = /** @type {{ packages?: { name?: string, absence?: string }[] }} */ (
    readJson(populationPath)
  );
  const packages = population.packages ?? [];
  if (packages.length === 0) {
    violations.push(
      `zero packages parsed from ${populationPath} — the gate would measure nothing and pass.`
    );
    return { lines, violations };
  }

  const installedDocument = options.installed
    ? readJson(options.installed)
    : JSON.parse(pnpmStdout(["ls", "-r", "--depth", "0", "--json"]));
  const { versions, ambiguous } = installedVersions(installedDocument);
  for (const entry of ambiguous) {
    violations.push(`two installed versions of one direct dependency — ${entry}`);
  }

  const outdatedDocument = /** @type {Record<string, { current?: string, latest?: string }>} */ (
    options.outdated
      ? readJson(options.outdated)
      : JSON.parse(pnpmStdout(["outdated", "-r", "--format", "json"]) || "{}")
  );

  const instant = options.instant ? Date.parse(options.instant) : Date.now();
  if (Number.isNaN(instant)) {
    violations.push(`--instant ${String(options.instant)} is not a parseable instant.`);
    return { lines, violations };
  }
  const boundary = instant - MATURITY_MS;

  for (const entry of packages) {
    const name = entry.name ?? "";
    if (name.length === 0) {
      violations.push("a population entry carries no name.");
      continue;
    }
    const absence = entry.absence;
    if (absence !== undefined && !RECOGNISED_ABSENCE.has(absence)) {
      violations.push(
        `${name} declares absence "${absence}", which is not one of ${[...RECOGNISED_ABSENCE].join(", ")}.`
      );
      continue;
    }
    const installed = versions.get(name);
    if (installed === undefined) {
      if (absence === undefined) {
        violations.push(
          `${name} is in the population but is not installed as a direct dependency — either it ` +
            `was removed (delete its population entry) or it became transitive (declare its absence).`
        );
        continue;
      }
      lines.push(`${name}\t${UNKNOWN}\t${UNKNOWN}\tdeclared absent: ${absence}`);
      continue;
    }
    if (absence !== undefined) {
      violations.push(
        `${name} declares absence "${absence}" but IS installed at ${installed} — the declaration ` +
          `is stale, and a stale absence exempts a real lag from this gate.`
      );
      continue;
    }

    const reported = outdatedDocument[name];
    if (reported === undefined || reported.current === reported.latest) {
      lines.push(`${name}\t${installed}\t${installed}\tat latest`);
      continue;
    }

    /** @type {Record<string, unknown>} */
    let times;
    try {
      times = options.registry
        ? /** @type {Record<string, unknown>} */ (
            readJson(path.join(options.registry, registryFileName(name)))
          )
        : /** @type {Record<string, unknown>} */ (
            JSON.parse(pnpmStdout(["view", name, "time", "--json"]))
          );
    } catch (error) {
      violations.push(
        `${name} is reported outdated (${String(reported.current)} → ${String(reported.latest)}) but ` +
          `its publish times could not be read, so its target is unknown: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }

    const target = latestMature(times, boundary);
    if (target === null) {
      lines.push(`${name}\t${installed}\t${UNKNOWN}\tno mature release published yet`);
      continue;
    }
    if (compareVersions(installed, target) >= 0) {
      lines.push(`${name}\t${installed}\t${target}\tat or above latest mature`);
      continue;
    }

    const row = holds.find((hold) =>
      hold.patterns.some((token) => tokenToPattern(token).test(name))
    );
    if (row === undefined) {
      violations.push(
        `${name} is installed at ${installed}, below its latest-mature target ${target}, with no ` +
          `hold row naming it in ${canonPath} §"${HOLDS_HEADING.replace(/^#+\s*/, "")}".`
      );
      lines.push(`${name}\t${installed}\t${target}\tlag: UNDOCUMENTED`);
      continue;
    }
    lines.push(`${name}\t${installed}\t${target}\tlag: held by ${row.packages}`);
  }

  return { lines, violations };
}

/**
 * @param {string[]} argv
 * @returns {number} Process exit code.
 */
function main(argv) {
  const options = parseOptions(argv);
  if (options === null) {
    process.stderr.write(
      "usage: node scripts/testing/holds-gate.mjs " +
        "[--installed <path>] [--outdated <path>] [--registry <dir>] [--population <path>] " +
        "[--canon <path>] [--instant <iso>]\n"
    );
    return 1;
  }

  /** @type {{ lines: string[], violations: string[] }} */
  let result;
  try {
    result = evaluate(options);
  } catch (error) {
    process.stderr.write(
      `holds-gate: an input could not be read, so nothing was measured: ` +
        `${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }

  for (const line of result.lines) process.stdout.write(`${line}\n`);
  const lags = result.lines.filter((line) => line.includes("\tlag: ")).length;
  process.stdout.write(
    `\n${String(result.lines.length)} population packages measured, ${String(lags)} below latest mature\n`
  );
  for (const violation of result.violations) {
    process.stderr.write(`holds-gate: ${violation}\n`);
  }
  return result.violations.length > 0 ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
