// @ts-check
/**
 * @file coverage-floor-gate.mjs
 * @description Fitness check #37: the four global coverage floors of `apps/api/vitest.config.ts`
 *   never descend against the pull request's base, except under a canon-exception marker of their
 *   own, and a `decorative-demolition` marker names a slice that this pull request deletes, as the
 *   committed ledger records it.
 *
 *   WHY IT EXISTS. The four literals are a ratchet: `autoUpdate` raises each to the measured value
 *   in the commit that earns it, so the only hand-written move to reject is a lowered number. The
 *   rule lived as a node heredoc written twice, byte for byte, in the CLAUDE.md block and the
 *   workflow step, with no suite: each change edited both copies and proved its red by hand.
 *
 *   WHAT IT READS. The global `thresholds: {` block of the head file only, with block-comment bytes
 *   dropped and per-scope blocks (nested one level deeper) ignored, and the same block of the file
 *   at the base commit, read with `git show`. A commented-out block cannot keep answering for a
 *   floor that no longer exists, and a per-scope block (CODING_STANDARDS §Coverage Targets)
 *   coexists instead of reading as a second literal.
 *
 *   THE LEGITIMATE DESCENT. A lowered floor passes only under a marker on its literal's own line or
 *   the line directly above it, naming a scenario of CLAUDE.md §Pragmatic Exceptions. A scenario in
 *   `SUBJECTS` names its subject after a colon, in that grammar, and the bare scenario is refused. A
 *   marker the base already carries on that metric accepted an earlier descent and accepts no new
 *   one, so every descent ships with a marker of its own.
 *
 *   SLICE MEMBERSHIP (ADR-0039). A `decorative-demolition:<id>` marker passes only when head's
 *   `ledger.json` lists the slice `<id>`, records it deleted, and records a descent of that metric
 *   whose `from` and `to` are the base's literal and the head's, and when the base's `ledger.json`
 *   (read with `git show`) does not already record it deleted: the marker belongs only in the pull
 *   request that deletes the slice's tests. Each refusal names the id and the metric. The ledgers
 *   are read only when such a marker answers for a descent; a marker of any other scenario never
 *   reads them.
 *
 *   FAIL-CLOSED, exit 1, on both sides. A base ref that does not resolve to a commit, a head file
 *   that cannot be read, a head with no global block, or with none or more than one literal of a
 *   metric at its top level, and a base that declares a metric more than once. A base that does
 *   not hold the file, or declares no literal of a metric, has no comparable floor and passes that
 *   metric. When the membership check is needed, a `ledger.json` absent from either side, or one
 *   that is no JSON or holds no `slices` object of slice objects, fails closed too.
 *
 *   EXIT CODES: 0 no floor lowered without a marker of its own; 1 a lowered floor, or an input the
 *   gate could not read; 2 a usage error, since the command takes no argument.
 *
 *   RESIDUAL LIMITS, stated rather than implied. (1) Only `apps/api/vitest.config.ts` is read, and
 *   only its global block. (2) Membership proves the ledger records the slice's deletion and its
 *   descent, never that the deletion explains the descent: the tracker's expected-versus-real drop
 *   and M14 reconcile that. (3) The ledger is the committed one; that it matches the tree is
 *   fitness #52's part.
 *
 *   Usage: `node scripts/testing/coverage-floor-gate.mjs`. `FITNESS_BASE_REF` names the base, by
 *   default `origin/main`. Node built-ins only, because the `fitness` job installs nothing; the
 *   repository is the one this file lives in, located from its own URL.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The repository this file lives in, located from its own URL. */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const HEAD_FILE = "apps/api/vitest.config.ts";
const LEDGER_FILE = "ledger.json";
const DEFAULT_BASE_REF = "origin/main";
const METRICS = ["lines", "functions", "branches", "statements"];
const DEMOLITION = "decorative-demolition";
// Scenarios from CLAUDE.md §Pragmatic Exceptions. A descent marked with anything
// else is not a canon exception, it is an unlabelled one.
const SCENARIOS = new Set([
  "migration",
  "prototype",
  "hotfix",
  "spike",
  "test-fixture",
  DEMOLITION,
]);
// A scenario whose marker names its subject after a colon, and the subject's
// grammar: decorative-demolition names the demolition slice the committed ledger
// lists (ADR-0039), so each descent it accepts is attributable to one slice.
const SUBJECTS = new Map([[DEMOLITION, /^[0-9]+(?:\.[0-9]+)+[a-z]?$/]]);
const USAGE =
  "usage: node scripts/testing/coverage-floor-gate.mjs (FITNESS_BASE_REF names the base)";

