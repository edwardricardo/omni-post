/**
 * @file fitnessInventoryGate.test.ts
 * @description Pins `scripts/testing/fitness-inventory-gate.mjs`, fitness check #44: the numbered
 *   steps of the fitness workflow form the set `1..N` with no hole and no duplicate, the canon's
 *   `# N.` check headings carry the same set, and the one count sentence states the derived `N`.
 *
 *   WHY THE GATE EXISTS, and therefore what this suite has to hold: the suite's own inventory was
 *   the one invariant nothing measured. A duplicated number, a heading deleted from the canon, a
 *   step deleted from the workflow and a stale count sentence each read as a complete inventory, and
 *   the summary printed a typed count that agreed with the document whatever actually ran.
 *
 *   Every input is a fixture string or a fixture file in a scratch directory, so the suite never
 *   reads the repository's own workflow or canon: it measures the gate's RULE rather than today's
 *   files, and it can prove each red path while the real files are clean. The rules are driven
 *   through the exported `evaluateInventory`; the CLI is driven as a process for what only a
 *   process can show — the exit code, where the inputs are found, and that the job summary is
 *   written from the derived count and only on a clean verdict.
 *
 *   The heading convention is pinned on purpose. A check heading in the canon is a `# N.` line at
 *   column 0 that follows the fence or a blank line; the canon's check blocks are shell, so a shell
 *   comment of that shape inside a block LOOKS like a heading. The suite holds that such a comment
 *   is reported by its line number, or, when it follows a blank line, surfaces as a duplicate or an
 *   unwired number — never silently counted and never silently ignored.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));

const GATE_SCRIPT = path.join(REPO_ROOT, "scripts", "testing", "fitness-inventory-gate.mjs");

interface Step {
  readonly number: number;
  readonly name: string;
  readonly line: number;
}

interface Heading {
  readonly number: number;
  readonly line: number;
}

interface Inventory {
  readonly n: number;
  readonly steps: readonly Step[];
  readonly headings: readonly Heading[];
}

interface Verdict {
  readonly inventory: Inventory | null;
  readonly violations: readonly string[];
}

interface InventoryInput {
  readonly workflowText: string;
  readonly canonText: string;
  readonly workflowLabel: string;
  readonly canonLabel: string;
}

/**
 * The module's surface as the suite uses it. It is loaded by a computed path because a literal
 * import of an untyped `.mjs` would leave the tests' typecheck scope an implicit-any module.
 */
interface FitnessInventoryGateModule {
  readonly evaluateInventory: (input: InventoryInput) => Verdict;
  readonly renderSummary: (inventory: Inventory) => string;
}

interface GateResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const WORKFLOW_LABEL = "fixture/fitness.yml";
const CANON_LABEL = "fixture/CLAUDE.md";

/** A numbered step name as the workflow writes it, double-quoted. */
const stepName = (number: number): string => `"#${String(number)} Check number ${String(number)}"`;

/**
 * A fitness workflow whose steps carry the given raw `name:` values, in order, each with a `run: |`
 * body. An unnumbered checkout step leads, as in the real file, so a reader that counted every step
 * would turn a clean fixture red.
 */
const renderWorkflow = (
  names: readonly string[],
  runBody: readonly string[] = ['echo "ok"']
): string =>
  [
    "name: Fixture fitness",
    "on: [push]",
    "jobs:",
    "  fitness:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Checkout code",
    "        uses: actions/checkout@v7",
    "",
    ...names.flatMap((name) => [
      `      - name: ${name}`,
      "        if: always()",
      "        run: |",
      "          set -euo pipefail",
      ...runBody.map((line) => `          ${line}`),
      "",
    ]),
  ].join("\n");

