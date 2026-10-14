// @ts-check
/**
 * @file holds-gate.mjs
 * @description Refuses an UNDOCUMENTED toolchain lag that has outlived its budget. For every direct
 *   testing dependency in `scripts/testing/toolchain-population.json`, it compares the installed
 *   version against the latest MATURE published version (stable, and at least 7 days old —
 *   ADR-0018's buffer). A lag needs no row for 30 days, the staleness budget of ADR-0036, because
 *   the weekly dependency window takes it inside that time. Past the budget it needs a row naming
 *   the package in `docs/security/SECURITY_CANON.md` §"Build-tool version holds & dated-debt
 *   overrides", and a lag past the budget with no row exits 1.
 *
 *   The comparator is "latest mature", never `latest`: the newest release is frequently younger
 *   than the buffer, and pulling it converts the buffer into decoration.
 *
 *   The budget counts from the maturity instant of the OLDEST stable release above the installed
 *   version, so a lag turns red 37 days after that release was published, to the second (30 days
 *   of maturity after the 7 of the buffer). Counting from the newest release would restart the
 *   clock on every release, and a package that ships weekly would never reach it. A lag inside the
 *   budget prints `lag: within budget (<n> d of 30)` and is not looked up in the table.
 *
 *   A row whose cells say `scheduled` or `pre-registered`, in any case, is refused. ADR-0036
 *   retired the scheduled row: nothing reads the date written in its text, so it exempted its
 *   package for as long as it stood. Rows stay for real holds only — a peer range that blocks the
 *   move, a measured breakage, or a recorded decision.
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
 *   RESIDUALS, stated rather than discovered later. (1) The population is DIRECT dependencies:
 *   `pnpm ls --depth 0` cannot see a transitive, so `playwright-core` carries
 *   `absence: "transitive"` and is documented rather than gated. (2) It does NOT check that the
 *   installed version sits at or below a hold's own ceiling, because the `Hold / floor` column
 *   carries BOTH ceilings (holds) and minimums (CVE floors) and several cells are prose; reading one
 *   as the other would fail the wrong trees. That check needs a typed column first. (3) The
 *   population is the testing and quality TOOLCHAIN. Production direct dependencies are not
 *   measured here: they move by CVE floor and by deliberate units (ADR-0036), and this gate claims
 *   nothing about their freshness. (4) Inside the budget a lag is not looked up in the table, so a
 *   real hold and a lag the next window takes read the same until the budget runs out. (5) The
 *   retired words are matched as whole words; a scheduled row phrased without them passes, and
 *   review is what reads it.
 *
 *   Usage: `node scripts/testing/holds-gate.mjs`
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const UNKNOWN = "—";
const DAY_MS = 24 * 60 * 60 * 1000;
const MATURITY_MS = 7 * DAY_MS;
const BUDGET_DAYS = 30;
const BUDGET_MS = BUDGET_DAYS * DAY_MS;
const RETIRED_SCHEDULE_WORDS = /\b(?:pre-registered|scheduled)\b/i;
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
 * @typedef {object} HoldsTable
 * @property {HoldRow[]} rows Rows whose shape agreed with the header; a ragged row is refused, not
 *   guessed, so it can never cover a lag through a cell the parser mis-read.
 * @property {string[]} refusals Complaints about the table itself or one of its rows, each already a
 *   complete sentence naming what was read and why it cannot be trusted: a header or row shape the
 *   parser cannot read, or a row that still describes a scheduled hold.
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
 * Splits one markdown table row into trimmed cells. An ESCAPED pipe (`\|`) is cell CONTENT — the
 * canon's jsdom row carries `engines.node: ^22 \|\| ^24` — so only an unescaped pipe delimits, and a
 * splitter that cannot tell them apart reports a whole row as ragged.
 *
 * @param {string} line
 * @returns {string[]}
 */
function splitCells(line) {
  return line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.trim());
}

/**
 * Reads the hold rows of the canon's build-tool section. Only the FIRST markdown table after the
 * heading counts, so prose between the two is skipped rather than parsed.
 *
 * Both columns it needs are located BY HEADER NAME, never by index, and the table is refused when
 * either is missing or when a row's cell count disagrees with the header's. Index reading failed
 * SILENTLY: the table grew a `Reason` column, index 3 stopped being the remove-when, and every row
 * with an empty remove-when passed because the reason answered in its place. A name that is absent is
 * loud; a position that moved is not.
 *
 * A row any of whose cells says `scheduled` or `pre-registered` is refused and never exempts its
 * package: the budget replaced the scheduled row (ADR-0036), and a refusal here is louder than a row
 * that silently outlives the day written in it.
 *
 * @param {string} markdown
 * @returns {HoldsTable}
 */
