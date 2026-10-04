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
 *   construction, and each measured exception is named with its reason below rather than predicted
 *   by a pattern.
 *
 *   INCLUSIVE UPPER BOUNDS ARE VIOLATIONS. `"pkg@<=W": X` cannot state the floor invariant at all:
 *   the bound is a DIFFERENT number from the target, so raising one leaves the other silently
 *   behind, which is the whole defect this gate closes. The canonical rewrite is `"pkg@<X": X`, the
 *   same set of lifted versions expressed so the two can only move together.
 *
 *   SCOPE. Only keys carrying a band (`name@<range>`) are read. A blanket key (`name: 1.2.3`, illustrative)
 *   has no band to disagree with its target, and `patchedDependencies:` is a different mechanism with
 *   no version selector at all. The block is located by its top-level `overrides:` key, never by a
 *   first-hit-anywhere scan, because the same package name legitimately appears in `catalog:` and in
 *   a named `catalogs:` block. The manifest measured is the one beside the `scripts/` directory this
 *   file lives in, located from the script's own URL: no git, and nothing read from the working
 *   directory, so a run from inside another checkout cannot measure that checkout's manifest instead.
 *
 *   NO SEMVER DEPENDENCY, deliberately. Neither `semver` nor `yaml` resolves from this repository's
 *   root, and a gate that runs in the dependency-consistency job must not need the tree it measures.
 *   The manifest is read as TEXT, through the block reader `engines-node-gate.mjs` uses for the
 *   catalog pin (`workspace-block-reader.mjs`) — the `overrides:` block is one flat `key: value`
 *   line each, the key and the value double-quoted, single-quoted or plain — and the comparator is
 *   an explicit three-number one over the comparators
 *   `<`, `<=`, `>`, `>=` and `=` and a bare major or major.minor X-range. A shape it does not
 *   recognise, a flow-style `{ … }` mapping included, is REFUSED rather than assumed benign, so the
 *   narrow comparator cannot quietly pass something it never understood.
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
 *   Usage: `node scripts/testing/override-bands-gate.mjs [--workspace <path>]` — `--workspace`
 *   replaces the manifest beside the script, which is how the suite drives the rule from fixtures.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readTopLevelBlock } from "./workspace-block-reader.mjs";

const OVERRIDES_KEY = "overrides";
/**
 * One flat entry line of the block: a double-quoted, single-quoted or plain key, then a value quoted
 * the same three ways. Single quotes are read because pnpm writes them in its own lockfile mirror of
 * this block, so a key copied from there is judged rather than refused as unreadable.
 */
const ENTRY =
  /^\s+(?:"([^"]+)"|'([^']+)'|([^"'#\s][^:]*?))\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*(?:#.*)?$/;
/** A comparator, then a version of one to three numbers, each number captured. Anything else is refused. */
const TOKEN = /^(<=|>=|<|>|=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
/** An override target: an exact three-number version, each number captured; never a range or a prerelease. */
const TARGET = /^(\d+)\.(\d+)\.(\d+)$/;
/** The manifest beside the `scripts/` directory this file lives in. */
const MANIFEST = fileURLToPath(new URL("../../pnpm-workspace.yaml", import.meta.url));

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
]);

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
 * @property {string} key The override key without its quotes, so a violation can be found by
 *   searching for it.
 * @property {string} value The override value without its quotes.
 */

/**
 * @typedef {object} Block
 * @property {Entry[]} entries
 * @property {string[]} unreadable Lines inside the block the parser could not read, trimmed of their
 *   surrounding whitespace. A line it cannot read could be the defect, so each one is reported rather
 *   than skipped.
 */

/**
 * The entries of the TOP-LEVEL `overrides:` block, read as text through the reader this gate shares
 * with `engines-node-gate.mjs`. The block ends at the next top-level key; a blank line or a comment
 * inside it, at any indentation, is not the end of it.
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

  // New overrides are appended at the END of the block, so an entry a reader drops is most likely
  // the newest, the one most likely to be wrong. The shared reader is what keeps a column-0 comment
  // from ending the block early.
  const block = readTopLevelBlock(text, OVERRIDES_KEY);
  if (block === null) {
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
    const hit = ENTRY.exec(line);
    const key = hit === null ? undefined : (hit[1] ?? hit[2] ?? hit[3]);
    const value = hit === null ? undefined : (hit[4] ?? hit[5] ?? hit[6]);
    if (key === undefined || value === undefined) {
      unreadable.push(trimmed);
      continue;
    }
    entries.push({ key, value });
  }
  return { entries, unreadable };
}

/** @typedef {[number, number, number]} Triple */

