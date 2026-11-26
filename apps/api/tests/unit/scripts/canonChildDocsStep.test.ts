/**
 * @file canonChildDocsStep.test.ts
 * @description Runs the body of the workflow step of fitness #24 (the four canon documents and
 *              their companions exist, each with its required line) as GitHub Actions runs it,
 *              and pins its verdict: exit 0 with no annotation on a clean copy of the eight
 *              documents, exit 1 with the named `::error` line of each clause, a case for each
 *              limit that block `# 24.` of docs/development/FITNESS_FUNCTIONS.md states, and two
 *              for limit (5), whose CRLF companion fails and whose CRLF child passes. The body is
 *              read from .github/workflows/fitness.yml when the suite runs and is never copied
 *              here, so a change to the step is a change to what this suite runs.
 *
 *              WHAT IT READS FROM THE TREE, and what a red run means. The workflow, and the eight
 *              documents as the tree holds them: the clean case and every clause and limit case
 *              start from copies of the real documents, and change only what the case names. So
 *              a real document that stops meeting #24 turns the clean case red, with the cases
 *              built on it, at the same time as the gate: the tree is wrong, and the gate's own
 *              annotation names the document. A fixture that changes a document by a pattern
 *              throws when the pattern matches nothing, so a document whose wording moved makes
 *              that case red with the fixture's message, never green on an unchanged copy: the
 *              fixture needs the new wording.
 *
 *              HOW THE BODY IS READ. `readRunBody` reads the workflow as text and accepts one
 *              form only, and throws, naming the line, on anything else:
 *              - the step: exactly one line outside a block scalar gives a step a name that
 *                starts with the prefix, and it opens the step's entry as `- name: "<prefix>…"`,
 *                an entry of `jobs.<id>.steps`; no step, two steps, another quoting or another
 *                place are refused;
 *              - its keys: plain keys among `name`, `id`, `if`, `continue-on-error`,
 *                `timeout-minutes` and one `run`. A `shell:` is refused with its own reason, any
 *                other key (`env:`, `working-directory:`, a quoted key) because the reader cannot
 *                tell what it does to the body;
 *              - its body: `run` is a literal block written `run: |` that holds a line, and its
 *                text is its lines without the indentation of its first line, ended by one line
 *                break (YAML's clip chomping). A folded `>`, a chomping or indentation indicator,
 *                a one-line or quoted `run`, an empty block and a line indented less than the
 *                first are refused;
 *              - its job: plain keys only, a `runs-on:` of a GitHub-hosted Ubuntu runner
 *                (`ubuntu-…`) and no `env:` and no `container:`; another job's keys are not read;
 *              - the workflow: no `env:` at its top level, and no `defaults:` key outside a block
 *                scalar.
 *              Each refused form would hand Actions' shell another text, hand the text to
 *              another shell, run it in another environment (a `BASH_ENV` in an `env:` is sourced
 *              by `bash -e` before the body) or on another machine, so the suite stops before it
 *              runs a body CI would not run. The reader of fitness #44 (`readWorkflowSteps` of
 *              scripts/testing/fitness-inventory-gate.mjs) is not this one: it keeps of a step its
 *              name and the lines of all its block scalars as written, and neither the key nor
 *              the indicator that opened them nor the step's other keys, which are what this
 *              reader judges.
 *
 *              HOW IT RUNS. A `run` with no `shell`, under no `defaults.run.shell`, runs on a
 *              Linux runner as `bash -e <file>`, so each case writes the body to a file beside a
 *              fresh working directory that holds copies of the eight documents, and runs
 *              `bash -e` on it there. `PATH` is the only variable the shell gets, so nothing of
 *              the machine's environment (a `BASH_ENV`, say) runs before the body.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "fitness.yml");
/** What the step's name starts with: its check number, then a space, so `#240` is not it. */
const STEP_PREFIX = "#24 ";

/** The four canon documents the step checks; each one's companion sits beside it. */
const CANON_DOCUMENTS = [
  "docs/architecture/ARCHITECTURE_CANON.md",
  "docs/development/CODING_STANDARDS.md",
  "docs/security/SECURITY_CANON.md",
  "docs/observability/LOGGING_CANON.md",
] as const;
type CanonDocument = (typeof CANON_DOCUMENTS)[number];

/**
 * A key whose value is a block scalar, `|` or `>` with any indicators and an optional comment:
 * the lines below it, while they are blank or further in than the key, are text and not keys.
 */
