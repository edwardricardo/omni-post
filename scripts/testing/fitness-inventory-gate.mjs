// @ts-check
/**
 * @file fitness-inventory-gate.mjs
 * @description Fitness check #44: the inventory of numbered fitness checks is contiguous, the
 *   workflow and the canon carry the same set, and the count the canon states is derived.
 *
 *   WHY IT EXISTS, measured: the one invariant the fitness suite did not measure was the suite
 *   itself. A step wired without its canon block, a canon block whose step was deleted, a number two
 *   steps both claim, or a count sentence left at the previous value each read as a complete
 *   inventory while a check silently stopped being enforced, and the workflow summary printed a
 *   typed count that agreed with the document whatever actually ran. The step this gate replaced
 *   returned exit 0 against all three of those plants.
 *
 *   THE TWO SOURCES. The workflow side is every step whose `name:` value starts with `#<number>`,
 *   double- or single-quoted, in any job of `.github/workflows/fitness.yml`. Block scalars (the
 *   `run: |` bodies) are skipped, so a shell line shaped like a step name is never read as one. An
 *   UNQUOTED `name: #N …` is refused: YAML reads it as a comment, so the step has no name and its
 *   number would be invisible. The canon side is every line of the form `# N.` at column 0 inside a
 *   fenced code block of `CLAUDE.md` §Automated Compliance Checks. The section ends at the next
 *   level-1 or level-2 heading OUTSIDE a fence, so a column-0 `## ` shell comment inside the code
 *   block does not truncate it. The count sentence is read from the section's prose, outside fences.
 *
 *   WHAT COUNTS AS A CHECK HEADING, and why the convention stays load-bearing. Every check block in
 *   the canon opens with `# N.` at column 0, either on the line after the fence opens or after a
 *   blank line. A `# N.` line in any other position is a shell comment that LOOKS like a heading,
 *   and it is reported as such by its line number instead of being counted or ignored. A look-alike
 *   that does open a block (after a blank line) is counted, and then shows up as a duplicate heading
 *   or as a documented-but-unwired number, so it is red either way rather than silent.
 *
 *   SETS, NOT SEQUENCES. Both files declare the checks out of numeric order (19 sits before 16 in
 *   the workflow and before 18 in the canon), and that placement changes nothing, so the gate
 *   compares sets: the workflow numbers form `1..N` with no hole and no duplicate, the canon carries
 *   the same set with no duplicate, and the one count sentence states `N` checks numbered `#1-#N`.
 *   `N` is the highest number a workflow step declares; the summary prints that derived value.
 *
 *   FAIL-CLOSED. An unreadable file, zero numbered steps, a missing section, zero canon headings, a
 *   fence that never closes, and a missing count sentence each exit 1 with a message naming the
 *   cause. A scan that read nothing must never render as a clean inventory.
 *
 *   RESIDUAL LIMITS, stated rather than implied. (1) Textual, not a YAML or Markdown parser: a step
 *   whose name is assembled by a matrix, a composite action or a flow-style `{ name: … }` mapping is
 *   invisible. (2) A look-alike `# N.` comment that opens a block can stand in for a deleted heading
 *   with the same number, because the canon side cannot tell the two apart. (3) The gate proves the
 *   inventory is complete, never that a listed check still measures what its prose claims.
 *
 *   Usage: `node scripts/testing/fitness-inventory-gate.mjs [--workflow <path>] [--canon <path>]
 *   [--summary <path>]`. Both inputs default to the files beside the `scripts/` directory this file
 *   lives in, located from the script's own URL: no git, and nothing read from the working
 *   directory. `--summary` appends the derived inventory as Markdown on a clean verdict, which is
 *   how the workflow step writes its job summary. Exit 0 on a clean inventory, 1 otherwise.
 * @layer infrastructure
 */
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The workflow beside the `scripts/` directory this file lives in. */
const WORKFLOW = fileURLToPath(new URL("../../.github/workflows/fitness.yml", import.meta.url));
/** The canon beside the `scripts/` directory this file lives in. */
const CANON = fileURLToPath(new URL("../../CLAUDE.md", import.meta.url));

