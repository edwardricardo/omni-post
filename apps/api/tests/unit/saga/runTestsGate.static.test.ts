/**
 * @file runTestsGate.static.test.ts
 * @description Merge-blocking source-scan invariants over `apps/api/scripts/run-tests.sh`,
 *              the gate every "the tests pass" claim in this repository rests on.
 *              The script is shell, so its honesty is only auditable structurally:
 *              the final gate must act on the per-batch runner exit it already
 *              captures, the Vitest phase must not throw its runner exit away, and
 *              the header must not carry a count that rots.
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

/** The name the Vitest phase must contribute to that accumulator. */
const VITEST_BATCH_NAME = "vitest-unit";

/**
 * Line budgets for the three block scans below. Each is the block's CURRENT length
 * measured from its anchor line; `WINDOW_SLACK` is the room for an extra branch or
 * diagnostic line before the constant has to be raised. They are named rather than
 * inlined because a bare `+ 14` forces the reader to count lines in a shell script
 * to find out what it assumes, and because a too-small window fails with a message
 * about the wrong thing.
 */
const GATE_BLOCK_LINES = 23;
const VITEST_GUARD_BLOCK_LINES = 7;
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

/** The line that invokes the Vitest runner. */
function vitestInvocation(): string {
  return codeLinesContaining("vitest run")[0]?.trim() ?? "";
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
    expect(vitestInvocation()).not.toBe("");
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
      dropsCommentProse: !code.includes("Load .env if DATABASE_URL is not already set"),
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

    it("records a failed batch on a SKIPPED test in a tier-driven run", () => {
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
        recordsTheBatch: skipBlock.includes(FAILED_BATCHES),
      }).toEqual({ tierScoped: true, recordsTheBatch: true });
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

  describe("the Vitest phase keeps its runner exit", () => {
    it("does not discard the Vitest runner exit with `|| true`", () => {
      // Same defect as the node:test batches had, one phase earlier: a Vitest
      // process that dies before printing a summary parses as `0 failed`, and
      // `|| true` erases the only other evidence there was.
      expect(vitestInvocation()).not.toMatch(/\|\|\s*true\s*$/);
    });

    it("captures that exit into a variable", () => {
      expect(vitestInvocation()).toMatch(/\|\|\s*[A-Z_]*EXIT[A-Z_]*=\$\?/);
    });

    it("records the vitest batch as failed on a non-zero exit with zero parsed failures", () => {
      // The count-based append stays; this is the independent second signal, so
      // a Vitest crash with no parsed failures still reddens the run.
      const exitVariable = /\|\|\s*([A-Z_]*EXIT[A-Z_]*)=\$\?/.exec(vitestInvocation())?.[1] ?? "";
      expect(exitVariable).not.toBe("");

      const guardIndex = codeLines.findIndex(
        (line) => line.includes(`$${exitVariable}`) && line.includes("-ne 0")
      );
      expect(guardIndex).toBeGreaterThanOrEqual(0);

      // Window = the `if` line, its body (the marker echo, the output dump, the
      // append) and its `fi`, plus slack for one more diagnostic line.
      const guardBlock = codeLines
        .slice(guardIndex, guardIndex + VITEST_GUARD_BLOCK_LINES + WINDOW_SLACK)
        .join("\n");
      expect(guardBlock).toContain(FAILED_BATCHES);
      expect(guardBlock).toContain(VITEST_BATCH_NAME);
    });

    it("keeps the count-based append as its own signal", () => {
      const countIndex = codeLines.findIndex(
        (line) => line.includes("VITEST_FAILED") && line.includes("-gt 0")
      );
      expect(countIndex).toBeGreaterThanOrEqual(0);

      // Window = `if` + the single append + `fi`, plus slack.
      const countBlock = codeLines
        .slice(countIndex, countIndex + COUNT_APPEND_BLOCK_LINES + WINDOW_SLACK)
        .join("\n");
      expect(countBlock).toContain(`${FAILED_BATCHES}="$${FAILED_BATCHES} ${VITEST_BATCH_NAME}"`);
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
