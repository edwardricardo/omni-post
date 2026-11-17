// @ts-check
/**
 * @file instruction-context-gate.mjs
 * @description The gate behind `pnpm check:instruction-context`: the instruction files every
 *   session loads by itself are the ones `.claude/instruction-manifest.json` names, they fit its
 *   byte budget, each record moved out of them keeps a live path-scoped rule that names it and is
 *   never loaded itself, and the hooks that enforce the manifest in every session are wired.
 *
 *   WHY IT EXISTS, measured: the loaded project instruction files grew from 449 KB on 2026-10-15 to
 *   572 KB on 2026-11-14 with nothing counting them, until the largest model refused every request
 *   of the project because of the instruction content alone (ADR-0045). Moving the records out was
 *   the repair; this gate is what keeps the context from growing back unnoticed.
 *
 *   THE PRINCIPLE: the gate does not reproduce the harness's loader; it is built so it cannot count
 *   less than the harness loads. Where the harness's behaviour is derived exactly and cheaply, the
 *   gate derives it; where it is not, the gate counts the file. A false red, cleared by rewording or
 *   by listing the file, is accepted; a false green is not.
 *
 *   WHAT IT READS, all under the root: git's listing with its file modes (`git ls-files --stage`),
 *   the manifest, the entry files, every file they import, and every tracked rule under
 *   `.claude/rules/`. The auto-loaded set is:
 *   - the entry files the harness reads from the project root, each when git tracks it:
 *     `CLAUDE.md` (required, read even when untracked), `.claude/CLAUDE.md`, `CLAUDE.local.md`,
 *     `AGENTS.md` and `.claude/AGENTS.md`. This is the list of the memory page
 *     (https://code.claude.com/docs/en/memory, "Project instructions", "Local instructions" and
 *     "AGENTS.md") and of Claude Code 2.1.325's own lists (`CLAUDE.md`, `.claude/CLAUDE.md`,
 *     `CLAUDE.local.md`; `AGENTS.md`, `.claude/AGENTS.md`). Exact for the first three; for the two
 *     `AGENTS.md` files an over-count, see the false reds below: 2.1.326's list of them is empty
 *     and loads neither, and the gate counts them whichever version runs;
 *   - every rule under `.claude/rules/`, at any depth, whose front matter does not prove it
 *     path-scoped. A rule is path-scoped only when its text opens with the line `---`; the first
 *     `---` after that line is a line of its own, `---` and nothing else (the harness closes the
 *     front matter at the first `---` wherever it falls); the lines between, blank lines aside, are
 *     `paths:` and then one or more lines `  - "<glob>"` (two spaces, a dash, a space, a
 *     double-quoted glob holding no `"`, no backslash and no control character); and at least one
 *     glob holds no comma and no brace and, trimmed and with one trailing `/**` cut, is neither empty
 *     nor `**`. That is a valid YAML mapping whose `paths` the harness keeps (2.1.325 drops a
 *     `paths` whose every entry is `**` once a trailing `/**` is cut, and loads the rule at session
 *     start); anything else, `paths: null`, a flow list, an unquoted glob, a second key, a front
 *     matter YAML would refuse, is counted as loaded;
 *   - every file an `@` token of a loaded file or of any tracked rule names, followed through the
 *     files it loads, with no depth limit. For each `@` in the text, wherever it is written, the
 *     token after it runs to the first space that is not escaped by a backslash or to a backslash
 *     that escapes no space; and the token and every prefix of it, with `\ ` read as a space, is
 *     resolved from the directory of the file that holds it (`~/` from the home directory). Each
 *     that names an existing file is loaded; a name too long for the file system names no file and
 *     is skipped, as the harness skips it. The harness reads a token only at the start of a
 *     Markdown text token or after a space, ends it at the end of that text token, skips code, and
 *     cuts the path at its first `#`: the path it loads is a prefix of the gate's token, so
 *     `@doc.md#section` and an import next to markup are never missed. An import in a path-scoped
 *     rule counts because it loads at session start whatever the rule's scope.
 *
 *   THE MANIFEST: `{ version: 1, tracked, local, records, budget }`. `tracked` lists the files
 *   every checkout loads, `local` the files only the main checkout holds (git ignores them, so this
 *   gate cannot read or count them), `records` each moved record with its rule and the globs of that
 *   rule that match nothing today (`emptyGlobs`, glob to reason), and `budget` the byte ceiling
 *   (`bytes`), the target (`target`) and, while the ceiling is above the target, the plan item that
 *   brings it down (`targetOwedBy`).
 *
 *   WHAT FAILS, exit 1, each line naming its rule:
 *   - A1 an import that resolves to a file outside the repository: no checkout holds it;
 *   - L1 a path git tracks as a symbolic link or a submodule at `.claude`, at `.claude/rules` or
 *     under `.claude/rules/`: the harness follows it and loads the rules behind it, which git's
 *     listing does not show, so the gate could not count them;
 *   - M1 the tracked list differs from the derived set in either direction, names a file git does
 *     not track, or names one twice;
 *   - M2 a local entry git tracks, one the tracked set loads, or one named twice;
 *   - B1 the derived set's bytes above `budget.bytes`; B2 `budget.bytes` more than 1,024 bytes
 *     above them, a stale ceiling that would let the context grow back unseen (`--write` lowers it
 *     and never raises it); B3 `budget.bytes` above `target` with no `targetOwedBy`, a
 *     `targetOwedBy` that does not start with a plan item id, or one left once the context meets the
 *     target;
 *   - R1 a record's rule that is not a tracked Markdown file under `.claude/rules/`, whose front
 *     matter does not prove it path-scoped, that imports a file, or that does not name its
 *     document; R2 a record git does not track, one the context loads, or one that is not a
 *     Markdown file (the record guard skips every call that names no Markdown file before it reads
 *     anything, so a record of another kind would never count as opened); R3 a glob of the rule
 *     that matches no tracked file and no `emptyGlobs` entry explains, an `emptyGlobs` entry whose
 *     glob matches a file or that the rule does not list, and an entry with no reason;
 *   - W1 the hooks that enforce the manifest at run time are not in place. `.claude/settings.json`
 *     must be tracked, must not set `disableAllHooks` (to anything but `false`), must not set
 *     `MAINTAINER_DISABLE_INSTRUCTION_CHECK` or `AI_AGENT` in its `env` block (with any value: the
 *     first switches the hooks off, the second replaces the harness version the check reads), and
 *     must run four entries: `instructions_loaded.py` on `InstructionsLoaded` and
 *     `user_prompt_instruction_check.py` on `UserPromptSubmit`, each in a group with no matcher;
 *     `pre_tool_record_guard.py record` on `PreToolUse` in a group whose matcher names Read and
 *     Grep and no other tool (a Bash call opens no record); and
 *     `pre_tool_record_guard.py judge` on `PreToolUse` in a group whose matcher names Edit, Write,
 *     MultiEdit and Bash (a matcher may also be `*` or absent there). Each entry is an allowlist: a
 *     blocking one (the check and the judging guard) holds `type: "command"`, its `command`,
 *     `"onFailure": "block"` and an optional `timeout` of at least 10 seconds, and nothing else;
 *     a recording one (the recorder and the recording guard) holds the same keys without
 *     `onFailure`, so a recorder that cannot run never refuses a read. Every other key is refused,
 *     because each changes whether the hook runs or blocks: `async` and `asyncRewake` run it in the
 *     background, where `onFailure` has no effect, `if` filters it (on an event with no tool, a hook
 *     with `if` never runs), `shell` and `args` change how it starts. Every entry that runs one of the
 *     four commands is held, a second copy included, and its group may hold only `matcher` and
 *     `hooks`. Without `"onFailure": "block"` a hook the harness cannot start, that exits with a code
 *     other than 0 or 2, or that times out lets the call through (the hooks reference, Claude Code
 *     2.1.295 and later). The three hook files and the module `_instruction_context.py` they import
 *     must be tracked, and the three hooks executable in git's index and in the checkout.
 *   A glob is read as the harness reads it: one with no slash matches at any depth, and a leading
 *   slash anchors it to the root.
 *
 *   FAIL-CLOSED, exit 3, which wins over 1: git's listing failing, longer than the buffer the gate
 *   reads it into (64 MiB, the message names it), or listing no file, a manifest that cannot be
 *   read, is not JSON or is not the shape above (a `targetOwedBy` that is blank included), a
 *   `CLAUDE.md` that is missing, unreadable or not a regular file, an entry file, a rule or an
 *   imported file that cannot be read, settings that cannot be read, are not JSON or hold no
 *   `hooks` object, and a file the derivation or W1 reads that git tracks and the checkout lacks.
 *   A usage error exits 2.
 *
 *   FALSE REDS, the over-counts kept on purpose, each cleared by listing the file or rewording:
 *   (1) every `@` token is read, in code spans, fenced and indented code, HTML comments, quotes,
 *   tables and addresses (`someone@docs/x.md`) included, and every prefix of it, so a mention that
 *   names an existing file counts though the harness skips it; (2) imports are followed past the
 *   harness's four hops, and the harness's skips (a file over its size limit, a non-text extension,
 *   a path `claudeMdExcludes` lists) are not applied; (3) a tracked `AGENTS.md` or
 *   `.claude/AGENTS.md` counts, although by default the harness reads them only in a project with no
 *   `CLAUDE.md`; the setting `claude-md-and-agents-md`, a per-user choice the gate cannot see, loads
 *   them beside it; (4) a rule whose front matter the harness would read as scoped but that is not in
 *   the grammar above (a flow list, a comma-separated string, an unquoted or single-quoted glob,
 *   another key, Windows line endings, a byte-order mark, a lone brace glob) counts as loaded;
 *   (5) every symbolic link or submodule under `.claude/rules/` is refused, also one whose target the
 *   gate could have read; (6) the bytes are the files' bytes, block HTML comments and front matter
 *   included, which the harness strips before loading: an upper bound.
 *
 *   RESIDUAL LIMITS, what the gate does not count, stated rather than implied: (1) content the
 *   harness loads on a match, after session start: a path-scoped rule's body; a `CLAUDE.md`,
 *   `CLAUDE.local.md` or `AGENTS.md` in a subdirectory, which loads once a file there is read; and
 *   the rules of a `.claude/rules` directory inside a subdirectory, which load on a match there,
 *   since the gate reads rules only under the root's `.claude/rules/`; (2) a
 *   session started in a subdirectory, which also loads at start each of those files between that
 *   directory and the root; (3) only tracked rules and tracked entry files are read, so one that a
 *   single checkout holds is invisible: the local list names those; (4) the user's and the
 *   organization's instruction files and auto memory, which belong to the machine, not the checkout;
 *   (5) B3 checks the shape of `targetOwedBy`, an id such as `ABC-1` at its start, not that a plan
 *   document names that item: review reads it; (6) matching is Node's `path.matchesGlob`, whose
 *   wildcards skip dot-named segments, so a glob whose only files sit under a dot-named directory
 *   reads as matching nothing, a false red, and an `emptyGlobs` entry for such a glob passes; R3
 *   reads a glob with a comma as written, while the harness splits it, a false red too; (7) W1
 *   proves the hooks are in place, not that they behave: their own suites under
 *   `.claude/hooks-py/tests/` hold that, and a matcher written as any other regular expression than
 *   a list of tool names, `*` or nothing is read as not covering, a false red; (8) W1 reads the
 *   tracked `.claude/settings.json` only: it holds `disableAllHooks` there, and the two keys
 *   `MAINTAINER_DISABLE_INSTRUCTION_CHECK` and `AI_AGENT` of an `env` block there; the same keys
 *   set in any other settings source (`.claude/settings.local.json`, the user's settings, the
 *   managed settings, a `--settings` argument) are not held here; (9) `onFailure` has effect from Claude Code 2.1.295,
 *   and an older harness ignores the key and lets the call through when a hook cannot start.
 *
 *   RETIRED WHEN: `targetOwedBy` leaves the manifest once the context is under the target, and the
 *   target then holds as a hard cap; the gate itself retires only by an ADR that records a
 *   measurement of the model provider's limit on instruction content showing no budget is needed.
 *
 *   Usage: `node scripts/testing/instruction-context-gate.mjs [--write] [--root <dir>]`. Exit 0
 *   clean, 1 on a verdict, 2 on a usage error, 3 on an unread input.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {{ kind: "file", buffer: Buffer, mode?: number } | { kind: "absent" } | { kind: "not-file" } | { kind: "error", message: string }} FileRead
 * @typedef {{ rule: string, document: string, emptyGlobs: Record<string, string> }} RecordEntry
 * @typedef {{ bytes: number, target: number, targetOwedBy?: string }} Budget
 * @typedef {{ version: 1, tracked: string[], local: string[], records: RecordEntry[], budget: Budget }} Manifest
 * @typedef {{ files: string[], bytes: number }} Measured
 * @typedef {object} Verdict
 * @property {number} exitCode 0 clean, 1 a verdict, 3 an unread input.
 * @property {string[]} unread Every input that could not be read; non-empty means exit 3.
 * @property {string[]} violations Every rule broken, each prefixed with its rule.
 * @property {string | null} summary The one-line account of the context, absent when unread.
 * @property {Measured | null} measured The derived set and its bytes, absent when unread.
 * @typedef {{ exitCode: number, messages: string[] }} Outcome
 * @typedef {{ scoped: boolean, globs: string[], body: string }} RuleFile
 * @typedef {{ why: string, bytes: number }} Loaded
 * @typedef {{ event: string, file: string, mode: string, tools: readonly string[], blocking: boolean, exact: boolean }} RequiredHook
 * @typedef {{ violations: string[], unread: string[], wired: number }} Wiring
 */

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const COMMAND = "node scripts/testing/instruction-context-gate.mjs";
const USAGE = `usage: ${COMMAND} [--write] [--root <dir>]`;
const EXIT = Object.freeze({ CLEAN: 0, VERDICT: 1, USAGE: 2, UNREAD: 3 });

