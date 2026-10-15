// @ts-check
/**
 * @file patched-dependencies-gate.mjs
 * @description Fitness check #48, and the monitor that watches every patched dependency until it is
 *   resolved (the owner's rule of 2026-10-15: every patch is monitored all the time until it is
 *   resolved). A patched dependency is a package whose installed files pnpm changes at install time,
 *   through `patchedDependencies` in `pnpm-workspace.yaml` and a file under `patches/`, and each one
 *   exists only by an owner's decision recorded in its own ADR (`docs/security/SECURITY_CANON.md`
 *   §"Patched dependencies"). Its record lives in `scripts/testing/patched-dependencies.json`: the
 *   exact version, the patch file, the upstream pull request, merge commit and release, `resolvedBy`
 *   (the package and the version range whose first stable release ends the patch), the ADR, `since`,
 *   `why` and `removeWhen`, every field required.
 *
 *   TWO MODES, split on purpose.
 *   - `--check`, offline: the consistency half, run by the battery step `patched-deps` and by
 *     fitness #48 in the Dependency Consistency job. Every `patchedDependencies` key names one exact
 *     version and has exactly one record with the same package, version and patch file; every record
 *     is well formed and has its key, its patch file and its ADR on disk; every file under `patches/`
 *     is named by a record. It reads tracked files only: no install, no registry, no API.
 *   - `--resolution`, online: for every record, the registry's versions and publish times of
 *     `resolvedBy.package` (`pnpm view <package> versions time --json`). A STABLE version inside
 *     `resolvedBy.range`, published at or before the instant, makes the patch resolvable: the gate
 *     exits 1 naming the lowest such version, its publish instant and the record's remove-when.
 *     `--remind` then opens one issue per resolvable patch through `gh` (label `patched-dependency`),
 *     comments on it once a day while it stays open (never on the day it opened it), and reopens it
 *     when it was closed while the patch still stands. A second run on the same day therefore opens
 *     no second issue and posts no second comment, which is what makes the workflow's retry safe.
 *     This half runs on a schedule (`patched-dependencies.yml`, every 6 hours), never in
 *     pull-request CI, so an upstream release never blocks unrelated work.
 *
 *   EXIT CODES, the same in every mode: 0 a clean verdict; 1 a verdict (in `--check` an
 *   inconsistency, in `--resolution` at least one resolvable patch); 2 a usage error; 3 an input
 *   could not be read. 3 wins over 1 when both occur, so a run that found a resolvable patch but left
 *   another input unread still asks the operator to look. The scheduled workflow retries only 3, so
 *   a registry or GitHub hiccup and a resolvable patch never share a verdict.
 *
 *   THE WORKSPACE IS READ AS TEXT, through the reader the engines and override-bands gates share
 *   (`workspace-block-reader.mjs`), not through a YAML parser: neither `yaml` nor `js-yaml` resolves
 *   from the repository root, and a gate in the Dependency Consistency job must not need the tree it
 *   measures. A block line the reader cannot read as one flat `key: value` entry is a violation,
 *   never skipped, and a `patchedDependencies` key spelled any way but as a plain column-0 key (a
 *   flow mapping, a quoted or nested key, a second block) is refused, so a patch the reader cannot
 *   see never passes as an absent one.
 *
 *   FAIL-CLOSED, exit 3: an unreadable workspace, records file, `patches/` directory or registry
 *   document, a records file with no `entries` array, a workspace block line or key the text reader
 *   cannot read, a registry document with no versions or no publish times, a record `--resolution`
 *   cannot measure because it is malformed, and a `gh` call that fails, each naming the cause. A
 *   missing `patches/` directory is no patch file, not an unread one. Zero patches in both the
 *   workspace and the records is a clean pass that says so: the state the repository returns to when
 *   its last patch leaves.
 *
 *   RESIDUAL LIMITS, stated rather than implied. (1) `resolvedBy.range` is the comparator subset of
 *   semver (`<`, `<=`, `>`, `>=`, `=` or none, on an exact `X.Y.Z`, joined by spaces and `||`);
 *   `^`, `~`, partial versions and prereleases are refused rather than guessed. (2) The check proves a
 *   record exists and is well formed, never that the patch reproduces the upstream change it names,
 *   which review reads. (3) The resolution half proves a release inside the range is published, not
 *   that it carries the fix; the remove-when names what the move verifies. (4) Between two scheduled
 *   runs, up to 6 hours, a resolvable patch is not yet reported.
 *
 *   Usage: `node scripts/testing/patched-dependencies-gate.mjs --check [--workspace <file>]
 *   [--records <file>] [--root <dir>]` or `--resolution [--remind] [--records <file>]
 *   [--registry <dir>] [--instant <iso>]`. Every input is injectable so the suite drives the rule from
 *   fixtures: `--root` is the directory the records' patch and ADR paths resolve against, and
 *   `--registry` a directory of `pnpm view` documents named like the holds gate's
 *   (`@scope/name` → `_scope_name.json`). With none of them, the inputs are the files beside the
 *   `scripts/` directory this file lives in, the registry and the clock. Exit 0 on a clean verdict,
 *   1 on a violation, 2 on a usage error, 3 on an unreadable input.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readTopLevelBlock } from "./workspace-block-reader.mjs";

const GATE = "patched-dependencies-gate";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const KEY = "patchedDependencies";
const PATCHES_DIR = "patches";
const LABEL = "patched-dependency";
const LABEL_COLOR = "d93f0b";
const UNKNOWN = "—";
/** The exit codes, one per outcome; the scheduled workflow retries only `EXIT_UNREAD`. */
const EXIT_CLEAN = 0;
const EXIT_VERDICT = 1;
const EXIT_USAGE = 2;
const EXIT_UNREAD = 3;
const USAGE =
  "usage: node scripts/testing/patched-dependencies-gate.mjs --check [--workspace <file>] " +
  "[--records <file>] [--root <dir>] | --resolution [--remind] [--records <file>] " +
  "[--registry <dir>] [--instant <iso>]";

