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
 * Returns a copy of `source` in which the interior of `#` comments is replaced by
 * spaces, preserving length and newline positions so every index stays valid in
 * both copies. A `#` inside a single- or double-quoted string is left alone: the
 * script greps for `"^# tests "` and friends, and blanking those would hide real
 * code from the scan.
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
  it("finds the runner script and its final gate", () => {
    // Non-vacuity: every assertion below reads one of these, so a scan that
    // stopped locating them would turn the suite green while the gate rotted.
    expect(runner.length).toBeGreaterThan(0);
    expect(finalGateCondition()).not.toBe("");
    expect(vitestInvocation()).not.toBe("");
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
      const condition = finalGateCondition();
      const testsFailedTerm = condition.includes("$TOTAL_FAIL");
      const testsCancelledTerm = condition.includes("$TOTAL_CANCEL");
      const batchTerm = /-n\s+"\$FAILED_BATCHES"/.test(condition);

      expect({ testsFailedTerm, testsCancelledTerm, batchTerm }).toEqual({
        testsFailedTerm: true,
        testsCancelledTerm: true,
        batchTerm: true,
      });
    });

    it("says WHY when the gate fires with zero failed and zero cancelled tests", () => {
      // Without a dedicated line, the only CI-visible difference between "a
      // runner died" and "nothing happened" is a bare exit code, and the reader
      // is sent looking for a failed test that does not exist.
      const gateIndex = codeLines.findIndex((line) =>
        line.includes(`FAILED batches:$${FAILED_BATCHES}`)
      );
      const gateBlock = codeLines.slice(gateIndex, gateIndex + 14).join("\n");

      const cancelExplained = /TOTAL_CANCEL.*-eq 0|-eq 0.*TOTAL_CANCEL/.test(gateBlock);
      const errorLine = /echo "ERROR:.*(runner|exit)/i.test(gateBlock);

      expect({ cancelExplained, errorLine }).toEqual({ cancelExplained: true, errorLine: true });
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

      const guardBlock = codeLines.slice(guardIndex, guardIndex + 6).join("\n");
      expect(guardBlock).toContain(FAILED_BATCHES);
      expect(guardBlock).toContain(VITEST_BATCH_NAME);
    });

    it("keeps the count-based append as its own signal", () => {
      const countIndex = codeLines.findIndex(
        (line) => line.includes("VITEST_FAILED") && line.includes("-gt 0")
      );
      expect(countIndex).toBeGreaterThanOrEqual(0);

      const countBlock = codeLines.slice(countIndex, countIndex + 4).join("\n");
      expect(countBlock).toContain(`${FAILED_BATCHES}="$${FAILED_BATCHES} ${VITEST_BATCH_NAME}"`);
    });
  });

  describe("the header describes the runner without a figure that rots", () => {
    it("states no test count", () => {
      // A count in a comment is wrong the day after it is written, and this one
      // was: it named a total the suite left behind long ago. The batch lists
      // below it are the inventory; the header points at them instead.
      const countClaims = headerComment()
        .split("\n")
        .filter((line) => /\b\d{2,}\b/.test(line));

      expect(countClaims).toEqual([]);
    });
  });
});