/**
 * The numbers a `TOKEN` or `TARGET` match captured, an omitted minor or patch read as 0. It takes the
 * capture groups themselves rather than re-splitting a string, so nothing reaches it that the
 * pattern did not already admit as a run of digits.
 *
 * @param {string | undefined} major Captured by both patterns whenever they match.
 * @param {string | undefined} minor
 * @param {string | undefined} patch
 * @returns {Triple}
 */
function triple(major, minor, patch) {
  return [Number(major ?? "0"), Number(minor ?? "0"), Number(patch ?? "0")];
}

/**
 * @param {Triple} left
 * @param {Triple} right
 * @returns {number} Negative when `left` precedes `right`.
 */
function compare(left, right) {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

/**
 * @typedef {object} Clause
 * @property {"<" | "<=" | ">" | ">=" | "="} op
 * @property {string} text The version as written, or as derived for a bare X-range.
 * @property {Triple} parts
 */

/**
 * @typedef {object} Band
 * @property {Clause[]} clauses
 * @property {Clause | null} writtenUpper The single literal `<` comparator, if any.
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
  /** @type {Clause | null} */
  let writtenUpper = null;
  let writtenUpperCount = 0;
  /** @type {string | null} */
  let inclusiveUpper = null;

  for (const token of tokens) {
    const hit = TOKEN.exec(token);
    if (hit === null) {
      return {
        error:
          `\`${token}\` is not a comparator this gate recognises. It reads \`<\`, \`<=\`, \`>\`, ` +
          `\`>=\`, \`=\` and a bare major or major.minor range over three-number versions, which is ` +
          `every shape the manifest uses; anything else is refused rather than assumed benign.`,
      };
    }
    const [, op = "", major, minor, patch] = hit;
    const parts = triple(major, minor, patch);
    const text = token.slice(op.length);
    if (op === "<") {
      writtenUpper = { op, text, parts };
      writtenUpperCount += 1;
      clauses.push(writtenUpper);
      continue;
    }
    if (op === "<=") {
      inclusiveUpper = text;
      clauses.push({ op, text, parts });
      continue;
    }
    if (op === ">" || op === ">=" || op === "=") {
      clauses.push({ op, text, parts });
      continue;
    }
    if (patch !== undefined) {
      clauses.push({ op: "=", text, parts });
      continue;
    }
    // A bare X-range: `8` is the 8.x line, below 9.0.0, and `7.1` the 7.1.x line, below 7.2.0. That
    // upper bound is DERIVED, never written, so it can never satisfy the canonical shape — which is
    // exactly why a major-scoped band needs an allowlist entry rather than a rule of its own.
    const [majorPart, minorPart] = parts;
    /** @type {Triple} */
    const upper = minor === undefined ? [majorPart + 1, 0, 0] : [majorPart, minorPart + 1, 0];
    clauses.push({ op: ">=", text: parts.join("."), parts });
    clauses.push({ op: "<", text: upper.join("."), parts: upper });
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
 * @param {Triple} version
 * @param {Clause[]} clauses
 * @returns {boolean}
 */
function satisfies(version, clauses) {
  return clauses.every((clause) => {
    const order = compare(version, clause.parts);
    if (clause.op === "<") return order < 0;
    if (clause.op === "<=") return order <= 0;
    if (clause.op === ">") return order > 0;
    if (clause.op === ">=") return order >= 0;
    return order === 0;
  });
}

/**
 * The key rewritten in the canonical shape: the band's lower bounds kept as written, its upper bound
 * replaced by the target. Keeping the lower bounds is what stops the remedy from widening a floor
 * scoped to one line into one that also lifts every older line onto the target.
 *
 * @param {string} name
 * @param {Band} band
 * @param {string} target
 * @returns {string}
 */
function canonicalKey(name, band, target) {
  const lowers = band.clauses
    .filter((clause) => clause.op === ">=" || clause.op === ">")
    .map((clause) => `${clause.op}${clause.text}`);
  return `${name}@${[...lowers, `<${target}`].join(" ")}`;
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

  const target = TARGET.exec(entry.value);
  if (target === null) {
    return {
      line: `${entry.key}\t${entry.value}\tREFUSED: the target is not a version`,
      violation:
        `${entry.key} → ${entry.value}: the target is not a three-number version, so the gate ` +
        `cannot compare it with the band \`${range}\`. A range-scoped override names an exact ` +
        `release: a prerelease or build suffix, a catalog reference, an alias or a range there pins ` +
        `nothing this comparator can measure.`,
    };
  }
  const targetParts = triple(target[1], target[2], target[3]);

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
        `\`${canonicalKey(name, band, entry.value)}\`, which lifts the same set of versions with ` +
        `the bound and the target forced to move together.`,
    };
  }

  if (band.writtenUpper !== null && compare(band.writtenUpper.parts, targetParts) === 0) {
    return {
      line: `${entry.key}\t${entry.value}\tcanonical: the band's exclusive upper bound is the target`,
      violation: null,
    };
  }

  if (reason !== null) {
    return { line: `${entry.key}\t${entry.value}\tallowlisted: ${reason}`, violation: null };
  }

  if (satisfies(targetParts, band.clauses)) {
    return {
      line: `${entry.key}\t${entry.value}\tviolation: the target satisfies its own band`,
      violation:
        `${entry.key} → ${entry.value}: the target SATISFIES its own band \`${range}\`, so the ` +
        `override pins the tree to a version the band still selects and can lift nothing above it — ` +
        `it is inert against the advisory it was written for. Raise the bound to the target ` +
        `(\`${canonicalKey(name, band, entry.value)}\`), or record the key in this gate's allowlist ` +
        `with the measured behaviour that makes a pin scoped to one line necessary rather than a ` +
        `floor; a pin that only de-duplicates is dropped instead (ADR-0018).`,
    };
  }

  return {
    line: `${entry.key}\t${entry.value}\tviolation: the band was left behind by its target`,
    violation:
      `${entry.key} → ${entry.value}: the band's exclusive upper bound is ` +
      `${band.writtenUpper?.text ?? "absent"} while the target is ${entry.value}, so the band no ` +
      `longer describes the versions this target replaces and the override applies to nothing the ` +
      `tree resolves — an inert floor that still reads as held. Move the bound and the target ` +
      `together (\`${canonicalKey(name, band, entry.value)}\`), or record the key in this gate's ` +
      `allowlist with the measured reason the two cannot be the same number.`,
  };
}

