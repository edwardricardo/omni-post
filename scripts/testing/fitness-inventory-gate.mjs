// @ts-check
/**
 * @file fitness-inventory-gate.mjs
 * @description Fitness check #44: the inventory of numbered fitness checks is contiguous, the
 *   workflow, the reference of check blocks and the list of the canon carry the same set, each list
 *   line names its check as its step does and says how it runs, and the count the canon states is
 *   derived.
 *
 *   WHY IT EXISTS, measured: the one invariant the fitness suite did not measure was the suite
 *   itself. A step wired without its block, a block whose step was deleted, a number two steps both
 *   claim, or a count sentence left at the previous value each read as a complete inventory while a
 *   check silently stopped being enforced, and the workflow summary printed a typed count that
 *   agreed with the document whatever actually ran. The step this gate replaced returned exit 0
 *   against all three of those plants. The check blocks then left the canon for a reference read on
 *   demand (ADR-0045), so the canon keeps one line per check: three files now state the suite, and
 *   this gate holds the three to one set.
 *
 *   THE THREE SOURCES. The workflow side is every step whose `name:` value starts with `#<number>`,
 *   double- or single-quoted, in any job of `.github/workflows/fitness.yml`, with the lines of the
 *   block scalars its own entry of the steps list holds (its `run: |` body). An entry opens at a
 *   line that starts `- ` and ends at the next line, outside a block scalar and not a comment, at
 *   its column or to its left: the next entry, named or not, or a key that leaves the list. So the
 *   body of a step with no numbered name is never credited to the numbered step before it. Block
 *   scalars are never read as keys, so a shell line shaped like a step name is never read as one.
 *   An UNQUOTED `name: #N …` is refused: YAML reads it as a comment, so the step has no name and
 *   its number would be invisible. A numbered name that no open entry holds (a job's, say) is
 *   refused too: no step's body can be told to be its. The reference side is every line of
 *   the form `# N.` at column 0 inside a fenced code block of the section `## Check blocks` of
 *   `docs/development/FITNESS_FUNCTIONS.md`. The list side is every line of `CLAUDE.md` §Automated
 *   Compliance Checks, outside code blocks, of the form `- **#N** <name> — <how>`, where `<how>` is
 *   `shell` for an inline check or one code span holding the command its step runs; the count
 *   sentence is read from the same section's prose. A section ends at the next level-1 or level-2
 *   heading OUTSIDE a fence, so a column-0 `## ` shell comment inside a code block does not
 *   truncate it.
 *
 *   WHAT COUNTS AS A CHECK HEADING, and why the convention stays load-bearing. Every check block in
 *   the reference opens with `# N.` at column 0, either on the line after the fence opens or after
 *   a blank line. A `# N.` line in any other position is a shell comment that LOOKS like a heading,
 *   and it is reported as such by its line number instead of being counted or ignored. A look-alike
 *   that does open a block (after a blank line) is counted, and then shows up as a duplicate heading
 *   or as a documented-but-unwired number, so it is red either way rather than silent. A line of the
 *   list that opens like an entry (a list marker, then `#` and a digit, bold or not) and is not
 *   exactly `- **#N** ` with no leading zero is reported by its line number the same way.
 *
 *   SETS, NOT SEQUENCES. The files declare the checks out of numeric order (19 sits before 16 in
 *   the workflow and before 18 in the reference), and that placement changes nothing, so the gate
 *   compares sets: the workflow numbers form `1..N` with no hole and no duplicate, the reference and
 *   the list each carry the same set with no duplicate, and the one count sentence states `N`
 *   checks numbered `#1-#N`. `N` is the highest number a workflow step declares; the summary prints
 *   that derived value.
 *
 *   WHAT FAILS beyond the sets: a list line whose name is not its step's name without the `#N `
 *   prefix, character for character (the violation prints the line as it must read); a list line
 *   that ends in neither ` — shell` nor ` — ` and one code span, or whose code span's text does not
 *   occur in its step's run body; a `# N.` heading inside a code block of the canon's section (the
 *   blocks live in the reference); and a count sentence in the reference (the count is stated once,
 *   in the canon).
 *
 *   FAIL-CLOSED. An unreadable file, zero numbered steps, a numbered name outside an entry of a
 *   steps list, a missing section in the canon or the reference, zero reference headings, zero list
 *   lines, a fence that never closes, and a missing count sentence each exit 1 with a message naming
 *   the cause. A scan that read nothing must never render as a clean inventory.
 *
 *   RESIDUAL LIMITS, stated rather than implied. (1) Textual, not a YAML or Markdown parser: a step
 *   whose name is assembled by a matrix, a composite action or a flow-style `{ name: … }` mapping is
 *   invisible, and a YAML escape in a quoted name is compared as written. (2) A look-alike `# N.`
 *   comment that opens a block can stand in for a deleted heading with the same number, because the
 *   reference side cannot tell the two apart. (3) The command check proves the command occurs in
 *   the step's run body, not that it is the command the step's verdict comes from; a step's body
 *   is its block scalars only, so a one-line `run:` value is not read and such a step can only be
 *   listed as `shell`. (4) A block's text and its step's body are still mirrored by hand. (5) The
 *   gate proves the inventory is complete, never that a listed check still measures what its prose
 *   claims.
 *
 *   Usage: `node scripts/testing/fitness-inventory-gate.mjs [--workflow <path>] [--canon <path>]
 *   [--reference <path>] [--summary <path>]`. The three inputs default to the files beside the
 *   `scripts/` directory this file lives in, located from the script's own URL: no git, and nothing
 *   read from the working directory. `--summary` appends the derived inventory as Markdown on a
 *   clean verdict, which is how the workflow step writes its job summary. Exit 0 on a clean
 *   inventory, 1 otherwise.
 * @layer infrastructure
 */
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The workflow beside the `scripts/` directory this file lives in. */
const WORKFLOW = fileURLToPath(new URL("../../.github/workflows/fitness.yml", import.meta.url));
/** The canon beside the `scripts/` directory this file lives in. */
const CANON = fileURLToPath(new URL("../../CLAUDE.md", import.meta.url));
/** The reference of check blocks beside the `scripts/` directory this file lives in. */
const REFERENCE = fileURLToPath(
  new URL("../../docs/development/FITNESS_FUNCTIONS.md", import.meta.url)
);