const BLOCK_SCALAR_KEY = /^(\s*)(-\s+)?[A-Za-z_][\w-]*:\s*[|>][-+0-9]*\s*(?:#.*)?$/;
const COMMENT_LINE = /^\s*#/;
/** A `name:` key, the first key of an entry or not, with its value captured as written. */
const NAME_KEY = /^\s*(?:-\s+)?name:\s*(.*)$/;
/** The one way the reader accepts a step to open: an entry whose first key is a double-quoted name. */
const STEP_OPENING = /^(\s*)(-\s+)name:\s*"/;
/** A plain key, with its value as written after it. */
const KEY = /^\s*([A-Za-z_][\w-]*):(?:\s+(.*))?$/;
/** A key that holds a mapping or a list below it: a plain key with no value on its line. */
const PARENT_KEY = /^\s*[A-Za-z_][\w-]*:\s*$/;
const DEFAULTS_KEY = /^\s*defaults:(?:\s|$)/;
/** A workflow-level `env:`: a key at column 0. */
const WORKFLOW_ENV_KEY = /^env:(?:\s|$)/;
/** The label of a GitHub-hosted Ubuntu runner, with no trailing comment. */
const UBUNTU_RUNNER = /^ubuntu-[\w.-]+$/;
/** The step's own keys that leave the text and the shell of `run` as Actions' defaults make them. */
const NEUTRAL_STEP_KEYS = new Set(["name", "id", "if", "continue-on-error", "timeout-minutes"]);

/** One line of the workflow, with whether it is text inside a block scalar. */
interface WorkflowLine {
  text: string;
  number: number;
  inBlock: boolean;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** A line that holds YAML structure: outside a block scalar, not blank and not a comment. */
function isStructure(line: WorkflowLine): boolean {
  return !line.inBlock && line.text.trim().length > 0 && !COMMENT_LINE.test(line.text);
}

/** The workflow's lines, each marked when a block scalar above it holds it as text. */
function scanWorkflow(text: string): WorkflowLine[] {
  const lines: WorkflowLine[] = [];
  let blockKeyColumn: number | null = null;
  for (const [index, line] of text.split("\n").entries()) {
    const number = index + 1;
    if (blockKeyColumn !== null && (line.trim().length === 0 || indentOf(line) > blockKeyColumn)) {
      lines.push({ text: line, number, inBlock: true });
      continue;
    }
    blockKeyColumn = null;
    const scalar = COMMENT_LINE.test(line) ? null : BLOCK_SCALAR_KEY.exec(line);
    if (scalar !== null) blockKeyColumn = (scalar[1] ?? "").length + (scalar[2] ?? "").length;
    lines.push({ text: line, number, inBlock: false });
  }
  return lines;
}

/**
 * @description The text of a literal block with clip chomping: its lines without the indentation
 *   of its first non-blank line, the trailing blank lines dropped, one line break at the end.
 * @param block The block's lines, as written.
 * @param where How the block is named when it cannot be read.
 * @returns The block's text.
 */
function literalText(block: WorkflowLine[], where: string): string {
  const first = block.find((line) => line.text.trim().length > 0);
  if (first === undefined) throw new Error(`${where}: the literal block holds no line`);
  const indent = indentOf(first.text);
  const lines = block.map((line) => {
    if (line.text.trim().length > 0 && indentOf(line.text) < indent) {
      throw new Error(
        `${where}: line ${String(line.number)} is indented less than the block's first line, ` +
          "which YAML refuses"
      );
    }
    return line.text.slice(indent);
  });
  while (lines.length > 0 && (lines.at(-1) ?? "").trim().length === 0) lines.pop();
  return `${lines.join("\n")}\n`;
}

/**
 * @description The index of the structural line that holds the one at `index`: the nearest one
 *   above it that sits further out than `column`, or -1 when none does.
 * @param structure The workflow's structural lines, in order.
 * @param index The index of the held line.
 * @param column The column the held line's key or dash sits at.
 * @returns The holder's index, or -1.
 */
function holderOf(structure: WorkflowLine[], index: number, column: number): number {
  for (let at = index - 1; at >= 0; at -= 1) {
    if (indentOf(structure[at]?.text ?? "") < column) return at;
  }
  return -1;
}

/**
 * @description Refuses what the job of the step sets that changes where or with what the body
 *   runs: an `env:`, a `container:`, and a `runs-on:` that is not a GitHub-hosted Ubuntu runner
 *   or is missing. The job is the mapping that holds the step's `steps:` list.
 * @param structure The workflow's structural lines, in order.
 * @param stepIndex The index of the step's name line in `structure`.
 * @param dashColumn The column of the step's `-`.
 * @param where How the step is named in a refusal.
 */
function refuseJobKeys(
  structure: WorkflowLine[],
  stepIndex: number,
  dashColumn: number,
  where: string
): void {
  const stepsAt = holderOf(structure, stepIndex, dashColumn);
  const stepsLine = structure[stepsAt];
  const jobAt =
    stepsLine === undefined ? -1 : holderOf(structure, stepsAt, indentOf(stepsLine.text));
  const jobLine = structure[jobAt];
  const jobsAt = jobLine === undefined ? -1 : holderOf(structure, jobAt, indentOf(jobLine.text));
  if (
    stepsLine?.text.trim() !== "steps:" ||
    jobLine === undefined ||
    !PARENT_KEY.test(jobLine.text) ||
    structure[jobsAt]?.text.trimEnd() !== "jobs:"
  ) {
    throw new Error(`${where} is not an entry of the steps list of a job, \`jobs.<id>.steps\``);
  }

  const job = `the job at line ${String(jobLine.number)}`;
  const keyColumn = indentOf(stepsLine.text);
  let runsOn: string | null = null;
  for (const line of structure.slice(jobAt + 1)) {
    if (indentOf(line.text) <= indentOf(jobLine.text)) break;
    if (indentOf(line.text) !== keyColumn) continue;
    const key = KEY.exec(line.text);
    if (key === null) {
      throw new Error(
        `${job}: line ${String(line.number)} is not a plain key (\`word:\`), so this reader ` +
          "cannot tell what it sets"
      );
    }
    const name = key[1] ?? "";
    if (name === "env") {
      throw new Error(
        `${job} sets \`env:\` at line ${String(line.number)}. Actions exports it to every step, ` +
          "and a variable such as `BASH_ENV` changes what `bash -e` runs before the body: run the " +
          "body with that environment."
      );
    }
    if (name === "container") {
      throw new Error(
        `${job} sets \`container:\` at line ${String(line.number)}, so Actions runs the body in ` +
          "that image, with its shell and its tools, and not on the runner this suite stands for."
      );
    }
    if (name === "runs-on") runsOn = (key[2] ?? "").replace(/\s+#.*$/, "").trim();
  }
  if (runsOn === null) throw new Error(`${job} names no \`runs-on:\``);
  if (!UBUNTU_RUNNER.test(runsOn)) {
    throw new Error(
      `${job} runs on \`${runsOn}\`, and this suite runs the body as a GitHub-hosted Ubuntu ` +
        "runner (`ubuntu-…`) does: run it on the runner named."
    );
  }
}

/**
 * @description The run body of the one step whose name starts with `prefix`, as Actions hands it
 *   to the shell. The form it accepts and the forms it refuses are in this file's header.
 * @param text The workflow, as written.
 * @param prefix What the step's name starts with.
 * @returns The body, ended by one line break.
 */
function readRunBody(text: string, prefix: string): string {
  const lines = scanWorkflow(text);
  const structure = lines.filter(isStructure);

  const defaults = structure.filter((line) => DEFAULTS_KEY.test(line.text));
  if (defaults.length > 0) {
    throw new Error(
      `the workflow declares \`defaults:\` at line ${defaults.map((line) => String(line.number)).join(", ")}. ` +
        "Actions applies `defaults.run` (a shell, a working directory) to every run step, so the " +
        "body would no longer run as this suite runs it: read what it sets and run the body so."
    );
  }
  const workflowEnv = structure.find((line) => WORKFLOW_ENV_KEY.test(line.text));
  if (workflowEnv !== undefined) {
    throw new Error(
      `the workflow sets \`env:\` at line ${String(workflowEnv.number)}. Actions exports it to ` +
        "every step, and a variable such as `BASH_ENV` changes what `bash -e` runs before the " +
        "body: run the body with that environment."
    );
  }

  const named = structure.filter((line) => {
    const value = (NAME_KEY.exec(line.text)?.[1] ?? "").trim();
    return value.replace(/^["']/, "").startsWith(prefix);
  });
  const step = named[0];
  if (step === undefined || named.length > 1) {
    throw new Error(
      `expected one step whose name starts with \`${prefix}\`, found ${String(named.length)}` +
        (named.length > 0 ? ` (lines ${named.map((line) => String(line.number)).join(", ")})` : "")
    );
  }
  const where = `the step at line ${String(step.number)}`;
  const opening = STEP_OPENING.exec(step.text);
  if (opening === null) {
    throw new Error(
      `${where} is not written \`- name: "${prefix.trim()} …"\`, the one form this reader accepts`
    );
  }
  const dashColumn = (opening[1] ?? "").length;
  const keyColumn = dashColumn + (opening[2] ?? "").length;
  refuseJobKeys(structure, structure.indexOf(step), dashColumn, where);

  const start = lines.indexOf(step) + 1;
  const end = lines.findIndex(
    (line, index) => index >= start && isStructure(line) && indentOf(line.text) <= dashColumn
  );
  const entry = lines.slice(start, end === -1 ? lines.length : end);

  let run: { line: WorkflowLine; at: number } | null = null;
  for (const [at, line] of entry.entries()) {
    if (!isStructure(line) || indentOf(line.text) !== keyColumn) continue;
    const key = KEY.exec(line.text);
    if (key === null) {
      throw new Error(
        `${where}: line ${String(line.number)} is not a plain key (\`word:\`), so this reader ` +
          "cannot tell what it sets"
      );
    }
    const name = key[1] ?? "";
    if (name === "shell") {
      throw new Error(
        `${where} sets \`shell:\` at line ${String(line.number)}. This suite runs the body with ` +
          "`bash -e`, the shell Actions uses when a step names none: run it with the shell named."
      );
    }
    if (name === "run") {
      if (run !== null) throw new Error(`${where} sets \`run:\` twice, which YAML refuses`);
      if ((key[2] ?? "").trim() !== "|") {
        throw new Error(
          `${where}: line ${String(line.number)} is \`${line.text.trim()}\`, and this reader ` +
            "accepts only the literal block `run: |`, whose text is its lines as written"
        );
      }
      run = { line, at };
      continue;
    }
    if (!NEUTRAL_STEP_KEYS.has(name)) {
      throw new Error(
        `${where} sets \`${name}:\` at line ${String(line.number)}, and this reader does not know ` +
          "what that key does to the text or the shell of the body"
      );
    }
  }
  if (run === null) throw new Error(`${where} has no \`run:\` key`);

  const block: WorkflowLine[] = [];
  for (const line of entry.slice(run.at + 1)) {
    if (!line.inBlock) break;
    block.push(line);
  }
  return literalText(block, where);
}

/** A canon document's companion: its path with `.md` replaced by `_REFERENCE.md`, as the step derives it. */
function companionOf(document: CanonDocument): string {
  return `${document.slice(0, -".md".length)}_REFERENCE.md`;
}

/** The text of each document of a working copy, by its path from the copy's root; `null` leaves it out. */
type WorkingCopy = Record<string, string | null>;

/**
 * @description The eight documents as the tree holds them, with `overrides` applied. A path that
 *   is not one of the eight throws, so a mistyped override cannot pass as a ninth file.
 * @param overrides The text a document takes instead, or `null` to leave it out.
 * @returns The working copy.
 */
function makeWorkingCopy(overrides: WorkingCopy = {}): WorkingCopy {
  const copy: WorkingCopy = {};
  for (const document of CANON_DOCUMENTS) {
    for (const file of [document, companionOf(document)]) {
      copy[file] = readFileSync(path.join(REPO_ROOT, file), "utf8");
    }
  }
  for (const file of Object.keys(overrides)) {
    if (!(file in copy)) throw new Error(`${file} is not one of the eight documents of the step`);
  }
  return { ...copy, ...overrides };
}

/**
 * A fixture that left the document as it was would let its case run on the real text, so each
 * edit below throws when it changes nothing.
 */
function changed(before: string, after: string, edit: string): string {
  if (after === before) throw new Error(`the fixture's edit (${edit}) changed nothing`);
  return after;
}

/** A document's text with every line `drop` holds for removed. */
function withoutLines(text: string, drop: (line: string) => boolean): string {
  const kept = text
    .split("\n")
    .filter((line) => !drop(line))
    .join("\n");
  return changed(text, kept, "no line to remove");
}

/** A document's text with every match of `pattern` replaced. */
function replacing(text: string, pattern: RegExp, replacement: string): string {
  return changed(text, text.replace(pattern, replacement), `${String(pattern)} matched nothing`);
}

/** A document's text with CRLF line endings. */
function withCrlf(text: string): string {
  return changed(text, text.replace(/\r?\n/g, "\r\n"), "no LF line ending");
}

/** What one run of the body did. */
interface StepRun {
  status: number | null;
  /** The non-empty lines of its standard output. */
  stdout: string[];
  stderr: string;
}

/** The annotation the step prints for one violation. */
function violation(message: string): string {
  return `::error title=Fitness #24 violation::${message}`;
}

const PASSED: StepRun = { status: 0, stdout: [], stderr: "" };

/** A run that exits 1 having printed one annotation per message, in that order. */
function failedWith(...messages: string[]): StepRun {
  return { status: 1, stdout: messages.map(violation), stderr: "" };
}

describe("the run body of the fitness #24 step", () => {
  let body = "";
  let root = "";

  beforeAll(() => {
    body = readRunBody(readFileSync(WORKFLOW, "utf8"), STEP_PREFIX);
  });

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "canon-child-docs-step-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** The directory the body runs in, where its relative paths resolve. */
  function workDir(): string {
    return path.join(root, "work");
  }

  /** Writes the copy's documents under the working directory, each at its path. */
  function writeWorkingCopy(copy: WorkingCopy): void {
    mkdirSync(workDir(), { recursive: true });
    for (const [file, text] of Object.entries(copy)) {
      if (text === null) continue;
      const target = path.join(workDir(), file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
  }

  /** The body run as Actions runs it: written to a file outside the copy, then `bash -e <file>`. */
  function runStep(): StepRun {
    const script = path.join(root, "step.sh");
    writeFileSync(script, body);
    const run = spawnSync("bash", ["-e", script], {
      cwd: workDir(),
      env: { PATH: process.env["PATH"] ?? "" },
      encoding: "utf8",
      timeout: 10_000,
    });
    return {
      status: run.status,
      stdout: run.stdout.split("\n").filter((line) => line.length > 0),
      stderr: run.stderr,
    };
  }

  /** A document's text as the tree holds it. */
  function treeText(file: string): string {
    return readFileSync(path.join(REPO_ROOT, file), "utf8");
  }

  it("exits 0 and prints no annotation on a clean copy of the eight documents", () => {
    writeWorkingCopy(makeWorkingCopy());

    expect(runStep()).toEqual(PASSED);
  });

  it("exits 1 naming the canon document that is missing", () => {
    writeWorkingCopy(makeWorkingCopy({ "docs/development/CODING_STANDARDS.md": null }));

    expect(runStep()).toEqual(
      failedWith("MISSING canon child: docs/development/CODING_STANDARDS.md")
    );
  });

  it("exits 1 naming the canon document that has no **Owner:** line", () => {
    const document = "docs/security/SECURITY_CANON.md";
    writeWorkingCopy(
      makeWorkingCopy({
        [document]: withoutLines(treeText(document), (line) => line.startsWith("**Owner:**")),
      })
    );

    expect(runStep()).toEqual(failedWith(`MISSING **Owner:** line in ${document}`));
  });

  it("exits 1 naming the canon document whose **Owner: line lacks its closing asterisks", () => {
    const document = "docs/architecture/ARCHITECTURE_CANON.md";
    writeWorkingCopy(
      makeWorkingCopy({
        [document]: replacing(treeText(document), /^\*\*Owner:\*\*/gm, "**Owner:"),
      })
    );

    expect(runStep()).toEqual(failedWith(`MISSING **Owner:** line in ${document}`));
  });

  it("exits 1 naming the companion that is missing", () => {
    const document = "docs/observability/LOGGING_CANON.md";
    writeWorkingCopy(makeWorkingCopy({ [companionOf(document)]: null }));

    expect(runStep()).toEqual(
      failedWith(`MISSING companion of ${document}: ${companionOf(document)}`)
    );
  });

  it("exits 1 naming the companion that has no ## How to extend heading", () => {
    const companion = companionOf("docs/development/CODING_STANDARDS.md");
    writeWorkingCopy(
      makeWorkingCopy({
        [companion]: withoutLines(treeText(companion), (line) => line === "## How to extend"),
      })
    );

    expect(runStep()).toEqual(failedWith(`MISSING §'How to extend' heading in ${companion}`));
  });

  it("exits 1 naming the companion whose ## How to extend heading carries trailing text", () => {
    const companion = companionOf("docs/security/SECURITY_CANON.md");
    writeWorkingCopy(
      makeWorkingCopy({
        [companion]: replacing(
          treeText(companion),
          /^## How to extend$/gm,
          "## How to extend these rules"
        ),
      })
    );

    expect(runStep()).toEqual(failedWith(`MISSING §'How to extend' heading in ${companion}`));
  });

  it("prints both lines, the document's then the companion's, when a document and its companion are missing together", () => {
    const document = "docs/observability/LOGGING_CANON.md";
    writeWorkingCopy(makeWorkingCopy({ [document]: null, [companionOf(document)]: null }));

    expect(runStep()).toEqual(
      failedWith(
        `MISSING canon child: ${document}`,
        `MISSING companion of ${document}: ${companionOf(document)}`
      )
    );
  });

  it("limit (1), textual: counts a ## How to extend heading that only a code fence holds, and exits 0", () => {
    const companion = companionOf("docs/architecture/ARCHITECTURE_CANON.md");
    const unheaded = withoutLines(treeText(companion), (line) => line === "## How to extend");
    writeWorkingCopy(
      makeWorkingCopy({ [companion]: `${unheaded}\n\`\`\`markdown\n## How to extend\n\`\`\`\n` })
    );

    expect(runStep()).toEqual(PASSED);
  });

  it("limit (2), the companion's existence and not the pointer: exits 0 when the **Reference:** line names another file", () => {
    const document = "docs/development/CODING_STANDARDS.md";
    writeWorkingCopy(
      makeWorkingCopy({
        [document]: replacing(
          treeText(document),
          /^\*\*Reference:\*\*.*$/m,
          "**Reference:** [ELSEWHERE_REFERENCE.md](ELSEWHERE_REFERENCE.md)"
        ),
      })
    );

    expect(runStep()).toEqual(PASSED);
  });

  it("limit (3), the two lines and not what is under them: exits 0 when a document and its companion hold only their required line", () => {
    const document = "docs/security/SECURITY_CANON.md";
    writeWorkingCopy(
      makeWorkingCopy({
        [document]: "**Owner:** Maintainers\n",
        [companionOf(document)]: "## How to extend\n",
      })
    );

    expect(runStep()).toEqual(PASSED);
  });

  it("limit (4), -f follows a link: exits 0 when the document is a symbolic link to a file outside the copy", () => {
    const document = "docs/observability/LOGGING_CANON.md";
    writeWorkingCopy(makeWorkingCopy({ [document]: null }));
    const elsewhere = path.join(root, "elsewhere.md");
    writeFileSync(elsewhere, "**Owner:** Maintainers\n");
    symlinkSync(elsewhere, path.join(workDir(), document));

    expect(runStep()).toEqual(PASSED);
  });

  it("limit (5), line endings as bytes: exits 1 naming a companion with CRLF line endings", () => {
    const companion = companionOf("docs/architecture/ARCHITECTURE_CANON.md");
    writeWorkingCopy(makeWorkingCopy({ [companion]: withCrlf(treeText(companion)) }));

    expect(runStep()).toEqual(failedWith(`MISSING §'How to extend' heading in ${companion}`));
  });

  it("limit (5), line endings as bytes: exits 0 on a canon document with CRLF line endings", () => {
    const document = "docs/development/CODING_STANDARDS.md";
    writeWorkingCopy(makeWorkingCopy({ [document]: withCrlf(treeText(document)) }));

    expect(runStep()).toEqual(PASSED);
  });
});

/** The parts of a synthetic workflow `readRunBody` is tried on. */
interface WorkflowParts {
  /** Lines after `on: push`, at the workflow's top level. */
  top: string[];
  /** The job's `runs-on:` lines, as written. */
  runsOn: string[];
  /** Lines after `runs-on:`, among the job's keys. */
  job: string[];
  /** The line that opens the job's list of steps, as written. */
  stepsKey: string;
  /** The name line of the step under test, as written. */
  nameLine: string;
  /** The lines of that step after its name line, as written. */
  step: string[];
  /** Lines after the last step, as written. */
  after: string[];
}

/** A workflow of three steps, the middle one under test, with `overrides` applied. */
function makeWorkflow(overrides: Partial<WorkflowParts> = {}): string {
  const parts: WorkflowParts = {
    top: [],
    runsOn: ["    runs-on: ubuntu-latest"],
    job: [],
    stepsKey: "    steps:",
    nameLine: '      - name: "#24 Under test"',
    step: [
      "        if: always()",
      "        run: |",
      "          set -uo pipefail",
      "          # a comment line the block keeps",
      '          if [ -f "x" ]; then',
      '            echo "one"',
      "          fi",
      "",
      '          echo "two"',
      "",
    ],
    after: [],
    ...overrides,
  };
  return [
    "name: Synthetic",
    "on: push",
    ...parts.top,
    "jobs:",
    "  fitness:",
    ...parts.runsOn,
    ...parts.job,
    parts.stepsKey,
    '      - name: "#23 Before"',
    "        run: |",
    "          echo before",
    // Text of a body shaped like a step name, which the reader must not count as a step.
    '          - name: "#24 a line of a body shaped like a step"',
    parts.nameLine,
    ...parts.step,
    '      - name: "#25 After"',
    "        run: |",
    "          echo after",
    ...parts.after,
    "",
  ].join("\n");
}

/** The body `readRunBody` reads from the step under test of `makeWorkflow`'s defaults. */
const SYNTHETIC_BODY = [
  "set -uo pipefail",
  "# a comment line the block keeps",
  'if [ -f "x" ]; then',
  '  echo "one"',
  "fi",
  "",
  'echo "two"',
  "",
].join("\n");

describe("readRunBody, the reader of a step's run body", () => {
  it("returns the literal block of the named step without its indentation, ended by one line break", () => {
    expect(readRunBody(makeWorkflow(), STEP_PREFIX)).toBe(SYNTHETIC_BODY);
  });

  it.each(["ubuntu-24.04", "ubuntu-24.04 # pinned"])(
    "accepts a job that runs on `%s`, a GitHub-hosted Ubuntu runner",
    (runner) => {
      const workflow = makeWorkflow({ runsOn: [`    runs-on: ${runner}`] });

      expect(readRunBody(workflow, STEP_PREFIX)).toBe(SYNTHETIC_BODY);
    }
  );

  it("accepts an `env:` that only another job sets", () => {
    const workflow = makeWorkflow({
      after: [
        "  other:",
        "    runs-on: ubuntu-latest",
        "    env:",
        "      BASH_ENV: /tmp/elsewhere",
        "    steps:",
        "      - run: echo other",
      ],
    });

    expect(readRunBody(workflow, STEP_PREFIX)).toBe(SYNTHETIC_BODY);
  });

  it("refuses a `run: |` whose block holds no line", () => {
    const workflow = makeWorkflow({ step: ["        if: always()", "        run: |"] });

    expect(() => readRunBody(workflow, STEP_PREFIX)).toThrow(/the literal block holds no line/);
  });

  it("refuses a block line indented less than the block's first line", () => {
    const workflow = makeWorkflow({
      step: ["        run: |", "            echo deep", "          echo shallow"],
    });

    expect(() => readRunBody(workflow, STEP_PREFIX)).toThrow(
      /indented less than the block's first line/
    );
  });

  it("refuses a step that sets `run:` twice", () => {
    const workflow = makeWorkflow({
      step: ["        run: |", "          echo one", "        run: |", "          echo two"],
    });

    expect(() => readRunBody(workflow, STEP_PREFIX)).toThrow(/sets `run:` twice/);
  });

  it("refuses a step with no `run:` key", () => {
    const workflow = makeWorkflow({ step: ["        if: always()"] });

    expect(() => readRunBody(workflow, STEP_PREFIX)).toThrow(/has no `run:` key/);
  });

  it("refuses a quoted key on the step, which the reader cannot tell from `shell:`", () => {
    const workflow = makeWorkflow({
      step: ['        "shell": bash', "        run: |", "          echo one"],
    });

    expect(() => readRunBody(workflow, STEP_PREFIX)).toThrow(
      /the step at line \d+: line \d+ is not a plain key/
    );
  });

  it("refuses a step that is not an entry of a job's `steps:` list", () => {
    const workflow = makeWorkflow({ stepsKey: "    pre-steps:" });

    expect(() => readRunBody(workflow, STEP_PREFIX)).toThrow(
      /is not an entry of the steps list of a job/
    );
  });

  it("refuses a workflow-level `env:`, which Actions exports to every step", () => {
    const workflow = makeWorkflow({ top: ["env:", "  BASH_ENV: /tmp/sourced-first"] });

    expect(() => readRunBody(workflow, STEP_PREFIX)).toThrow(/the workflow sets `env:`/);
  });

  it("refuses an `env:` of the step's job, which Actions exports to every step of it", () => {
    const workflow = makeWorkflow({ job: ["    env:", "      BASH_ENV: /tmp/sourced-first"] });

    expect(() => readRunBody(workflow, STEP_PREFIX)).toThrow(/the job at line \d+ sets `env:`/);
  });

  it("refuses a `container:` of the step's job, which runs the body in another image", () => {
    const workflow = makeWorkflow({ job: ["    container: node:22"] });

    expect(() => readRunBody(workflow, STEP_PREFIX)).toThrow(
      /the job at line \d+ sets `container:`/
    );
  });

  it("refuses a quoted key of the step's job, which the reader cannot tell from `env:`", () => {
    const workflow = makeWorkflow({ job: ['    "env": { BASH_ENV: /tmp/sourced-first }'] });

    expect(() => readRunBody(workflow, STEP_PREFIX)).toThrow(
      /the job at line \d+: line \d+ is not a plain key/
    );
  });

  it.each(["windows-latest", "macos-latest", "[self-hosted, linux]", "${{ matrix.os }}"])(
    "refuses a job that runs on `%s`, which is not a GitHub-hosted Ubuntu runner",
    (runner) => {
      const workflow = makeWorkflow({ runsOn: [`    runs-on: ${runner}`] });

      expect(() => readRunBody(workflow, STEP_PREFIX)).toThrow(
        /runs on `.+`, and this suite runs the body as a GitHub-hosted Ubuntu runner/
      );
    }
  );

  it("refuses a job that names no `runs-on:`", () => {
    expect(() => readRunBody(makeWorkflow({ runsOn: [] }), STEP_PREFIX)).toThrow(
      /names no `runs-on:`/
    );
  });

  it.each([">", "|-", "|+", "|2", "| # a comment", "echo one", '"echo one"'])(
    "refuses `run: %s`, which is not the literal block `run: |`",
    (form) => {
      const workflow = makeWorkflow({ step: [`        run: ${form}`, "          echo one"] });

      expect(() => readRunBody(workflow, STEP_PREFIX)).toThrow(/literal block `run: \|`/);
    }
  );

  const SHELL_PLACEMENTS: [string, string[]][] = [
    ["before its run", ["        shell: bash", "        run: |", "          echo one"]],
    ["after its run body", ["        run: |", "          echo one", "        shell: bash"]],
  ];

  it.each(SHELL_PLACEMENTS)("refuses a step that names its own shell %s", (_placement, step) => {
    expect(() => readRunBody(makeWorkflow({ step }), STEP_PREFIX)).toThrow(
      /sets `shell:` at line \d+\. This suite runs the body with `bash -e`, the shell Actions uses when a step names none/
    );
  });

  it.each(["env: { X: y }", "working-directory: docs"])(
    "refuses a step key that changes what the body sees: `%s`",
    (key) => {
      const workflow = makeWorkflow({
        step: [`        ${key}`, "        run: |", "          echo one"],
      });

      expect(() => readRunBody(workflow, STEP_PREFIX)).toThrow(/does not know what/);
    }
  );

  const DEFAULTS_LEVELS: [string, Partial<WorkflowParts>][] = [
    ["the workflow's", { top: ["defaults:", "  run:", "    shell: sh"] }],
    ["a job's", { job: ["    defaults:", "      run:", "        working-directory: docs"] }],
  ];

  it.each(DEFAULTS_LEVELS)("refuses %s `defaults:`", (_level, overrides) => {
    expect(() => readRunBody(makeWorkflow(overrides), STEP_PREFIX)).toThrow(/`defaults:`/);
  });

  it("refuses a workflow in which two steps' names start with the prefix", () => {
    const workflow = makeWorkflow({
      after: ['      - name: "#24 Again"', "        run: |", "          echo again"],
    });

    expect(() => readRunBody(workflow, STEP_PREFIX)).toThrow(/found 2/);
  });

  it("refuses a workflow in which no step's name starts with the prefix", () => {
    expect(() => readRunBody(makeWorkflow(), "#26 ")).toThrow(/found 0/);
  });

  it.each([
    ["single-quoted", "      - name: '#24 Under test'"],
    ["unquoted, which YAML reads as a comment", "      - name: #24 Under test"],
  ])("refuses a step name written %s", (_form, nameLine) => {
    expect(() => readRunBody(makeWorkflow({ nameLine }), STEP_PREFIX)).toThrow(/- name: "#24 …"/);
  });
});
