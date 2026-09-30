// @ts-check
/**
 * @file override-bands-gate.mjs
 * @description Refuses a range-scoped `overrides:` entry in `pnpm-workspace.yaml` whose band no
 *   longer describes the versions its own target replaces.
 *
 *   WHY IT EXISTS, measured: a CVE floor is written so that the band's EXCLUSIVE UPPER BOUND and the
 *   target are the same number — `"pkg@<X": X` — which is what makes the override lift exactly the
 *   versions below `X` onto `X`. When a new advisory raises the target and the band is left behind,
 *   the tree is already resolved to the PREVIOUS target, a version the old band no longer selects,
 *   and the override silently stops applying while still reading as a floor in the manifest and in
 *   the canon. That shape has eight recorded instances in this repository — `fast-uri` twice inside a
 *   single change, `brace-expansion` on all three of its lines, `undici`, `sharp`, and one variant
 *   where the advisory's vulnerable set WAS the target — and until this gate nothing detected it. A
 *   floor that has gone inert is worse than no floor: the audit stays green because the advisory's
 *   range no longer matches, and the manifest still says the debt is held.
 *
 *   AN ALLOWLIST, not a denylist, in the form fitness #28 and #40 use. The inadmissible set is
 *   open-ended (a band overtaken by its own target, a band whose upper bound was never the target, a
 *   major-line scope, an inclusive bound, a future shape nobody predicted), while the admissible one
 *   is a sentence: the band's written `<X` equals the target. Everything else is a violation by
 *   construction, and the two measured exceptions are named with their reasons below rather than
 *   predicted by a pattern.
 *
 *   INCLUSIVE UPPER BOUNDS ARE VIOLATIONS. `"pkg@<=W": X` cannot state the floor invariant at all:
 *   the bound is a DIFFERENT number from the target, so raising one leaves the other silently
 *   behind, which is the whole defect this gate closes. The canonical rewrite is `"pkg@<X": X`, the
 *   same set of lifted versions expressed so the two can only move together.
 *
 *   SCOPE. Only keys carrying a band (`name@<range>`) are read. A blanket key (`shell-quote: 1.8.4`)
 *   has no band to disagree with its target, and `patchedDependencies:` is a different mechanism with
 *   no version selector at all. The block is located by its top-level `overrides:` key, never by a
 *   first-hit-anywhere scan, because the same package name legitimately appears in `catalog:` and in
 *   a named `catalogs:` block.
 *
 *   NO SEMVER DEPENDENCY, deliberately. Neither `semver` nor `yaml` resolves from this repository's
 *   root, and a gate that runs in the dependency-consistency job must not need the tree it measures.
 *   The manifest is read as TEXT, the way `engines-node-gate.mjs` already reads the catalog pin — the
 *   `overrides:` block is one flat `"key": value` line each — and the comparator is an explicit
 *   three-number one over exactly the shapes the file contains (`<X`, `<=X`, `>=A <X`, and a bare
 *   major or minor X-range). A shape it does not recognise is REFUSED rather than assumed benign, so
 *   the narrow comparator cannot quietly pass something it never understood.
 *
 *   FAIL-CLOSED in every direction a silent pass could hide an inert band: an unreadable manifest, a
 *   manifest with no top-level `overrides:` block, a line inside the block the parser cannot read,
 *   zero range-scoped entries parsed, a target that is not a three-number version, a band with two
 *   exclusive upper bounds, and an allowlist entry matching no override key each exit 1. A gate that
 *   reports a clean zero over inputs it never read asserts an invariant nobody measured.
 *
 *   TWO RESIDUALS, stated rather than discovered later. (1) The allowlist is keyed by the FULL key
 *   text, band included, so raising an allowlisted band orphans its entry and forces the reason to be
 *   re-read — but the orphan check proves the key still EXISTS, never that its reason still holds.
 *   (2) The gate compares a band with its own target; it does not know which version an advisory
 *   actually patches. `pnpm audit` cannot decide that either (its vulnerable-range string can
 *   disagree with the advisory's own first-patched version), which is why the canon requires a floor
 *   to be cross-derived from OSV plus the upstream changelog. This gate holds the SHAPE; the number
 *   is still a human measurement.
 *
 *   Usage: `node scripts/testing/override-bands-gate.mjs`
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const OVERRIDES_KEY = "overrides:";
/** One flat entry line of the block: an optionally quoted key, then an optionally quoted value. */
const ENTRY = /^\s+(?:"([^"]+)"|([^"#\s][^:]*?))\s*:\s*(?:"([^"]*)"|([^\s#]+))\s*(?:#.*)?$/;
/** A comparator token, or a bare major / major.minor X-range. Anything else is refused. */
const TOKEN = /^(<=|>=|<|>|=)?(\d+(?:\.\d+){0,2})$/;
/** An override target: an exact three-number version, never a range and never a prerelease. */
const TARGET = /^\d+\.\d+\.\d+$/;