const SECTION_HEADING = "## Automated Compliance Checks";
/** A `name:` key, optionally the first key of a sequence entry, with its raw value captured. */
const NAME_KEY = /^(\s*)(-\s+)?name:\s*(.*)$/;
/** A key whose value is a block scalar indicator, so the lines below it are text, not YAML keys. */
const BLOCK_SCALAR_KEY = /^(\s*)(-\s+)?[A-Za-z_][\w-]*:\s*[|>][+-]?\d*\s*(?:#.*)?$/;
const DOUBLE_QUOTED = /^"((?:[^"\\]|\\.)*)"/;
const SINGLE_QUOTED = /^'((?:[^']|'')*)'/;
/** The number at the start of a step name: digits not followed by another digit. */
const STEP_NUMBER = /^#(\d+)(?!\d)/;
const FENCE = /^(`{3,}|~{3,})/;
const SECTION_END = /^#{1,2}(?:\s|$)/;
const CHECK_HEADING = /^# (\d+)\.(?:\s|$)/;
const COUNT_SENTENCE = /There\s+are\s+\*\*(\d+)\s+checks,\s+numbered\s+#(\d+)-#(\d+)\*\*/g;

/**
 * @typedef {object} Step
 * @property {number} number
 * @property {string} name The step name without its quotes.
 * @property {number} line One-based line in the workflow.
 */

/**
 * @typedef {object} Heading
 * @property {number} number
 * @property {number} line One-based line in the canon.
 */

/**
 * @typedef {object} Inventory
 * @property {number} n The highest number a workflow step declares.
 * @property {Step[]} steps In declaration order.
 * @property {Heading[]} headings In declaration order.
 */

/**
 * @typedef {object} Verdict
 * @property {Inventory | null} inventory `null` when either source yielded nothing to compare.
 * @property {string[]} violations Every refusal, each one a reason to exit 1.
 */

/**
 * A decimal check number as written. A zero or a leading zero is refused rather than normalised, so
 * `#07` and `#7` cannot both pass as the same check.
 *
 * @param {string} digits
 * @returns {number | null}
 */
function checkNumber(digits) {
  return /^[1-9]\d*$/.test(digits) ? Number(digits) : null;
}

/**
 * @param {string} line
 * @returns {number}
 */
function indentOf(line) {
  return line.length - line.trimStart().length;
}

/**
 * The numbered steps of a workflow, read as text.
 *
 * @param {string} text
 * @param {string} label How the file is named in a violation.
 * @returns {{ steps: Step[], violations: string[] }}
 */
function readWorkflowSteps(text, label) {
  /** @type {Step[]} */
  const steps = [];
  /** @type {string[]} */
  const violations = [];
  /** @type {number | null} */
  let blockKeyColumn = null;

  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (blockKeyColumn !== null) {
      if (line.trim().length === 0 || indentOf(line) > blockKeyColumn) continue;
      blockKeyColumn = null;
    }

    const scalar = BLOCK_SCALAR_KEY.exec(line);
    if (scalar !== null) {
      blockKeyColumn = (scalar[1] ?? "").length + (scalar[2] ?? "").length;
    }

    const key = NAME_KEY.exec(line);
    if (key === null) continue;
    const value = (key[3] ?? "").trim();
    if (value.startsWith("#")) {
      violations.push(
        `${label}:${String(lineNumber)} declares the step name \`${value}\` unquoted. YAML reads an ` +
          `unquoted \`#\` as the start of a comment, so the step has no name and its check number is ` +
          `invisible to the workflow and to this inventory. Quote the name.`
      );
      continue;
    }
    const quoted = DOUBLE_QUOTED.exec(value) ?? SINGLE_QUOTED.exec(value);
    if (quoted === null) continue;
    const name = value.startsWith("'")
      ? (quoted[1] ?? "").replaceAll("''", "'")
      : (quoted[1] ?? "");
    const numbered = STEP_NUMBER.exec(name);
    if (numbered === null) continue;
    const number = checkNumber(numbered[1] ?? "");
    if (number === null) {
      violations.push(
        `${label}:${String(lineNumber)} names the step \`${name}\`, whose number is not a check ` +
          `number: checks are numbered from 1, without a leading zero.`
      );
      continue;
    }
    steps.push({ number, name, line: lineNumber });
  }
  return { steps, violations };
}

/**
 * The check headings and the count sentences of the canon's §Automated Compliance Checks.
 *
 * @param {string} text
 * @param {string} label How the file is named in a violation.
 * @returns {{ headings: Heading[], sentences: { count: number, from: number, to: number, text: string }[], violations: string[], readable: boolean }}
 *   `readable` is false when the section could not be delimited, so nothing it holds was compared.
 */