/**
 * @template T
 * @typedef {{ value: T } | { error: string }} Result
 */

/**
 * @typedef {object} Marker A canon-exception marker on or above a literal.
 * @property {string} scenario
 * @property {string} id The scenario, with its subject after a colon when it names one.
 * @property {string | null} subject What follows the colon, `null` when nothing does.
 * @property {boolean} valid
 * @property {"unlisted" | "subject" | null} why
 *
 * @typedef {object} Literal One floor literal of a thresholds block.
 * @property {string} value As written.
 * @property {Marker | null} marker
 *
 * @typedef {Map<string, Literal[]>} Floors Each metric's literals at the block's top level.
 *
 * @typedef {Record<string, Record<string, unknown>>} Slices The `slices` of a `ledger.json`.
 *
 * @typedef {object} Ledgers The `slices` of head's `ledger.json` and of the base's.
 * @property {Result<Slices>} head
 * @property {Result<Slices>} base
 *
 * @typedef {object} Verdict What one comparison found.
 * @property {string[]} notes The lines for stderr, in order: what was accepted and why a marker
 *   was not honoured.
 * @property {string[]} violations One per floor lowered without a marker of its own.
 * @property {string | null} error Why the gate could not compare, failing closed, else `null`.
 *
 * @typedef {object} GateRun What the command prints and the code it exits with.
 * @property {number} code 0 clean, 1 a violation or an input that could not be read, 2 usage.
 * @property {string} stdout
 * @property {string} stderr
 *
 * @typedef {object} GateSeams What the suite replaces; the command passes none.
 * @property {string} [root] The repository root, absolute.
 * @property {Readonly<Record<string, string | undefined>>} [env] Replaces `process.env`.
 * @property {(args: readonly string[]) => Result<string>} [git] Replaces git, run in the root.
 */

// Split every line into its code half and its line-comment half: block-comment
// bytes are dropped (a commented-out block must not keep answering for a floor
// that no longer exists) and string literals are preserved verbatim (a glob key
// like "src/**/*.ts" holds the exact byte pairs that a naive comment strip eats).
// The canon-exception markers live in the comment half, which is why comments are
// separated rather than discarded.
/**
 * @param {string} source
 * @returns {{ code: string, comment: string }[]}
 */
const scanLines = (source) => {
  const lines = [];
  let code = "";
  let comment = "";
  let state = "code";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "\n") {
      lines.push({ code, comment });
      code = "";
      comment = "";
      if (state === "line") state = "code";
      i += 1;
      continue;
    }
    if (state === "block") {
      if (c === "*" && source[i + 1] === "/") {
        state = "code";
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (state === "line") {
      comment += c;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== "\n")
        j += source[j] === "\\" ? 2 : 1;
      code += source.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      state = "line";
      comment = "//";
      i += 2;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      state = "block";
      i += 2;
      continue;
    }
    code += c;
    i += 1;
  }
  lines.push({ code, comment });
  return lines;
};

/**
 * @param {string | undefined} comment
 * @returns {Marker | null}
 */
const markerOf = (comment) => {
  const m = /canon-exception:\s*([a-z-]+)(?::(\S+))?/.exec(comment ?? "");
  if (m === null) return null;
  const scenario = m[1] ?? "";
  const id = m[2] === undefined ? scenario : `${scenario}:${m[2]}`;
  const grammar = SUBJECTS.get(scenario);
  const why = !SCENARIOS.has(scenario)
    ? "unlisted"
    : grammar !== undefined && !grammar.test(m[2] ?? "")
      ? "subject"
      : null;
  return { scenario, id, subject: m[2] ?? null, valid: why === null, why };
};

// Reads the GLOBAL thresholds block only. A metric is accepted only at the top
// level of `thresholds: {`, so a per-scope block — which CODING_STANDARDS
// §Coverage Targets requires (Domain 90 / Application 85 / Infrastructure 70) —
// nests one level deeper and coexists instead of reading as ambiguity.
/**
 * @param {string} source
 * @returns {Floors | null} `null` when the source holds no global thresholds block.
 */