/** The checked-in manifest, relative to the root. */
export const MANIFEST = ".claude/instruction-manifest.json";
/** How far `budget.bytes` may sit above the context before it is a stale ceiling. */
export const BUDGET_SLACK = 1024;
/** The entry file every session starts from; the gate refuses a root without it. */
const ENTRY = "CLAUDE.md";
/** Every entry file the harness reads from the project root, `CLAUDE.md` first. */
const ENTRIES = [ENTRY, ".claude/CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", ".claude/AGENTS.md"];
const RULES_DIR = ".claude/rules/";
/** The directories whose replacement by a link would hide every rule. */
const RULE_PARENTS = [".claude", ".claude/rules"];
/** Git's modes for a symbolic link and a submodule: git lists the link, not what is behind it. */
const LINK_MODES = ["120000", "160000"];
const UNSCOPED = "a rule whose front matter does not prove it path-scoped";
const MANIFEST_KEYS = ["version", "tracked", "local", "records", "budget"];
const RECORD_KEYS = ["rule", "document", "emptyGlobs"];
const BUDGET_KEYS = ["bytes", "target", "targetOwedBy"];
/** A plan item id at the start of `targetOwedBy`: upper-case words joined by hyphens. */
const PLAN_ITEM = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+(?![A-Za-z0-9-])/;
/** An `@` and the token after it: a backslash escapes a space and ends the token otherwise. */
const IMPORT_TOKEN = /@((?:\\ |[^\s\\])+)/g;
/**
 * One glob line of a front matter that proves a rule path-scoped: a double-quoted YAML scalar with
 * no escape, no quote and no character YAML refuses to print (a control or a noncharacter).
 */
const GLOB_LINE = /^ {2}- "([^"\\\p{Cc}￾￿]*)"$/u;
/** How many matching files an `emptyGlobs` refusal names. */
const SHOWN_MATCHES = 3;
const MISSING_REPAIR = "restore it with git checkout, or delete it with git rm";
/** The record guard reads a call only when it names a file with this suffix. */
const RECORD_SUFFIX = ".md";
/** The bytes `git ls-files` may print; a longer listing fails the read and the message names it. */
const LISTING_BUFFER = 64 * 1024 * 1024;

