/**
 * @file runTestsGate.static.test.ts
 * @description Merge-blocking source-scan invariants over `apps/api/scripts/run-tests.sh`,
 *              the gate every "the tests pass" claim in this repository rests on.
 *              The script is shell, so its honesty is only auditable structurally:
 *              the final gate must act on the per-batch runner exit it already
 *              captures, the script must refuse to start without a test database
 *              rather than read an environment file, it must never start vitest,
 *              both tiers must be collected by their suffixes rather than listed by
 *              hand, `--list` must answer above the database refusal, and the header
 *              must not carry a count that rots.
 *
 *              A runner that reports a batch FAILED and then exits zero is worse
 *              than one that never noticed, because every downstream gate believes
 *              it. These assertions are therefore read as behaviour, not style: each
 *              one names the reproduction it closes.
 *
 *              The scan works on a copy with comments blanked (offsets preserved),
 *              so prose describing the defect can never satisfy an assertion about
 *              the code that fixes it.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(currentDir, "..", "..", "..");
const runnerPath = join(apiRoot, "scripts", "run-tests.sh");

const runner = readFileSync(runnerPath, "utf8");
const runnerLines = runner.split("\n");

/**
 * The accumulator `run_batch` appends to whenever a batch is recorded failed —
 * on parsed failures, on cancellations, and on a non-zero runner exit alike.
 */
const FAILED_BATCHES = "FAILED_BATCHES";

/**
 * The condition that opens the refusal: an unset and an empty `DATABASE_URL` alike.
 * The braces-and-default form is what makes it hold under `set -u` as well.
 */
const EMPTY_DATABASE_URL_CONDITION = 'if [ -z "${DATABASE_URL:-}" ]; then';

/** A phrase that lives only in a comment of the script, for the stripper's tripwire. */
const KNOWN_COMMENT_PROSE = "The database is never guessed";

/**
 * Line budgets for the three block scans below. Each is the block's CURRENT length
 * measured from its anchor line; `WINDOW_SLACK` is the room for an extra branch or
 * diagnostic line before the constant has to be raised. They are named rather than
 * inlined because a bare `+ 14` forces the reader to count lines in a shell script
 * to find out what it assumes, and because a too-small window fails with a message
 * about the wrong thing.
 */
const GATE_BLOCK_LINES = 27;
const REFUSAL_BLOCK_LINES = 11;
const COUNT_APPEND_BLOCK_LINES = 3;
const WINDOW_SLACK = 3;

/**
 * Returns a copy of `source` in which the interior of `#` comments is replaced by
 * spaces, preserving length and newline positions so every index stays valid in
 * both copies. A `#` inside a single- or double-quoted string is left alone: the
 * script greps for `"^# tests "` and friends, and blanking those would hide real
 * code from the scan.
 *
 * Two bash behaviours it deliberately does NOT model, written down because both
 * would blank real code and turn an assertion silently green:
 *   - bash starts a comment only at a word boundary, so `${VAR#prefix}`, `$#` and
 *     `array[#]` are code; this blanks from the `#` to end of line;
 *   - here-documents (`<<EOF`) are literal text in which `#` is not a comment and
 *     a lone quote does not open one; there are none in the script today.
 * The sanity assertion in the suite below is the tripwire: it checks that a known
 * code token survives and a known comment token does not, so the day either
 * construct appears the scan reports it instead of quietly reading blanks.
 */
function stripComments(source: string): string {
  const chars = source.split("");
  let quote: string | null = null;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (quote !== null) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === "#") {
      let j = i;
      while (j < source.length && source[j] !== "\n") {
        chars[j] = " ";
        j++;
      }
      i = j;
    }
  }

  return chars.join("");
}

const code = stripComments(runner);
const codeLines = code.split("\n");

/** Every code line (comments blanked) that contains `needle`. */
function codeLinesContaining(needle: string): string[] {
  return codeLines.filter((line) => line.includes(needle));
}

/**
 * The script's FINAL gate: the `if` whose body prints the failed-batch list and
 * exits 1. Anchored on that `echo` rather than on a line number, so the assertion
 * survives edits above it and fails loudly if the block is ever removed.
 */