interface CanonFixture {
  /** Check headings, in declaration order; each opens its own block after a blank line. */
  readonly headings: readonly number[];
  /** The count sentence; `null` leaves it out. Defaults to the one matching `headings`. */
  readonly sentence?: string | null;
  /** Extra lines appended to a check's body, by check number. */
  readonly bodies?: Readonly<Record<number, readonly string[]>>;
  /** Lines written after the section ends, under a later level-2 heading. */
  readonly after?: readonly string[];
  /** Leaves the code block unclosed. */
  readonly unclosed?: boolean;
}

const countSentence = (n: number): string =>
  `There are **${String(n)} checks, numbered #1-#${String(n)}**`;

const renderCanon = (fixture: CanonFixture): string => {
  const sentence =
    fixture.sentence === undefined ? countSentence(fixture.headings.length) : fixture.sentence;
  const blocks = fixture.headings.flatMap((number, index) => [
    ...(index === 0 ? [] : [""]),
    `# ${String(number)}. Check number ${String(number)}.`,
    `echo "check ${String(number)}"`,
    ...(fixture.bodies?.[number] ?? []),
  ]);
  return [
    "# Fixture canon",
    "",
    "## Automated Compliance Checks (CI Fitness Functions)",
    "",
    `**Wired to CI.** Every check below runs in the workflow.${sentence === null ? "" : ` ${sentence}.`} Run them locally.`,
    "",
    "````bash",
    ...blocks,
    ...(fixture.unclosed === true ? [] : ["````"]),
    "",
    "## Problem-Solving Standards",
    "",
    ...(fixture.after ?? []),
    "",
  ].join("\n");
};

const loadGate = async (): Promise<FitnessInventoryGateModule> =>
  (await import(GATE_SCRIPT)) as FitnessInventoryGateModule;

const evaluate = async (workflowText: string, canonText: string): Promise<Verdict> => {
  const gate = await loadGate();
  return gate.evaluateInventory({
    workflowText,
    canonText,
    workflowLabel: WORKFLOW_LABEL,
    canonLabel: CANON_LABEL,
  });
};

const numbered = (count: number): number[] =>
  Array.from({ length: count }, (_, index) => index + 1);

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

const scratch = (prefix: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
};

const toResult = (result: ReturnType<typeof spawnSync>): GateResult => ({
  status: result.status ?? -1,
  stdout: String(result.stdout ?? ""),
  stderr: String(result.stderr ?? ""),
});