const SECTION_HEADING = "## Automated Compliance Checks";
const REFERENCE_SECTION = "## Check blocks";
/** A `name:` key, optionally the first key of a sequence entry, with its raw value captured. */
const NAME_KEY = /^(\s*)(-\s+)?name:\s*(.*)$/;
/**
 * A key whose value is a block scalar indicator, so the lines below it are text, not YAML keys.
 * Any key qualifies, `name:` included: a step name written as a block scalar is not the quoted
 * `"#N …"` form a check step uses, so it declares no check and its lines are skipped as text.
 */
const BLOCK_SCALAR_KEY = /^(\s*)(-\s+)?[A-Za-z_][\w-]*:\s*[|>][+-]?\d*\s*(?:#.*)?$/;
/** A line that opens an entry of a block sequence: its indentation, then `-` and a space or the end. */
const SEQUENCE_ENTRY = /^(\s*)-(?:\s|$)/;
/** A comment line, which ends no YAML structure whatever its indentation. */
const COMMENT_LINE = /^\s*#/;
const DOUBLE_QUOTED = /^"((?:[^"\\]|\\.)*)"/;
const SINGLE_QUOTED = /^'((?:[^']|'')*)'/;
/** The number at the start of a step name: digits not followed by another digit. */
const STEP_NUMBER = /^#(\d+)(?!\d)/;
const FENCE = /^(`{3,}|~{3,})/;
const SECTION_END = /^#{1,2}(?:\s|$)/;
const CHECK_HEADING = /^# (\d+)\.(?:\s|$)/;
const COUNT_SENTENCE = /There\s+are\s+\*\*(\d+)\s+checks,\s+numbered\s+#(\d+)-#(\d+)\*\*/g;
/** The exact opening of a list line: a dash, the check number in bold with no leading zero. */
const LIST_ENTRY = /^- \*\*#([1-9]\d*)\*\* (.*)$/;
/** The end of a list line: an em dash, then `shell` or one code span; the name is what precedes. */
const LIST_HOW = /^(.*) — (?:(shell)|`([^`]+)`)$/;
/** A line that opens like a list entry: a list marker, then `#` and a digit, bold or not. */
const ENTRY_LOOKALIKE = /^\s*[-*+]\s+\**#\d/;

/**
 * @typedef {object} Step
 * @property {number} number
 * @property {string} name The step name without its quotes.
 * @property {number} line One-based line in the workflow.
 * @property {string[]} body The lines of the step's block scalars, its `run: |` body, as written.
 */

/**
 * @typedef {object} Heading
 * @property {number} number
 * @property {number} line One-based line in the reference.
 */

/**
 * @typedef {object} Entry
 * @property {number} number
 * @property {string} name The name the list line gives its check.
 * @property {string | null} command The code span's text, or `null` for a line that says `shell`.
 * @property {number} line One-based line in the canon.
 */

/**
 * @typedef {object} Inventory
 * @property {number} n The highest number a workflow step declares.
 * @property {Step[]} steps In declaration order.
 * @property {Heading[]} headings In declaration order.
 * @property {Entry[]} entries In declaration order.
 */

/**
 * @typedef {object} Verdict
 * @property {Inventory | null} inventory `null` when a source yielded nothing to compare.
 * @property {string[]} violations Every refusal, each one a reason to exit 1.
 */

/**
 * @typedef {object} CountSentence
 * @property {number} count
 * @property {number} from
 * @property {number} to
 * @property {string} text The sentence with its whitespace collapsed.
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
 * @description The count sentences of a text.
 * @param {string} text
 * @returns {CountSentence[]}
 */
function countSentencesOf(text) {
  return [...text.matchAll(COUNT_SENTENCE)].map((hit) => ({
    count: Number(hit[1]),
    from: Number(hit[2]),
    to: Number(hit[3]),
    text: hit[0].replace(/\s+/g, " "),
  }));
}

/**
 * @description The numbered steps of a workflow, read as text, each with the lines of its run body.
 *   A step is an entry of a steps list: a line that opens a block sequence entry (`- `) starts it,
 *   and the next line outside a block scalar at that entry's column or to its left (the next entry,
 *   named or not, or a key that leaves the list) ends it. A block scalar's lines belong to the step
 *   whose entry holds them, so the body of a step with no numbered name is never credited to the
 *   numbered step before it. A numbered name that no open entry holds names no step whose body can
 *   be told, so it is refused rather than counted. Comment lines end nothing.
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
  /** @type {number | null} The column of the `-` of the open sequence entry. */
  let entryColumn = null;
  /** @type {Step | null} */
  let current = null;

  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (blockKeyColumn !== null) {
      if (line.trim().length === 0 || indentOf(line) > blockKeyColumn) {
        current?.body.push(line);
        continue;
      }
      blockKeyColumn = null;
    }

    if (line.trim().length > 0 && !COMMENT_LINE.test(line)) {
      if (entryColumn !== null && indentOf(line) <= entryColumn) {
        entryColumn = null;
        current = null;
      }
      const entry = SEQUENCE_ENTRY.exec(line);
      if (entry !== null && entryColumn === null) entryColumn = (entry[1] ?? "").length;
    }

    const scalar = BLOCK_SCALAR_KEY.exec(line);
    if (scalar !== null) {
      blockKeyColumn = (scalar[1] ?? "").length + (scalar[2] ?? "").length;
    }

    const key = NAME_KEY.exec(line);
    if (key === null) continue;
    current = null;
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
    if (entryColumn === null) {
      violations.push(
        `${label}:${String(lineNumber)} names \`${name}\` outside an entry of a steps list (a line ` +
          "that starts `- `), so no step's run body can be told to be its. A check is a step: name " +
          "it on the step, or drop the number."
      );
      continue;
    }
    current = { number, name, line: lineNumber, body: [] };
    steps.push(current);
  }
  return { steps, violations };
}

