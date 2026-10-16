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
 *   A FAMILY is a set of packages that release together and must resolve to ONE version, declared
 *   under `families` in the population with a `name`, its `members` and a `note` saying why. The gate
 *   reads every member each importer declares, and every member that such a declaration resolves
 *   as its own dependency or peer, and exits 1 when two of them carry different versions, naming
 *   each version with the importer it was read in. That is the drift one member moved alone leaves,
 *   and the drift lockfile preference leaves when a member keeps an older sibling as its peer.
 *
 *   FAIL-CLOSED, deliberately, in every direction a silent pass could hide a lag: zero parsed hold
 *   rows, an unreadable table, a population package that is not installed and declares no absence,
 *   a declared absence that is stale because the package IS installed, an unrecognised absence
 *   reason, an unreadable registry document for a package the outdated report flags, an installed
 *   version that does not parse, or two different installed versions of one name. And for the
 *   families: a population key other than `packages` and `families`, a family field other than
 *   `name`, `members` and `note`, a family with no name, no note or fewer than two members, a
 *   member listed twice, a member no importer declares, a member version that does not parse, and a
 *   deduplicated listing entry whose expanded copy is missing, so its peers cannot be read. A gate
 *   that reports a clean zero over inputs it never read asserts an invariant nobody measured.
 *
 *   Every input is injectable so the suite can drive the rule with fixtures and never touch the
 *   registry: `--installed`, `--outdated`, `--registry`, `--population`, `--canon`, `--instant`.
 *   With none of them the live inputs are read from pnpm and the clock. An unrecognised flag exits 1
 *   rather than being ignored, because an ignored flag would silently read the live tree in a suite
 *   that must not reach it.
 *
 *   RESIDUALS, stated rather than discovered later. (1) The population is DIRECT dependencies: the
 *   gate reads the importer level of `pnpm ls -r --depth 1`, where a transitive does not appear, so
 *   `playwright-core` carries `absence: "transitive"` and is documented rather than gated. The one
 *   level below is read for the families alone, and only a member's own dependencies and peers: a
 *   member reached deeper, or only through a package outside its family, is not compared. Both read
 *   the INSTALLED tree, which `pnpm ls` reports: it equals the lockfile after the frozen install the
 *   CI job runs first, and a lockfile resolved but not installed is not read. (2) It
 *   does NOT check that the installed version sits at or below a hold's own ceiling, because the
 *   `Hold / floor` column carries BOTH ceilings (holds) and minimums (CVE floors) and several cells
 *   are prose; reading one as the other would fail the wrong trees. That check needs a typed column first. (3) The
 *   population is the testing and quality TOOLCHAIN. Production direct dependencies are not
 *   measured here: they move by CVE floor and by deliberate units (ADR-0036), and this gate claims
 *   nothing about their freshness. The Prisma family is the one exception, measured through its
 *   CLI, `prisma`: a toolchain devDependency (generate, migrate, studio) that moves in lockstep with
 *   `@prisma/client` and `@prisma/adapter-pg`. The CLI's freshness is measured; the family `prisma`
 *   is checked for LOCKSTEP, so the two production members are read for equality with the CLI and
 *   each other, and their freshness is still not measured. (4) Inside the budget a lag is not
 *   looked up in the table, so a real hold and a lag the next window takes read the same until the
 *   budget runs out. (5) The retired words are matched as whole words; a scheduled row phrased
 *   without them passes, and review is what reads it.
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
const POPULATION_FIELDS = new Set(["packages", "families"]);
const FAMILY_FIELDS = new Set(["name", "members", "note"]);
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"];
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
 * @typedef {object} Family
 * @property {string} name
 * @property {string[]} members Distinct, two or more.
 */

/**
 * @typedef {object} ListedEntry One dependency an importer declares, as `pnpm ls` prints it.
 * @property {string} importer The importer's package name, or its path when it has none.
 * @property {string} name
 * @property {Record<string, unknown>} body
 */

/**
 * @typedef {object} Resolution One version a family member was read at.
 * @property {string} member
 * @property {string} version
 * @property {string} where The importer, and the member it resolved under when it is a dependency
 *   or a peer of another member rather than a declaration of the importer itself.
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
    for (const section of DEPENDENCY_SECTIONS) {
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
 * Reads the population's `families` and refuses any declaration the lockstep check could not trust.
 * A family that is refused is not checked at all: its refusal already fails the run, and comparing
 * members of a declaration the gate could not read would report a verdict on a guess.
 *
 * @param {unknown} declared The population's `families` value; absent means no family is declared.
 * @returns {{ families: Family[], problems: string[] }}
 */