/**
 * One flat entry line of the block: a double-quoted, single-quoted or plain key, then a value quoted
 * the same three ways; the override-bands gate reads its `overrides:` block with the same shape.
 */
const ENTRY =
  /^\s+(?:"([^"]+)"|'([^']+)'|([^"'#\s][^:]*?))\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*(?:#.*)?$/;
/** A key that names one exact version; the package may be scoped, so the version follows the last `@`. */
const EXACT_KEY = /^(?:@[^@/\s]+\/)?[^@/\s]+@\d+\.\d+\.\d+$/;
/** The only opener the reader can read: the key at column 0, then nothing but a comment. */
const PLAIN_OPENER = new RegExp(`^${KEY}:\\s*(?:#.*)?$`);
/** Any non-comment line that keys `patchedDependencies`, however it is spelled or indented. */
const ANY_OPENER = new RegExp(`^\\s*["']?${KEY}["']?\\s*:`);
const EXACT = /^(\d+)\.(\d+)\.(\d+)$/;
const COMPARATOR = /^(<=|>=|<|>|=)?(\d+)\.(\d+)\.(\d+)$/;
const SHA = /^[0-9a-f]{40}$/;
const HTTPS = /^https:\/\/\S+$/;
const PATCH_PATH = new RegExp(`^${PATCHES_DIR}/[^/]+\\.patch$`);
const ADR_PATH = /^docs\/technical\/ADR-\d{4}-[^/]+\.md$/;

/**
 * @typedef {[number, number, number]} Triple
 * @typedef {"<" | "<=" | ">" | ">=" | "="} Operator
 * @typedef {{ op: Operator, parts: Triple }} Comparator
 * @typedef {Comparator[][]} Range One comparator set per `||` alternative.
 * @typedef {{ package: string, version: string, patch: string,
 *   upstream: { pr: string, commit: string, release: string },
 *   resolvedBy: { package: string, range: string }, adr: string, since: string, why: string,
 *   removeWhen: string }} PatchRecord
 * @typedef {{ record: PatchRecord, id: string, range: Range }} Parsed
 * @typedef {{ parsed: Parsed[], problems: string[] }} Records
 * @typedef {{ key: string, value: string }} WorkspaceEntry
 * @typedef {{ lines: string[], violations: string[], unread: string[], summary: string }} Verdict
 *   `violations` are the verdict (exit 1); `unread` names every input that could not be read
 *   (exit 3), kept apart so the two never share an exit code.
 * @typedef {{ parsed: Parsed, version: string, published: string }} Resolvable
 * @typedef {{ number: number, title: string, state: string, created: string }} Issue
 * @typedef {{ mode: "check" | "resolution", remind: boolean, workspace: string, records: string,
 *   root: string, registry: string | null, instant: number }} Options
 */