function readCanonHeadings(text, label) {
  /** @type {Heading[]} */
  const headings = [];
  /** @type {string[]} */
  const violations = [];
  const lines = text.split("\n");

  const starts = lines.flatMap((line, index) => (line.startsWith(SECTION_HEADING) ? [index] : []));
  if (starts.length !== 1) {
    violations.push(
      starts.length === 0
        ? `${label} has no \`${SECTION_HEADING}\` section, so no check heading was read. Refusing ` +
            `rather than reporting a clean inventory over a section that moved or was renamed.`
        : `${label} opens \`${SECTION_HEADING}\` ${String(starts.length)} times (lines ` +
            `${starts.map((index) => String(index + 1)).join(", ")}), so which one holds the checks ` +
            `is ambiguous.`
    );
    return { headings, sentences: [], violations, readable: false };
  }

  /** @type {{ marker: string, line: number } | null} */
  let fence = null;
  let previous = "";
  /** @type {string[]} */
  const prose = [];
  for (let index = (starts[0] ?? 0) + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    if (fence !== null) {
      const closing = FENCE.exec(line);
      if (
        closing !== null &&
        line.trim() === closing[1] &&
        closing[1].startsWith(fence.marker[0] ?? "") &&
        closing[1].length >= fence.marker.length
      ) {
        fence = null;
        previous = line;
        continue;
      }
      const heading = CHECK_HEADING.exec(line);
      if (heading !== null) {
        const opensBlock = previous.trim().length === 0 || FENCE.test(previous);
        const number = checkNumber(heading[1] ?? "");
        if (!opensBlock || number === null) {
          violations.push(
            `${label}:${String(lineNumber)} reads \`${line.trim()}\`, a shell comment shaped like a ` +
              `check heading that does not open a check block (a heading follows the fence or a ` +
              `blank line, and is numbered from 1). Reword the comment so it does not start with ` +
              `\`# <number>.\` at column 0: as written it is either a heading in the wrong place ` +
              `or a comment that the inventory would otherwise have to guess about.`
          );
        } else {
          headings.push({ number, line: lineNumber });
        }
      }
      previous = line;
      continue;
    }
    const opening = FENCE.exec(line);
    if (opening !== null) {
      fence = { marker: opening[1] ?? "", line: lineNumber };
      previous = line;
      continue;
    }
    if (SECTION_END.test(line)) break;
    prose.push(line);
    previous = line;
  }

  if (fence !== null) {
    violations.push(
      `${label}:${String(fence.line)} opens a code block that never closes, so where ` +
        `§Automated Compliance Checks ends cannot be read. Refusing rather than counting headings ` +
        `from the rest of the file.`
    );
    return { headings: [], sentences: [], violations, readable: false };
  }

  const sentences = [...prose.join("\n").matchAll(COUNT_SENTENCE)].map((hit) => ({
    count: Number(hit[1]),
    from: Number(hit[2]),
    to: Number(hit[3]),
    text: hit[0].replace(/\s+/g, " "),
  }));
  return { headings, sentences, violations, readable: true };
}

/**
 * @param {Map<number, number[]>} lines
 * @returns {string}
 */
function describeDuplicates(lines) {
  return [...lines]
    .map(([number, at]) => `${String(number)} (lines ${at.map(String).join(", ")})`)
    .join("; ");
}

/**
 * @param {{ number: number, line: number }[]} entries
 * @returns {Map<number, number[]>} Every number declared more than once, with its lines.
 */
function duplicatesOf(entries) {
  /** @type {Map<number, number[]>} */
  const seen = new Map();
  for (const entry of entries) {
    seen.set(entry.number, [...(seen.get(entry.number) ?? []), entry.line]);
  }
  return new Map([...seen].filter(([, at]) => at.length > 1).sort(([a], [b]) => a - b));
}

/**
 * @param {Set<number>} left
 * @param {Set<number>} right
 * @returns {number[]} The members of `left` missing from `right`, ascending.
 */
function missingFrom(left, right) {
  return [...left].filter((number) => !right.has(number)).sort((a, b) => a - b);
}