function parseFamilies(declared) {
  /** @type {Family[]} */
  const families = [];
  /** @type {string[]} */
  const problems = [];
  if (declared === undefined) return { families, problems };
  if (!Array.isArray(declared)) {
    problems.push("the population's `families` is not an array, so no family can be read from it.");
    return { families, problems };
  }
  /** @type {Map<string, string>} */
  const ownerOf = new Map();
  /** @type {Set<string>} */
  const names = new Set();
  declared.forEach((raw, index) => {
    const before = problems.length;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      problems.push(`family #${String(index + 1)} is not an object.`);
      return;
    }
    const record = /** @type {Record<string, unknown>} */ (raw);
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const title = name.length > 0 ? `family ${name}` : `family #${String(index + 1)}`;
    const unknown = Object.keys(record).filter((key) => !FAMILY_FIELDS.has(key));
    if (unknown.length > 0) {
      problems.push(
        `${title} declares ${unknown.map((key) => `"${key}"`).join(", ")}, which is not one of ` +
          `${[...FAMILY_FIELDS].join(", ")}: an unread field may be a misspelled one, and a ` +
          `misspelled \`members\` would check nothing.`
      );
    }
    if (name.length === 0) problems.push(`${title} carries no name.`);
    if (name.length > 0 && names.has(name)) problems.push(`${title} is declared twice.`);
    names.add(name);
    if (typeof record.note !== "string" || record.note.trim().length === 0) {
      problems.push(`${title} carries no note saying why its members move together.`);
    }
    const members = record.members;
    if (
      !Array.isArray(members) ||
      members.some((member) => typeof member !== "string" || member.trim().length === 0)
    ) {
      problems.push(`${title}'s \`members\` is not a list of package names.`);
      return;
    }
    const distinct = [...new Set(/** @type {string[]} */ (members))];
    if (distinct.length !== members.length) problems.push(`${title} lists a member twice.`);
    if (distinct.length < 2) {
      problems.push(
        `${title} has ${String(distinct.length)} member(s): a family needs two or more, or there ` +
          `is no lockstep to check.`
      );
    }
    for (const member of distinct) {
      const owner = ownerOf.get(member);
      if (owner !== undefined) {
        problems.push(`${member} is a member of both ${owner} and ${title}.`);
      }
      ownerOf.set(member, title);
    }
    if (problems.length === before) families.push({ name, members: distinct });
  });
  return { families, problems };
}

/**
 * Every dependency the listing's importers declare, and the expanded children of each listed copy.
 * `pnpm ls` prints a package's children once and marks every later copy at the same store path
 * `deduped`, so a deduplicated entry is read through the copy that was expanded.
 *
 * @param {unknown} document The `pnpm ls -r --depth 1 --json` document.
 * @returns {{ entries: ListedEntry[], expanded: Map<string, Record<string, unknown>> }}
 */
function listedEntries(document) {
  /** @type {ListedEntry[]} */
  const entries = [];
  /** @type {Map<string, Record<string, unknown>>} */
  const expanded = new Map();
  const importers = Array.isArray(document) ? document : [];
  for (const importer of importers) {
    if (typeof importer !== "object" || importer === null) continue;
    const record = /** @type {Record<string, unknown>} */ (importer);
    const label =
      typeof record.name === "string" && record.name.length > 0
        ? record.name
        : String(record.path ?? "(an importer with no name)");
    for (const section of DEPENDENCY_SECTIONS) {
      const dependencies = record[section];
      if (typeof dependencies !== "object" || dependencies === null) continue;
      for (const [name, raw] of Object.entries(dependencies)) {
        if (typeof raw !== "object" || raw === null) continue;
        const body = /** @type {Record<string, unknown>} */ (raw);
        entries.push({ importer: label, name, body });
        const children = body.dependencies;
        if (
          body.deduped !== true &&
          typeof body.path === "string" &&
          typeof children === "object" &&
          children !== null
        ) {
          expanded.set(body.path, /** @type {Record<string, unknown>} */ (children));
        }
      }
    }
  }
  return { entries, expanded };
}

/**
 * Compares every version one family resolves to: each member an importer declares, and each member
 * such a declaration resolves as its own dependency or peer. One version is lockstep; two or more is
 * a violation naming each version with where it was read.
 *
 * @param {Family} family
 * @param {{ entries: ListedEntry[], expanded: Map<string, Record<string, unknown>> }} listing
 * @returns {{ line: string, violations: string[] }}
 */