const floorsOf = (source) => {
  const lines = scanLines(source);
  /** @type {Floors} */
  const found = new Map(METRICS.map((metric) => [metric, []]));
  let started = false;
  let depth = 0;
  for (let n = 0; n < lines.length; n += 1) {
    const { code, comment } = lines[n] ?? { code: "", comment: "" };
    const braces = code.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""');
    if (!started) {
      if (/(^|[^A-Za-z0-9_$])thresholds\s*:\s*\{/.test(braces)) {
        started = true;
        depth = 1;
      }
      continue;
    }
    if (depth === 1) {
      const m =
        /^\s*(lines|functions|branches|statements)\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*,?\s*$/.exec(code);
      if (m !== null) {
        found.get(m[1] ?? "")?.push({
          value: m[2] ?? "",
          marker: markerOf(comment) ?? markerOf(n > 0 ? lines[n - 1]?.comment : ""),
        });
      }
    }
    for (const ch of braces) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
    if (depth <= 0) break;
  }
  return started ? found : null;
};

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The verdict of the ledgers on a `decorative-demolition` marker that answers for a descent: the
 * sentence the acceptance adds, the refusal, or why the ledgers could not be read.
 *
 * @param {Marker} marker
 * @param {string} metric
 * @param {string} from The base's literal.
 * @param {string} to The head's literal.
 * @param {Ledgers} ledgers
 * @returns {{ accepted: string } | { refusal: string } | { error: string }}
 */
function membershipOf(marker, metric, from, to, ledgers) {
  const id = marker.subject ?? "";
  const carries = `fitness #37: coverage.thresholds.${metric} carries 'canon-exception: ${marker.id}'`;
  if ("error" in ledgers.head) {
    return {
      error: `${carries}, and head's ledger.json could not be read, so the slice cannot be checked against it — failing closed: ${ledgers.head.error}`,
    };
  }
  if ("error" in ledgers.base) {
    return {
      error: `${carries}, and the base's ledger.json could not be read, so whether the slice was already deleted cannot be told — failing closed: ${ledgers.base.error}`,
    };
  }
  const slice = Object.hasOwn(ledgers.head.value, id) ? ledgers.head.value[id] : undefined;
  if (slice === undefined) {
    return { refusal: `${carries}, but head's ledger.json lists no slice '${id}' — not honoured.` };
  }
  if (!Object.hasOwn(slice, "deleted")) {
    return {
      refusal: `${carries}, but head's ledger.json does not record slice '${id}' as deleted: the marker belongs only in the pull request that deletes the slice's tests (ADR-0039) — not honoured.`,
    };
  }
  const before = Object.hasOwn(ledgers.base.value, id) ? ledgers.base.value[id] : undefined;
  if (before !== undefined && Object.hasOwn(before, "deleted")) {
    return {
      refusal: `${carries}, but the base's ledger.json already records slice '${id}' as deleted: an earlier pull request deleted its tests, and the marker belongs only in that one (ADR-0039) — not honoured.`,
    };
  }
  const floors = slice["floors"];
  const floor = isObject(floors) && isObject(floors[metric]) ? floors[metric] : null;
  if (floor === null) {
    return {
      refusal: `${carries}, but slice '${id}' records no ${metric} descent in head's ledger.json — not honoured.`,
    };
  }
  if (floor["from"] !== Number(from) || floor["to"] !== Number(to)) {
    return {
      refusal: `${carries}, but slice '${id}' records ${metric} ${String(floor["from"])} -> ${String(floor["to"])} in head's ledger.json, while this pull request lowers it ${from} -> ${to} — not honoured.`,
    };
  }
  return {
    accepted: ` Head's ledger.json records slice '${id}' deleted in this pull request, ${metric} ${from} -> ${to}, and the base's does not.`,
  };
}

/**
 * @description Compares the head's global coverage floors with the base's, metric by metric: a
 *   floor at or above its base passes, a metric the base does not declare passes, and a lowered
 *   floor passes only under a valid marker of its own on or above its literal, which for a
 *   `decorative-demolition` marker names a slice the ledgers record as deleted in this pull
 *   request with this descent.
 * @param {string} headSource The head's `apps/api/vitest.config.ts`.
 * @param {string} baseSource The same file at the base, `""` when the base does not hold it.
 * @param {() => Ledgers} ledgers Reads the two ledgers; called only when a membership check is
 *   needed, and at most once.
 * @returns {Verdict} The notes, the violations, or why the gate failed closed.
 */
export function evaluateFloors(headSource, baseSource, ledgers) {
  /** @type {string[]} */
  const notes = [];
  /** @type {string[]} */
  const violations = [];
  /** @param {string} error */
  const failClosed = (error) => ({ notes, violations, error });
  /** @type {Ledgers | null} */
  let read = null;
  const head = floorsOf(headSource);
  if (head === null) {
    return failClosed(
      `fitness #37: no global 'thresholds: {' block found in ${HEAD_FILE} — the floor is missing, renamed, or commented out. The guard cannot see it, failing closed.`
    );
  }
  const base = baseSource.trim() === "" ? null : floorsOf(baseSource);
  for (const metric of METRICS) {
    const headHits = head.get(metric) ?? [];
    const headHit = headHits[0];
    if (headHits.length !== 1 || headHit === undefined) {
      const why =
        headHits.length === 0
          ? "the literal is missing, commented out, or built by a helper call"
          : "the GLOBAL block declares it more than once (a per-scope block nested deeper is ignored on purpose and is not this)";
      return failClosed(
        `fitness #37: expected exactly one literal '${metric}:' at the top level of the global thresholds block in ${HEAD_FILE}, found ${headHits.length} — ${why}; the guard cannot see the floor, failing closed.`
      );
    }
    const baseHits = base === null ? [] : (base.get(metric) ?? []);
    // Absent on base passes BY METRIC: a base with no literal for it is the
    // pre-ratchet format, which has no comparable floor. TWO or more is ambiguity,
    // and ambiguity fails closed on this side exactly as it does on the head side —
    // an open base side let a 90 -> 56.9 descent through on all four metrics.
    const baseHit = baseHits[0];
    if (baseHit === undefined) continue;
    if (baseHits.length > 1) {
      return failClosed(
        `fitness #37: the base declares '${metric}:' ${baseHits.length} times at the top level of its global thresholds block — the guard cannot tell which value is the floor, failing closed (the head side fails closed on the same ambiguity).`
      );
    }
    if (Number(headHit.value) >= Number(baseHit.value)) continue;
    const marker = headHit.marker;
    const lowered = `coverage.thresholds.${metric} lowered: ${baseHit.value} (base) -> ${headHit.value} (head)`;
    // A marker the base already carries on this metric accepted an earlier descent;
    // it accepts no new one, so every descent ships with a marker of its own.
    const inherited = marker !== null && marker.valid && baseHit.marker?.id === marker.id;
    if (marker !== null && marker.valid && !inherited) {
      read ??= marker.scenario === DEMOLITION ? ledgers() : null;
      const membership =
        marker.scenario === DEMOLITION && read !== null
          ? membershipOf(marker, metric, baseHit.value, headHit.value, read)
          : { accepted: "" };
      if ("error" in membership) return failClosed(membership.error);
      if ("refusal" in membership) {
        notes.push(membership.refusal);
        violations.push(lowered);
        continue;
      }
      notes.push(
        `fitness #37: coverage.thresholds.${metric} lowered ${baseHit.value} -> ${headHit.value}, ACCEPTED under the 'canon-exception: ${marker.id}' marker on or above that line. The marker ships in the diff for a human to approve and carries its own follow-up per CLAUDE.md §Pragmatic Exceptions.${membership.accepted}`
      );
      continue;
    }
    if (inherited) {
      notes.push(
        `fitness #37: coverage.thresholds.${metric} carries 'canon-exception: ${marker.id}', which the base already carries on that metric: it accepted an earlier descent and accepts no new one — not honoured.`
      );
    } else if (marker !== null && marker.why === "subject") {
      notes.push(
        `fitness #37: coverage.thresholds.${metric} carries 'canon-exception: ${marker.id}', whose subject after the colon is missing or outside its scenario's grammar (${SUBJECTS.get(marker.scenario)}) — not honoured.`
      );
    } else if (marker !== null) {
      notes.push(
        `fitness #37: coverage.thresholds.${metric} carries 'canon-exception: ${marker.id}', which is not a scenario from the CLAUDE.md §Pragmatic Exceptions allowed list (${[...SCENARIOS].join(", ")}) — not honoured.`
      );
    }
    violations.push(lowered);
  }
  return { notes, violations, error: null };
}

/**
 * @param {string} root
 * @returns {(args: readonly string[]) => Result<string>}
 */
function gitIn(root) {
  return (args) => {
    try {
      return {
        value: execFileSync("git", [...args], {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 256 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };
}

/**
 * A file at a commit: its text, `null` when the commit does not hold it, or why git failed.
 *
 * @param {(args: readonly string[]) => Result<string>} git
 * @param {string} commit
 * @param {string} file
 * @returns {Result<string | null>}
 */
function fileAt(git, commit, file) {
  const listed = git(["ls-tree", "--name-only", commit, "--", file]);
  if ("error" in listed) return listed;
  if (listed.value.trim() === "") return { value: null };
  const shown = git(["show", `${commit}:${file}`]);
  return "error" in shown ? shown : { value: shown.value };
}

/**
 * @param {string} root
 * @param {string} file
 * @returns {Result<string>}
 */
function readTree(root, file) {
  try {
    return { value: readFileSync(path.join(root, file), "utf8") };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The `slices` of a `ledger.json`, or why they cannot be read.
 *
 * @param {Result<string | null>} file
 * @param {string} where How the side holding the file is named when it is absent.
 * @returns {Result<Slices>}
 */
function slicesOf(file, where) {
  if ("error" in file) return file;
  if (file.value === null) return { error: `${where} holds no ${LEDGER_FILE}` };
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(file.value);
  } catch (error) {
    return { error: `it is no JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const slices = isObject(parsed) ? parsed["slices"] : undefined;
  if (!isObject(slices) || !Object.values(slices).every(isObject)) {
    return { error: "it holds no `slices` object whose every slice is an object" };
  }
  return { value: /** @type {Slices} */ (slices) };
}

/**
 * @description Runs fitness #37: resolves the base, reads the head's and the base's
 *   `apps/api/vitest.config.ts`, compares their global floors and, when a `decorative-demolition`
 *   marker answers for a descent, reads head's and the base's `ledger.json`. Nothing is printed
 *   here; the entry point writes what this returns.
 * @param {readonly string[]} argv The command's arguments; it takes none.
 * @param {GateSeams} [seams] The root, the environment and git, replaced by the suite.
 * @returns {GateRun} The exit code and what to print on each stream.
 */
export function main(argv, seams = {}) {
  if (argv.length > 0) return { code: 2, stdout: "", stderr: `${USAGE}\n` };
  const root = seams.root ?? ROOT;
  const env = seams.env ?? process.env;
  const git = seams.git ?? gitIn(root);
  const baseRef = env["FITNESS_BASE_REF"] || DEFAULT_BASE_REF;
  /** @param {string[]} lines */
  const text = (lines) => lines.map((line) => `${line}\n`).join("");
  /**
   * @param {string} error
   * @param {string[]} [notes]
   */
  const unread = (error, notes = []) => ({ code: 1, stdout: "", stderr: text([...notes, error]) });

  const resolved = git(["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]);
  if ("error" in resolved || resolved.value.trim() === "") {
    return unread(
      `fitness #37: base ref ${baseRef} does not resolve to a commit, so there is no floor to compare against — failing closed.`
    );
  }
  const commit = resolved.value.trim();
  const head = readTree(root, HEAD_FILE);
  if ("error" in head) {
    return unread(`fitness #37: ${HEAD_FILE} could not be read, failing closed: ${head.error}`);
  }
  const base = fileAt(git, commit, HEAD_FILE);
  if ("error" in base) {
    return unread(
      `fitness #37: ${HEAD_FILE} at the base ${baseRef} could not be read, failing closed: ${base.error}`
    );
  }

  const verdict = evaluateFloors(head.value, base.value ?? "", () => ({
    head: slicesOf(readTree(root, LEDGER_FILE), "the head"),
    base: slicesOf(fileAt(git, commit, LEDGER_FILE), `the base ${baseRef}`),
  }));
  if (verdict.error !== null) return unread(verdict.error, verdict.notes);
  const summary =
    `coverage-floor-gate: ${METRICS.length} floors of ${HEAD_FILE} compared with ${baseRef} ` +
    `(${commit}): ${verdict.violations.length} lowered with no honoured marker`;
  return {
    code: verdict.violations.length > 0 ? 1 : 0,
    stdout: text([...verdict.violations, summary]),
    stderr: text(verdict.notes),
  };
}

/**
 * True only when this file is the process entry point, so importing it for the suite does not run
 * the command.
 *
 * @returns {boolean}
 */
function invokedAsScript() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedAsScript()) {
  const run = main(process.argv.slice(2));
  process.stdout.write(run.stdout);
  process.stderr.write(run.stderr);
  process.exitCode = run.code;
}
