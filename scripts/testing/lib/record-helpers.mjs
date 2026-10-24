// @ts-check
/**
 * @file record-helpers.mjs
 * @description The helpers the committed machine records of `scripts/testing/` and the commands
 *   that write and check them share: the code-unit order their rows are sorted in, the
 *   plain-object test their readers apply to parsed JSON, the Prettier rendering under this
 *   repository's configuration that makes a record's bytes the ones `pnpm format:check` accepts,
 *   the reads of the tree and of git's listing as `Result` values, a command's exit codes, result
 *   and entry-point test, and the tail every record command ends in: write the record, or check it
 *   against the committed one and name the drift. One copy each, so two records cannot drift apart
 *   in how they sort, render, read or report.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

/**
 * @template T
 * @typedef {{ value: T } | { error: string }} Result
 */

/**
 * @typedef {object} CliResult What a command prints and the code it exits with.
 * @property {number} code The exit code.
 * @property {string} output The text to print, each line ending in a newline.
 *
 * @typedef {object} RecordSpec How a record's command names its record in what it prints.
 * @property {string} label The prefix of every line: `ledger`, `dependency-ledger`.
 * @property {string} noun What its messages call the record: `ledger`, `record`.
 * @property {string} command The command that rewrites the record: `pnpm ledger`.
 * @property {string} list The top-level key of the record's rows: `files`, `names`.
 * @property {string} id The key that names a row: `path`, `name`.
 */

/**
 * One run of a record's command, once its record is built. The record travels once, here: the
 * renderer receives it, and the drift reads the same object.
 * @template {Readonly<Record<string, unknown>>} R
 * @typedef {object} RecordRun
 * @property {string} root The repository root, absolute.
 * @property {string} out The record file written or checked, absolute.
 * @property {R} record The record the tree gives.
 * @property {(record: R) => Promise<string>} render Renders a record as the bytes to write or
 *   compare.
 * @property {readonly string[]} lines The lines printed first, already worded.
 * @property {boolean} failing Whether those lines fail the run (problems) or only inform (notes).
 */

/**
 * The exit codes every record command shares: 0 written or current; 1 a verdict (a problem or a
 * drift); 2 a usage error; 3 an input that could not be read in full, which wins over 1.
 */
export const EXIT = Object.freeze({ CLEAN: 0, VERDICT: 1, USAGE: 2, UNREAD: 3 });

/**
 * @description Orders two strings by UTF-16 code unit. `localeCompare` would follow the ICU
 *   collation of the Node that runs it, which folds case and punctuation (`post` before `Post`)
 *   and may change with the ICU version or the locale; `<` is the same on every machine and, for
 *   the ASCII paths and package names git lists here, is byte order.
 * @param {string} left One string.
 * @param {string} right The other.
 * @returns {number} Negative, zero or positive, as `Array.prototype.sort` reads it.
 */
export function byCodeUnit(left, right) {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/**
 * @description Says whether a value is a plain object: what a JSON reader expects where a file
 *   may hold `null`, a number, a string or an array instead.
 * @param {unknown} value Any value.
 * @returns {value is Record<string, unknown>} `true` for an object that is not an array.
 */
export function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @description Renders a value as the JSON text a committed record holds: `JSON.stringify`
 *   formatted by Prettier with the configuration that applies to the record's path in this
 *   repository (the `.prettierrc` and the `.editorconfig`, as the CLI reads them), whatever tree
 *   the record describes, so every record renders under the one set of rules `pnpm format:check`
 *   holds here. It orders nothing: equal values render equal bytes, and the caller owns the order
 *   of every list and key.
 * @param {string} file The record's absolute path in this repository.
 * @param {unknown} value The record.
 * @returns {Promise<string>} The text, ending in a newline.
 */
export async function renderJson(file, value) {
  const config = await prettier.resolveConfig(file, { editorconfig: true });
  return prettier.format(JSON.stringify(value, null, 2), { ...config, parser: "json" });
}

/**
 * @description Words a thrown value.
 * @param {unknown} error What was thrown.
 * @returns {string} Its message.
 */
export function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @description Reads one file of the tree.
 * @param {string} root Absolute repository root.
 * @param {string} file Repository-relative.
 * @returns {Result<string>} Its text, or an error naming the file.
 */
export function readText(root, file) {
  try {
    return { value: readFileSync(path.join(root, file), "utf8") };
  } catch (error) {
    return { error: `${file} could not be read: ${messageOf(error)}` };
  }
}

/**
 * @description Lists the paths git tracks in a repository.
 * @param {string} root The repository root.
 * @returns {Result<string[]>} Repository-relative paths, in git's order.
 */
export function listTrackedFiles(root) {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { value: out.split("\0").filter((file) => file.length > 0) };
  } catch (error) {
    return { error: `git ls-files failed in ${root}: ${messageOf(error)}` };
  }
}