/**
 * The bands whose shape is deliberate, each with the measured reason it cannot take the canonical
 * form. Keyed by the FULL override key so that raising a band orphans its entry and forces the reason
 * to be re-read rather than inherited. The list may only shrink.
 *
 * @type {Map<string, string>}
 */
const ALLOWED = new Map([
  [
    "find-my-way@<9.6.1",
    "the advisory names 9.6.1 as its patched version but npm never published it (the registry goes " +
      "9.6.0 then 9.7.0), so 9.7.0 is the minimal AVAILABLE patched version and ADR-0018's " +
      'minimal-patch rule is satisfied rather than waived (SECURITY_CANON.md §"CVE-floor pins")',
  ],
  [
    "gaxios@7",
    "a de-dup pin scoped to ONE major line rather than a floor, so its target necessarily satisfies " +
      "the band: measured in the lockfile, 6.7.1 coexists with 7.1.5, and a blanket pin would force " +
      "every 6.x consumer onto a major it does not declare",
  ],
  [
    "google-auth-library@10",
    "the same major-scoped de-dup as gaxios@7, in the same atomic family: the lockfile carries " +
      "9.15.1 beside 10.7.0, so the band has to be the 10.x line rather than the whole name",
  ],
]);

/** @type {string | null} */
let repoRootCache = null;

/**
 * The repository root, resolved LAZILY. With `--workspace` injected the gate needs neither git nor a
 * repository at all, which is what lets its own suite drive the rule from fixtures.
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
 * @property {string | null} workspace
 */

/**
 * @param {string[]} argv
 * @returns {Options | null} `null` on a usage error, which exits 1.
 */
function parseOptions(argv) {
  /** @type {Options} */
  const options = { workspace: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = (argv[i] ?? "").replace(/^--/, "");
    if (flag !== "workspace") return null;
    const value = argv[i + 1];
    if (value === undefined) return null;
    i += 1;
    options.workspace = value;
  }
  return options;
}

/**
 * @typedef {object} Entry
 * @property {string} key The override key verbatim, so a violation can be found by searching for it.
 * @property {string} value The override value verbatim.
 */

/**
 * @typedef {object} Block
 * @property {Entry[]} entries
 * @property {string[]} unreadable Lines inside the block the parser could not read, verbatim. A line
 *   it cannot read could be the defect, so each one is reported rather than skipped.
 */

/**
 * The entries of the TOP-LEVEL `overrides:` block, read as text. The block ends at the next
 * top-level key; a blank line or a comment inside it is not the end of it.
 *
 * @param {string} file
 * @returns {Block | { error: string }}
 */