function parseHolds(markdown) {
  const lines = markdown.split("\n");
  const start = lines.indexOf(HOLDS_HEADING);
  if (start === -1) return { rows: [], refusals: [] };
  /** @type {HoldRow[]} */
  const rows = [];
  /** @type {string[]} */
  const refusals = [];
  /** @type {string[] | null} */
  let header = null;
  let packageAt = -1;
  let removeWhenAt = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.startsWith("#")) break;
    if (!line.startsWith("|")) {
      if (header !== null) break;
      continue;
    }
    const cells = splitCells(line);
    if (header === null) {
      header = cells;
      const named = cells.map((cell) => cell.toLowerCase());
      packageAt = named.indexOf("package");
      removeWhenAt = named.indexOf("remove-when");
      if (packageAt === -1 || removeWhenAt === -1) {
        refusals.push(
          `the holds table header declares [${cells.join(", ")}] — it must declare both a ` +
            `"Package" and a "Remove-when" column, because the gate locates them by NAME. A ` +
            `renamed or dropped column would otherwise be read from whatever cell sits in its ` +
            `place, which is how an empty remove-when passed.`
        );
        return { rows: [], refusals };
      }
      continue;
    }
    // The count is checked BEFORE the separator is skipped by content, because the separator is the
    // row that makes the block a table at all: when ITS count disagrees with the header, GFM renders
    // no table, and skipping it first would let the one shape through in which the reader and the
    // parser disagree about whether a table exists.
    const isSeparator = cells.every((cell) => /^:?-{2,}:?$/.test(cell));
    if (cells.length !== header.length) {
      refusals.push(
        isSeparator
          ? `the holds table's SEPARATOR row carries ${cells.length} cells against a header of ` +
              `${header.length} — GFM renders the block as prose rather than a table when the two ` +
              `disagree, so every row below it only LOOKS tabular. Refused rather than parsed.`
          : `the holds row starting ${cells[0] ?? "(empty)"} carries ${cells.length} cells against ` +
              `a header of ${header.length} — markdown drops the excess and pads the missing, so ` +
              `the row RENDERS whole while every cell after the discrepancy is read from the wrong ` +
              `column. Refused rather than guessed.`
      );
      continue;
    }
    if (isSeparator) continue;
    const packages = cells[packageAt] ?? "";
    // The word is reported as the row spells it, so the author can find it in the table.
    const retired = cells
      .map((cell) => RETIRED_SCHEDULE_WORDS.exec(cell)?.[0])
      .find((word) => word !== undefined);
    if (retired !== undefined) {
      refusals.push(
        `row ${packages} says "${retired}": the words \`scheduled\` and \`pre-registered\`, in any ` +
          `case, describe a retired scheduled hold; the budget replaced scheduled rows (ADR-0036)`
      );
      continue;
    }
    const tokens = [...packages.matchAll(/`([^`]+)`/g)].map((hit) => hit[1] ?? "");
    rows.push({
      packages,
      patterns: tokens,
      removeWhen: cells[removeWhenAt] ?? "",
    });
  }
  return { rows, refusals };
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
 * The publish instant of the OLDEST stable release above `installed` that is mature at the
 * boundary — the release whose maturity starts the budget. Ordering by publish time rather than by
 * version is the point: a backport published later than a higher release does not restart the
 * clock, and neither does a newer release.
 *
 * @param {Record<string, unknown>} times
 * @param {string} installed
 * @param {number} boundary
 * @returns {number | null} Epoch milliseconds, or null when no unmet release is mature yet.
 */
function oldestUnmetPublish(times, installed, boundary) {
  /** @type {number | null} */
  let oldest = null;
  for (const [version, published] of Object.entries(times)) {
    if (version === "created" || version === "modified") continue;
    if (typeof published !== "string") continue;
    const parsed = parseVersion(version);
    if (parsed === null || !parsed.stable) continue;
    if (compareVersions(version, installed) <= 0) continue;
    const at = Date.parse(published);
    if (Number.isNaN(at) || at > boundary) continue;
    if (oldest === null || at < oldest) oldest = at;
  }
  return oldest;
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

  const { rows: holds, refusals } = parseHolds(readFileSync(canonPath, "utf8"));
  violations.push(...refusals);
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

    // The budget floor is the newest stable release that has been mature for 30 days or more, i.e.
    // published on or before `boundary - BUDGET_MS`. Installed at or above the floor (or with no
    // floor yet), every unmet release is younger than the budget: within budget, no row needed.
    // Installed below it, the floor itself has outlived the budget: past budget, and the row lookup
    // below decides.
    const budgetFloor = latestMature(times, boundary - BUDGET_MS);
    if (budgetFloor === null || compareVersions(installed, budgetFloor) >= 0) {
      const oldest = oldestUnmetPublish(times, installed, boundary);
      if (oldest === null) {
        // Unreachable while the two helpers agree: the target is itself a stable release above
        // `installed`, published on or before the boundary, and a target whose publish time does not
        // parse is taken as the budget floor by `latestMature` too, so it never lands here. The guard
        // turns a later change to either helper into a refusal instead of a day count nobody computed.
        violations.push(
          `${name} is below its target ${target}, but no release above ${installed} could be ` +
            `dated, so the days it has spent in the budget cannot be counted.`
        );
        continue;
      }
      const days = Math.floor((instant - (oldest + MATURITY_MS)) / DAY_MS);
      lines.push(
        `${name}\t${installed}\t${target}\tlag: within budget (${String(days)} d of ${String(BUDGET_DAYS)})`
      );
      continue;
    }

    const row = holds.find((hold) =>
      hold.patterns.some((token) => tokenToPattern(token).test(name))
    );
    if (row === undefined) {
      violations.push(
        `${name} is installed at ${installed}, below its latest-mature target ${target}, and ` +
          `${budgetFloor} has been mature for ${String(BUDGET_DAYS)} days or more with no hold row ` +
          `naming ${name} in ${canonPath} §"${HOLDS_HEADING.replace(/^#+\s*/, "")}".`
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
  /** @param {string} marker */
  const count = (marker) => result.lines.filter((line) => line.includes(marker)).length;
  process.stdout.write(
    `\n${String(result.lines.length)} population packages measured, ` +
      `${String(count("\tlag: "))} below latest mature ` +
      `(${String(count("\tlag: within budget"))} within budget, ` +
      `${String(count("\tlag: held by "))} held, ` +
      `${String(count("\tlag: UNDOCUMENTED"))} undocumented)\n`
  );
  for (const violation of result.violations) {
    process.stderr.write(`holds-gate: ${violation}\n`);
  }
  return result.violations.length > 0 ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