function finalGateCondition(): string {
  const reportIndex = codeLines.findIndex((line) =>
    line.includes(`FAILED batches:$${FAILED_BATCHES}`)
  );
  if (reportIndex === -1) return "";
  for (let i = reportIndex - 1; i >= 0; i--) {
    const line = codeLines[i] ?? "";
    if (/^\s*if\s/.test(line)) return line.trim();
  }
  return "";
}

/** Index of the code line that opens the empty-`DATABASE_URL` refusal, or -1. */
function refusalIndex(): number {
  return codeLines.findIndex((line) => line.trim() === EMPTY_DATABASE_URL_CONDITION);
}

/**
 * Index of the first code line that starts work: the opening banner or the first
 * `run_batch` call, whichever comes first. The refusal must sit above it.
 */
function firstWorkIndex(): number {
  return codeLines.findIndex(
    (line) => /^\s*echo "Running/.test(line) || /^\s*(?:[A-Z_]+=\S+\s+)*run_batch\s+"/.test(line)
  );
}

/** The script's header comment block: every leading `#` line after the shebang. */
function headerComment(): string {
  const header: string[] = [];
  for (const line of runnerLines.slice(1)) {
    if (!line.startsWith("#")) break;
    header.push(line);
  }
  return header.join("\n");
}

