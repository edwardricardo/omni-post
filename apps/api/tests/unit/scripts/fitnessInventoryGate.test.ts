/**
 * @file fitnessInventoryGate.test.ts
 * @description Pins `scripts/testing/fitness-inventory-gate.mjs`, fitness check #44: the numbered
 *   steps of the fitness workflow form the set `1..N` with no hole and no duplicate, the `# N.`
 *   check headings of the reference carry the same set, the list of `CLAUDE.md` §Automated
 *   Compliance Checks carries it too, one line per check with its step's name and how it runs, and
 *   the one count sentence states the derived `N`.
 *
 *   WHY THE GATE EXISTS, and therefore what this suite has to hold: the suite's own inventory was
 *   the one invariant nothing measured. A duplicated number, a block deleted from the reference, a
 *   step deleted from the workflow, a list line that drifted from its step and a stale count
 *   sentence each read as a complete inventory, and the summary printed a typed count that agreed
 *   with the document whatever actually ran.
 *
 *   Every input is a fixture string or a fixture file in a scratch directory, so the suite never
 *   reads the repository's own workflow, reference or canon: it measures the gate's RULE rather
 *   than today's files, and it can prove each red path while the real files are clean. The rules
 *   are driven through the exported `evaluateInventory`; the CLI is driven as a process for what
 *   only a process can show — the exit code, where the inputs are found, and that the job summary
 *   is written from the derived count and only on a clean verdict.
 *
 *   The heading convention is pinned on purpose. A check heading in the reference is a `# N.` line
 *   at column 0 that follows the fence or a blank line; the check blocks are shell, so a shell
 *   comment of that shape inside a block LOOKS like a heading. The suite holds that such a comment
 *   is reported by its line number, or, when it follows a blank line, surfaces as a duplicate or an
 *   unwired number — never silently counted and never silently ignored. The list form is pinned
 *   the same way: a line that opens like a list entry and is not exactly
 *   `- **#N** <step name> — <how>` is reported by its line number.
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
  readonly body: readonly string[];
}

interface Heading {
  readonly number: number;
  readonly line: number;
}

interface Entry {
  readonly number: number;
  readonly name: string;
  readonly command: string | null;
  readonly line: number;
}

interface Inventory {
  readonly n: number;
  readonly steps: readonly Step[];
  readonly headings: readonly Heading[];
  readonly entries: readonly Entry[];
}

interface Verdict {
  readonly inventory: Inventory | null;
  readonly violations: readonly string[];
}

interface InventoryInput {
  readonly workflowText: string;
  readonly canonText: string;
  readonly referenceText: string;
  readonly workflowLabel: string;
  readonly canonLabel: string;
  readonly referenceLabel: string;
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
const REFERENCE_LABEL = "fixture/FITNESS_FUNCTIONS.md";

/** A numbered step name as the workflow writes it, double-quoted. */
const stepName = (number: number): string => `"#${String(number)} Check number ${String(number)}"`;

/**
 * The command the default body of the step at a one-based position runs. Each step's is its own, so
 * a list command found in the wrong step's body is told apart from one found in its own.
 */
const stepCommand = (position: number): string => `node scripts/check-${String(position)}.mjs`;

/** The command only a step with no `name:` key runs, in the fixtures that hold one. */
const UNNAMED_COMMAND = "node scripts/only-unnamed.mjs";

/** A steps entry with no `name:` key whose first key opens a block scalar. */
const UNNAMED_RUN_STEP = ["      - run: |", `          ${UNNAMED_COMMAND}`, ""];

/** A steps entry with no `name:` key whose block scalar sits under a later key. */
const UNNAMED_USES_STEP = [
  "      - uses: actions/github-script@v8",
  "        with:",
  "          script: |",
  `            ${UNNAMED_COMMAND}`,
  "",
];

/**
 * A fitness workflow whose steps carry the given raw `name:` values, in order, each with a `run: |`
 * body. An unnumbered checkout step leads, as in the real file, so a reader that counted every step
 * would turn a clean fixture red. With no `runBody`, each step runs a command of its own,
 * `stepCommand(<its position>)`; a given `runBody` is written into every step.
 */
const renderWorkflow = (names: readonly string[], runBody?: readonly string[]): string =>
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
    ...names.flatMap((name, index) => [
      `      - name: ${name}`,
      "        if: always()",
      "        run: |",
      "          set -euo pipefail",
      ...(runBody ?? [stepCommand(index + 1)]).map((line) => `          ${line}`),
      "",
    ]),
  ].join("\n");

/**
 * A workflow whose check #1 is followed by the given unnamed step, then by check #2. The unnamed
 * step's body is its own: none of its lines is check #1's.
 */
const withUnnamedStep = (unnamed: readonly string[]): string =>
  [
    renderWorkflow([stepName(1)]),
    ...unnamed,
    `      - name: ${stepName(2)}`,
    "        run: |",
    `          ${stepCommand(2)}`,
    "",
  ].join("\n");

/**
 * A workflow whose only check, #1, holds the given lines under `with:` (on line 12 onward), with its
 * `run: |` body after them. A `name:` among those lines belongs to something the step holds, so a
 * reader that let it end the step or open one would take #1's body away from it.
 */
const withNestedName = (nested: readonly string[]): string =>
  [
    renderWorkflow([]),
    `      - name: ${stepName(1)}`,
    "        with:",
    ...nested,
    "        run: |",
    `          ${stepCommand(1)}`,
    "",
  ].join("\n");