/**
 * @description Finds the one line that opens a section, or says why it cannot be found.
 * @param {string[]} lines
 * @param {string} heading The section's heading, matched at the start of a line.
 * @param {string} label How the file is named in a violation.
 * @param {string} what What the section would have yielded, for the violation.
 * @returns {{ start: number } | { violation: string }} The zero-based index of the heading line.
 */
function findSection(lines, heading, label, what) {
  const starts = lines.flatMap((line, index) => (line.startsWith(heading) ? [index] : []));
  if (starts.length === 1) return { start: starts[0] ?? 0 };
  return {
    violation:
      starts.length === 0
        ? `${label} has no \`${heading}\` section, so no ${what} was read. Refusing rather than ` +
          `reporting a clean inventory over a section that moved or was renamed.`
        : `${label} opens \`${heading}\` ${String(starts.length)} times (lines ` +
          `${starts.map((index) => String(index + 1)).join(", ")}), so which one holds the checks ` +
          `is ambiguous.`,
  };
}

/**
 * @description Whether `line` closes the fence opened by `marker`.
 * @param {string} line
 * @param {string} marker The opening fence's backticks or tildes.
 * @returns {boolean}
 */
function closesFence(line, marker) {
  const closing = FENCE.exec(line);
  return (
    closing !== null &&
    line.trim() === closing[1] &&
    closing[1].startsWith(marker[0] ?? "") &&
    closing[1].length >= marker.length
  );
}