function readOverrides(file) {
  /** @type {string} */
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return {
      error:
        `${file} could not be read, so no override band was measured: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    };
  }

  /** @type {string[]} */
  const block = [];
  let inside = false;
  let seen = false;
  for (const line of text.split("\n")) {
    // The block ends at the next top-level KEY, and a column-0 COMMENT is not one: YAML allows an
    // unindented comment inside a mapping, and this manifest uses exactly that to separate override
    // groups. Ending on any column-0 byte would drop every entry after the first such comment — and
    // new overrides are appended at the END, so the entry most likely to be wrong is the one lost.
    if (/^[^\s#]/.test(line)) {
      if (inside) break;
      inside = line.startsWith(OVERRIDES_KEY);
      seen = seen || inside;
      continue;
    }
    if (inside) block.push(line);
  }
  if (!seen) {
    return {
      error:
        `${file} declares no top-level \`overrides:\` block, so no band was measured. Refusing ` +
        `rather than reporting a clean zero: a block that moved or was renamed would otherwise read ` +
        `as an empty one.`,
    };
  }

  /** @type {Entry[]} */
  const entries = [];
  /** @type {string[]} */
  const unreadable = [];
  for (const line of block) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const hit = ENTRY.exec(line);
    const key = hit === null ? undefined : (hit[1] ?? hit[2]);
    const value = hit === null ? undefined : (hit[3] ?? hit[4]);
    if (key === undefined || value === undefined) {
      unreadable.push(trimmed);
      continue;
    }
    entries.push({ key, value });
  }
  return { entries, unreadable };
}

/**
 * The three numeric parts of a version, padded from a major or major.minor form.
 *
 * PRECONDITION, and the reason there is no guard here: every caller passes a string already matched
 * by `TOKEN` or `TARGET`, both of which admit `\d+(\.\d+){0,2}` and nothing else. A re-validation
 * inside this helper would be a branch no input can reach — untestable by construction, and reading
 * as safety while proving nothing. The two regexes ARE the validation; keep it that way.
 *
 * @param {string} version A version already matched by `TOKEN` or `TARGET`.
 * @returns {number[]} Exactly three numbers.
 */
function numericParts(version) {
  const parts = version.split(".").map((part) => Number(part));
  while (parts.length < 3) parts.push(0);
  return parts;
}

/**
 * @param {string} left A version already matched by `TOKEN` or `TARGET`.
 * @param {string} right A version already matched by `TOKEN` or `TARGET`.
 * @returns {number} Negative when `left` precedes `right`.
 */