/** The settings file that wires the hooks, relative to the root. */
export const SETTINGS = ".claude/settings.json";
/**
 * The shortest timeout a required hook may be given, in seconds: the check waits up to 5 seconds
 * for the harness's asynchronous reports, and a hook the harness kills lets the prompt through.
 */
export const HOOK_TIMEOUT_FLOOR = 10;
const HOOK_COMMAND_PREFIX = "$CLAUDE_PROJECT_DIR/";
/** The module the three hooks import; the harness never runs it, so it needs no executable bit. */
const HOOK_MODULE = ".claude/hooks-py/_instruction_context.py";
const GUARD_FILE = ".claude/hooks-py/pre_tool_record_guard.py";
/** The keys a group that runs a required hook may hold. */
const GROUP_KEYS = Object.freeze(["matcher", "hooks"]);
/** The keys an entry of a required hook may hold: a blocking one must also hold `onFailure`. */
const ENTRY_KEYS = Object.freeze({
  blocking: Object.freeze(["type", "command", "timeout", "onFailure"]),
  recording: Object.freeze(["type", "command", "timeout"]),
});
/**
 * The hooks that enforce the manifest at run time, each on the one event that can do its part. An
 * empty `tools` list means a group with no matcher: on `InstructionsLoaded` a matcher filters the
 * load reasons, and a recorder that saw only some of them would block sessions for the rest. The
 * guard runs twice: `record` notes the openings of a record and must never refuse a read, `judge`
 * refuses a write when the guard cannot run. `exact` holds a matcher to its tools and no other:
 * the record mode opens a record only on a Read or a Grep, so a Bash call it ran on would open
 * nothing, and a group that still names Bash keeps the model the guard left.
 * @type {readonly RequiredHook[]}
 */
const REQUIRED_HOOKS = Object.freeze([
  {
    event: "InstructionsLoaded",
    file: ".claude/hooks-py/instructions_loaded.py",
    mode: "",
    tools: [],
    blocking: false,
    exact: false,
  },
  {
    event: "UserPromptSubmit",
    file: ".claude/hooks-py/user_prompt_instruction_check.py",
    mode: "",
    tools: [],
    blocking: true,
    exact: false,
  },
  {
    event: "PreToolUse",
    file: GUARD_FILE,
    mode: "record",
    tools: ["Read", "Grep"],
    blocking: false,
    exact: true,
  },
  {
    event: "PreToolUse",
    file: GUARD_FILE,
    mode: "judge",
    tools: ["Edit", "Write", "MultiEdit", "Bash"],
    blocking: true,
    exact: false,
  },
]);
/**
 * The keys an `env` block of the tracked settings may not set, whatever the value, and why: each
 * changes what the instruction hooks decide for every session of every checkout.
 */
const ENV_REFUSED = Object.freeze({
  MAINTAINER_DISABLE_INSTRUCTION_CHECK:
    "turns the instruction check and the record guard off for every session of every checkout (the Maintainer sets the switch from a terminal)",
  AI_AGENT:
    "replaces the harness version the instruction check reads, so an old harness that ignores onFailure would pass",
});
/** Why a key outside the allowlist leaves a required hook without its effect. */
const KEY_REASONS = Object.freeze({
  async: "runs it in the background, where nothing it returns blocks and onFailure has no effect",
  asyncRewake:
    "runs it in the background, where nothing it returns blocks and onFailure has no effect",
  if: "filters the calls it runs on, and on an event with no tool a hook with it never runs",
  shell: "changes the shell that starts it",
  args: "spawns it without a shell, with another argument vector",
  onFailure: "would refuse the call whenever a hook that only records cannot run",
});
/** @type {(hook: RequiredHook) => string} */
const commandOf = ({ file, mode }) =>
  `${HOOK_COMMAND_PREFIX}${file}${mode === "" ? "" : ` ${mode}`}`;
/** @type {(hook: RequiredHook) => string} */
const labelOf = ({ file, mode }) => `${file}${mode === "" ? "" : ` ${mode}`}`;
/** Git's mode for an executable file, and the owner's execute bit of a file on disk. */
const EXECUTABLE_MODE = "100755";
const OWNER_EXECUTE = 0o100;

/** @type {(error: unknown) => string} */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/** @type {(count: number, noun: string) => string} */
const plural = (count, noun) => `${String(count)} ${noun}${count === 1 ? "" : "s"}`;

/** @type {(count: number) => string} */
const times = (count) => (count === 2 ? "twice" : `${String(count)} times`);

/** @type {(code: number, messages: string[]) => Outcome} */
const outcome = (exitCode, messages) => ({ exitCode, messages });

/** @type {(unread: string[]) => Verdict} */
const unreadVerdict = (unread) => ({
  exitCode: EXIT.UNREAD,
  unread,
  violations: [],
  summary: null,
  measured: null,
});

/**
 * @description Whether a value is a repository-relative path: a non-empty string with no leading
 *   slash, no backslash and no empty, `.` or `..` segment.
 * @param {unknown} value The value to test.
 * @returns {value is string} True for a repository-relative path.
 */