/**
 * @param {unknown} value
 * @returns {value is string} True for a string holding something besides whitespace.
 */
function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>} The value when it is a plain object, otherwise an empty one.
 */
function fieldsOf(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * A `YYYY-MM-DD` date that round-trips: V8 reads `2026-02-30` as March 2.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function day(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

/**
 * @param {unknown} error
 * @returns {string} The error's message, or the value itself as text.
 */
function reason(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {number} count
 * @returns {string} "dependency" or "dependencies", agreeing with the count.
 */
function dependencies(count) {
  return count === 1 ? "dependency" : "dependencies";
}

/**
 * @param {string} version
 * @returns {Triple | null} The three numbers of an exact stable version; null for anything else,
 *   prereleases and build metadata included.
 */
function triple(version) {
  const hit = EXACT.exec(version);
  return hit === null ? null : [Number(hit[1]), Number(hit[2]), Number(hit[3])];
}

/**
 * @param {Triple} left
 * @param {Triple} right
 * @returns {number} Negative when `left` precedes `right`.
 */
function compare(left, right) {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

/**
 * Parses the comparator subset of a semver range. Anything outside it is refused, so a range the
 * gate would misread never decides whether a patch is resolvable.
 *
 * @param {string} range
 * @returns {Range | null} One comparator set per `||` alternative, or null when the range does not
 *   parse.
 */
function parseRange(range) {
  /** @type {Range} */
  const sets = [];
  for (const alternative of range.split("||")) {
    const tokens = alternative
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0);
    if (tokens.length === 0) return null;
    /** @type {Comparator[]} */
    const set = [];
    for (const token of tokens) {
      const hit = COMPARATOR.exec(token);
      if (hit === null) return null;
      const op = /** @type {Operator} */ (hit[1] ?? "=");
      set.push({ op, parts: [Number(hit[2]), Number(hit[3]), Number(hit[4])] });
    }
    sets.push(set);
  }
  return sets;
}

/**
 * @param {Range} range
 * @param {Triple} version
 * @returns {boolean} True when the version satisfies every comparator of one alternative.
 */
function satisfies(range, version) {
  return range.some((set) =>
    set.every(({ op, parts }) => {
      const order = compare(version, parts);
      if (op === "<") return order < 0;
      if (op === "<=") return order <= 0;
      if (op === ">") return order > 0;
      if (op === ">=") return order >= 0;
      return order === 0;
    })
  );
}

/**
 * @param {string} file
 * @returns {boolean} True when the path names a regular file.
 */
function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Validates one record and names every field it lacks or holds in the wrong shape.
 *
 * @param {unknown} raw
 * @param {number} index
 * @returns {{ parsed: Parsed } | { problem: string }}
 */
function validateRecord(raw, index) {
  const fields = fieldsOf(raw);
  const upstream = fieldsOf(fields.upstream);
  const resolvedBy = fieldsOf(fields.resolvedBy);
  /** @type {[string, boolean][]} */
  const shape = [
    ["package", text(fields.package)],
    ["version", typeof fields.version === "string" && EXACT.test(fields.version)],
    ["patch", typeof fields.patch === "string" && PATCH_PATH.test(fields.patch)],
    ["upstream.pr", typeof upstream.pr === "string" && HTTPS.test(upstream.pr)],
    ["upstream.commit", typeof upstream.commit === "string" && SHA.test(upstream.commit)],
    ["upstream.release", typeof upstream.release === "string" && HTTPS.test(upstream.release)],
    ["resolvedBy.package", text(resolvedBy.package)],
    ["resolvedBy.range", text(resolvedBy.range)],
    ["adr", typeof fields.adr === "string" && ADR_PATH.test(fields.adr)],
    ["since", day(fields.since)],
    ["why", text(fields.why)],
    ["removeWhen", text(fields.removeWhen)],
  ];
  const label =
    text(fields.package) && text(fields.version)
      ? `${fields.package}@${fields.version}`
      : `entry ${String(index)}`;
  const malformed = shape.filter(([, ok]) => !ok).map(([name]) => name);
  if (malformed.length > 0) {
    return {
      problem:
        `the record ${label} lacks or misshapes ${malformed.join(", ")}: every field is required ` +
        `(an exact X.Y.Z version, a patch under ${PATCHES_DIR}/, https URLs, a 40-hex merge ` +
        `commit, an ADR under docs/technical/, a YYYY-MM-DD since)`,
    };
  }
  const record = /** @type {PatchRecord} */ (/** @type {unknown} */ (fields));
  const range = parseRange(record.resolvedBy.range);
  if (range === null) {
    return {
      problem:
        `the record ${label} declares resolvedBy.range "${record.resolvedBy.range}", which does ` +
        `not parse: write comparators (<, <=, >, >=, = or none) on exact X.Y.Z versions, joined ` +
        `by spaces and ||; ^, ~, partial versions and prereleases are refused`,
    };
  }
  return { parsed: { record, id: label, range } };
}

/**
 * Reads and validates the records file.
 *
 * @param {string} file
 * @returns {Records | { error: string }}
 */
function readRecords(file) {
  /** @type {unknown} */
  let document;
  try {
    document = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { error: `${file} could not be read, so no patch was measured: ${reason(error)}` };
  }
  const entries = fieldsOf(document).entries;
  if (!Array.isArray(entries)) {
    return { error: `${file} holds no \`entries\` array, so no patch was measured` };
  }
  /** @type {Parsed[]} */
  const parsed = [];
  /** @type {string[]} */
  const problems = [];
  for (const [index, raw] of entries.entries()) {
    const result = validateRecord(raw, index);
    if ("problem" in result) {
      problems.push(result.problem);
    } else if (parsed.some((other) => other.id === result.parsed.id)) {
      problems.push(`${result.parsed.id} is recorded twice; one record per patch`);
    } else {
      parsed.push(result.parsed);
    }
  }
  return { parsed, problems };
}

/**
 * Reads the `patchedDependencies:` block of the workspace manifest as text. A block line the reader
 * cannot read is `unread`, not a violation: the patch it may hold was never measured.
 *
 * @param {string} file
 * @returns {{ entries: WorkspaceEntry[], problems: string[], unread: string[] } | { error: string }}
 */
function readWorkspace(file) {
  /** @type {string} */
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch (error) {
    return { error: `${file} could not be read, so no patch was measured: ${reason(error)}` };
  }
  const keyed = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("#") && ANY_OPENER.test(line));
  if (keyed.length > 1 || keyed.some((line) => !PLAIN_OPENER.test(line))) {
    return {
      error:
        `${file} keys \`${KEY}\` ${String(keyed.length)} time(s), and not only as one plain ` +
        `column-0 \`${KEY}:\` block: a flow mapping, a quoted or nested key or a second block is ` +
        `invisible to the text reader, so a patch written that way would pass as an absent one`,
    };
  }
  /** @type {WorkspaceEntry[]} */
  const entries = [];
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const unread = [];
  for (const line of readTopLevelBlock(source, KEY) ?? []) {
    const hit = ENTRY.exec(line);
    const key = hit === null ? undefined : (hit[1] ?? hit[2] ?? hit[3]);
    const value = hit === null ? undefined : (hit[4] ?? hit[5] ?? hit[6]);
    if (key === undefined || value === undefined) {
      unread.push(
        `${file}: the \`${KEY}\` line "${line.trim()}" is not one flat key: value entry, so it ` +
          `cannot be matched to a record`
      );
    } else if (entries.some((entry) => entry.key === key)) {
      problems.push(`${file}: the \`${KEY}\` key ${key} appears twice`);
    } else {
      entries.push({ key, value });
    }
  }
  return { entries, problems, unread };
}

/**
 * The file names under `patches/`. A missing directory holds no patch file, the state the
 * repository returns to when its last patch leaves; any other failure is an unread input.
 *
 * @param {string} root
 * @returns {{ files: string[] } | { error: string }}
 */
function readPatchesDir(root) {
  const dir = path.join(root, PATCHES_DIR);
  try {
    return { files: readdirSync(dir) };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { files: [] };
    return {
      error: `${dir} could not be read, so its files were not matched to records: ${reason(error)}`,
    };
  }
}

/**
 * The consistency half: workspace keys, records, patch files and ADRs agree.
 *
 * @param {Options} options
 * @returns {Verdict}
 */
function check(options) {
  /** @type {string[]} */
  const lines = [];
  const records = readRecords(options.records);
  if ("error" in records) return { lines, violations: [], unread: [records.error], summary: "" };
  const workspace = readWorkspace(options.workspace);
  if ("error" in workspace) {
    return { lines, violations: [], unread: [workspace.error], summary: "" };
  }
  const violations = [...records.problems, ...workspace.problems];
  const unread = [...workspace.unread];

  const byId = new Map(records.parsed.map((parsed) => [parsed.id, parsed.record]));
  for (const { key, value } of workspace.entries) {
    if (!EXACT_KEY.test(key)) {
      violations.push(
        `the \`${KEY}\` key ${key} names no exact version: a patch is keyed <package>@<X.Y.Z>, ` +
          `so pnpm refuses the move past that version while the key stands (ADR-0037)`
      );
      continue;
    }
    const record = byId.get(key);
    if (record === undefined) {
      violations.push(
        `${key} is patched in ${options.workspace} but has no well-formed record in ` +
          `${options.records}: a patch exists only with its record and its ADR`
      );
    } else if (value !== record.patch) {
      violations.push(
        `${key} is patched with ${value} in ${options.workspace}, but its record names ${record.patch}`
      );
    }
  }

  const keys = new Set(workspace.entries.map((entry) => entry.key));
  for (const { record, id } of records.parsed) {
    /** @type {string[]} */
    const found = [];
    if (!keys.has(id)) {
      found.push(`${id} is recorded but has no \`${KEY}\` entry in ${options.workspace}`);
    }
    if (!isFile(path.join(options.root, record.patch))) {
      found.push(`${id}: its patch file ${record.patch} does not exist under ${options.root}`);
    }
    if (!isFile(path.join(options.root, record.adr))) {
      found.push(`${id}: its ADR ${record.adr} does not exist under ${options.root}`);
    }
    violations.push(...found);
    lines.push(`${id}\tpatch\t${found.length === 0 ? "consistent" : "INCONSISTENT"}`);
  }

  const patches = readPatchesDir(options.root);
  if ("error" in patches) unread.push(patches.error);
  for (const name of "files" in patches ? patches.files : []) {
    const file = `${PATCHES_DIR}/${name}`;
    if (!records.parsed.some(({ record }) => record.patch === file)) {
      violations.push(
        `${file} is named by no record: a patch file leaves with its record and its key`
      );
    }
  }

  const consistent = lines.filter((line) => line.endsWith("\tconsistent")).length;
  const empty =
    records.parsed.length === 0 &&
    workspace.entries.length === 0 &&
    violations.length === 0 &&
    unread.length === 0;
  const summary = empty
    ? `0 patched dependencies: none in ${KEY}, none recorded, no file under ${PATCHES_DIR}/ (a clean pass)`
    : `${String(lines.length)} patched ${dependencies(lines.length)} checked against ${KEY}, ` +
      `${PATCHES_DIR}/ and the ADRs: ${String(consistent)} consistent, ` +
      `${String(violations.length)} violation(s)` +
      (unread.length > 0 ? `, ${String(unread.length)} input(s) unread` : "");
  return { lines, violations, unread, summary };
}

/**
 * @param {string} name
 * @returns {string} The registry fixture file name, `@scope/name` → `_scope_name.json`.
 */
function registryFileName(name) {
  return `${name.replaceAll("@", "_").replaceAll("/", "_")}.json`;
}

/**
 * The versions and publish times of one package: from `--registry` when given, else from
 * `pnpm view`. A document with no versions or no publish times is refused rather than read as a
 * package with nothing published.
 *
 * @param {string} name
 * @param {string | null} registry
 * @returns {{ versions: string[], time: Record<string, unknown> }}
 */
function registryDocument(name, registry) {
  const raw =
    registry === null
      ? execFileSync("pnpm", ["view", name, "versions", "time", "--json"], {
          cwd: ROOT,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        })
      : readFileSync(path.join(registry, registryFileName(name)), "utf8");
  const document = fieldsOf(JSON.parse(raw));
  const listed = typeof document.versions === "string" ? [document.versions] : document.versions;
  if (
    !Array.isArray(listed) ||
    listed.length === 0 ||
    !listed.every((v) => typeof v === "string")
  ) {
    throw new Error(`the registry document of ${name} lists no versions`);
  }
  if (Object.keys(fieldsOf(document.time)).length === 0) {
    throw new Error(`the registry document of ${name} carries no publish times`);
  }
  return { versions: /** @type {string[]} */ (listed), time: fieldsOf(document.time) };
}

/**
 * The resolution half: for each record, is a stable release inside `resolvedBy.range` published?
 *
 * @param {Options} options
 * @returns {{ verdict: Verdict, resolvable: Resolvable[] }}
 */
function resolution(options) {
  /** @type {string[]} */
  const lines = [];
  /** @type {Resolvable[]} */
  const resolvable = [];
  const records = readRecords(options.records);
  if ("error" in records) {
    return { verdict: { lines, violations: [], unread: [records.error], summary: "" }, resolvable };
  }
  /** @type {string[]} */
  const violations = [];
  // A malformed record cannot be measured, so here it is an unread input: exit 1 in this mode means
  // only that a patch is resolvable. `--check`, fitness #48, reports it as the violation it is.
  const unread = records.problems.map((problem) => `${problem}; its resolution was not measured`);
  for (const parsed of records.parsed) {
    const { record, id, range } = parsed;
    /** @type {{ versions: string[], time: Record<string, unknown> }} */
    let document;
    try {
      document = registryDocument(record.resolvedBy.package, options.registry);
    } catch (error) {
      unread.push(
        `${id}: the registry of ${record.resolvedBy.package} could not be read, so its ` +
          `resolution was not measured: ${reason(error)}`
      );
      lines.push(`${id}\tpatch\tunmeasured`);
      continue;
    }
    // A listed version with no parseable publish time is counted as published: an undated release
    // must not hide a resolvable patch.
    const published = document.versions
      .map((version) => ({ version, parts: triple(version), at: document.time[version] }))
      .filter(
        (entry) =>
          entry.parts !== null &&
          !(typeof entry.at === "string" && Date.parse(entry.at) > options.instant)
      )
      .sort((a, b) => compare(/** @type {Triple} */ (a.parts), /** @type {Triple} */ (b.parts)));
    const latest = published.at(-1)?.version ?? UNKNOWN;
    const first = published.find((entry) => satisfies(range, /** @type {Triple} */ (entry.parts)));
    if (first === undefined) {
      lines.push(`${id}\tpatch\tunresolved (latest ${latest})`);
      continue;
    }
    const resolving =
      record.resolvedBy.package === record.package
        ? first.version
        : `${record.resolvedBy.package}@${first.version}`;
    const at = typeof first.at === "string" ? first.at : "at an unknown instant";
    lines.push(`${id}\tpatch\tresolvable: ${resolving} published ${at}`);
    violations.push(`${id} is resolvable by ${resolving} (published ${at}): ${record.removeWhen}`);
    resolvable.push({ parsed, version: resolving, published: at });
  }
  const count = records.parsed.length;
  const summary =
    count === 0
      ? "0 patched dependencies recorded: nothing to resolve"
      : `${String(count)} patched ${dependencies(count)} measured against the registry: ` +
        `${String(resolvable.length)} resolvable, ` +
        `${String(lines.filter((line) => line.includes("\tunresolved")).length)} unresolved`;
  return { verdict: { lines, violations, unread, summary }, resolvable };
}

/**
 * Runs `gh` and returns its standard output; a failing call throws with its standard error.
 *
 * @param {string[]} args
 * @returns {string}
 */
function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * The issues carrying the label, open and closed. A full page is refused: an issue past it could
 * be duplicated.
 *
 * @returns {Issue[]}
 */
function listIssues() {
  const page = JSON.parse(
    gh(["api", `repos/{owner}/{repo}/issues?labels=${LABEL}&state=all&per_page=100`])
  );
  if (!Array.isArray(page) || page.length === 100) {
    throw new Error(`listing the ${LABEL} issues returned no list, or a full page`);
  }
  return page
    .map((issue) => fieldsOf(issue))
    .filter((issue) => issue.pull_request === undefined)
    .map((issue) => ({
      number: Number(issue.number),
      title: String(issue.title),
      state: String(issue.state),
      created: typeof issue.created_at === "string" ? issue.created_at : "",
    }));
}

/**
 * The comment bodies an issue received on or after the start of `today`. An answer that is not a
 * list is refused rather than read as no comment, which would post a second one the same day.
 *
 * @param {number} number
 * @param {string} today
 * @returns {string[]}
 */
function commentsSince(number, today) {
  const endpoint = `repos/{owner}/{repo}/issues/${String(number)}/comments`;
  const page = JSON.parse(gh(["api", `${endpoint}?since=${today}T00:00:00Z&per_page=100`]));
  if (!Array.isArray(page)) {
    throw new Error(`listing the comments of #${String(number)} returned no list`);
  }
  return page.map((comment) => String(fieldsOf(comment).body));
}

/**
 * Opens one issue per resolvable patch, comments on it once a day while it stays open, and reopens
 * it when it was closed while the patch still stands. An issue opened on `today` gets no comment
 * that day, so a re-run after a failure midway repeats nothing it already did.
 *
 * @param {Resolvable[]} resolvable
 * @param {string} today `YYYY-MM-DD`, the day of the instant.
 * @param {string[]} log Receives one line per completed action, so a call that fails midway still
 *   reports what it did before it.
 * @returns {void}
 */
function remind(resolvable, today, log) {
  const issues = listIssues();
  let labelled = false;
  for (const { parsed, version, published } of resolvable) {
    const { record, id } = parsed;
    const title = `Patched dependency resolvable: ${id} → ${version}`;
    const facts =
      `${id} is patched (\`${record.patch}\`) until ${record.resolvedBy.package} publishes a ` +
      `version in \`${record.resolvedBy.range}\`; ${version} was published ${published}.`;
    const issue = issues.find((candidate) => candidate.title === title);
    if (issue === undefined) {
      if (!labelled) {
        const description = "A patched dependency whose resolving release is published";
        gh([
          "label",
          "create",
          LABEL,
          "--color",
          LABEL_COLOR,
          "--description",
          description,
          "--force",
        ]);
        labelled = true;
      }
      const body =
        `${facts}\n\nRemove-when: ${record.removeWhen}\n\nADR: \`${record.adr}\`. Upstream: ` +
        `${record.upstream.pr} (merge commit \`${record.upstream.commit}\`), release ` +
        `${record.upstream.release}. Record: \`scripts/testing/patched-dependencies.json\`.\n\n` +
        `Opened by scripts/testing/patched-dependencies-gate.mjs (workflow patched-dependencies.yml, ` +
        `every 6 hours). It comments here once a day while the patch stands, and reopens this issue ` +
        `if it is closed before the change that removes the patch lands.`;
      gh(["issue", "create", "--title", title, "--body", body, "--label", LABEL]);
      log.push(`open: ${title}`);
      continue;
    }
    const body = `Still resolvable on ${today}: ${facts}`;
    if (issue.state !== "open") {
      gh(["issue", "reopen", String(issue.number), "--comment", body]);
      log.push(`reopen #${String(issue.number)}: ${title}`);
    } else if (issue.created.slice(0, 10) === today) {
      log.push(`skip #${String(issue.number)}: ${title} (opened on ${today})`);
    } else if (commentsSince(issue.number, today).includes(body)) {
      log.push(`skip #${String(issue.number)}: ${title} (already commented on ${today})`);
    } else {
      gh(["issue", "comment", String(issue.number), "--body", body]);
      log.push(`comment #${String(issue.number)}: ${title}`);
    }
  }
}

/**
 * @param {string[]} argv
 * @returns {{ options: Options } | { usage: string }}
 */
function parseOptions(argv) {
  /** @type {Record<string, unknown>} */
  let values;
  try {
    values = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        check: { type: "boolean" },
        resolution: { type: "boolean" },
        remind: { type: "boolean" },
        workspace: { type: "string" },
        records: { type: "string" },
        root: { type: "string" },
        registry: { type: "string" },
        instant: { type: "string" },
      },
    }).values;
  } catch (error) {
    return { usage: reason(error) };
  }
  if (Boolean(values.check) === Boolean(values.resolution)) {
    return { usage: "give exactly one of --check and --resolution" };
  }
  const given = (/** @type {string} */ flag) => values[flag] !== undefined;
  if (values.check && ["remind", "registry", "instant"].some(given)) {
    return { usage: "--remind, --registry and --instant belong to --resolution" };
  }
  if (values.resolution && ["workspace", "root"].some(given)) {
    return { usage: "--workspace and --root belong to --check" };
  }
  const instant = given("instant") ? Date.parse(String(values.instant)) : Date.now();
  if (Number.isNaN(instant))
    return { usage: `--instant ${String(values.instant)} is not an instant` };
  return {
    options: {
      mode: values.check ? "check" : "resolution",
      remind: Boolean(values.remind),
      workspace: given("workspace")
        ? String(values.workspace)
        : path.join(ROOT, "pnpm-workspace.yaml"),
      records: given("records")
        ? String(values.records)
        : path.join(ROOT, "scripts", "testing", "patched-dependencies.json"),
      root: given("root") ? String(values.root) : ROOT,
      registry: given("registry") ? String(values.registry) : null,
      instant,
    },
  };
}