/** A list under `with:` whose item carries the given `name:` value, on line 13. */
const nestedListItem = (value: string): string[] => [
  "          items:",
  `            - name: ${value}`,
  "              value: one",
];

/** A mapping under `with:` that carries the given `name:` value, on line 12. */
const nestedMappingKey = (value: string): string[] => [`          name: ${value}`];

/** The refusal of `#2 Check number 2` named inside a list or mapping a step holds. */
const nestedNameRefusal = (label: string, line: number): string =>
  `${label}:${String(line)} names \`#2 Check number 2\` inside a list or mapping that an entry ` +
  "of a steps list holds (a `with:` value, say), not as a key of the entry itself, so it names no " +
  "step and no step's run body can be told to be its. A check is a step: name it on the step, or " +
  "drop the number.";

/**
 * A workflow whose only check, #1, opens on the dash line `dash` (line 10), which holds no key, and
 * has its keys, its name first (line 11), at the indentation `keys`; then, when given, the lines
 * nested under its `with:` (from line 13), and its `run: |` body.
 */
const withKeysBelowDash = (dash: string, keys: string, nested: readonly string[] = []): string =>
  [
    renderWorkflow([]),
    dash,
    `${keys}name: ${stepName(1)}`,
    ...(nested.length === 0 ? [] : [`${keys}with:`, ...nested.map((line) => `${keys}  ${line}`)]),
    `${keys}run: |`,
    `${keys}  ${stepCommand(1)}`,
    "",
  ].join("\n");

/**
 * A workflow whose only check, #1, has the given comment line between its keys and its `run: |`
 * body. A comment ends no YAML structure, so the body after it is still #1's.
 */
const withCommentBeforeRun = (comment: string): string =>
  [
    renderWorkflow([]),
    `      - name: ${stepName(1)}`,
    "        if: always()",
    comment,
    "        run: |",
    `          ${stepCommand(1)}`,
    "",
  ].join("\n");

const countSentence = (n: number): string =>
  `There are **${String(n)} checks, numbered #1-#${String(n)}**`;

/** The list line the canon carries for a fixture step named by `stepName`. */
const listLine = (number: number, how = "shell"): string =>
  `- **#${String(number)}** Check number ${String(number)} — ${how}`;

interface CanonFixture {
  /** The list, in order: a number renders its default line, a string is written as it stands. */
  readonly list: readonly (number | string)[];
  /** The count sentence; `null` leaves it out. Defaults to one stating the length of the list. */
  readonly sentence?: string | null;
  /** A code block written inside the section, after the list. */
  readonly fence?: readonly string[];
  /** Leaves that code block unclosed. */
  readonly unclosed?: boolean;
  /** Lines written after the section ends, under a later level-2 heading. */
  readonly after?: readonly string[];
}

/**
 * `CLAUDE.md` as the gate reads it: the section heading on line 3, the governing paragraph with the
 * count sentence on line 5, and the list from line 7, one line per entry.
 */
const renderCanon = (fixture: CanonFixture): string => {
  const sentence =
    fixture.sentence === undefined ? countSentence(fixture.list.length) : fixture.sentence;
  return [
    "# Fixture canon",
    "",
    "## Automated Compliance Checks (CI Fitness Functions)",
    "",
    `**Wired to CI.** Every check below runs in the workflow.${sentence === null ? "" : ` ${sentence}.`} Run them locally.`,
    "",
    ...fixture.list.map((entry) => (typeof entry === "number" ? listLine(entry) : entry)),
    "",
    ...(fixture.fence === undefined
      ? []
      : ["````bash", ...fixture.fence, ...(fixture.unclosed === true ? [] : ["````", ""])]),
    "**Extending the suite.** Add the check's line to the list above.",
    "",
    "## Problem-Solving Standards",
    "",
    ...(fixture.after ?? []),
    "",
  ].join("\n");
};

interface ReferenceFixture {
  /** Check headings, in declaration order; each opens its own block after a blank line. */
  readonly headings: readonly number[];
  /** Extra lines appended to a check's body, by check number. */
  readonly bodies?: Readonly<Record<number, readonly string[]>>;
  /** A prose line written above the code block; defaults to a line that states no count. */
  readonly prose?: string;
  /** The heading of the section that holds the blocks; defaults to `## Check blocks`. */
  readonly section?: string;
  /** Lines written after the section ends, under a later level-2 heading. */
  readonly after?: readonly string[];
  /** Leaves the code block unclosed. */
  readonly unclosed?: boolean;
}

/**
 * The reference as the gate reads it: the section heading on line 3, a prose line on line 5, the
 * fence on line 7 and the first heading on line 8.
 */
const renderReference = (fixture: ReferenceFixture): string => {
  const blocks = fixture.headings.flatMap((number, index) => [
    ...(index === 0 ? [] : [""]),
    `# ${String(number)}. Check number ${String(number)}.`,
    `echo "check ${String(number)}"`,
    ...(fixture.bodies?.[number] ?? []),
  ]);
  return [
    "# Fixture reference",
    "",
    fixture.section ?? "## Check blocks",
    "",
    fixture.prose ?? "Each check's block follows, under its number.",
    "",
    "````bash",
    ...blocks,
    ...(fixture.unclosed === true ? [] : ["````"]),
    "",
    "## Not a numbered check",
    "",
    ...(fixture.after ?? []),
    "",
  ].join("\n");
};

const loadGate = async (): Promise<FitnessInventoryGateModule> =>
  (await import(GATE_SCRIPT)) as FitnessInventoryGateModule;