function isRelativePath(value) {
  return (
    typeof value === "string" &&
    value !== "" &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

/**
 * @description Whether a value is a plain JSON object.
 * @param {unknown} value The value to test.
 * @returns {value is Record<string, unknown>} True for an object that is not an array.
 */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @type {(value: unknown) => value is number} */
const isPositiveInteger = (value) => Number.isSafeInteger(value) && Number(value) > 0;

/**
 * @description Checks the manifest's shape, so every rule reads a manifest it can trust.
 * @param {unknown} parsed The parsed JSON.
 * @returns {{ manifest: Manifest } | { problems: string[] }} The manifest, or what is wrong.
 */
function readManifest(parsed) {
  if (!isObject(parsed)) return { problems: [`${MANIFEST} must hold one JSON object`] };
  /** @type {string[]} */
  const problems = [];
  const known = `the manifest holds ${MANIFEST_KEYS.join(", ")}`;
  for (const key of Object.keys(parsed).filter((key) => !MANIFEST_KEYS.includes(key))) {
    problems.push(`${MANIFEST}: unknown key ${key}; ${known}`);
  }
  for (const key of MANIFEST_KEYS.filter((key) => !(key in parsed))) {
    problems.push(`${MANIFEST}: missing key ${key}; ${known}`);
  }
  if ("version" in parsed && parsed.version !== 1) {
    problems.push(`${MANIFEST}: version must be 1`);
  }
  const { tracked, local, records, budget } = parsed;
  if (
    "tracked" in parsed &&
    !(Array.isArray(tracked) && tracked.length > 0 && tracked.every(isRelativePath))
  ) {
    problems.push(`${MANIFEST}: tracked must be a non-empty array of repository-relative paths`);
  }
  if ("local" in parsed && !(Array.isArray(local) && local.every(isRelativePath))) {
    problems.push(`${MANIFEST}: local must be an array of repository-relative paths`);
  }
  if ("records" in parsed) {
    if (Array.isArray(records)) {
      for (const [index, record] of records.entries()) {
        problems.push(...recordProblems(record, `records[${String(index)}]`));
      }
    } else {
      problems.push(`${MANIFEST}: records must be an array`);
    }
  }
  if ("budget" in parsed) problems.push(...budgetProblems(budget));
  if (problems.length > 0) return { problems };
  const raw = /** @type {Record<string, unknown>[]} */ (records);
  return {
    manifest: {
      version: 1,
      tracked: /** @type {string[]} */ (tracked),
      local: /** @type {string[]} */ (local),
      records: raw.map((record) => ({
        rule: /** @type {string} */ (record.rule),
        document: /** @type {string} */ (record.document),
        emptyGlobs: /** @type {Record<string, string>} */ (record.emptyGlobs ?? {}),
      })),
      budget: /** @type {Budget} */ (budget),
    },
  };
}

/**
 * @description The shape problems of one record entry.
 * @param {unknown} record The entry.
 * @param {string} where How the entry is named, `records[<index>]`.
 * @returns {string[]} The problems, empty when the entry is well formed.
 */
function recordProblems(record, where) {
  const shape = `${MANIFEST}: ${where} must be an object with rule and document paths and an optional emptyGlobs`;
  if (!isObject(record)) return [shape];
  if (Object.keys(record).some((key) => !RECORD_KEYS.includes(key))) return [shape];
  if (!isRelativePath(record.rule) || !isRelativePath(record.document)) return [shape];
  const { emptyGlobs } = record;
  if (
    emptyGlobs !== undefined &&
    !(isObject(emptyGlobs) && Object.values(emptyGlobs).every((why) => typeof why === "string"))
  ) {
    return [`${MANIFEST}: ${where}.emptyGlobs must map each glob to its reason, a string`];
  }
  return [];
}

/**
 * @description The shape problems of the budget.
 * @param {unknown} budget The `budget` value.
 * @returns {string[]} The problems, empty when the budget is well formed.
 */
function budgetProblems(budget) {
  if (!isObject(budget)) return [`${MANIFEST}: budget must be an object`];
  /** @type {string[]} */
  const problems = Object.keys(budget)
    .filter((key) => !BUDGET_KEYS.includes(key))
    .map((key) => `${MANIFEST}: budget holds the unknown key ${key}`);
  for (const key of ["bytes", "target"]) {
    if (!isPositiveInteger(budget[key])) {
      problems.push(`${MANIFEST}: budget.${key} must be a positive integer`);
    }
  }
  const owed = budget.targetOwedBy;
  if ("targetOwedBy" in budget && (typeof owed !== "string" || owed.trim() === "")) {
    problems.push(`${MANIFEST}: budget.targetOwedBy must be a non-blank string when present`);
  }
  return problems;
}

/**
 * @description The paths the `@` tokens of a text may name, read so that none the harness loads is
 *   missed: every prefix of each token, the token included, with `\ ` read as a space. A prefix
 *   stands for a path the harness ends earlier: at the end of a Markdown text token, or before the
 *   `#` of a fragment.
 * @param {string} text The text of a loaded file or a rule.
 * @returns {string[][]} For each distinct token, its prefixes from the shortest to the token.
 */
function importCandidates(text) {
  /** @type {Set<string>} */
  const tokens = new Set();
  for (const match of text.matchAll(IMPORT_TOKEN)) {
    tokens.add(match[1] ?? "");
  }
  return [...tokens].map((token) =>
    Array.from({ length: token.length }, (_, index) =>
      token.slice(0, index + 1).replaceAll("\\ ", " ")
    )
  );
}

/**
 * @description Whether one glob of a rule proves the harness keeps it: no comma and no brace, which
 *   the harness splits and expands, and neither empty nor `**` once trimmed and once a trailing
 *   `/**` is cut.
 * @param {string} glob The glob as the rule writes it.
 * @returns {boolean} True when the harness keeps this glob, so the rule is path-scoped.
 */
function provesScope(glob) {
  if (/[,{}]/.test(glob)) return false;
  const trimmed = glob.trim();
  const cut = trimmed.endsWith("/**") ? trimmed.slice(0, -3) : trimmed;
  return cut !== "" && cut !== "**";
}

/**
 * @description Reads a rule by the narrow grammar the header states: it is path-scoped only when
 *   its front matter proves it, and every other rule is read as loaded at session start.
 * @param {string} text The rule file.
 * @returns {RuleFile} Whether the rule is proven path-scoped, its globs and its body.
 */
function readRule(text) {
  /** @type {RuleFile} */
  const unscoped = { scoped: false, globs: [], body: text };
  if (!text.startsWith("---\n")) return unscoped;
  const close = text.indexOf("---", 4);
  const after = close === -1 ? "" : text.slice(close + 3);
  if (close === -1 || text[close - 1] !== "\n" || !(after === "" || after.startsWith("\n"))) {
    return unscoped;
  }
  const lines = text
    .slice(4, close)
    .split("\n")
    .filter((line) => line !== "");
  if (lines[0] !== "paths:" || lines.length < 2) return unscoped;
  /** @type {string[]} */
  const globs = [];
  for (const line of lines.slice(1)) {
    const item = GLOB_LINE.exec(line);
    if (item === null) return unscoped;
    globs.push(item[1] ?? "");
  }
  if (!globs.some(provesScope)) return unscoped;
  return { scoped: true, globs, body: after.slice(1) };
}

/**
 * @description Whether a tracked file matches a rule's glob, read as the harness reads it.
 * @param {string} glob The glob as the rule writes it.
 * @param {string} file A repository-relative path.
 * @returns {boolean} True on a match.
 */
function globMatches(glob, file) {
  if (glob.startsWith("/")) return path.posix.matchesGlob(file, glob.slice(1));
  return path.posix.matchesGlob(file, glob.includes("/") ? glob : `**/${glob}`);
}

/**
 * @typedef {object} Derived
 * @property {Map<string, Loaded>} loaded The auto-loaded set, by repository-relative path.
 * @property {Map<string, string[]>} imports Each file's imports, relative or absolute.
 * @property {Map<string, RuleFile>} rules Each tracked rule.
 * @property {string[]} violations A1's and L1's refusals.
 * @property {string[]} unread What could not be read.
 */

/**
 * @description Derives the auto-loaded set, never less than the harness loads at session start.
 * @param {{ root: string, tracked: readonly string[], links: readonly string[], readFile: (absolutePath: string) => FileRead, homeDir: string }} input
 *   The root, git's listing, the paths it lists as links, the reader and the home directory `~`
 *   expands to.
 * @returns {Derived} The set and what was read on the way.
 */
function deriveContext({ root, tracked, links, readFile, homeDir }) {
  /** @type {Derived} */
  const derived = {
    loaded: new Map(),
    imports: new Map(),
    rules: new Map(),
    violations: [],
    unread: [],
  };
  const gitTracked = new Set(tracked);
  /** @type {Map<string, FileRead>} */
  const reads = new Map();
  /** @type {(absolute: string) => FileRead} */
  const read = (absolute) => {
    const known = reads.get(absolute);
    if (known !== undefined) return known;
    const result = readFile(absolute);
    reads.set(absolute, result);
    return result;
  };
  /** @type {{ file: string, text: string }[]} */
  const queue = [];

  /** @type {(file: string, why: string, buffer: Buffer) => void} */
  const load = (file, why, buffer) => {
    derived.loaded.set(file, { why, bytes: buffer.length });
    queue.push({ file, text: buffer.toString("utf8") });
  };

  /**
   * Reads a repository file the derivation counts. A file git tracks that the checkout lacks is
   * unread, never skipped: every clean checkout would load it.
   * @type {(file: string) => Buffer | null}
   */
  const readCounted = (file) => {
    const result = read(path.join(root, file));
    if (result.kind === "file") return result.buffer;
    if (result.kind === "error") {
      derived.unread.push(`${file} could not be read: ${result.message}`);
    } else if (result.kind === "not-file") {
      derived.unread.push(
        `${file} is not a regular file in ${root}: the harness reads it as an instruction file, ` +
          "so replace what stands at that path with the file"
      );
    } else if (gitTracked.has(file)) {
      derived.unread.push(
        `${file} is tracked by git and missing from the checkout, so its bytes cannot be ` +
          `counted: ${MISSING_REPAIR}`
      );
    } else {
      derived.unread.push(
        `${file} does not exist in ${root}: the auto-loaded set would be derived from nothing`
      );
    }
    return null;
  };

  for (const entry of ENTRIES) {
    if (entry !== ENTRY && !gitTracked.has(entry)) continue;
    const buffer = readCounted(entry);
    if (buffer === null) continue;
    load(
      entry,
      entry === ENTRY ? "the entry file" : "an entry file the harness reads from the project root",
      buffer
    );
  }

  const linked = new Set(links);
  for (const link of [...linked].sort()) {
    if (!RULE_PARENTS.includes(link) && !link.startsWith(RULES_DIR)) continue;
    derived.violations.push(
      `L1: git tracks ${link} as a symbolic link or a submodule, and the harness reads the rules ` +
        "behind it, which git's listing does not show, so the gate cannot count them: replace the " +
        "link with the files it points to"
    );
  }

  const ruleFiles = tracked.filter(
    (file) => file.startsWith(RULES_DIR) && file.endsWith(".md") && !linked.has(file)
  );
  for (const rule of [...ruleFiles].sort()) {
    const buffer = readCounted(rule);
    if (buffer === null) continue;
    const parsed = readRule(buffer.toString("utf8"));
    derived.rules.set(rule, parsed);
    if (parsed.scoped) {
      queue.push({ file: rule, text: buffer.toString("utf8") });
    } else {
      load(rule, UNSCOPED, buffer);
    }
  }

  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    /** @type {string[]} */
    const targets = [];
    derived.imports.set(next.file, targets);
    for (const prefixes of importCandidates(next.text)) {
      for (const candidate of prefixes) {
        const absolute = candidate.startsWith("~/")
          ? path.resolve(homeDir, candidate.slice(2))
          : path.resolve(root, path.dirname(next.file), candidate);
        const relative = path.relative(root, absolute);
        const inside = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
        const target = inside ? relative.split(path.sep).join("/") : absolute;
        const result = read(absolute);
        if (result.kind === "absent" && inside && gitTracked.has(target)) {
          readCounted(target);
          continue;
        }
        if (result.kind === "absent" || result.kind === "not-file") continue;
        if (result.kind === "error") {
          // One refusal per token: its longer prefixes would repeat the same failure.
          derived.unread.push(`${target} could not be read: ${result.message}`);
          break;
        }
        if (!targets.includes(target)) targets.push(target);
        if (!inside) {
          derived.violations.push(
            `A1: ${next.file} imports ${candidate}, which resolves to ${absolute}, outside the ` +
              "repository: no checkout holds it, and the budget cannot count it"
          );
          continue;
        }
        if (!derived.loaded.has(target)) load(target, `imported by ${next.file}`, result.buffer);
      }
    }
  }
  derived.unread = [...new Set(derived.unread)];
  derived.violations = [...new Set(derived.violations)];
  return derived;
}

/**
 * @description The repeated entries of a list, with how many times each appears.
 * @param {readonly string[]} list The list.
 * @returns {[string, number][]} Each repeated entry and its count.
 */
function repeated(list) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const item of list) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1);
}