describe("run-tests.sh is a gate that can go red", () => {
  it("finds the runner script and every region the assertions read", () => {
    // Non-vacuity: every assertion below reads one of these, so a scan that
    // stopped locating them would turn the suite green while the gate rotted.
    // `headerComment()` belongs here as much as the others — it collects leading
    // `#` lines from the second line on, so moving `set -e` up or inserting one
    // blank line makes it return "" and the anti-rot assertion passes having read
    // nothing at all.
    expect(runner.length).toBeGreaterThan(0);
    expect(finalGateCondition()).not.toBe("");
    expect(refusalIndex()).toBeGreaterThanOrEqual(0);
    expect(firstWorkIndex()).toBeGreaterThanOrEqual(0);
    expect(headerComment()).not.toBe("");
  });

  it("blanks comments without blanking code", () => {
    // The scan reads `code`, not `runner`. A stripper that blanked too much would
    // make every "the code does NOT contain X" assertion vacuously true, and one
    // that blanked too little would let a comment satisfy an assertion about code.
    // Cheap tripwire in both directions, plus the offset invariant every
    // line-indexed lookup depends on.
    expect({
      lengthPreserved: code.length === runner.length,
      lineCountPreserved: codeLines.length === runnerLines.length,
      keepsCode: code.includes("run_batch()"),
      keepsQuotedHash: code.includes('grep "^# tests "'),
      // Read in both copies, so a reworded comment fails here instead of passing
      // on a phrase that no longer exists anywhere.
      dropsCommentProse:
        runner.includes(KNOWN_COMMENT_PROSE) && !code.includes(KNOWN_COMMENT_PROSE),
    }).toEqual({
      lengthPreserved: true,
      lineCountPreserved: true,
      keepsCode: true,
      keepsQuotedHash: true,
      dropsCommentProse: true,
    });
  });

  describe("the final gate acts on the captured runner exit", () => {
    it("records a failed batch on a non-zero runner exit", () => {
      // The capture half, which already shipped. It is asserted here so the
      // gate assertion below cannot be satisfied by deleting the capture.
      const guard = codeLinesContaining("runner_exit").some((line) => line.includes("-ne 0"));
      const append = codeLinesContaining(FAILED_BATCHES).some((line) => line.includes("$name"));

      expect({ guard, append }).toEqual({ guard: true, append: true });
    });

    it("includes the recorded failed-batch set in the final gate condition", () => {
      // The reproduction: a batch whose runner exits non-zero while reporting
      // `# fail 0` and `# cancelled 0` prints [FAIL], dumps its output, is listed
      // among the failed batches — and a gate reading only the test totals still
      // exits zero. Capturing an exit code is not acting on it.
      expect(finalGateCondition()).toContain(FAILED_BATCHES);
    });

    it("leaves no path on which a batch is recorded failed and the script exits zero", () => {
      // Stated as the invariant rather than as a shape: whatever the condition
      // becomes, a non-empty accumulator must reach it.
      //
      // All three terms are pinned on purpose even though the two count terms are
      // currently subsumed by the third (every path that raises a count also
      // appends a batch name). That redundancy is the defence-in-depth half: if a
      // future edit narrows `run_batch`'s append condition, a run with real
      // failures must still go red on the counts alone. The script says the same
      // thing at the gate, so neither can be "simplified" without the other.
      const condition = finalGateCondition();
      const testsFailedTerm = condition.includes("$TOTAL_FAIL");
      const testsCancelledTerm = condition.includes("$TOTAL_CANCEL");
      const testsSkippedTerm = condition.includes("$TOTAL_SKIP");
      const batchTerm = /-n\s+"\$FAILED_BATCHES"/.test(condition);

      expect({ testsFailedTerm, testsCancelledTerm, testsSkippedTerm, batchTerm }).toEqual({
        testsFailedTerm: true,
        testsCancelledTerm: true,
        testsSkippedTerm: true,
        batchTerm: true,
      });
    });

    it("runs each listed file in its own node process, and fails its batch with it", () => {
      // The reproduction: handed a whole batch, node read back one summary, so a file
      // that collected nothing hid behind its siblings' counts and a listed path that
      // no longer existed was dropped without a word (SMELL-74).
      const nodeLine = codeLines.find((line) => /^\s*result=\$\(node /.test(line)) ?? "";
      const append = codeLines.findIndex((line) => line.includes(`$${FAILED_BATCHES} $name"`));

      expect({
        oneFile: nodeLine.includes('"$file"') && !nodeLine.includes('"$@"'),
        oneAtATime: nodeLine.includes("--test-concurrency=1"),
        batchFailsWithAFile: codeLines
          .slice(append - 3, append)
          .join("\n")
          .includes("failed_files"),
      }).toEqual({ oneFile: true, oneAtATime: true, batchFailsWithAFile: true });
    });

    it("fails the file on a SKIPPED test in a tier-driven run", () => {
      // The term the author stopped one short of. A skipped test in a tier-driven
      // run is a service the tier was supposed to provide and did not: the counts
      // stay clean, the batch prints OK, and the run reports green over tests that
      // never executed. `TOTAL_SKIP` was already accumulated and already printed —
      // it simply gated nothing, in the very tier this gate is load-bearing for.
      //
      // Tier-scoped like the zero-collect term, so a developer trimming a batch
      // locally (TIER unset) is not blocked by their own choice.
      const skipIndex = codeLines.findIndex(
        (line) => line.includes("$skip") && line.includes("-gt 0")
      );
      expect(skipIndex).toBeGreaterThanOrEqual(0);

      const skipBlock = codeLines
        .slice(skipIndex, skipIndex + COUNT_APPEND_BLOCK_LINES + WINDOW_SLACK)
        .join("\n");

      expect({
        tierScoped: /-n\s+"\$\{TIER:-\}"/.test(codeLines[skipIndex] ?? ""),
        failsTheFile: /reasons=.*skipped under TIER/.test(skipBlock),
      }).toEqual({ tierScoped: true, failsTheFile: true });
    });

    it("says WHY when the gate fires on skipped tests alone", () => {
      // Without its own line, a run that goes red purely on skips sends the reader
      // hunting for a failed test that does not exist — the same misdirection the
      // cancelled branch already has a message for.
      const gateIndex = codeLines.findIndex((line) =>
        line.includes(`FAILED batches:$${FAILED_BATCHES}`)
      );
      const gateBlock = codeLines
        .slice(gateIndex, gateIndex + GATE_BLOCK_LINES + WINDOW_SLACK)
        .join("\n");

      expect(gateBlock).toMatch(/echo "ERROR:.*SKIPPED/i);
    });

    it("says WHY when the gate fires with zero failed and zero cancelled tests", () => {
      // Without a dedicated line, the only CI-visible difference between "a
      // runner died" and "nothing happened" is a bare exit code, and the reader
      // is sent looking for a failed test that does not exist.
      const gateIndex = codeLines.findIndex((line) =>
        line.includes(`FAILED batches:$${FAILED_BATCHES}`)
      );
      // Window = the gate block from its anchor to `exit 1`, plus slack. The block
      // is GATE_BLOCK_LINES long today; the slack absorbs one more `echo` or one
      // more branch before the window has to grow. Too small and this assertion
      // reddens with a message about the ERROR line while the real change was an
      // added branch, which sends the reader to the wrong place.
      const gateBlock = codeLines
        .slice(gateIndex, gateIndex + GATE_BLOCK_LINES + WINDOW_SLACK)
        .join("\n");

      // Named for what it checks: that the clean-count branch is GUARDED on
      // `TOTAL_CANCEL -eq 0`, which is what separates it from the cancelled
      // branch. It does not check that the cancelled case is explained.
      const zeroCancelBranchGuard = /TOTAL_CANCEL.*-eq 0|-eq 0.*TOTAL_CANCEL/.test(gateBlock);
      const errorLine = /echo "ERROR:.*(runner|exit)/i.test(gateBlock);

      expect({ zeroCancelBranchGuard, errorLine }).toEqual({
        zeroCancelBranchGuard: true,
        errorLine: true,
      });
    });
  });

  describe("the runner collects integration suites only, and never guesses a database", () => {
    it("refuses an empty DATABASE_URL before it starts any work", () => {
      // The reproduction: with DATABASE_URL unset, a local run used to load the
      // repository's development `.env` and run every suite against the shared
      // development database and its Redis, which the suites write to and flush.
      // A refusal placed after the first batch would still let that batch run.
      expect(refusalIndex()).toBeGreaterThanOrEqual(0);
      expect(refusalIndex()).toBeLessThan(firstWorkIndex());
    });

    it("refuses with TIER unset as well, because the condition is not nested in any branch", () => {
      // A local run without TIER has as much to lose as a CI tier. Nesting depth is
      // counted over the code above the refusal: an enclosing `if` (on TIER or on
      // anything else) would make the refusal conditional.
      const above = codeLines.slice(0, refusalIndex());
      const opened = above.filter((line) => /^\s*if\s/.test(line)).length;
      const closed = above.filter((line) => /^\s*fi\b/.test(line)).length;

      expect({
        depth: opened - closed,
        namesTier: codeLines[refusalIndex()]?.includes("TIER"),
      }).toEqual({
        depth: 0,
        namesTier: false,
      });
    });

    it("exits 2 with a message on stderr that names the variable and the test environment", () => {
      // Window = the `if` line, its brace-grouped echo lines redirected to stderr,
      // `exit 2` and `fi`, plus slack for one more line of guidance.
      const refusalBlock = codeLines
        .slice(refusalIndex(), refusalIndex() + REFUSAL_BLOCK_LINES + WINDOW_SLACK)
        .join("\n");

      expect({
        exitsTwo: /^\s*exit 2\s*$/m.test(refusalBlock),
        toStderr: refusalBlock.includes(">&2"),
        namesVariable: /echo ".*DATABASE_URL/.test(refusalBlock),
        namesTestEnvironment: /echo ".*\.env\.test/.test(refusalBlock),
      }).toEqual({
        exitsTwo: true,
        toStderr: true,
        namesVariable: true,
        namesTestEnvironment: true,
      });
    });

    it("reads no environment file", () => {
      // The caller exports the test environment; the script never loads one on its
      // own, so no file found at the repository root can choose the database.
      // Quoted text is emptied first: the refusal's own message prints the command
      // a developer runs, and printing it is not running it.
      const sourcing = codeLines
        .map((line) => line.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""'))
        .filter(
          (line) =>
            /(?:^|[;&|]|\bthen|\bdo)\s*(?:source|\.)\s+\S/.test(line) || line.includes("--env-file")
        );

      expect(sourcing).toEqual([]);
    });

    it("never starts vitest", () => {
      // Vitest collects the unit tier from the tree on its own. A second start here
      // runs every unit test twice and folds a second verdict into this one.
      expect(codeLinesContaining("vitest")).toEqual([]);
    });
  });

  describe("both tiers are collected by their suffixes, and listed without a database", () => {
    /** Index of the code line that opens the `--list` answer, or -1. */
    function listBlockIndex(): number {
      return codeLines.findIndex((line) => line.trim() === 'if [ -n "$LIST_ONLY" ]; then');
    }

    it("collects every *.integration.test.ts and *.live.test.ts outside tests/unit, in byte order", () => {
      // The reproduction: a suite no hand-written batch named never ran (SMELL-75),
      // and nothing compared the tree against the lists. Found by its suffix, a new
      // suite runs the day it lands, in either tier.
      const collectLine = codeLines.find((line) => /^\s*find tests /.test(line)) ?? "";

      expect({
        collectsTheServicesTier: codeLinesContaining("select_files integration ").length > 0,
        collectsTheLiveTier: codeLinesContaining("select_files live ").length > 0,
        throughCollect: codeLinesContaining('collect "$suffix"').length > 0,
        skipsTheUnitTier: collectLine.includes("-path tests/unit -prune"),
        byteOrder: collectLine.includes("LC_ALL=C sort"),
        reversible: codeLinesContaining('"$TEST_ORDER"').length > 0,
      }).toEqual({
        collectsTheServicesTier: true,
        collectsTheLiveTier: true,
        throughCollect: true,
        skipsTheUnitTier: true,
        byteOrder: true,
        reversible: true,
      });
    });

    it("names no suite by hand", () => {
      // A hand-listed suite is a second inventory beside the collection, the shape
      // that let a suite stop running unnoticed, and the one the live tier kept
      // until it was collected too.
      expect(codeLines.filter((line) => /tests\/[^\s"']*\.test\.ts/.test(line))).toEqual([]);
    });

    it("answers --list above the database refusal, and exits there", () => {
      // Listing reads the tree, the script and the quarantine, never a database, so
      // fitness #30 can read it with no DATABASE_URL. Below the refusal it would be
      // refused; past its own `exit 0` it would run the suites it was asked to list.
      const start = listBlockIndex();
      const end = codeLines.findIndex((line, index) => index > start && /^fi\b/.test(line));
      const block = codeLines.slice(start, end + 1).join("\n");

      expect({
        found: start >= 0 && end > start,
        aboveTheRefusal: start < refusalIndex(),
        exitsZero: /^\s*exit 0\s*$/m.test(block),
        runsNothing: !/\brun_(?:batch|file)\b/.test(block),
      }).toEqual({ found: true, aboveTheRefusal: true, exitsZero: true, runsNothing: true });
    });

    it("reads the shared quarantine with jq and prints each entry it keeps out", () => {
      // One quarantine for this runner and the reach engine; a second copy would
      // drift from the first.
      expect({
        sharedFile: code.includes("packages/test-contracts/quarantine.json"),
        readWithJq: codeLinesContaining("jq -e").length > 0,
        printsEachEntry: code.includes('"  QUARANTINED (not run): %s — %s\\n"'),
      }).toEqual({ sharedFile: true, readWithJq: true, printsEachEntry: true });
    });
  });

  describe("the header describes the runner without a figure that rots", () => {
    it("states no test count", () => {
      // A count in a comment is wrong the day after it is written, and this one
      // was: it named a total the suite left behind long ago. The batch lists
      // below it are the inventory; the header points at them instead.
      //
      // Targeted at the rot CLASS — a number followed by what it counts, with at
      // most one adjective between them ("283 unit tests", "21 such suites") —
      // rather than at any digit run. A blanket digit ban also rejects tracker
      // ids, dates and line references, which do not rot, and pushes the next
      // author into paraphrasing a real reference instead of dropping a count.
      const countClaims = headerComment()
        .split("\n")
        .filter((line) => /\b\d+\s+(?:\w+\s+)?(?:tests?|suites?|specs?|files?)\b/i.test(line));

      expect(countClaims).toEqual([]);
    });
  });
});