function checkFamily(family, listing) {
  /** @type {string[]} */
  const violations = [];
  /** @type {Resolution[]} */
  const resolutions = [];
  const members = new Set(family.members);
  /** @type {Set<string>} */
  const declared = new Set();
  /** @type {Set<string>} */
  const importers = new Set();

  /**
   * @param {string} member
   * @param {unknown} version
   * @param {string} where
   */
  const record = (member, version, where) => {
    if (typeof version !== "string" || parseVersion(version) === null) {
      violations.push(
        `family ${family.name}: ${member} in ${where} reports the version ${JSON.stringify(version)}, ` +
          `which does not parse, so it cannot be compared with its siblings.`
      );
      return;
    }
    resolutions.push({ member, version, where });
  };

  for (const { importer, name, body } of listing.entries) {
    if (!members.has(name)) continue;
    declared.add(name);
    importers.add(importer);
    record(name, body.version, importer);
    const children =
      body.deduped === true
        ? listing.expanded.get(typeof body.path === "string" ? body.path : "")
        : body.dependencies;
    if (body.deduped === true && children === undefined) {
      violations.push(
        `family ${family.name}: ${name} in ${importer} is listed as deduplicated, and no expanded ` +
          `copy of ${String(body.path)} is in the listing, so its dependencies and peers cannot be read.`
      );
      continue;
    }
    if (typeof children !== "object" || children === null) continue;
    for (const [child, raw] of Object.entries(children)) {
      if (!members.has(child) || typeof raw !== "object" || raw === null) continue;
      record(
        child,
        /** @type {{ version?: unknown }} */ (raw).version,
        `${importer} under ${name}`
      );
    }
  }

  for (const member of family.members) {
    if (!declared.has(member)) {
      violations.push(
        `family ${family.name}: ${member} is a member that no importer declares — remove it from the ` +
          `family, or the lockstep check reads a member it never sees.`
      );
    }
  }

  /** @type {Map<string, string[]>} */
  const byVersion = new Map();
  for (const { member, version, where } of resolutions) {
    const sites = byVersion.get(version) ?? [];
    sites.push(`${member} in ${where}`);
    byVersion.set(version, sites);
  }
  const versions = [...byVersion.keys()].sort(compareVersions);
  if (versions.length > 1) {
    violations.push(
      `family ${family.name} does not resolve to one version: ` +
        versions
          .map((version) => `${version} — ${(byVersion.get(version) ?? []).join(", ")}`)
          .join("; ") +
        `. Its members move together, in one change.`
    );
  }
  const verdict =
    versions.length === 1 && violations.length === 0 ? "in lockstep" : "NOT in lockstep";
  return {
    line:
      `family ${family.name}\t${versions.join(", ") || UNKNOWN}\t${verdict} ` +
      `(${String(family.members.length)} members, ${String(resolutions.length)} resolutions ` +
      `read in ${String(importers.size)} importers)`,
    violations,
  };
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
 * @typedef {object} Evaluation
 * @property {string[]} lines One per population package.
 * @property {string[]} familyLines One per declared family, printed after the population summary.
 * @property {string[]} violations
 */

/**
 * @param {Options} options
 * @returns {Evaluation}
 */
function evaluate(options) {
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const familyLines = [];
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
    return { lines, familyLines, violations };
  }
  for (const row of holds) {
    if (row.removeWhen.length === 0 || row.removeWhen === UNKNOWN) {
      violations.push(
        `the hold row for ${row.packages} carries no remove-when — a hold without an observable ` +
          `exit condition is permanent debt that reads as tracked.`
      );
    }
  }

  const population =
    /** @type {{ packages?: { name?: string, absence?: string }[], families?: unknown }} */ (
      readJson(populationPath)
    );
  const packages = population.packages ?? [];
  if (packages.length === 0) {
    violations.push(
      `zero packages parsed from ${populationPath} — the gate would measure nothing and pass.`
    );
    return { lines, familyLines, violations };
  }
  for (const key of Object.keys(population)) {
    if (!POPULATION_FIELDS.has(key)) {
      violations.push(
        `${populationPath} declares "${key}", which is not one of ${[...POPULATION_FIELDS].join(", ")}: ` +
          `an unread key may be a misspelled one, and a misspelled \`families\` would check nothing.`
      );
    }
  }
  const { families, problems: familyProblems } = parseFamilies(population.families);
  violations.push(...familyProblems);

  // Depth 1 for the families: a member's own dependencies and peers sit one level below the
  // importer. The importer level, which is all the population reads, is the same at depth 0.
  const installedDocument = options.installed
    ? readJson(options.installed)
    : JSON.parse(pnpmStdout(["ls", "-r", "--depth", "1", "--json"]));
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
    return { lines, familyLines, violations };
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

  const listing = listedEntries(installedDocument);
  for (const family of families) {
    const { line, violations: diverging } = checkFamily(family, listing);
    familyLines.push(line);
    violations.push(...diverging);
  }

  return { lines, familyLines, violations };
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

  /** @type {Evaluation} */
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
  for (const line of result.familyLines) process.stdout.write(`${line}\n`);
  for (const violation of result.violations) {
    process.stderr.write(`holds-gate: ${violation}\n`);
  }
  return result.violations.length > 0 ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