/**
 * @description Names a file in a message: relative to the root when it lies inside it, absolute
 *   otherwise.
 * @param {string} root The repository root, absolute.
 * @param {string} file The file, absolute.
 * @returns {string} The path as the message shows it.
 */
function shownPath(root, file) {
  const relative = path.relative(root, file);
  return relative.startsWith("..") || path.isAbsolute(relative) ? file : relative;
}

/**
 * @description Joins the lines a command prints with the code it exits with; no line prints
 *   nothing.
 * @param {number} code The exit code.
 * @param {readonly string[]} lines The lines, without their newlines.
 * @returns {CliResult} The result.
 */
export function cliResult(code, lines) {
  return { code, output: lines.length === 0 ? "" : `${lines.join("\n")}\n` };
}

/**
 * @description Says whether a module is the process entry point, so a suite's import of a
 *   command's functions runs nothing.
 * @param {string} moduleUrl The module's `import.meta.url`.
 * @returns {boolean} `true` when node was started with that module.
 */
export function isEntryPoint(moduleUrl) {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
}

/**
 * @description Renders a run's record. A configuration Prettier cannot read rejects, and that is an
 *   input that could not be read: an error, never a record written or compared in other bytes.
 * @template {Readonly<Record<string, unknown>>} R
 * @param {RecordSpec} spec How the command names its record.
 * @param {RecordRun<R>} run The run.
 * @returns {Promise<Result<string>>} The bytes, or the line that says why there are none.
 */
async function rendered(spec, run) {
  try {
    return { value: await run.render(run.record) };
  } catch (error) {
    return {
      error: `${spec.label}: unread: the ${spec.noun} could not be rendered: ${messageOf(error)}`,
    };
  }
}

/**
 * @description Write mode: renders the record and writes it, then exits 1 when the run's lines are
 *   problems, so a decision session sees the record and its problems at once. A record that cannot
 *   be rendered or written exits 3.
 * @template {Readonly<Record<string, unknown>>} R
 * @param {RecordSpec} spec How the command names its record.
 * @param {RecordRun<R>} run The run.
 * @param {string} counts What the written record is reported with.
 * @returns {Promise<CliResult>} The result.
 */
export async function writeRecord(spec, run, counts) {
  const text = await rendered(spec, run);
  if ("error" in text) return cliResult(EXIT.UNREAD, [...run.lines, text.error]);
  const shown = shownPath(run.root, run.out);
  try {
    writeFileSync(run.out, text.value);
  } catch (error) {
    const why = messageOf(error);
    return cliResult(EXIT.UNREAD, [
      ...run.lines,
      `${spec.label}: ${shown} could not be written: ${why}`,
    ]);
  }
  const wrote = `${spec.label}: wrote ${shown}: ${counts}`;
  return cliResult(run.failing ? EXIT.VERDICT : EXIT.CLEAN, [...run.lines, wrote]);
}

/**
 * @description Indexes a committed record's rows by the key that names them. The committed file
 *   is whatever the disk holds, so a list that is not one, a row with no name and a name listed
 *   twice are each named rather than read past.
 * @param {unknown} rows The committed record's list of rows.
 * @param {RecordSpec} spec How the record lists its rows.
 * @returns {Result<Map<string, string>>} Each row's name with the row as JSON.
 */
function rowsById(rows, { list, id, noun }) {
  if (!Array.isArray(rows)) return { error: `the committed ${noun}'s ${list} are not a list` };
  /** @type {Map<string, string>} */
  const byId = new Map();
  for (const row of rows) {
    const name = isObject(row) ? row[id] : undefined;
    if (typeof name !== "string") return { error: `a committed row has no ${id}` };
    if (byId.has(name)) return { error: `the committed ${noun} lists ${name} twice` };
    byId.set(name, JSON.stringify(row));
  }
  return { value: byId };
}