/**
 * @description M1 and M2: the manifest's lists against the derived set and git's listing.
 * @param {Manifest} manifest The manifest.
 * @param {Map<string, Loaded>} loaded The derived set.
 * @param {ReadonlySet<string>} gitTracked Git's listing.
 * @returns {string[]} The refusals.
 */
function checkLists(manifest, loaded, gitTracked) {
  /** @type {string[]} */
  const violations = [];
  for (const [file, count] of repeated(manifest.tracked)) {
    violations.push(
      `M1: ${file} is listed ${times(count)} in the manifest's tracked list: delete the repeated entry`
    );
  }
  const listed = new Set(manifest.tracked);
  for (const [file, { why }] of [...loaded].sort(([a], [b]) => a.localeCompare(b))) {
    if (listed.has(file)) continue;
    violations.push(
      `M1: ${file} is auto-loaded (${why}) and is not in the manifest's tracked list: list it, ` +
        "or stop loading it"
    );
  }
  for (const file of [...listed].sort()) {
    if (!loaded.has(file)) {
      violations.push(
        `M1: ${file} is in the manifest's tracked list and nothing loads it at session start: ` +
          "delete the entry, or restore its import"
      );
    }
    if (!gitTracked.has(file)) {
      violations.push(
        `M1: ${file} is in the manifest's tracked list and git does not track it: a file every ` +
          "checkout loads is committed, so commit it or move its entry to the local list"
      );
    }
  }
  for (const [file, count] of repeated(manifest.local)) {
    violations.push(
      `M2: ${file} is listed ${times(count)} in the manifest's local list: delete the repeated entry`
    );
  }
  for (const file of [...new Set(manifest.local)].sort()) {
    if (gitTracked.has(file)) {
      violations.push(
        `M2: ${file} is in the manifest's local list and git tracks it: a local file is one git ` +
          "ignores, and a tracked one belongs in the tracked list"
      );
    }
    const auto = loaded.get(file);
    if (auto !== undefined) {
      violations.push(
        `M2: ${file} is in the manifest's local list and is auto-loaded (${auto.why}): the ` +
          "tracked set loads in every checkout, and a local file exists in one"
      );
    }
  }
  return violations;
}

/**
 * @description B1 to B3: the derived bytes against the ceiling and the target.
 * @param {Budget} budget The manifest's budget.
 * @param {number} bytes The derived set's bytes.
 * @returns {string[]} The refusals.
 */
function checkBudget(budget, bytes) {
  /** @type {string[]} */
  const violations = [];
  if (bytes > budget.bytes) {
    violations.push(
      `B1: the auto-loaded instruction context is ${String(bytes)} bytes, above its budget of ` +
        `${String(budget.bytes)}: it grew by ${plural(bytes - budget.bytes, "byte")}. Move a ` +
        "record out of the loaded files, or raise budget.bytes by hand in a visible edit"
    );
  }
  if (budget.bytes - bytes > BUDGET_SLACK) {
    violations.push(
      `B2: budget.bytes is ${String(budget.bytes)}, ${String(budget.bytes - bytes)} bytes above ` +
        `the context's ${String(bytes)}, more than the slack of ${String(BUDGET_SLACK)}: a stale ` +
        `ceiling lets the context grow back unnoticed. Run --write, or lower it to ${String(bytes)}`
    );
  }
  const owed = budget.targetOwedBy;
  if (owed === undefined) {
    if (budget.bytes > budget.target) {
      violations.push(
        `B3: budget.bytes ${String(budget.bytes)} is above the target of ` +
          `${String(budget.target)}, and budget.targetOwedBy names no plan item that brings the ` +
          "context under it: name the item, or bring the context under the target"
      );
    }
  } else if (!PLAN_ITEM.test(owed.trim())) {
    violations.push(
      `B3: budget.targetOwedBy "${owed}" does not start with a plan item id, such as ABC-1: ` +
        "name the item that brings the context under the target"
    );
  } else if (bytes <= budget.target) {
    violations.push(
      `B3: the context, ${String(bytes)} bytes, meets the target of ${String(budget.target)}: ` +
        "delete budget.targetOwedBy, so the target holds as a cap"
    );
  }
  return violations;
}

/**
 * @description R1 to R3 for one record: its rule, its document and its rule's globs.
 * @param {RecordEntry} record The record entry.
 * @param {Derived} derived The derived context, with every tracked rule read.
 * @param {readonly string[]} tracked Git's listing.
 * @returns {{ violations: string[], globs: number, empty: number }} The refusals, and how many
 *   globs the rule has and how many of them an entry names as empty.
 */