describe("fitness inventory gate (#44)", () => {
  describe("a clean inventory", () => {
    it("derives N from the workflow and reports no violation when both sides carry 1..N", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(3).map(stepName)),
        renderCanon({ headings: numbered(3) })
      );

      expect(verdict.violations).toEqual([]);
      expect(verdict.inventory?.n).toBe(3);
      expect(verdict.inventory?.steps.map((step) => step.number)).toEqual([1, 2, 3]);
      expect(verdict.inventory?.headings.map((heading) => heading.number)).toEqual([1, 2, 3]);
    });

    // Both real files declare their checks out of numeric order, and that placement changes nothing.
    it("compares sets, so checks declared out of numeric order on either side are not a violation", async () => {
      const verdict = await evaluate(
        renderWorkflow([1, 2, 4, 3].map(stepName)),
        renderCanon({ headings: [1, 3, 2, 4] })
      );

      expect(verdict.violations).toEqual([]);
      expect(verdict.inventory?.n).toBe(4);
    });

    it("reads a single-quoted step name and a step whose name is not its first key", async () => {
      const workflow = [
        renderWorkflow([stepName(1)]),
        "      - name: '#2 It''s single-quoted'",
        "        run: echo two",
        "      - if: always()",
        '        name: "#3 Name after the condition"',
        "        run: echo three",
        "",
      ].join("\n");

      const verdict = await evaluate(workflow, renderCanon({ headings: numbered(3) }));

      expect(verdict.violations).toEqual([]);
      expect(verdict.inventory?.steps.map((step) => step.name)).toEqual([
        "#1 Check number 1",
        "#2 It's single-quoted",
        "#3 Name after the condition",
      ]);
    });

    it("does not read a step-name-shaped line inside a run block as a step", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName), [
          'name: "#7 a line of shell, not a step"',
          "# 7. a comment",
        ]),
        renderCanon({ headings: numbered(2) })
      );

      expect(verdict.violations).toEqual([]);
      expect(verdict.inventory?.n).toBe(2);
    });

    it("does not read a step name written as a block scalar as a check, nor its lines as steps", async () => {
      const verdict = await evaluate(
        renderWorkflow([
          ...numbered(2).map(stepName),
          '|\n          name: "#7 a line of a block-scalar name, not a step"',
        ]),
        renderCanon({ headings: numbered(2) })
      );

      expect(verdict.violations).toEqual([]);
      expect(verdict.inventory?.n).toBe(2);
    });

    it("tolerates a count sentence wrapped across lines", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ headings: numbered(2), sentence: "There are **2\nchecks, numbered #1-#2**" })
      );

      expect(verdict.violations).toEqual([]);
    });
  });

  describe("the five violation kinds", () => {
    it("refuses a check number two steps claim, naming the number and both lines", async () => {
      const verdict = await evaluate(
        renderWorkflow([1, 2, 2, 3].map(stepName)),
        renderCanon({ headings: numbered(3) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("more than one step: 2 (lines 16, 22)");
    });

    it("refuses a hole below the derived maximum", async () => {
      const verdict = await evaluate(
        renderWorkflow([1, 2, 4].map(stepName)),
        renderCanon({ headings: [1, 2, 4], sentence: countSentence(4) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("hole: #3");
      expect(verdict.violations[0]).toContain("derived maximum of #4");
    });

    // The set starts at 1, not at the lowest number declared: a suite whose first check was
    // deleted on both sides still has a hole.
    it("refuses a hole at #1, even when both sides agree on the rest", async () => {
      const verdict = await evaluate(
        renderWorkflow([2, 3].map(stepName)),
        renderCanon({ headings: [2, 3], sentence: countSentence(3) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("hole: #1 declared by no step");
    });

    it("refuses a step with no canon heading as wired but undocumented", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(3).map(stepName)),
        renderCanon({ headings: [1, 3], sentence: countSentence(3) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("wired but undocumented: #2");
    });

    it("refuses a canon heading with no step as documented but unwired", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(3).map(stepName)),
        renderCanon({ headings: numbered(4), sentence: countSentence(3) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("documented but unwired: #4");
    });

    it("refuses a count sentence left at the previous value", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(3).map(stepName)),
        renderCanon({ headings: numbered(3), sentence: countSentence(2) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain('states "There are **2 checks, numbered #1-#2**"');
      expect(verdict.violations[0]).toContain("derived inventory is 3 checks (#1-#3)");
    });

    it("refuses a count sentence whose range disagrees with its own count", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(3).map(stepName)),
        renderCanon({ headings: numbered(3), sentence: "There are **3 checks, numbered #1-#4**" })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("derived inventory is 3 checks");
    });

    it("refuses two count sentences, since which one is the canon's is ambiguous", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ headings: numbered(2), sentence: `${countSentence(2)}. ${countSentence(2)}` })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("states the count 2 times");
    });
  });

  describe("what counts as a check heading", () => {
    it("reports a `# N.` comment that does not open a block by its line, instead of counting it", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({
          headings: numbered(2),
          bodies: { 1: ["# 2. a shell comment shaped like a heading"] },
        })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("fixture/CLAUDE.md:10 reads `# 2. a shell comment");
      expect(verdict.inventory?.headings.map((heading) => heading.number)).toEqual([1, 2]);
    });

    // The convention is load-bearing: a look-alike after a blank line cannot be told from a heading,
    // so it is counted — and then the inventory goes red over it rather than absorbing it.
    it("reports a look-alike after a blank line as a duplicate heading when its number exists", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({
          headings: numbered(2),
          bodies: { 2: ["", "# 1. a comment after a blank line"] },
        })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain(
        "declares a check heading more than once: 1 (lines 8, 14)"
      );
    });

    it("reports a look-alike after a blank line as documented but unwired when its number does not", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({
          headings: numbered(2),
          bodies: { 2: ["", "# 9. a comment after a blank line"] },
        })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("documented but unwired: #9");
    });

    // Measured in the real canon: `# 11 once …` and `# 22 harnesses …` sit inside check bodies.
    it("does not read a comment that starts with a number but no period as a heading", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({
          headings: numbered(2),
          bodies: { 1: ["# 11 once a gate marked its read —"] },
        })
      );

      expect(verdict.violations).toEqual([]);
    });

    it("does not end the section at a column-0 `## ` comment inside the code block", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({
          headings: numbered(2),
          bodies: { 1: ["## a shell comment with two hashes"] },
        })
      );

      expect(verdict.violations).toEqual([]);
      expect(verdict.inventory?.headings).toHaveLength(2);
    });

    it("stops at the next level-2 heading, so a `# N.` line in a later section is not read", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({
          headings: numbered(2),
          after: ["````bash", "# 3. a later section's block", "````"],
        })
      );

      expect(verdict.violations).toEqual([]);
      expect(verdict.inventory?.headings).toHaveLength(2);
    });
  });

  describe("malformed step names", () => {
    it("refuses an unquoted `#N` name, which YAML reads as a comment", async () => {
      const verdict = await evaluate(
        renderWorkflow([stepName(1), "#2 Unquoted"]),
        renderCanon({ headings: [1], sentence: countSentence(1) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("declares the step name `#2 Unquoted` unquoted");
    });

    it("refuses a check number with a leading zero", async () => {
      const verdict = await evaluate(
        renderWorkflow([stepName(1), '"#02 Leading zero"']),
        renderCanon({ headings: [1], sentence: countSentence(1) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("is not a check number");
    });
  });

  describe("fail-closed", () => {
    it("refuses a workflow with zero numbered steps", async () => {
      const verdict = await evaluate(renderWorkflow([]), renderCanon({ headings: numbered(2) }));

      expect(verdict.inventory).toBeNull();
      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain(
        "zero numbered steps were read from fixture/fitness.yml"
      );
    });

    it("refuses a canon with no Automated Compliance Checks section", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ headings: numbered(2) }).replace(
          "## Automated Compliance Checks",
          "## Renamed"
        )
      );

      expect(verdict.inventory).toBeNull();
      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("has no `## Automated Compliance Checks` section");
    });

    it("refuses a section with zero check headings", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ headings: [] })
      );

      expect(verdict.inventory).toBeNull();
      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("zero check headings were read");
    });

    it("refuses a code block that never closes", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ headings: numbered(2), unclosed: true })
      );

      expect(verdict.inventory).toBeNull();
      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain(
        "fixture/CLAUDE.md:7 opens a code block that never closes"
      );
    });

    it("refuses a section that states no count sentence", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ headings: numbered(2), sentence: null })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("states no count in the form");
    });
  });

  describe("the job summary", () => {
    it("states the derived count and lists every check by number, in numeric order", async () => {
      const gate = await loadGate();
      const verdict = await evaluate(
        renderWorkflow(['"#2 Second | piped"', stepName(1)]),
        renderCanon({ headings: [1, 2] })
      );
      expect(verdict.inventory).not.toBeNull();
      if (verdict.inventory === null) return;

      const summary = gate.renderSummary(verdict.inventory);

      expect(summary).toContain("2 checks (#1-#2), derived from the numbered steps");
      expect(summary.indexOf("| 1 | Check number 1 |")).toBeLessThan(
        summary.indexOf("| 2 | Second \\| piped |")
      );
    });
  });

  describe("the command line", () => {
    const writeInputs = (
      dir: string,
      workflow: string,
      canon: string
    ): { workflow: string; canon: string } => {
      const files = { workflow: path.join(dir, "fitness.yml"), canon: path.join(dir, "CLAUDE.md") };
      writeFileSync(files.workflow, workflow);
      writeFileSync(files.canon, canon);
      return files;
    };

    const runGate = (args: readonly string[], cwd?: string): GateResult =>
      toResult(
        spawnSync(process.execPath, [GATE_SCRIPT, ...args], {
          encoding: "utf8",
          ...(cwd === undefined ? {} : { cwd }),
        })
      );

    it("exits 0, prints the derived N and appends the summary on a clean inventory", () => {
      const dir = scratch("fitness-inventory-gate-");
      const files = writeInputs(
        dir,
        renderWorkflow(numbered(3).map(stepName)),
        renderCanon({ headings: numbered(3) })
      );
      const summary = path.join(dir, "summary.md");
      writeFileSync(summary, "previous step's summary\n");

      const result = runGate([
        "--workflow",
        files.workflow,
        "--canon",
        files.canon,
        "--summary",
        summary,
      ]);

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        "derived N=3 from 3 numbered workflow steps and 3 canon headings"
      );
      const written = readFileSync(summary, "utf8");
      expect(written.startsWith("previous step's summary\n## Fitness Functions")).toBe(true);
      expect(written).toContain("3 checks (#1-#3)");
    });

    it("exits 1 with each violation on stderr and writes no summary when the inventory is red", () => {
      const dir = scratch("fitness-inventory-gate-");
      const files = writeInputs(
        dir,
        renderWorkflow([1, 1].map(stepName)),
        renderCanon({ headings: [1] })
      );
      const summary = path.join(dir, "summary.md");

      const result = runGate([
        "--workflow",
        files.workflow,
        "--canon",
        files.canon,
        "--summary",
        summary,
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `fitness-inventory-gate: ${files.workflow} declares a check number on more than one step: 1`
      );
      expect(existsSync(summary)).toBe(false);
    });

    it("exits 1 naming an input file that cannot be read", () => {
      const dir = scratch("fitness-inventory-gate-");
      const files = writeInputs(dir, renderWorkflow([stepName(1)]), renderCanon({ headings: [1] }));
      const missing = path.join(dir, "absent.yml");

      const result = runGate(["--workflow", missing, "--canon", files.canon]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${missing} could not be read`);
    });

    it("exits 1 on an unknown argument instead of ignoring it", () => {
      const result = runGate(["--workspace", "anything"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("usage: node scripts/testing/fitness-inventory-gate.mjs");
    });

    // A copy of the gate in a scratch tree, run from a different directory with no flags: the only
    // files it can measure are the ones beside its own `scripts/` directory, so a lookup that leaned
    // on git or on the working directory would read another tree or fail here.
    it("reads the workflow and the canon beside its own scripts directory, needing neither git nor the working directory", () => {
      const tree = scratch("fitness-inventory-gate-tree-");
      mkdirSync(path.join(tree, "scripts", "testing"), { recursive: true });
      mkdirSync(path.join(tree, ".github", "workflows"), { recursive: true });
      const script = path.join(tree, "scripts", "testing", "fitness-inventory-gate.mjs");
      copyFileSync(GATE_SCRIPT, script);
      writeFileSync(
        path.join(tree, ".github", "workflows", "fitness.yml"),
        renderWorkflow(numbered(5).map(stepName))
      );
      writeFileSync(path.join(tree, "CLAUDE.md"), renderCanon({ headings: numbered(5) }));
      const elsewhere = scratch("fitness-inventory-gate-cwd-");

      const result = toResult(
        spawnSync(process.execPath, [script], { cwd: elsewhere, encoding: "utf8" })
      );

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("derived N=5");
    });
  });
});