/**
 * Derives the inventory from the two file contents and lists every violation.
 *
 * @param {{ workflowText: string, canonText: string, workflowLabel: string, canonLabel: string }} input
 * @returns {Verdict}
 */
export function evaluateInventory({ workflowText, canonText, workflowLabel, canonLabel }) {
  const workflow = readWorkflowSteps(workflowText, workflowLabel);
  const canon = readCanonHeadings(canonText, canonLabel);
  const violations = [...workflow.violations, ...canon.violations];

  if (workflow.steps.length === 0) {
    violations.push(
      `zero numbered steps were read from ${workflowLabel}, so the inventory would be derived from ` +
        `nothing. Refusing rather than reporting a clean inventory: the step-name convention ` +
        `(\`name: "#<number> <title>"\`) changed or the file is not the fitness workflow.`
    );
  }
  if (canon.readable && canon.headings.length === 0) {
    violations.push(
      `zero check headings were read from ${canonLabel} §Automated Compliance Checks, so the canon ` +
        `side of the inventory is empty. Refusing rather than reporting every step as undocumented ` +
        `over a section whose \`# <number>.\` convention moved.`
    );
  }
  if (workflow.steps.length === 0 || !canon.readable || canon.headings.length === 0) {
    return { inventory: null, violations };
  }

  const n = Math.max(...workflow.steps.map((step) => step.number));
  const wired = new Set(workflow.steps.map((step) => step.number));
  const documented = new Set(canon.headings.map((heading) => heading.number));

  const stepDuplicates = duplicatesOf(workflow.steps);
  if (stepDuplicates.size > 0) {
    violations.push(
      `${workflowLabel} declares a check number on more than one step: ` +
        `${describeDuplicates(stepDuplicates)}. Two steps answer for one number, so one of them is ` +
        `invisible to this inventory and to every reader counting the suite.`
    );
  }
  const headingDuplicates = duplicatesOf(canon.headings);
  if (headingDuplicates.size > 0) {
    violations.push(
      `${canonLabel} §Automated Compliance Checks declares a check heading more than once: ` +
        `${describeDuplicates(headingDuplicates)}. Either two blocks claim one check, or a shell ` +
        `comment shaped like \`# <number>.\` opens a line after a blank one inside a block and reads ` +
        `as a heading; reword the comment.`
    );
  }
  const holes = missingFrom(new Set(Array.from({ length: n }, (_, index) => index + 1)), wired);
  if (holes.length > 0) {
    violations.push(
      `the inventory has a hole: ${holes.map((number) => `#${String(number)}`).join(", ")} ` +
        `declared by no step of ${workflowLabel}, against a derived maximum of #${String(n)}. A ` +
        `number nothing declares is a check nobody deleted on purpose and nobody runs.`
    );
  }
  const undocumented = missingFrom(wired, documented);
  if (undocumented.length > 0) {
    violations.push(
      `wired but undocumented: ${undocumented.map((number) => `#${String(number)}`).join(", ")} ` +
        `has a step in ${workflowLabel} and no \`# <number>.\` heading in ${canonLabel} §Automated ` +
        `Compliance Checks. A check whose enforcement has no prose is a gate nobody can review.`
    );
  }
  const unwired = missingFrom(documented, wired);
  if (unwired.length > 0) {
    violations.push(
      `documented but unwired: ${unwired.map((number) => `#${String(number)}`).join(", ")} has a ` +
        `heading in ${canonLabel} §Automated Compliance Checks and no step in ${workflowLabel}. A ` +
        `check the canon describes and nothing runs reads as enforced while it is not.`
    );
  }

  if (canon.sentences.length === 0) {
    violations.push(
      `${canonLabel} §Automated Compliance Checks states no count in the form ` +
        `\`There are **N checks, numbered #1-#N**\`, so the claim this gate reads was reworded or ` +
        `deleted. Refusing rather than passing over an unstated count.`
    );
  } else if (canon.sentences.length > 1) {
    violations.push(
      `${canonLabel} §Automated Compliance Checks states the count ` +
        `${String(canon.sentences.length)} times (${canon.sentences.map((s) => `"${s.text}"`).join(", ")}), ` +
        `so which statement is the canon's is ambiguous. Keep exactly one.`
    );
  } else {
    const [sentence] = canon.sentences;
    if (
      sentence !== undefined &&
      (sentence.count !== n || sentence.from !== 1 || sentence.to !== n)
    ) {
      violations.push(
        `${canonLabel} states "${sentence.text}" but the derived inventory is ${String(n)} checks ` +
          `(#1-#${String(n)}). Update the sentence in the same change that adds or removes a check.`
      );
    }
  }

  return { inventory: { n, steps: workflow.steps, headings: canon.headings }, violations };
}