function checkRecord(record, derived, tracked) {
  const { rule, document, emptyGlobs } = record;
  /** @type {string[]} */
  const violations = [];
  const gitTracked = new Set(tracked);
  if (!gitTracked.has(document)) {
    violations.push(
      `R2: the record ${document} is not tracked by git: commit it, or correct the record's document`
    );
  }
  const auto = derived.loaded.get(document);
  if (auto !== undefined) {
    violations.push(
      `R2: the record ${document} is auto-loaded (${auto.why}): a record is read as a file, never ` +
        "loaded as instruction content"
    );
  }
  if (!document.endsWith(RECORD_SUFFIX)) {
    violations.push(
      `R2: the record ${document} is not a Markdown file: the record guard reads only a call that ` +
        `names a ${RECORD_SUFFIX} file, so an opening of this record would never count`
    );
  }
  if (!rule.startsWith(RULES_DIR) || !rule.endsWith(".md")) {
    violations.push(
      `R1: the record rule ${rule} is not a Markdown file under ${RULES_DIR}, so the harness ` +
        "never loads it when a governed file is touched"
    );
    return { violations, globs: 0, empty: 0 };
  }
  const parsed = derived.rules.get(rule);
  if (!gitTracked.has(rule) || parsed === undefined) {
    violations.push(
      `R1: the record rule ${rule} is not tracked by git: commit it, or correct the record's rule`
    );
    return { violations, globs: 0, empty: 0 };
  }
  if (!parsed.scoped) {
    violations.push(
      `R1: the record rule ${rule} does not prove it is path-scoped, so it loads in every session ` +
        'instead of when a governed file is touched: open it with "---", "paths:" and one ' +
        '`  - "<glob>"` line per glob, at least one glob other than ** with no comma or brace, ' +
        'then "---"'
    );
  }
  for (const target of derived.imports.get(rule) ?? []) {
    violations.push(
      `R1: the record rule ${rule} imports ${target}: an import in a rule loads at session start ` +
        "whether the rule is path-scoped or not, so name the document as text with no @ before it"
    );
  }
  if (!parsed.body.includes(document)) {
    violations.push(
      `R1: the record rule ${rule} does not name its document ${document}: the rule is what ` +
        "tells a session where the record is"
    );
  }
  if (!parsed.scoped) return { violations, globs: 0, empty: 0 };
  let empty = 0;
  for (const glob of parsed.globs) {
    const matches = tracked.filter((file) => globMatches(glob, file));
    const reason = emptyGlobs[glob];
    if (reason === undefined) {
      if (matches.length === 0) {
        violations.push(
          `R3: the glob "${glob}" of ${rule} matches no tracked file, so the rule never loads for ` +
            "it: correct the glob, or name it in emptyGlobs with the reason it matches nothing today"
        );
      }
      continue;
    }
    if (matches.length > 0) {
      const shown = [...matches].sort().slice(0, SHOWN_MATCHES).join(", ");
      violations.push(
        `R3: emptyGlobs names "${glob}", which matches ${plural(matches.length, "tracked file")} ` +
          `(${shown}): delete it`
      );
      continue;
    }
    if (reason.trim() === "") {
      violations.push(`R3: emptyGlobs gives "${glob}" no reason: say why it matches nothing today`);
      continue;
    }
    empty += 1;
  }
  for (const glob of Object.keys(emptyGlobs).filter((key) => !parsed.globs.includes(key))) {
    violations.push(`R3: emptyGlobs names "${glob}", which ${rule} does not list: delete it`);
  }
  return { violations, globs: parsed.globs.length, empty };
}

/**
 * @description Whether a hook group's matcher lets every required tool through: a list of tool
 *   names that holds each of them, `*`, or no matcher. An event with no tool takes no matcher.
 * @param {unknown} matcher The group's `matcher`, absent when the group has none.
 * @param {readonly string[]} tools The tools the hook must see, none for an event without tools.
 * @returns {boolean} True when the group reaches the hook on every call it must judge.
 */
function covers(matcher, tools) {
  if (matcher === undefined || matcher === "" || matcher === "*") return true;
  if (tools.length === 0 || typeof matcher !== "string") return false;
  const named = matcher.split("|");
  return tools.every((tool) => named.includes(tool));
}

/** @type {(hook: RequiredHook) => string} */
const whereHookRuns = ({ event, tools }) =>
  tools.length === 0
    ? `on ${event}`
    : `on ${event} for ${tools.slice(0, -1).join(", ")} and ${tools.at(-1) ?? ""}`;

/**
 * @description Every entry of the settings' hooks, in any group of the hook's event, whose command
 *   is the hook's command, each with its group: a second copy is held as the first is.
 * @param {Record<string, unknown>} hooks The settings' `hooks` object.
 * @param {RequiredHook} required The hook.
 * @returns {{ group: Record<string, unknown>, entry: Record<string, unknown> }[]} The entries.
 */
function hookEntries(hooks, required) {
  const groups = hooks[required.event];
  const command = commandOf(required);
  /** @type {{ group: Record<string, unknown>, entry: Record<string, unknown> }[]} */
  const found = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!isObject(group)) continue;
    for (const entry of Array.isArray(group.hooks) ? group.hooks : []) {
      if (isObject(entry) && entry.command === command) found.push({ group, entry });
    }
  }
  return found;
}

/**
 * @description W1 over the settings: no `disableAllHooks`, and each required hook run on its
 *   event in a group that reaches it, by entries that hold only the keys its kind allows.
 * @param {Record<string, unknown>} settings The parsed settings, whose `hooks` is an object.
 * @returns {{ violations: string[], wired: number }} The refusals, and how many hooks are wired.
 */
function checkSettings(settings) {
  const hooks = /** @type {Record<string, unknown>} */ (settings.hooks);
  /** @type {string[]} */
  const violations = [];
  const { disableAllHooks } = settings;
  if (disableAllHooks !== undefined && disableAllHooks !== false) {
    violations.push(
      `W1: ${SETTINGS} sets "disableAllHooks": ${JSON.stringify(disableAllHooks)}, which turns ` +
        `every hook off, these included: delete it`
    );
  }
  const { env } = settings;
  for (const [key, why] of Object.entries(ENV_REFUSED)) {
    if (isObject(env) && Object.hasOwn(env, key)) {
      violations.push(`W1: ${SETTINGS} sets "${key}" in its env block, which ${why}: delete it`);
    }
  }
  let wired = 0;
  for (const required of REQUIRED_HOOKS) {
    const found = hookEntries(hooks, required);
    if (!found.some(({ group }) => covers(group.matcher, required.tools))) {
      violations.push(notRunMessage(required));
      continue;
    }
    const problems = found.flatMap(({ group, entry }) => entryProblems(required, group, entry));
    violations.push(...problems);
    if (problems.length === 0) wired += 1;
  }
  return { violations, wired };
}

/**
 * @description The refusal for a required hook no group runs, naming the entry to add.
 * @param {RequiredHook} required The hook.
 * @returns {string} The W1 line.
 */
function notRunMessage(required) {
  const group =
    required.tools.length === 0
      ? "in a group with no matcher"
      : `in a group whose matcher is "${required.tools.join("|")}"`;
  const failure = required.blocking ? `, "onFailure": "block"` : "";
  return (
    `W1: ${SETTINGS} does not run ${labelOf(required)} ${whereHookRuns(required)}: add ` +
    `{"type": "command", "command": "${commandOf(required)}"${failure}} ${group}`
  );
}

/**
 * @description The keys of one entry that runs a required hook, and of its group, held to the
 *   allowlist of the hook's kind, then its values.
 * @param {RequiredHook} required The hook.
 * @param {Record<string, unknown>} group The group that holds the entry.
 * @param {Record<string, unknown>} entry The entry.
 * @returns {string[]} The W1 lines, none when the entry runs the hook as it must.
 */
function entryProblems(required, group, entry) {
  const label = `${labelOf(required)} runs ${whereHookRuns(required)}`;
  const allowed = required.blocking ? ENTRY_KEYS.blocking : ENTRY_KEYS.recording;
  const problems = Object.keys(group)
    .filter((key) => !GROUP_KEYS.includes(key))
    .map(
      (key) =>
        `W1: the group where ${label} holds the key "${key}", which W1 does not read: delete it`
    );
  for (const key of Object.keys(entry).filter((name) => !allowed.includes(name))) {
    const why = Object.hasOwn(KEY_REASONS, key)
      ? KEY_REASONS[/** @type {keyof typeof KEY_REASONS} */ (key)]
      : "W1 does not read, so it cannot tell that the hook still runs as it must";
    problems.push(`W1: ${label} with the key "${key}", which ${why}: delete it`);
  }
  return [
    ...problems,
    ...matcherProblems(required, label, group),
    ...valueProblems(required, label, entry),
  ];
}

/**
 * @description For a hook held to its tools exactly: a group whose matcher names any other tool,
 *   or every tool, runs it on calls where it does nothing.
 * @param {RequiredHook} required The hook.
 * @param {string} label The hook and where it runs, for the message.
 * @param {Record<string, unknown>} group The group that holds the entry.
 * @returns {string[]} The W1 line, or none.
 */
function matcherProblems(required, label, group) {
  const { matcher } = group;
  const named = typeof matcher === "string" && matcher !== "" ? matcher.split("|") : ["*"];
  if (!required.exact || named.every((tool) => required.tools.includes(tool))) return [];
  const where =
    matcher === undefined || matcher === ""
      ? "with no matcher"
      : `whose matcher is ${JSON.stringify(matcher)}`;
  return [
    `W1: ${label} in a group ${where}: it opens a record only on ${required.tools.join(" and ")}, ` +
      `a Bash call never opens one, and a call of any other tool runs it for nothing: ` +
      `set the matcher to "${required.tools.join("|")}"`,
  ];
}