/**
 * @description The check headings of the reference's section of check blocks: every `# N.` line at
 *   column 0 inside a code block of the section that follows the fence or a blank line.
 * @param {string} text
 * @param {string} label How the file is named in a violation.
 * @param {string} sectionHeading The heading of the section that holds the blocks.
 * @returns {{ headings: Heading[], violations: string[], readable: boolean }} `readable` is false
 *   when the section could not be delimited, so nothing it holds was compared.
 */
function readBlockHeadings(text, label, sectionHeading) {
  /** @type {Heading[]} */
  const headings = [];
  /** @type {string[]} */
  const violations = [];
  const lines = text.split("\n");

  const section = findSection(lines, sectionHeading, label, "check heading");
  if ("violation" in section) {
    return { headings, violations: [section.violation], readable: false };
  }

  /** @type {{ marker: string, line: number } | null} */
  let fence = null;
  let previous = "";
  for (let index = section.start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    if (fence !== null) {
      if (closesFence(line, fence.marker)) {
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
    previous = line;
  }

  if (fence !== null) {
    violations.push(
      `${label}:${String(fence.line)} opens a code block that never closes, so where ` +
        `\`${sectionHeading}\` ends cannot be read. Refusing rather than counting headings from the ` +
        `rest of the file.`
    );
    return { headings: [], violations, readable: false };
  }
  return { headings, violations, readable: true };
}

/**
 * @description The list of the canon's §Automated Compliance Checks: every line, outside code
 *   blocks, of the form `- **#N** <name> — <how>`, with every line that opens like an entry and is
 *   not in that form, every `# N.` heading left inside a code block of the section, and the count
 *   sentences of the section's prose.
 * @param {string} text
 * @param {string} label How the file is named in a violation.
 * @returns {{ entries: Entry[], fencedHeadings: { line: number, text: string }[], sentences: CountSentence[], violations: string[], readable: boolean }}
 *   `readable` is false when the section could not be delimited, so nothing it holds was compared.
 */
function readCanonList(text, label) {
  /** @type {Entry[]} */
  const entries = [];
  /** @type {{ line: number, text: string }[]} */
  const fencedHeadings = [];
  /** @type {string[]} */
  const violations = [];
  const lines = text.split("\n");

  const section = findSection(lines, SECTION_HEADING, label, "list line and no count sentence");
  if ("violation" in section) {
    return {
      entries,
      fencedHeadings,
      sentences: [],
      violations: [section.violation],
      readable: false,
    };
  }

  /** @type {{ marker: string, line: number } | null} */
  let fence = null;
  /** @type {string[]} */
  const prose = [];
  for (let index = section.start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    if (fence !== null) {
      if (closesFence(line, fence.marker)) fence = null;
      else if (CHECK_HEADING.test(line))
        fencedHeadings.push({ line: lineNumber, text: line.trim() });
      continue;
    }
    const opening = FENCE.exec(line);
    if (opening !== null) {
      fence = { marker: opening[1] ?? "", line: lineNumber };
      continue;
    }
    if (SECTION_END.test(line)) break;
    prose.push(line);

    const entry = LIST_ENTRY.exec(line);
    if (entry !== null) {
      const how = LIST_HOW.exec(entry[2] ?? "");
      entries.push({
        number: Number(entry[1]),
        name: how === null ? (entry[2] ?? "") : (how[1] ?? ""),
        command: how === null || how[2] !== undefined ? null : (how[3] ?? ""),
        line: lineNumber,
      });
      if (how === null) {
        violations.push(
          `${label}:${String(lineNumber)} lists #${String(entry[1])} with no way it runs: a line ends ` +
            `in \` — shell\` for an inline check, or in \` — \` and one code span holding the ` +
            `command its step runs.`
        );
      }
    } else if (ENTRY_LOOKALIKE.test(line)) {
      violations.push(
        `${label}:${String(lineNumber)} reads \`${line.trim()}\`, which opens like a line of the check ` +
          `list but is not \`- **#<number>** <step name> — <how>\` (a dash, the number in bold with ` +
          `no leading zero, the step's name, an em dash, and \`shell\` or one code span). Rewrite it ` +
          `in that form, or reword it so it does not open like a list entry.`
      );
    }
  }

  if (fence !== null) {
    violations.push(
      `${label}:${String(fence.line)} opens a code block that never closes, so where ` +
        `§Automated Compliance Checks ends cannot be read. Refusing rather than reading the list ` +
        `from the rest of the file.`
    );
    return { entries: [], fencedHeadings: [], sentences: [], violations, readable: false };
  }
  return {
    entries,
    fencedHeadings,
    sentences: countSentencesOf(prose.join("\n")),
    violations,
    readable: true,
  };
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
 * @param {number[]} numbers
 * @returns {string}
 */
function numberList(numbers) {
  return numbers.map((number) => `#${String(number)}`).join(", ");
}

/**
 * @description A step's title: its name without the `#N ` prefix.
 * @param {Step} step
 * @returns {string}
 */
function titleOf(step) {
  return step.name.replace(STEP_NUMBER, "").replace(/^ /, "");
}

/**
 * @description Each list line against its step: the name copied from the step's, and the command,
 *   when the line names one, found in the step's run body.
 * @param {Entry[]} entries
 * @param {Step[]} steps
 * @param {string} canonLabel
 * @param {string} workflowLabel
 * @returns {string[]}
 */
function checkEntriesAgainstSteps(entries, steps, canonLabel, workflowLabel) {
  /** @type {Map<number, Step>} */
  const byNumber = new Map();
  for (const step of steps) if (!byNumber.has(step.number)) byNumber.set(step.number, step);
  /** @type {string[]} */
  const violations = [];
  for (const entry of entries) {
    const step = byNumber.get(entry.number);
    if (step === undefined) continue;
    const at = `${workflowLabel}:${String(step.line)}`;
    const title = titleOf(step);
    if (entry.name !== title) {
      const how = entry.command === null ? "shell" : `\`${entry.command}\``;
      violations.push(
        `${canonLabel}:${String(entry.line)} names #${String(entry.number)} \`${entry.name}\`, but ` +
          `its step at ${at} is named \`${title}\`. The list copies the step's name, so the line ` +
          `must read: \`- **#${String(entry.number)}** ${title} — ${how}\``
      );
    }
    if (entry.command !== null && !step.body.join("\n").includes(entry.command)) {
      violations.push(
        `${canonLabel}:${String(entry.line)} says #${String(entry.number)} runs ` +
          `\`${entry.command}\`, but the run body of its step at ${at} does not contain that text. ` +
          `Name the command the step runs, or \`shell\` for an inline check.`
      );
    }
  }
  return violations;
}

/**
 * Derives the inventory from the three file contents and lists every violation.
 *
 * @param {{ workflowText: string, canonText: string, referenceText: string, workflowLabel: string, canonLabel: string, referenceLabel: string }} input
 * @returns {Verdict}
 */
export function evaluateInventory({
  workflowText,
  canonText,
  referenceText,
  workflowLabel,
  canonLabel,
  referenceLabel,
}) {
  const workflow = readWorkflowSteps(workflowText, workflowLabel);
  const reference = readBlockHeadings(referenceText, referenceLabel, REFERENCE_SECTION);
  const canon = readCanonList(canonText, canonLabel);
  const violations = [...workflow.violations, ...reference.violations, ...canon.violations];

  for (const heading of canon.fencedHeadings) {
    violations.push(
      `${canonLabel}:${String(heading.line)} holds the check heading \`${heading.text}\` in a code ` +
        `block of §Automated Compliance Checks. The check blocks live in ${referenceLabel}; this ` +
        `section keeps one line per check. Move the block there.`
    );
  }
  for (const sentence of countSentencesOf(referenceText)) {
    violations.push(
      `${referenceLabel} states the check count ("${sentence.text}"). The count is stated once, in ` +
        `${canonLabel} §Automated Compliance Checks; delete it here.`
    );
  }

  if (workflow.steps.length === 0) {
    violations.push(
      `zero numbered steps were read from ${workflowLabel}, so the inventory would be derived from ` +
        `nothing. Refusing rather than reporting a clean inventory: the step-name convention ` +
        `(\`name: "#<number> <title>"\`) changed or the file is not the fitness workflow.`
    );
  }
  if (reference.readable && reference.headings.length === 0) {
    violations.push(
      `zero check headings were read from ${referenceLabel} \`${REFERENCE_SECTION}\`, so the ` +
        `reference side of the inventory is empty. Refusing rather than reporting every step as ` +
        `undocumented over a section whose \`# <number>.\` convention moved.`
    );
  }
  if (canon.readable && canon.entries.length === 0) {
    violations.push(
      `zero list lines were read from ${canonLabel} §Automated Compliance Checks, so the list side ` +
        `of the inventory is empty. Refusing rather than reporting every step as unlisted over a ` +
        `list whose \`- **#<number>**\` form moved.`
    );
  }
  if (
    workflow.steps.length === 0 ||
    !reference.readable ||
    reference.headings.length === 0 ||
    !canon.readable ||
    canon.entries.length === 0
  ) {
    return { inventory: null, violations };
  }

  const n = Math.max(...workflow.steps.map((step) => step.number));
  const wired = new Set(workflow.steps.map((step) => step.number));
  const documented = new Set(reference.headings.map((heading) => heading.number));
  const listed = new Set(canon.entries.map((entry) => entry.number));

  const stepDuplicates = duplicatesOf(workflow.steps);
  if (stepDuplicates.size > 0) {
    violations.push(
      `${workflowLabel} declares a check number on more than one step: ` +
        `${describeDuplicates(stepDuplicates)}. Two steps answer for one number, so one of them is ` +
        `invisible to this inventory and to every reader counting the suite.`
    );
  }
  const headingDuplicates = duplicatesOf(reference.headings);
  if (headingDuplicates.size > 0) {
    violations.push(
      `${referenceLabel} declares a check heading more than once: ` +
        `${describeDuplicates(headingDuplicates)}. Either two blocks claim one check, or a shell ` +
        `comment shaped like \`# <number>.\` opens a line after a blank one inside a block and reads ` +
        `as a heading; reword the comment.`
    );
  }
  const entryDuplicates = duplicatesOf(canon.entries);
  if (entryDuplicates.size > 0) {
    violations.push(
      `${canonLabel} §Automated Compliance Checks lists a check more than once: ` +
        `${describeDuplicates(entryDuplicates)}. Keep one line per check.`
    );
  }
  const holes = missingFrom(new Set(Array.from({ length: n }, (_, index) => index + 1)), wired);
  if (holes.length > 0) {
    violations.push(
      `the inventory has a hole: ${numberList(holes)} declared by no step of ${workflowLabel}, ` +
        `against a derived maximum of #${String(n)}. A number nothing declares is a check nobody ` +
        `deleted on purpose and nobody runs.`
    );
  }
  const undocumented = missingFrom(wired, documented);
  if (undocumented.length > 0) {
    violations.push(
      `wired but undocumented: ${numberList(undocumented)} has a step in ${workflowLabel} and no ` +
        `\`# <number>.\` heading in ${referenceLabel}. A check whose enforcement has no prose is a ` +
        `gate nobody can review.`
    );
  }
  const unwired = missingFrom(documented, wired);
  if (unwired.length > 0) {
    violations.push(
      `documented but unwired: ${numberList(unwired)} has a heading in ${referenceLabel} and no ` +
        `step in ${workflowLabel}. A check the reference describes and nothing runs reads as ` +
        `enforced while it is not.`
    );
  }
  const unlisted = missingFrom(wired, listed);
  if (unlisted.length > 0) {
    violations.push(
      `wired but unlisted: ${numberList(unlisted)} has a step in ${workflowLabel} and no line in ` +
        `the list of ${canonLabel} §Automated Compliance Checks. A check the list leaves out is ` +
        `invisible to every session, which loads the list and not the blocks.`
    );
  }
  const listedUnwired = missingFrom(listed, wired);
  if (listedUnwired.length > 0) {
    violations.push(
      `listed but unwired: ${numberList(listedUnwired)} has a line in the list of ${canonLabel} ` +
        `§Automated Compliance Checks and no step in ${workflowLabel}. A check the list names and ` +
        `nothing runs reads as enforced while it is not.`
    );
  }
  violations.push(
    ...checkEntriesAgainstSteps(canon.entries, workflow.steps, canonLabel, workflowLabel)
  );

  const [sentence, ...otherSentences] = canon.sentences;
  if (sentence === undefined) {
    violations.push(
      `${canonLabel} §Automated Compliance Checks states no count in the form ` +
        `\`There are **N checks, numbered #1-#N**\`, so the claim this gate reads was reworded or ` +
        `deleted. Refusing rather than passing over an unstated count.`
    );
  } else if (otherSentences.length > 0) {
    violations.push(
      `${canonLabel} §Automated Compliance Checks states the count ` +
        `${String(canon.sentences.length)} times (${canon.sentences.map((s) => `"${s.text}"`).join(", ")}), ` +
        `so which statement is the canon's is ambiguous. Keep exactly one.`
    );
  } else if (sentence.count !== n || sentence.from !== 1 || sentence.to !== n) {
    violations.push(
      `${canonLabel} states "${sentence.text}" but the derived inventory is ${String(n)} checks ` +
        `(#1-#${String(n)}). Update the sentence in the same change that adds or removes a check.`
    );
  }

  return {
    inventory: { n, steps: workflow.steps, headings: reference.headings, entries: canon.entries },
    violations,
  };
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
      "this workflow and matched against the list of CLAUDE.md §Automated Compliance Checks and the " +
      "blocks of docs/development/FITNESS_FUNCTIONS.md.",
    "",
    "| # | Check |",
    "| --- | --- |",
    ...rows,
    "",
    "Thresholds, ratchets and event conditions are stated per check in the blocks of " +
      "docs/development/FITNESS_FUNCTIONS.md; each step's own result is its verdict.",
    "",
  ].join("\n");
}

/**
 * @typedef {object} Options
 * @property {string} workflow
 * @property {string} canon
 * @property {string} reference
 * @property {string | null} summary
 */

/**
 * @param {string[]} argv
 * @returns {Options | null} `null` on a usage error, which exits 1.
 */
function parseOptions(argv) {
  /** @type {Options} */
  const options = { workflow: WORKFLOW, canon: CANON, reference: REFERENCE, summary: null };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] ?? "";
    const value = argv[i + 1];
    if (value === undefined) return null;
    if (flag === "--workflow") options.workflow = value;
    else if (flag === "--canon") options.canon = value;
    else if (flag === "--reference") options.reference = value;
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
        "[--canon <path>] [--reference <path>] [--summary <path>]\n"
    );
    return 1;
  }

  const workflow = readInput(options.workflow);
  const canon = readInput(options.canon);
  const reference = readInput(options.reference);
  if ("error" in workflow || "error" in canon || "error" in reference) {
    for (const input of [workflow, canon, reference]) {
      if ("error" in input) process.stderr.write(`fitness-inventory-gate: ${input.error}\n`);
    }
    return 1;
  }

  const verdict = evaluateInventory({
    workflowText: workflow.text,
    canonText: canon.text,
    referenceText: reference.text,
    workflowLabel: options.workflow,
    canonLabel: options.canon,
    referenceLabel: options.reference,
  });
  if (verdict.inventory !== null) {
    process.stdout.write(
      `fitness-inventory-gate: derived N=${String(verdict.inventory.n)} from ` +
        `${String(verdict.inventory.steps.length)} numbered workflow steps, ` +
        `${String(verdict.inventory.headings.length)} reference headings and ` +
        `${String(verdict.inventory.entries.length)} list lines\n`
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