/**
 * The job summary for a clean inventory: the derived count and every check by number, so nothing in
 * it is typed by hand.
 *
 * @param {Inventory} inventory
 * @returns {string}
 */
export function renderSummary(inventory) {
  const rows = [...inventory.steps]
    .sort((a, b) => a.number - b.number)
    .map((step) => {
      const title = step.name.replace(STEP_NUMBER, "").trim().replaceAll("|", "\\|");
      return `| ${String(step.number)} | ${title} |`;
    });
  return [
    "## Fitness Functions",
    "",
    `${String(inventory.n)} checks (#1-#${String(inventory.n)}), derived from the numbered steps of ` +
      "this workflow and matched against CLAUDE.md §Automated Compliance Checks.",
    "",
    "| # | Check |",
    "| --- | --- |",
    ...rows,
    "",
    "Thresholds, ratchets and event conditions are stated per check in CLAUDE.md §Automated " +
      "Compliance Checks; each step's own result is its verdict.",
    "",
  ].join("\n");
}

/**
 * @typedef {object} Options
 * @property {string} workflow
 * @property {string} canon
 * @property {string | null} summary
 */

/**
 * @param {string[]} argv
 * @returns {Options | null} `null` on a usage error, which exits 1.
 */
function parseOptions(argv) {
  /** @type {Options} */
  const options = { workflow: WORKFLOW, canon: CANON, summary: null };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] ?? "";
    const value = argv[i + 1];
    if (value === undefined) return null;
    if (flag === "--workflow") options.workflow = value;
    else if (flag === "--canon") options.canon = value;
    else if (flag === "--summary") options.summary = value;
    else return null;
  }
  return options;
}

/**
 * @param {string} file
 * @returns {{ text: string } | { error: string }}
 */
function readInput(file) {
  try {
    return { text: readFileSync(file, "utf8") };
  } catch (error) {
    return {
      error:
        `${file} could not be read, so the inventory would be derived from nothing and read as ` +
        `clean: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * @param {string[]} argv
 * @returns {number} Process exit code.
 */
function main(argv) {
  const options = parseOptions(argv);
  if (options === null) {
    process.stderr.write(
      "usage: node scripts/testing/fitness-inventory-gate.mjs [--workflow <path>] " +
        "[--canon <path>] [--summary <path>]\n"
    );
    return 1;
  }

  const workflow = readInput(options.workflow);
  const canon = readInput(options.canon);
  const unreadable = [workflow, canon].flatMap((input) => ("error" in input ? [input.error] : []));
  if ("error" in workflow || "error" in canon) {
    for (const problem of unreadable) process.stderr.write(`fitness-inventory-gate: ${problem}\n`);
    return 1;
  }

  const verdict = evaluateInventory({
    workflowText: workflow.text,
    canonText: canon.text,
    workflowLabel: options.workflow,
    canonLabel: options.canon,
  });
  if (verdict.inventory !== null) {
    process.stdout.write(
      `fitness-inventory-gate: derived N=${String(verdict.inventory.n)} from ` +
        `${String(verdict.inventory.steps.length)} numbered workflow steps and ` +
        `${String(verdict.inventory.headings.length)} canon headings\n`
    );
  }
  for (const violation of verdict.violations) {
    process.stderr.write(`fitness-inventory-gate: ${violation}\n`);
  }
  if (verdict.violations.length > 0 || verdict.inventory === null) return 1;

  if (options.summary !== null) {
    try {
      appendFileSync(options.summary, renderSummary(verdict.inventory));
    } catch (error) {
      process.stderr.write(
        `fitness-inventory-gate: the summary could not be written to ${options.summary}: ` +
          `${error instanceof Error ? error.message : String(error)}\n`
      );
      return 1;
    }
  }
  return 0;
}

/**
 * True only when this file is the process entry point. The rules are exported for the suite, and
 * importing them must not run the CLI as a side effect.
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

if (invokedAsScript()) process.exitCode = main(process.argv.slice(2));