/**
 * @description The values of one entry: its type, its timeout, and `onFailure` on a blocking hook.
 * @param {RequiredHook} required The hook.
 * @param {string} label The hook and where it runs, for the message.
 * @param {Record<string, unknown>} entry The entry.
 * @returns {string[]} The W1 lines.
 */
function valueProblems(required, label, entry) {
  const problems = [];
  const { type, timeout, onFailure } = entry;
  if (type !== "command")
    problems.push(`W1: ${label} with "type": ${JSON.stringify(type)}: set it to "command"`);
  if (timeout !== undefined && !(typeof timeout === "number" && timeout >= HOOK_TIMEOUT_FLOOR)) {
    problems.push(
      `W1: ${label} with a timeout of ${String(timeout)} seconds: a hook the harness kills lets the call through, so set at least ${String(HOOK_TIMEOUT_FLOOR)} or leave it out`
    );
  }
  if (required.blocking && onFailure !== "block") {
    const found =
      onFailure === undefined
        ? `without "onFailure": "block"`
        : `with "onFailure": ${JSON.stringify(onFailure)}`;
    problems.push(
      `W1: ${label} ${found}: a hook the harness cannot start, that exits with a code other than 0 or 2, or that times out lets the call through unless "onFailure" is "block": set it`
    );
  }
  return problems;
}

/**
 * @description Why a file W1 reads, which git tracks, could not be read.
 * @param {string} file The repository-relative file.
 * @param {FileRead} result What the reader returned, anything but a file.
 * @param {string} root The root.
 * @returns {string} The unread message.
 */
function unreadOf(file, result, root) {
  if (result.kind === "error") return `${file} could not be read: ${result.message}`;
  if (result.kind === "not-file") return `${file} is not a regular file in ${root}`;
  return `${file} is tracked by git and missing from the checkout: ${MISSING_REPAIR}`;
}

/**
 * @description W1 over the hook files: each is tracked and in the checkout, and each the harness
 *   runs is executable in git's index and on disk.
 * @param {{ root: string, gitTracked: ReadonlySet<string>, executables: ReadonlySet<string>, read: (absolutePath: string) => FileRead }} input
 *   The root, git's listing, the paths it records as executable, and the reader.
 * @returns {{ violations: string[], unread: string[] }} The refusals and what could not be read.
 */
function checkHookFiles({ root, gitTracked, executables, read }) {
  /** @type {string[]} */
  const violations = [];
  /** @type {string[]} */
  const unread = [];
  for (const file of new Set([...REQUIRED_HOOKS.map((hook) => hook.file), HOOK_MODULE])) {
    if (!gitTracked.has(file)) {
      violations.push(`W1: ${file} is not tracked by git, so no checkout holds it: commit it`);
      continue;
    }
    const result = read(path.join(root, file));
    if (result.kind !== "file") unread.push(unreadOf(file, result, root));
    if (result.kind !== "file" || file === HOOK_MODULE) continue;
    if (!executables.has(file)) {
      violations.push(
        `W1: ${file} is not executable in git's index, so a fresh checkout cannot start it: ` +
          `git update-index --chmod=+x ${file}`
      );
    }
    if (result.mode !== undefined && (result.mode & OWNER_EXECUTE) === 0) {
      violations.push(
        `W1: ${file} is not executable in the checkout, so the harness cannot start it and ` +
          `lets the call through: chmod +x ${file}`
      );
    }
  }
  return { violations, unread };
}

/**
 * @description W1: the hooks that enforce the manifest at run time are tracked, executable and
 *   wired in `.claude/settings.json`.
 * @param {{ root: string, gitTracked: ReadonlySet<string>, executables: ReadonlySet<string>, read: (absolutePath: string) => FileRead }} input
 *   The root, git's listing, the paths it records as executable, and the reader.
 * @returns {Wiring} The refusals, what could not be read, and how many hooks are wired.
 */
function checkWiring(input) {
  const { root, gitTracked, read } = input;
  if (!gitTracked.has(SETTINGS)) {
    const refusal = `W1: ${SETTINGS} is not tracked by git, so no checkout runs the hooks that enforce the manifest: commit it`;
    return { violations: [refusal], unread: [], wired: 0 };
  }
  const result = read(path.join(root, SETTINGS));
  if (result.kind !== "file") {
    return { violations: [], unread: [unreadOf(SETTINGS, result, root)], wired: 0 };
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(result.buffer.toString("utf8"));
  } catch (error) {
    return { violations: [], unread: [`${SETTINGS} is not JSON: ${messageOf(error)}`], wired: 0 };
  }
  if (!isObject(parsed) || !isObject(parsed.hooks)) {
    const unread = `${SETTINGS} holds no hooks object, so the gate cannot tell which hooks run`;
    return { violations: [], unread: [unread], wired: 0 };
  }
  const settings = checkSettings(parsed);
  const files = checkHookFiles(input);
  return {
    violations: [...settings.violations, ...files.violations],
    unread: files.unread,
    wired: settings.wired,
  };
}

/**
 * @description The one-line account of the context.
 * @param {{ files: number, bytes: number, budget: Budget, records: number, globs: number, empty: number, wired: number, violations: number }} counts
 *   What the run measured.
 * @returns {string} The summary line.
 */
function summarize({ files, bytes, budget, records, globs, empty, wired, violations }) {
  const above = budget.bytes - budget.target;
  const owed = budget.targetOwedBy === undefined ? "" : ` owed by ${budget.targetOwedBy}`;
  const target =
    above > 0
      ? `${String(above)} above the target of ${String(budget.target)}${owed}`
      : `within the target of ${String(budget.target)}`;
  return (
    `${plural(files, "auto-loaded file")}, ${String(bytes)} bytes of a budget of ` +
    `${String(budget.bytes)} (${target}); ${plural(records, "record")}, ${plural(globs, "glob")} ` +
    `(${String(empty)} empty by entry); ${String(wired)} of ${String(REQUIRED_HOOKS.length)} hook ` +
    `entries wired; ${plural(violations, "violation")}`
  );
}

/**
 * @description Evaluates the context of a root against its manifest. It touches no file itself:
 *   every read goes through `readFile`, so the suite drives it over an in-memory tree.
 * @param {{ root: string, manifestText: string, tracked: readonly string[], links?: readonly string[], executables?: readonly string[], readFile: (absolutePath: string) => FileRead, homeDir: string }} input
 *   The absolute root, the manifest's text, git's listing, the paths git lists as a symbolic link
 *   or a submodule and those it lists as executable (none when left out), the reader and the home
 *   directory.
 * @returns {Verdict} The verdict.
 */
export function evaluate({
  root,
  manifestText,
  tracked,
  links = [],
  executables = [],
  readFile,
  homeDir,
}) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(manifestText);
  } catch (error) {
    return unreadVerdict([`${MANIFEST} is not JSON: ${messageOf(error)}`]);
  }
  const shape = readManifest(parsed);
  if ("problems" in shape) return unreadVerdict(shape.problems);
  const { manifest } = shape;

  const derived = deriveContext({ root, tracked, links, readFile, homeDir });
  if (derived.unread.length > 0) return unreadVerdict(derived.unread);

  const files = [...derived.loaded.keys()].sort();
  const bytes = [...derived.loaded.values()].reduce((sum, file) => sum + file.bytes, 0);
  const violations = [
    ...derived.violations,
    ...checkLists(manifest, derived.loaded, new Set(tracked)),
    ...checkBudget(manifest.budget, bytes),
  ];
  let globs = 0;
  let empty = 0;
  for (const record of manifest.records) {
    const checked = checkRecord(record, derived, tracked);
    violations.push(...checked.violations);
    globs += checked.globs;
    empty += checked.empty;
  }
  const wiring = checkWiring({
    root,
    gitTracked: new Set(tracked),
    executables: new Set(executables),
    read: readFile,
  });
  if (wiring.unread.length > 0) return unreadVerdict(wiring.unread);
  violations.push(...wiring.violations);
  const summary = summarize({
    files: files.length,
    bytes,
    budget: manifest.budget,
    records: manifest.records.length,
    globs,
    empty,
    wired: wiring.wired,
    violations: violations.length,
  });
  return {
    exitCode: violations.length > 0 ? EXIT.VERDICT : EXIT.CLEAN,
    unread: [],
    violations,
    summary,
    measured: { files, bytes },
  };
}