function compare(left, right) {
  const a = numericParts(left);
  const b = numericParts(right);
  for (let i = 0; i < 3; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The version an X-range's own upper bound is: `7` covers up to `8.0.0`, `7.1` up to `7.2.0`. That
 * bound is DERIVED, never written, so it can never satisfy the canonical shape — which is exactly why
 * a major-scoped band needs an allowlist entry rather than a rule of its own.
 *
 * @param {number[]} parts
 * @param {number} written How many parts the author actually wrote.
 * @returns {string}
 */
function derivedUpper(parts, written) {
  const bumped = [...parts];
  const index = written - 1;
  bumped[index] = (bumped[index] ?? 0) + 1;
  for (let i = index + 1; i < 3; i += 1) bumped[i] = 0;
  return bumped.join(".");
}

/**
 * @typedef {object} Clause
 * @property {"<" | "<=" | ">" | ">=" | "="} op
 * @property {string} version
 */

/**
 * @typedef {object} Band
 * @property {Clause[]} clauses
 * @property {string | null} writtenUpper The version of the single literal `<` comparator, if any.
 * @property {string | null} inclusiveUpper The version of a `<=` comparator, if any.
 */

/**
 * @param {string} range
 * @returns {Band | { error: string }}
 */
function parseBand(range) {
  const tokens = range
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return { error: "the band is empty, so it selects nothing" };

  /** @type {Clause[]} */
  const clauses = [];
  /** @type {string | null} */
  let writtenUpper = null;
  let writtenUpperCount = 0;
  /** @type {string | null} */
  let inclusiveUpper = null;

  for (const token of tokens) {
    const hit = TOKEN.exec(token);
    const raw = hit === null ? undefined : hit[2];
    if (hit === null || raw === undefined) {
      return {
        error:
          `\`${token}\` is not a comparator this gate recognises. It reads \`<\`, \`<=\`, \`>\`, ` +
          `\`>=\`, \`=\` and a bare major or major.minor range over three-number versions, which is ` +
          `every shape the manifest uses; anything else is refused rather than assumed benign.`,
      };
    }
    const op = hit[1] ?? "";
    if (op === "<") {
      writtenUpper = raw;
      writtenUpperCount += 1;
      clauses.push({ op: "<", version: raw });
      continue;
    }
    if (op === "<=") {
      inclusiveUpper = raw;
      clauses.push({ op: "<=", version: raw });
      continue;
    }
    if (op === ">" || op === ">=" || op === "=") {
      clauses.push({ op, version: raw });
      continue;
    }
    const parts = numericParts(raw);
    const written = raw.split(".").length;
    if (written === 3) {
      clauses.push({ op: "=", version: raw });
      continue;
    }
    clauses.push({ op: ">=", version: parts.join(".") });
    clauses.push({ op: "<", version: derivedUpper(parts, written) });
  }

  if (writtenUpperCount > 1) {
    return {
      error:
        `it declares ${String(writtenUpperCount)} exclusive upper bounds, so which one the target ` +
        `should equal is ambiguous`,
    };
  }
  return { clauses, writtenUpper, inclusiveUpper };
}

/**
 * @param {string} version
 * @param {Clause[]} clauses
 * @returns {boolean}
 */
function satisfies(version, clauses) {
  return clauses.every((clause) => {
    const order = compare(version, clause.version);
    if (clause.op === "<") return order < 0;
    if (clause.op === "<=") return order <= 0;
    if (clause.op === ">") return order > 0;
    if (clause.op === ">=") return order >= 0;
    return order === 0;
  });
}

/**
 * @typedef {object} Verdict
 * @property {string} line The tab-separated report line for this entry.
 * @property {string | null} violation
 */

/**
 * @param {Entry} entry
 * @returns {Verdict}
 */
function judge(entry) {
  const at = entry.key.lastIndexOf("@");
  const name = entry.key.slice(0, at);
  const range = entry.key.slice(at + 1);
  const reason = ALLOWED.get(entry.key) ?? null;

  if (!TARGET.test(entry.value)) {
    return {
      line: `${entry.key}\t${entry.value}\tREFUSED: the target is not a version`,
      violation:
        `${entry.key} → ${entry.value}: the target is not a three-number version, so the gate ` +
        `cannot compare it with the band \`${range}\`. A range-scoped override names an exact ` +
        `version; a catalog reference or a range there means nothing is pinned to anything ` +
        `measurable.`,
    };
  }

  const band = parseBand(range);
  if ("error" in band) {
    return {
      line: `${entry.key}\t${entry.value}\tREFUSED: the band could not be read`,
      violation: `${entry.key} → ${entry.value}: ${band.error}`,
    };
  }

  if (band.inclusiveUpper !== null) {
    return {
      line: `${entry.key}\t${entry.value}\tREFUSED: inclusive upper bound`,
      violation:
        `${entry.key} → ${entry.value}: the band's upper bound \`<=${band.inclusiveUpper}\` is ` +
        `INCLUSIVE, so the bound and the target are different numbers and raising one leaves the ` +
        `other behind — the drift this gate exists to refuse. Write the key as ` +
        `\`${name}@<${entry.value}\`, which lifts the same set of versions with the bound and the ` +
        `target forced to move together.`,
    };
  }

  if (band.writtenUpper !== null && compare(band.writtenUpper, entry.value) === 0) {
    return {
      line: `${entry.key}\t${entry.value}\tcanonical: the band's exclusive upper bound is the target`,
      violation: null,
    };
  }

  if (reason !== null) {
    return { line: `${entry.key}\t${entry.value}\tallowlisted: ${reason}`, violation: null };
  }

  if (satisfies(entry.value, band.clauses)) {
    return {
      line: `${entry.key}\t${entry.value}\tviolation: the target satisfies its own band`,
      violation:
        `${entry.key} → ${entry.value}: the target SATISFIES its own band \`${range}\`, so the ` +
        `override pins the tree to a version the band still selects and can lift nothing above it — ` +
        `it is inert against the advisory it was written for. Raise the bound to the target ` +
        `(\`${name}@<${entry.value}\`), or record the key in this gate's allowlist with the measured ` +
        `reason it is a de-dup scoped to one line rather than a floor.`,
    };
  }

  return {
    line: `${entry.key}\t${entry.value}\tviolation: the band was left behind by its target`,
    violation:
      `${entry.key} → ${entry.value}: the band's exclusive upper bound is ` +
      `${band.writtenUpper ?? "absent"} while the target is ${entry.value}, so the band no longer ` +
      `describes the versions this target replaces and the override applies to nothing the tree ` +
      `resolves — an inert floor that still reads as held. Move the bound and the target together ` +
      `(\`${name}@<${entry.value}\`), or record the key in this gate's allowlist with the measured ` +
      `reason the two cannot be the same number.`,
  };
}

/**
 * @param {Options} options
 * @returns {{ lines: string[], violations: string[] }}
 */
function evaluate(options) {
  const file = options.workspace ?? path.join(repoRoot(), "pnpm-workspace.yaml");
  const block = readOverrides(file);
  if ("error" in block) return { lines: [], violations: [block.error] };

  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const violations = [];

  for (const line of block.unreadable) {
    violations.push(
      `${file} holds a line inside its \`overrides:\` block that could not be read as an entry: ` +
        `\`${line}\`. Refusing rather than skipping it: a line the parser cannot read is exactly ` +
        `where an unmeasured band would hide.`
    );
  }

  const scoped = block.entries.filter((entry) => entry.key.lastIndexOf("@") > 0);
  if (scoped.length === 0) {
    violations.push(
      `zero range-scoped overrides were parsed from ${file}, so nothing was measured. Refusing ` +
        `rather than reporting a clean zero: an entry shape this parser stopped matching would ` +
        `otherwise make the whole gate silently inert.`
    );
    return { lines, violations };
  }

  for (const entry of scoped) {
    const verdict = judge(entry);
    lines.push(verdict.line);
    if (verdict.violation !== null) violations.push(verdict.violation);
  }

  const present = new Set(scoped.map((entry) => entry.key));
  for (const [key, reason] of ALLOWED) {
    if (present.has(key)) continue;
    violations.push(
      `the allowlist names \`${key}\`, which no override key in ${file} matches any more, so its ` +
        `recorded reason ("${reason}") now excuses nothing. Delete the entry: the allowlist may ` +
        `only shrink, and an orphan row is how an exception outlives the measurement that earned it.`
    );
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
      "usage: node scripts/testing/override-bands-gate.mjs [--workspace <path>]\n"
    );
    return 1;
  }

  /** @type {{ lines: string[], violations: string[] }} */
  let result;
  try {
    result = evaluate(options);
  } catch (error) {
    process.stderr.write(
      `override-bands-gate: an input could not be read, so nothing was measured: ` +
        `${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }

  for (const line of result.lines) process.stdout.write(`${line}\n`);
  if (result.lines.length > 0) {
    const violating = result.lines.filter((line) => line.includes("\tviolation:")).length;
    const refused = result.lines.filter((line) => line.includes("\tREFUSED:")).length;
    process.stdout.write(
      `\n${String(result.lines.length)} range-scoped overrides measured, ` +
        `${String(violating + refused)} violating\n`
    );
  }
  for (const violation of result.violations) {
    process.stderr.write(`override-bands-gate: ${violation}\n`);
  }
  return result.violations.length > 0 ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