const evaluate = async (
  workflowText: string,
  canonText: string,
  referenceText: string
): Promise<Verdict> => {
  const gate = await loadGate();
  return gate.evaluateInventory({
    workflowText,
    canonText,
    referenceText,
    workflowLabel: WORKFLOW_LABEL,
    canonLabel: CANON_LABEL,
    referenceLabel: REFERENCE_LABEL,
  });
};

const numbered = (count: number): number[] =>
  Array.from({ length: count }, (_, index) => index + 1);

/** The three inputs of a clean inventory of `count` checks. */
const cleanInputs = (count: number): [string, string, string] => [
  renderWorkflow(numbered(count).map(stepName)),
  renderCanon({ list: numbered(count) }),
  renderReference({ headings: numbered(count) }),
];

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
    it("derives N from the workflow and reports no violation when all three sides carry 1..N", async () => {
      const verdict = await evaluate(...cleanInputs(3));

      expect(verdict.violations).toEqual([]);
      expect(verdict.inventory?.n).toBe(3);
      expect(verdict.inventory?.steps.map((step) => step.number)).toEqual([1, 2, 3]);
      expect(verdict.inventory?.headings.map((heading) => heading.number)).toEqual([1, 2, 3]);
      expect(verdict.inventory?.entries.map((entry) => entry.number)).toEqual([1, 2, 3]);
      expect(verdict.inventory?.entries[0]).toEqual({
        number: 1,
        name: "Check number 1",
        command: null,
        line: 7,
      });
    });

    // The real files declare their checks out of numeric order, and that placement changes nothing.
    it("compares sets, so checks declared out of numeric order on all three sides are not a violation", async () => {
      const verdict = await evaluate(
        renderWorkflow([1, 2, 4, 3].map(stepName)),
        renderCanon({ list: [2, 1, 4, 3] }),
        renderReference({ headings: [1, 3, 2, 4] })
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

      const verdict = await evaluate(
        workflow,
        renderCanon({
          list: [
            1,
            "- **#2** It's single-quoted — shell",
            "- **#3** Name after the condition — shell",
          ],
          sentence: countSentence(3),
        }),
        renderReference({ headings: numbered(3) })
      );

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
        renderCanon({ list: numbered(2) }),
        renderReference({ headings: numbered(2) })
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
        renderCanon({ list: numbered(2) }),
        renderReference({ headings: numbered(2) })
      );

      expect(verdict.violations).toEqual([]);
      expect(verdict.inventory?.n).toBe(2);
    });

    it("tolerates a count sentence wrapped across lines", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: numbered(2), sentence: "There are **2\nchecks, numbered #1-#2**" }),
        renderReference({ headings: numbered(2) })
      );

      expect(verdict.violations).toEqual([]);
    });

    it("gives each numbered step the lines of its run body, and ends a step's body at the next step", async () => {
      const workflow = [
        renderWorkflow([stepName(1)], ["node scripts/one.mjs"]),
        "      - name: Unnumbered step",
        "        run: |",
        "          node scripts/not-a-check.mjs",
        "",
      ].join("\n");

      const verdict = await evaluate(
        workflow,
        renderCanon({ list: [listLine(1, "`node scripts/one.mjs`")], sentence: countSentence(1) }),
        renderReference({ headings: [1] })
      );

      expect(verdict.violations).toEqual([]);
      expect(verdict.inventory?.steps[0]?.body).toEqual([
        "          set -euo pipefail",
        "          node scripts/one.mjs",
        "",
      ]);
      expect(verdict.inventory?.entries[0]?.command).toBe("node scripts/one.mjs");
    });
  });

  describe("the workflow, the reference and the count", () => {
    it("refuses a check number two steps claim, naming the number and both lines", async () => {
      const verdict = await evaluate(
        renderWorkflow([1, 2, 2, 3].map(stepName)),
        renderCanon({ list: numbered(3) }),
        renderReference({ headings: numbered(3) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("more than one step: 2 (lines 16, 22)");
    });

    it("refuses a hole below the derived maximum", async () => {
      const verdict = await evaluate(
        renderWorkflow([1, 2, 4].map(stepName)),
        renderCanon({ list: [1, 2, 4], sentence: countSentence(4) }),
        renderReference({ headings: [1, 2, 4] })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("hole: #3");
      expect(verdict.violations[0]).toContain("derived maximum of #4");
    });

    // The set starts at 1, not at the lowest number declared: a suite whose first check was
    // deleted on every side still has a hole.
    it("refuses a hole at #1, even when every side agrees on the rest", async () => {
      const verdict = await evaluate(
        renderWorkflow([2, 3].map(stepName)),
        renderCanon({ list: [2, 3], sentence: countSentence(3) }),
        renderReference({ headings: [2, 3] })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("hole: #1 declared by no step");
    });

    it("refuses a step with no block in the reference as wired but undocumented", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(3).map(stepName)),
        renderCanon({ list: numbered(3) }),
        renderReference({ headings: [1, 3] })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("wired but undocumented: #2");
      expect(verdict.violations[0]).toContain(`no \`# <number>.\` heading in ${REFERENCE_LABEL}`);
    });

    it("refuses a reference block with no step as documented but unwired", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(3).map(stepName)),
        renderCanon({ list: numbered(3) }),
        renderReference({ headings: numbered(4) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("documented but unwired: #4");
      expect(verdict.violations[0]).toContain(`has a heading in ${REFERENCE_LABEL}`);
    });

    it("refuses a count sentence left at the previous value", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(3).map(stepName)),
        renderCanon({ list: numbered(3), sentence: countSentence(2) }),
        renderReference({ headings: numbered(3) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain('states "There are **2 checks, numbered #1-#2**"');
      expect(verdict.violations[0]).toContain("derived inventory is 3 checks (#1-#3)");
    });

    it("refuses a count sentence whose range disagrees with its own count", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(3).map(stepName)),
        renderCanon({ list: numbered(3), sentence: "There are **3 checks, numbered #1-#4**" }),
        renderReference({ headings: numbered(3) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("derived inventory is 3 checks");
    });

    it("refuses two count sentences, since which one is the canon's is ambiguous", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: numbered(2), sentence: `${countSentence(2)}. ${countSentence(2)}` }),
        renderReference({ headings: numbered(2) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("states the count 2 times");
    });
  });

  describe("the list of CLAUDE.md", () => {
    it("refuses a step the list leaves out as wired but unlisted", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(3).map(stepName)),
        renderCanon({ list: [1, 3], sentence: countSentence(3) }),
        renderReference({ headings: numbered(3) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("wired but unlisted: #2 has a step in");
      expect(verdict.violations[0]).toContain(`no line in the list of ${CANON_LABEL}`);
    });

    it("refuses a list line with no step as listed but unwired", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(3).map(stepName)),
        renderCanon({
          list: [1, 2, 3, "- **#4** Check number 4 — shell"],
          sentence: countSentence(3),
        }),
        renderReference({ headings: numbered(3) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("listed but unwired: #4 has a line in the list of");
    });

    it("refuses a check listed twice, naming the number and both lines", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(3).map(stepName)),
        renderCanon({ list: [1, 2, 2, 3], sentence: countSentence(3) }),
        renderReference({ headings: numbered(3) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("lists a check more than once: 2 (lines 8, 9)");
    });

    it("refuses a list line whose name differs from its step's, printing the line as it must read", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: [1, "- **#2** Check number two — shell"], sentence: countSentence(2) }),
        renderReference({ headings: numbered(2) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain(
        `${CANON_LABEL}:8 names #2 \`Check number two\`, but its step at ${WORKFLOW_LABEL}:16 is named \`Check number 2\``
      );
      expect(verdict.violations[0]).toContain("must read: `- **#2** Check number 2 — shell`");
    });

    it("refuses a list command its step does not run", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: [1, listLine(2, "`pnpm check:nothing`")], sentence: countSentence(2) }),
        renderReference({ headings: numbered(2) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain(
        `${CANON_LABEL}:8 says #2 runs \`pnpm check:nothing\`, but the run body of its step at ${WORKFLOW_LABEL}:16 does not contain that text`
      );
    });

    it("accepts a list command its own step runs", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({
          list: [listLine(1, `\`${stepCommand(1)}\``), listLine(2, `\`${stepCommand(2)}\``)],
          sentence: countSentence(2),
        }),
        renderReference({ headings: numbered(2) })
      );

      expect(verdict.violations).toEqual([]);
      expect(verdict.inventory?.entries.map((entry) => entry.command)).toEqual([
        stepCommand(1),
        stepCommand(2),
      ]);
    });

    // The command is held against the check's OWN step: a command only another step runs says the
    // listed check applies a rule it does not, so it is refused although the workflow contains it.
    it("refuses a list command that only another check's step runs", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({
          list: [listLine(1, `\`${stepCommand(2)}\``), 2],
          sentence: countSentence(2),
        }),
        renderReference({ headings: numbered(2) })
      );

      expect(verdict.violations).toEqual([
        `${CANON_LABEL}:7 says #1 runs \`${stepCommand(2)}\`, but the run body of its step at ` +
          `${WORKFLOW_LABEL}:10 does not contain that text. Name the command the step runs, or ` +
          "`shell` for an inline check.",
      ]);
    });

    // An entry of the steps list ends the step before it whether or not it has a name, so the body
    // of a step with no `name:` key is never credited to the numbered step above it.
    it.each([
      ["a bare `- run: |` entry", UNNAMED_RUN_STEP],
      ["a `- uses:` entry whose `with:` holds a block scalar", UNNAMED_USES_STEP],
    ])(
      "refuses a list command that only the unnamed step after the check runs: %s",
      async (_shape, unnamed) => {
        const verdict = await evaluate(
          withUnnamedStep(unnamed),
          renderCanon({
            list: [listLine(1, `\`${UNNAMED_COMMAND}\``), 2],
            sentence: countSentence(2),
          }),
          renderReference({ headings: numbered(2) })
        );

        expect(verdict.violations).toEqual([
          `${CANON_LABEL}:7 says #1 runs \`${UNNAMED_COMMAND}\`, but the run body of its step at ` +
            `${WORKFLOW_LABEL}:10 does not contain that text. Name the command the step runs, or ` +
            "`shell` for an inline check.",
        ]);
        expect(verdict.inventory?.steps[0]?.body.join("\n")).not.toContain(UNNAMED_COMMAND);
      }
    );

    // A list nested inside a step (a `with:` value) is not an entry of the steps list: the step's
    // body after it is still the step's own.
    it("keeps a step's body its own across a list nested inside the step", async () => {
      const workflow = [
        renderWorkflow([]),
        `      - name: ${stepName(1)}`,
        "        with:",
        "          args:",
        "            - one",
        "            - two",
        "        run: |",
        `          ${stepCommand(1)}`,
        "",
      ].join("\n");

      const verdict = await evaluate(
        workflow,
        renderCanon({ list: [listLine(1, `\`${stepCommand(1)}\``)], sentence: countSentence(1) }),
        renderReference({ headings: [1] })
      );

      expect(verdict.violations).toEqual([]);
      expect(verdict.inventory?.steps[0]?.body).toEqual([`          ${stepCommand(1)}`, ""]);
    });

    // A comment at or left of the entry's column would end the step if it were read as a key, and
    // the run body after it would then belong to no step, so the list command would not be found.
    it.each([
      ["column 0", "# a comment at column 0"],
      ["the entry's column", "      # a comment at the entry's column"],
    ])(
      "keeps a step's body its own across a comment at %s between its keys and its run body",
      async (_column, comment) => {
        const verdict = await evaluate(
          withCommentBeforeRun(comment),
          renderCanon({
            list: [listLine(1, `\`${stepCommand(1)}\``)],
            sentence: countSentence(1),
          }),
          renderReference({ headings: [1] })
        );

        expect(verdict.violations).toEqual([]);
        expect(verdict.inventory?.steps.map((step) => step.number)).toEqual([1]);
        expect(verdict.inventory?.steps[0]?.body).toEqual([`          ${stepCommand(1)}`, ""]);
      }
    );

    // A dash line that holds no key (bare, a comment, or only an anchor or a tag) does not say where
    // the entry's keys start, so the first key line does: its name is the step's own.
    it.each([
      ["a bare dash, keys two columns in", "      -", "        "],
      ["a dash and a comment", "      - # the check", "        "],
      ["an anchor, keys two columns in", "      - &check", "        "],
      ["an anchor after two spaces, keys two columns in", "      -  &check", "        "],
      ["an anchor, keys four columns in", "      - &check", "          "],
      ["a tag, keys four columns in", "      - !!map", "          "],
      ["an anchor, a tag and a comment", "      - &check !!map # the check", "          "],
    ])(
      "reads the name on the first key line as the step's own when the dash line holds %s",
      async (_shape, dash, keys) => {
        const verdict = await evaluate(
          withKeysBelowDash(dash, keys),
          renderCanon({
            list: [listLine(1, `\`${stepCommand(1)}\``)],
            sentence: countSentence(1),
          }),
          renderReference({ headings: [1] })
        );

        expect(verdict.violations).toEqual([]);
        expect(verdict.inventory?.steps.map((step) => [step.number, step.line])).toEqual([[1, 11]]);
        expect(verdict.inventory?.steps[0]?.body).toEqual([`${keys}  ${stepCommand(1)}`, ""]);
      }
    );

    it("refuses a list line that states neither shell nor a command", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: [1, "- **#2** Check number 2"], sentence: countSentence(2) }),
        renderReference({ headings: numbered(2) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain(`${CANON_LABEL}:8 lists #2 with no way it runs`);
    });

    it("refuses a line that opens like an entry without the bold number, by its line, and counts it as no entry", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: [1, "- #2 Check number 2 — shell"], sentence: countSentence(2) }),
        renderReference({ headings: numbered(2) })
      );

      expect(verdict.violations).toHaveLength(2);
      expect(verdict.violations[0]).toContain(
        `${CANON_LABEL}:8 reads \`- #2 Check number 2 — shell\`, which opens like a line of the check list`
      );
      expect(verdict.violations[1]).toContain("wired but unlisted: #2");
    });

    it("refuses a list number with a leading zero as a line not in the list's form", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: [1, "- **#02** Check number 2 — shell"], sentence: countSentence(2) }),
        renderReference({ headings: numbered(2) })
      );

      expect(verdict.violations).toHaveLength(2);
      expect(verdict.violations[0]).toContain(`${CANON_LABEL}:8 reads \`- **#02** Check number 2`);
      expect(verdict.violations[1]).toContain("wired but unlisted: #2");
    });

    it("refuses a check block left in a code block of the section", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(3).map(stepName)),
        renderCanon({
          list: numbered(3),
          fence: ["# 3. A check block left behind.", 'echo "check 3"'],
        }),
        renderReference({ headings: numbered(3) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain(
        `${CANON_LABEL}:12 holds the check heading \`# 3. A check block left behind.\` in a code block`
      );
      expect(verdict.violations[0]).toContain(`The check blocks live in ${REFERENCE_LABEL}`);
    });

    it("does not read a list-shaped line after the section ends", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: numbered(2), after: ["- **#9** A later section's list — shell"] }),
        renderReference({ headings: numbered(2) })
      );

      expect(verdict.violations).toEqual([]);
      expect(verdict.inventory?.entries).toHaveLength(2);
    });

    it("refuses a section that holds no list line", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: [], sentence: countSentence(2) }),
        renderReference({ headings: numbered(2) })
      );

      expect(verdict.inventory).toBeNull();
      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain(
        `zero list lines were read from ${CANON_LABEL} §Automated Compliance Checks`
      );
    });

    it("refuses a section whose code block never closes", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: numbered(2), fence: ["echo open"], unclosed: true }),
        renderReference({ headings: numbered(2) })
      );

      expect(verdict.inventory).toBeNull();
      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain(
        `${CANON_LABEL}:10 opens a code block that never closes`
      );
    });

    it("refuses a canon with no Automated Compliance Checks section", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: numbered(2) }).replace("## Automated Compliance Checks", "## Renamed"),
        renderReference({ headings: numbered(2) })
      );

      expect(verdict.inventory).toBeNull();
      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("has no `## Automated Compliance Checks` section");
    });

    it("refuses a section that states no count sentence", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: numbered(2), sentence: null }),
        renderReference({ headings: numbered(2) })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("states no count in the form");
    });
  });

  describe("what counts as a check heading in the reference", () => {
    it("reports a `# N.` comment that does not open a block by its line, instead of counting it", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: numbered(2) }),
        renderReference({
          headings: numbered(2),
          bodies: { 1: ["# 2. a shell comment shaped like a heading"] },
        })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain(`${REFERENCE_LABEL}:10 reads \`# 2. a shell comment`);
      expect(verdict.inventory?.headings.map((heading) => heading.number)).toEqual([1, 2]);
    });

    // The convention is load-bearing: a look-alike after a blank line cannot be told from a heading,
    // so it is counted — and then the inventory goes red over it rather than absorbing it.
    it("reports a look-alike after a blank line as a duplicate heading when its number exists", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: numbered(2) }),
        renderReference({
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
        renderCanon({ list: numbered(2) }),
        renderReference({
          headings: numbered(2),
          bodies: { 2: ["", "# 9. a comment after a blank line"] },
        })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("documented but unwired: #9");
    });

    // Measured in the real blocks: `# 11 once …` and `# 22 harnesses …` sit inside check bodies.
    it("does not read a comment that starts with a number but no period as a heading", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: numbered(2) }),
        renderReference({
          headings: numbered(2),
          bodies: { 1: ["# 11 once a gate marked its read —"] },
        })
      );

      expect(verdict.violations).toEqual([]);
    });

    it("does not end the section at a column-0 `## ` comment inside the code block", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: numbered(2) }),
        renderReference({
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
        renderCanon({ list: numbered(2) }),
        renderReference({
          headings: numbered(2),
          after: ["````bash", "# 3. a later section's block", "````"],
        })
      );

      expect(verdict.violations).toEqual([]);
      expect(verdict.inventory?.headings).toHaveLength(2);
    });
  });

  describe("the reference", () => {
    it("refuses a count sentence in the reference, since the count is stated once, in CLAUDE.md", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: numbered(2) }),
        renderReference({ headings: numbered(2), prose: `${countSentence(2)}.` })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain(
        `${REFERENCE_LABEL} states the check count ("There are **2 checks, numbered #1-#2**")`
      );
      expect(verdict.violations[0]).toContain(`stated once, in ${CANON_LABEL}`);
    });

    it("refuses a reference with no `## Check blocks` section", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: numbered(2) }),
        renderReference({ headings: numbered(2), section: "## Blocks" })
      );

      expect(verdict.inventory).toBeNull();
      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain(
        `${REFERENCE_LABEL} has no \`## Check blocks\` section`
      );
    });

    it("refuses a reference with zero check headings", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: numbered(2) }),
        renderReference({ headings: [] })
      );

      expect(verdict.inventory).toBeNull();
      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain(
        `zero check headings were read from ${REFERENCE_LABEL}`
      );
    });

    it("refuses a reference whose code block never closes", async () => {
      const verdict = await evaluate(
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({ list: numbered(2) }),
        renderReference({ headings: numbered(2), unclosed: true })
      );

      expect(verdict.inventory).toBeNull();
      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain(
        `${REFERENCE_LABEL}:7 opens a code block that never closes`
      );
    });
  });

  describe("malformed step names", () => {
    it("refuses an unquoted `#N` name, which YAML reads as a comment", async () => {
      const verdict = await evaluate(
        renderWorkflow([stepName(1), "#2 Unquoted"]),
        renderCanon({ list: [1] }),
        renderReference({ headings: [1] })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("declares the step name `#2 Unquoted` unquoted");
    });

    // A numbered name that no entry of a steps list holds (here a job's) names no step, so the
    // reader cannot tell whose run body is its: it is refused, never counted as a check.
    it("refuses a numbered name outside an entry of a steps list", async () => {
      const workflow = [
        "name: Fixture fitness",
        "on: [push]",
        "jobs:",
        "  fitness:",
        '    name: "#2 A job named like a check"',
        "    runs-on: ubuntu-latest",
        "    steps:",
        `      - name: ${stepName(1)}`,
        "        run: |",
        `          ${stepCommand(1)}`,
        "",
      ].join("\n");

      const verdict = await evaluate(
        workflow,
        renderCanon({ list: [1] }),
        renderReference({ headings: [1] })
      );

      expect(verdict.violations).toEqual([
        `${WORKFLOW_LABEL}:5 names \`#2 A job named like a check\` outside an entry of a steps list ` +
          "(a line that starts `- `), so no step's run body can be told to be its. A check is a step: " +
          "name it on the step, or drop the number.",
      ]);
      expect(verdict.inventory?.steps.map((step) => step.number)).toEqual([1]);
    });

    // A numbered name below the keys of a step's entry is the name of something the step holds, so
    // it names no step: it is refused rather than counted, and the step's body stays the step's.
    it.each([
      ["an item of a list under `with:`", nestedListItem(stepName(2)), 13],
      ["a key of a mapping under `with:`", nestedMappingKey(stepName(2)), 12],
    ])(
      "refuses a numbered name nested inside an entry of a steps list: %s",
      async (_shape, nested, line) => {
        const verdict = await evaluate(
          withNestedName(nested),
          renderCanon({
            list: [listLine(1, `\`${stepCommand(1)}\``)],
            sentence: countSentence(1),
          }),
          renderReference({ headings: [1] })
        );

        expect(verdict.violations).toEqual([nestedNameRefusal(WORKFLOW_LABEL, line)]);
        expect(verdict.inventory?.steps.map((step) => step.number)).toEqual([1]);
        expect(verdict.inventory?.steps[0]?.body).toEqual([`          ${stepCommand(1)}`, ""]);
      }
    );

    // The first key line of an entry whose dash line holds no key sets the entry's key column, so
    // a numbered name further in is still something the step holds.
    it.each([
      ["a bare dash", "      -", "        "],
      ["a dash and a comment", "      - # the check", "        "],
      ["an anchor after two spaces", "      -  &check", "        "],
      ["an anchor, keys four columns in", "      - &check", "          "],
    ])(
      "refuses a numbered name nested inside an entry whose dash line holds %s",
      async (_shape, dash, keys) => {
        const verdict = await evaluate(
          withKeysBelowDash(dash, keys, [`name: ${stepName(2)}`]),
          renderCanon({
            list: [listLine(1, `\`${stepCommand(1)}\``)],
            sentence: countSentence(1),
          }),
          renderReference({ headings: [1] })
        );

        expect(verdict.violations).toEqual([nestedNameRefusal(WORKFLOW_LABEL, 13)]);
        expect(verdict.inventory?.steps.map((step) => step.number)).toEqual([1]);
        expect(verdict.inventory?.steps[0]?.body).toEqual([`${keys}  ${stepCommand(1)}`, ""]);
      }
    );

    it.each([
      ["an item of a list under `with:`", nestedListItem('"Unnumbered item"')],
      ["a key of a mapping under `with:`", nestedMappingKey('"Unnumbered item"')],
    ])(
      "reads an unnumbered name nested inside an entry as nothing, so the step keeps its body: %s",
      async (_shape, nested) => {
        const verdict = await evaluate(
          withNestedName(nested),
          renderCanon({
            list: [listLine(1, `\`${stepCommand(1)}\``)],
            sentence: countSentence(1),
          }),
          renderReference({ headings: [1] })
        );

        expect(verdict.violations).toEqual([]);
        expect(verdict.inventory?.steps.map((step) => step.number)).toEqual([1]);
        expect(verdict.inventory?.steps[0]?.body).toEqual([`          ${stepCommand(1)}`, ""]);
      }
    );

    it("refuses a check number with a leading zero", async () => {
      const verdict = await evaluate(
        renderWorkflow([stepName(1), '"#02 Leading zero"']),
        renderCanon({ list: [1] }),
        renderReference({ headings: [1] })
      );

      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain("is not a check number");
    });
  });

  describe("fail-closed", () => {
    it("refuses a workflow with zero numbered steps", async () => {
      const verdict = await evaluate(
        renderWorkflow([]),
        renderCanon({ list: numbered(2) }),
        renderReference({ headings: numbered(2) })
      );

      expect(verdict.inventory).toBeNull();
      expect(verdict.violations).toHaveLength(1);
      expect(verdict.violations[0]).toContain(
        "zero numbered steps were read from fixture/fitness.yml"
      );
    });
  });

  describe("the job summary", () => {
    it("states the derived count and lists every check by number, in numeric order", async () => {
      const gate = await loadGate();
      const verdict = await evaluate(
        renderWorkflow(['"#2 Second | piped"', stepName(1)]),
        renderCanon({ list: [1, "- **#2** Second | piped — shell"] }),
        renderReference({ headings: [1, 2] })
      );
      expect(verdict.violations).toEqual([]);
      expect(verdict.inventory).not.toBeNull();
      if (verdict.inventory === null) return;

      const summary = gate.renderSummary(verdict.inventory);

      expect(summary).toContain("2 checks (#1-#2), derived from the numbered steps");
      expect(summary).toContain(
        "matched against the list of CLAUDE.md §Automated Compliance Checks and the blocks of docs/development/FITNESS_FUNCTIONS.md"
      );
      expect(summary.indexOf("| 1 | Check number 1 |")).toBeLessThan(
        summary.indexOf("| 2 | Second \\| piped |")
      );
    });
  });

  describe("the command line", () => {
    const writeInputs = (
      dir: string,
      [workflow, canon, reference]: readonly [string, string, string]
    ): { workflow: string; canon: string; reference: string } => {
      const files = {
        workflow: path.join(dir, "fitness.yml"),
        canon: path.join(dir, "CLAUDE.md"),
        reference: path.join(dir, "FITNESS_FUNCTIONS.md"),
      };
      writeFileSync(files.workflow, workflow);
      writeFileSync(files.canon, canon);
      writeFileSync(files.reference, reference);
      return files;
    };

    const flags = (files: { workflow: string; canon: string; reference: string }): string[] => [
      "--workflow",
      files.workflow,
      "--canon",
      files.canon,
      "--reference",
      files.reference,
    ];

    const runGate = (args: readonly string[], cwd?: string): GateResult =>
      toResult(
        spawnSync(process.execPath, [GATE_SCRIPT, ...args], {
          encoding: "utf8",
          ...(cwd === undefined ? {} : { cwd }),
        })
      );

    it("exits 0, prints the derived N and appends the summary on a clean inventory", () => {
      const dir = scratch("fitness-inventory-gate-");
      const files = writeInputs(dir, cleanInputs(3));
      const summary = path.join(dir, "summary.md");
      writeFileSync(summary, "previous step's summary\n");

      const result = runGate([...flags(files), "--summary", summary]);

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(
        "fitness-inventory-gate: derived N=3 from 3 numbered workflow steps, 3 reference headings and 3 list lines\n"
      );
      const written = readFileSync(summary, "utf8");
      expect(written.startsWith("previous step's summary\n## Fitness Functions")).toBe(true);
      expect(written).toContain("3 checks (#1-#3)");
    });

    it("exits 1 with each violation on stderr and writes no summary when the inventory is red", () => {
      const dir = scratch("fitness-inventory-gate-");
      const files = writeInputs(dir, [
        renderWorkflow([1, 1].map(stepName)),
        renderCanon({ list: [1] }),
        renderReference({ headings: [1] }),
      ]);
      const summary = path.join(dir, "summary.md");

      const result = runGate([...flags(files), "--summary", summary]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `fitness-inventory-gate: ${files.workflow} declares a check number on more than one step: 1`
      );
      expect(existsSync(summary)).toBe(false);
    });

    it("exits 1 naming an input file that cannot be read", () => {
      const dir = scratch("fitness-inventory-gate-");
      const files = writeInputs(dir, cleanInputs(1));
      const missing = path.join(dir, "absent.yml");

      const result = runGate([...flags({ ...files, workflow: missing })]);

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(`${missing} could not be read`);
    });

    it("exits 1 naming a reference that cannot be read", () => {
      const dir = scratch("fitness-inventory-gate-");
      const files = writeInputs(dir, cleanInputs(1));
      const missing = path.join(dir, "absent.md");

      const result = runGate([...flags({ ...files, reference: missing })]);

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(`fitness-inventory-gate: ${missing} could not be read`);
    });

    it("exits 1 when a list command occurs only in another check's step, naming the check and its step", () => {
      const dir = scratch("fitness-inventory-gate-");
      const files = writeInputs(dir, [
        renderWorkflow(numbered(2).map(stepName)),
        renderCanon({
          list: [1, listLine(2, `\`${stepCommand(1)}\``)],
          sentence: countSentence(2),
        }),
        renderReference({ headings: numbered(2) }),
      ]);
      const summary = path.join(dir, "summary.md");

      const result = runGate([...flags(files), "--summary", summary]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        `fitness-inventory-gate: ${files.canon}:8 says #2 runs \`${stepCommand(1)}\`, but the run ` +
          `body of its step at ${files.workflow}:16 does not contain that text. Name the command the ` +
          "step runs, or `shell` for an inline check.\n"
      );
      expect(existsSync(summary)).toBe(false);
    });

    it("exits 1 when a list command occurs only in an unnamed step after the check", () => {
      const dir = scratch("fitness-inventory-gate-");
      const files = writeInputs(dir, [
        withUnnamedStep(UNNAMED_RUN_STEP),
        renderCanon({
          list: [listLine(1, `\`${UNNAMED_COMMAND}\``), 2],
          sentence: countSentence(2),
        }),
        renderReference({ headings: numbered(2) }),
      ]);

      const result = runGate(flags(files));

      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        `fitness-inventory-gate: ${files.canon}:7 says #1 runs \`${UNNAMED_COMMAND}\`, but the run ` +
          `body of its step at ${files.workflow}:10 does not contain that text. Name the command the ` +
          "step runs, or `shell` for an inline check.\n"
      );
    });

    // Every side carries #2 here, so a reader that counted the nested name as a step would pass the
    // inventory with no step that runs #2.
    it("exits 1 on a numbered name nested inside a step, even when every side carries its number", () => {
      const dir = scratch("fitness-inventory-gate-");
      const files = writeInputs(dir, [
        withNestedName(nestedListItem(stepName(2))),
        renderCanon({ list: numbered(2) }),
        renderReference({ headings: numbered(2) }),
      ]);

      const result = runGate(flags(files));

      expect(result.status).toBe(1);
      expect(result.stdout).toBe(
        "fitness-inventory-gate: derived N=1 from 1 numbered workflow steps, 2 reference headings and 2 list lines\n"
      );
      expect(result.stderr).toContain(
        `fitness-inventory-gate: ${nestedNameRefusal(files.workflow, 13)}\n`
      );
      expect(result.stderr).toContain("documented but unwired: #2");
      expect(result.stderr).toContain("listed but unwired: #2");
    });

    it("exits 1 on an unknown argument instead of ignoring it", () => {
      const result = runGate(["--workspace", "anything"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("usage: node scripts/testing/fitness-inventory-gate.mjs");
      expect(result.stderr).toContain("[--reference <path>]");
    });

    // A copy of the gate in a scratch tree, run from a different directory with no flags: the only
    // files it can measure are the ones beside its own `scripts/` directory, so a lookup that leaned
    // on git or on the working directory would read another tree or fail here.
    it("reads the workflow, the canon and the reference beside its own scripts directory, needing neither git nor the working directory", () => {
      const tree = scratch("fitness-inventory-gate-tree-");
      mkdirSync(path.join(tree, "scripts", "testing"), { recursive: true });
      mkdirSync(path.join(tree, ".github", "workflows"), { recursive: true });
      mkdirSync(path.join(tree, "docs", "development"), { recursive: true });
      const script = path.join(tree, "scripts", "testing", "fitness-inventory-gate.mjs");
      copyFileSync(GATE_SCRIPT, script);
      const [workflow, canon, reference] = cleanInputs(5);
      writeFileSync(path.join(tree, ".github", "workflows", "fitness.yml"), workflow);
      writeFileSync(path.join(tree, "CLAUDE.md"), canon);
      writeFileSync(path.join(tree, "docs", "development", "FITNESS_FUNCTIONS.md"), reference);
      const elsewhere = scratch("fitness-inventory-gate-cwd-");

      const result = toResult(
        spawnSync(process.execPath, [script], { cwd: elsewhere, encoding: "utf8" })
      );

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        "derived N=5 from 5 numbered workflow steps, 5 reference headings and 5 list lines"
      );
    });
  });
});