/**
 * @description Reads a file from disk for `evaluate`, following symbolic links as the harness
 *   does: a missing path, or a name too long for any file to have, is absent, and a directory or
 *   any other non-regular file is not a file.
 * @param {string} absolutePath The file.
 * @returns {FileRead} Its bytes, its absence, or why it could not be read.
 */
function readFromDisk(absolutePath) {
  /** @type {number} */
  let descriptor;
  try {
    // One descriptor serves the kind check and the read, so the path cannot name a different
    // file between the two; O_NONBLOCK keeps the open from waiting on a named pipe.
    descriptor = openSync(absolutePath, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    const code = /** @type {{ code?: unknown }} */ (error).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "ENAMETOOLONG")
      return { kind: "absent" };
    return { kind: "error", message: messageOf(error) };
  }
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) return { kind: "not-file" };
    return { kind: "file", buffer: readFileSync(descriptor), mode: stats.mode };
  } catch (error) {
    return { kind: "error", message: messageOf(error) };
  } finally {
    closeSync(descriptor);
  }
}

/**
 * @description Lists the paths git tracks under a root, and which of them git records as a
 *   symbolic link or a submodule, or as executable.
 * @param {string} root The repository root.
 * @param {number} buffer The bytes the listing may take.
 * @returns {{ files: string[], links: string[], executables: string[] } | { error: string }}
 *   Repository-relative paths, or why not.
 */
function trackedFiles(root, buffer) {
  /** @type {string} */
  let listing;
  try {
    listing = execFileSync("git", ["ls-files", "-z", "--stage"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: buffer,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (/** @type {{ code?: unknown }} */ (error).code === "ENOBUFS") {
      return {
        error: `git ls-files printed more than the listing buffer of ${String(buffer)} bytes in ${root}, so the gate read a cut listing: raise LISTING_BUFFER in ${COMMAND}`,
      };
    }
    return { error: `git ls-files failed in ${root}: ${messageOf(error)}` };
  }
  /** @type {Set<string>} */
  const files = new Set();
  /** @type {Set<string>} */
  const links = new Set();
  /** @type {Set<string>} */
  const executables = new Set();
  for (const record of listing.split("\0").filter((entry) => entry !== "")) {
    const tab = record.indexOf("\t");
    const file = record.slice(tab + 1);
    const mode = record.slice(0, record.indexOf(" "));
    files.add(file);
    if (LINK_MODES.includes(mode)) links.add(file);
    if (mode === EXECUTABLE_MODE) executables.add(file);
  }
  return { files: [...files], links: [...links], executables: [...executables] };
}

/** @type {(verdict: Verdict) => Outcome} */
const toOutcome = (verdict) =>
  outcome(
    verdict.exitCode,
    verdict.unread.length > 0 ? verdict.unread : [...verdict.violations, verdict.summary ?? ""]
  );

/**
 * @description Runs the gate over a root: reads git's listing and the manifest, evaluates, and with
 *   `write` lowers `budget.bytes` to the context's bytes, never raising it.
 * @param {{ root?: string, write?: boolean, listingBuffer?: number }} [input] The root, whether to
 *   lower the budget, and the bytes git's listing may take (the suite lowers it to show the
 *   failure a listing past it gives).
 * @returns {Outcome} The exit code and the messages to print.
 */
export function runGate({ root = REPO_ROOT, write = false, listingBuffer = LISTING_BUFFER } = {}) {
  const listed = trackedFiles(root, listingBuffer);
  if ("error" in listed) return outcome(EXIT.UNREAD, [listed.error]);
  if (listed.files.length === 0) {
    return outcome(EXIT.UNREAD, [
      `git tracks no file in ${root}: a context derived from no file is not clean`,
    ]);
  }
  const manifestPath = path.join(root, MANIFEST);
  /** @type {string} */
  let manifestText;
  try {
    manifestText = readFileSync(manifestPath, "utf8");
  } catch (error) {
    return outcome(EXIT.UNREAD, [`${MANIFEST} could not be read: ${messageOf(error)}`]);
  }
  /** @type {(text: string) => Verdict} */
  const check = (text) =>
    evaluate({
      root,
      manifestText: text,
      tracked: listed.files,
      links: listed.links,
      executables: listed.executables,
      readFile: readFromDisk,
      homeDir: homedir(),
    });
  const verdict = check(manifestText);
  if (!write || verdict.measured === null) return toOutcome(verdict);

  const ceiling = /** @type {Manifest} */ (JSON.parse(manifestText)).budget.bytes;
  const { bytes } = verdict.measured;
  if (bytes > ceiling) {
    return outcome(EXIT.VERDICT, [
      ...verdict.violations,
      "--write never raises budget.bytes: raise it by hand in a visible edit, or move content " +
        "out of the loaded files",
      verdict.summary ?? "",
    ]);
  }
  if (bytes === ceiling) {
    const unchanged = toOutcome(verdict);
    return outcome(unchanged.exitCode, [
      `budget.bytes already equals the context's ${String(bytes)} bytes; nothing to write`,
      ...unchanged.messages,
    ]);
  }
  const figure = /("budget"\s*:\s*\{[^{}]*?"bytes"\s*:\s*)\d+/;
  if (!figure.test(manifestText)) {
    return outcome(EXIT.UNREAD, [
      `${MANIFEST}: budget.bytes is not written as "bytes": <digits> inside "budget", so --write ` +
        "cannot place the new figure: write it that way, or set it by hand",
    ]);
  }
  const lowered = manifestText.replace(figure, `$1${String(bytes)}`);
  try {
    writeFileSync(manifestPath, lowered);
  } catch (error) {
    return outcome(EXIT.UNREAD, [`${MANIFEST} could not be written: ${messageOf(error)}`]);
  }
  const after = toOutcome(check(lowered));
  return outcome(after.exitCode, [
    `lowered budget.bytes from ${String(ceiling)} to ${String(bytes)} in ${MANIFEST}`,
    ...after.messages,
  ]);
}

/**
 * @description Reads the command line: `--write` and `--root <dir>`, each at most once.
 * @param {string[]} argv The arguments after the script.
 * @returns {{ root?: string, write: boolean } | null} The options, or `null` on a usage error.
 */
function parseArguments(argv) {
  /** @type {{ root?: string, write: boolean }} */
  const options = { write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write" && !options.write) {
      options.write = true;
    } else if (argument === "--root" && options.root === undefined) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return null;
      options.root = path.resolve(value);
      index += 1;
    } else {
      return null;
    }
  }
  return options;
}

/**
 * @description Runs the command and prints its messages: on stdout when clean, on stderr
 *   otherwise.
 * @param {string[]} argv The arguments after the script.
 * @returns {number} The exit code.
 */
function main(argv) {
  const options = parseArguments(argv);
  if (options === null) {
    process.stderr.write(`${USAGE}\n`);
    return EXIT.USAGE;
  }
  /** @type {Outcome} */
  let result;
  try {
    result = runGate(options);
  } catch (error) {
    result = outcome(EXIT.UNREAD, [`the gate failed: ${messageOf(error)}`]);
  }
  const stream = result.exitCode === EXIT.CLEAN ? process.stdout : process.stderr;
  for (const message of result.messages) stream.write(`instruction-context-gate: ${message}\n`);
  return result.exitCode;
}

/** True only when this file is the process entry point, so importing its exports runs nothing. */
const entryPoint = process.argv[1];
/** @type {boolean} */
let isEntryPoint;
try {
  isEntryPoint =
    entryPoint !== undefined && realpathSync(entryPoint) === fileURLToPath(import.meta.url);
} catch {
  isEntryPoint = false;
}
if (isEntryPoint) process.exitCode = main(process.argv.slice(2));