/**
 * An unread input wins over a verdict: the run that found a resolvable patch but left another
 * input unread is judged incomplete, so the operator looks instead of trusting a partial answer.
 *
 * @param {Verdict} verdict
 * @returns {number}
 */
function exitCode(verdict) {
  if (verdict.unread.length > 0) return EXIT_UNREAD;
  return verdict.violations.length > 0 ? EXIT_VERDICT : EXIT_CLEAN;
}

/**
 * @param {string[]} argv
 * @returns {number} The process exit code.
 */
function main(argv) {
  const parsed = parseOptions(argv);
  if ("usage" in parsed) {
    process.stderr.write(`${GATE}: ${parsed.usage}\n${USAGE}\n`);
    return EXIT_USAGE;
  }
  const { options } = parsed;
  /** @type {Verdict} */
  let verdict;
  /** @type {string[]} */
  const log = [];
  try {
    if (options.mode === "check") {
      verdict = check(options);
    } else {
      const measured = resolution(options);
      verdict = measured.verdict;
      if (options.remind && measured.resolvable.length > 0) {
        const today = new Date(options.instant).toISOString().slice(0, 10);
        try {
          remind(measured.resolvable, today, log);
        } catch (error) {
          verdict.unread.push(`GitHub: ${reason(error)}`);
        }
      }
    }
  } catch (error) {
    process.stderr.write(
      `${GATE}: an input could not be read, so nothing was measured: ${reason(error)}\n`
    );
    return EXIT_UNREAD;
  }
  for (const line of verdict.lines) process.stdout.write(`${line}\n`);
  for (const entry of log) process.stdout.write(`remind: ${entry}\n`);
  if (verdict.summary.length > 0) process.stdout.write(`\n${verdict.summary}\n`);
  for (const violation of verdict.violations) process.stderr.write(`${GATE}: ${violation}\n`);
  for (const input of verdict.unread) process.stderr.write(`${GATE}: ${input}\n`);
  return exitCode(verdict);
}

process.exitCode = main(process.argv.slice(2));