/**
 * @typedef {object} Result
 * @property {string[]} lines One report line per range-scoped override measured.
 * @property {string[]} violations Every refusal, each one a reason to exit 1.
 * @property {number} violating How many measured overrides drew a violating verdict, counted from
 *   the verdicts themselves rather than re-read from the report lines.
 */

/**
 * @param {Options} options
 * @returns {Result}
 */
function evaluate(options) {
  const file = options.workspace ?? MANIFEST;
  const block = readOverrides(file);
  if ("error" in block) return { lines: [], violations: [block.error], violating: 0 };

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
    return { lines, violations, violating: 0 };
  }

  let violating = 0;
  for (const entry of scoped) {
    const verdict = judge(entry);
    lines.push(verdict.line);
    if (verdict.violation !== null) {
      violations.push(verdict.violation);
      violating += 1;
    }
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

  return { lines, violations, violating };
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

  const result = evaluate(options);
  for (const line of result.lines) process.stdout.write(`${line}\n`);
  if (result.lines.length > 0) {
    process.stdout.write(
      `\n${String(result.lines.length)} range-scoped overrides measured, ` +
        `${String(result.violating)} violating\n`
    );
  }
  for (const violation of result.violations) {
    process.stderr.write(`override-bands-gate: ${violation}\n`);
  }
  return result.violations.length > 0 ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