/**
 * @description Names what differs between a committed record and the one the tree gives, by
 *   parsing the committed text: the top-level keys, then every other top-level part of the
 *   record the tree gives, compared whole, then each row that is new, gone or changed, in
 *   code-unit order of its name. The parts are read from the record itself, so a part added to it
 *   is compared the day it is added. Never empty: equal content laid out otherwise is named as
 *   such.
 * @param {string} committed The committed file's text, which differs from the rendered one.
 * @param {Readonly<Record<string, unknown>>} current The record the tree gives.
 * @param {RecordSpec} spec How the record lists its rows.
 * @returns {string[]} One line per difference.
 */
function recordDrift(committed, current, spec) {
  const { list, id, noun } = spec;
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(committed);
  } catch (error) {
    return [`the committed ${noun} is not JSON: ${messageOf(error)}`];
  }
  if (!isObject(parsed)) return [`the committed ${noun} is not a JSON object`];
  const was = rowsById(parsed[list], spec);
  if ("error" in was) return [was.error];
  /** @type {string[]} */
  const lines = [];
  if (Object.keys(parsed).join() !== Object.keys(current).join()) {
    lines.push("the top-level keys differ");
  }
  for (const key of Object.keys(current).filter((part) => part !== list)) {
    if (JSON.stringify(parsed[key]) !== JSON.stringify(current[key])) {
      lines.push(`the ${key} differs`);
    }
  }
  const rows = /** @type {ReadonlyArray<Readonly<Record<string, unknown>>>} */ (current[list]);
  const now = new Map(rows.map((row) => [/** @type {string} */ (row[id]), JSON.stringify(row)]));
  for (const name of [...new Set([...was.value.keys(), ...now.keys()])].sort(byCodeUnit)) {
    const before = was.value.get(name);
    const after = now.get(name);
    if (after === undefined) lines.push(`${name}: in the committed ${noun}, not in the tree`);
    else if (before === undefined) lines.push(`${name}: in the tree, not in the committed ${noun}`);
    else if (before !== after) lines.push(`${name}: its row differs`);
  }
  return lines.length > 0 ? lines : ["the content is equal; only its formatting differs"];
}

/**
 * @description `--check`: renders the record and compares its bytes with the committed file's,
 *   names each difference, and exits 1 on a difference or when the run's lines are problems. A
 *   committed file that does not exist is "no committed record"; any other read error, and a record
 *   that cannot be rendered, exits 3 with its own message. The drift reads the run's record, the
 *   one it rendered.
 * @template {Readonly<Record<string, unknown>>} R
 * @param {RecordSpec} spec How the command names its record.
 * @param {RecordRun<R>} run The run.
 * @returns {Promise<CliResult>} The result.
 */
export async function checkRecord(spec, run) {
  const text = await rendered(spec, run);
  if ("error" in text) return cliResult(EXIT.UNREAD, [...run.lines, text.error]);
  const shown = shownPath(run.root, run.out);
  /** @type {string} */
  let committed;
  try {
    committed = readFileSync(run.out, "utf8");
  } catch (error) {
    const why = messageOf(error);
    const missing = isObject(error) && error["code"] === "ENOENT";
    return cliResult(EXIT.UNREAD, [
      ...run.lines,
      missing
        ? `${spec.label}: unread: no committed ${spec.noun} at ${shown} (${why}); run \`${spec.command}\` and commit it`
        : `${spec.label}: unread: ${shown} could not be read: ${why}`,
    ]);
  }
  if (committed === text.value) {
    return run.failing
      ? cliResult(EXIT.VERDICT, run.lines)
      : cliResult(EXIT.CLEAN, [...run.lines, `${spec.label}: ${shown} is current`]);
  }
  return cliResult(EXIT.VERDICT, [
    ...run.lines,
    ...recordDrift(committed, run.record, spec).map((line) => `${spec.label}: drift: ${line}`),
    `${spec.label}: ${shown} is stale; run \`${spec.command}\` and commit the result`,
  ]);
}
