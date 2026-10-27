// @ts-check
/**
 * @file hard-probe.mjs
 * @description The hard probe's command: does a test block still pass once the code it imports does
 *   nothing? It checks out the source tree's commit in ONE detached worktree, installs it offline
 *   from the lockfile, builds the ledger and its import graph there, and for each planned block guts
 *   the test's subject (the first-party production modules its imports and their re-exports reach,
 *   with the modules that define the base classes their classes extend, read by the ledger's own
 *   resolution and graph, the listed test infrastructure aside), runs that block alone, restores
 *   the worktree with `git checkout -- .` and requires an empty porcelain before the next probe.
 *   Every runner leads a process group of its own, killed whole on a timeout and swept when the
 *   runner ends, so no worker outlives its probe. The source tree is only read, and written once:
 *   `probes.json`. The worktree sits at `tree/` inside a directory the run creates for itself under
 *   `--worktree-root` with `mkdtemp` (a unique name, open to its owner alone), so no path another
 *   user could plant beforehand is ever written to; it goes when the run ends, by `git worktree
 *   remove --force` and then that directory's removal, on failure and on a signal too. The plan,
 *   the commands, the outcomes and the record are `lib/hard-probe-core.mjs`'s; the gutting is
 *   `lib/hard-probe-gut.mjs`'s.
 *
 *   SIGNALS. Run as a command, SIGINT, SIGTERM and SIGHUP stop the run: the first kills every
 *   runner's process group and lets the run unwind, which restores the worktree after the probe in
 *   flight and then removes it; the removal runs in a process group of its own, so neither a second
 *   signal to the tool nor a terminal's signal to its group cuts it short. The tool then exits
 *   128 plus the signal's number, and writes no `probes.json`.
 *
 *   EXIT CODES, the ledger's: 0 written; 1 `--only` names no block of the ledger; 2 a usage error;
 *   3 an input or the environment failed: the source tree is not clean (its one exception is the
 *   tool's own `--out`, so an earlier run's uncommitted `probes.json` refuses nothing), `--out`
 *   names a tracked file that is no `probes.json` of this tool, `--worktree-root` lies inside the
 *   source tree or cannot hold a private directory, git, the install or a runner could not run, the
 *   ledger or its import graph could not be built, the ledger names a block its classifier does not
 *   find, a probe left the worktree dirty, or `probes.json` could not be written; 128 plus a
 *   signal's number, a run that signal stopped. Nothing is written on any exit but 0:
 *   `probes.json` is written last, after the worktree is removed, so a failed or stopped run leaves
 *   an earlier one as it was.
 *
 *   Usage: `node scripts/testing/hard-probe.mjs [--root <dir>] [--worktree-root <dir>]
 *   [--out <file>] [--seed <n>] [--limit <n> | --only <path::title>]`, or `pnpm hard-probe`. The
 *   environment the runners need (the test database's URL, for one) is the caller's: it passes
 *   through unchanged.
 * @layer infrastructure
 */
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fchmodSync,
  mkdtempSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { constants, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { classifyFile } from "@packages/eslint-plugin-testing";
import { SOURCE_EXTENSIONS } from "./lib/dependency-sites.mjs";
import { classBases, exportSources, gutModule, reExportSpecifiers } from "./lib/hard-probe-gut.mjs";
import {
  OUTCOME,
  hashes,
  isProbesRecord,
  outcomeOf,
  pendingTempPath,
  planProbes,
  probeCommand,
  probesRecord,
  renderProbes,
  subjectModules,
  summaryLines,
  testNamePattern,
} from "./lib/hard-probe-core.mjs";
import { blockRows, shapeOf } from "./lib/ledger-core.mjs";
import { importClosure, moduleReferences } from "./lib/ledger-imports.mjs";
import {
  EXIT,
  byCodeUnit,
  cliResult,
  isEntryPoint,
  listTrackedFiles,
  messageOf,
  readText,
} from "./lib/record-helpers.mjs";
import { build, importGraph, workspacePackages } from "./ledger.mjs";
import { WORKSPACE_FILE } from "./workspace-block-reader.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT_FILE = "probes.json";
const DEFAULT_SEED = 23;
const MAX_SEED = 0xffff_ffff;
const INSTALL = Object.freeze(["install", "--offline", "--frozen-lockfile"]);
/** How long one install may take, one block's run and the worktree's removal, in milliseconds. */
const INSTALL_TIMEOUT = 30 * 60_000;
const PROBE_TIMEOUT = 10 * 60_000;
const REMOVE_TIMEOUT = 10 * 60_000;
const USAGE =
  "usage: node scripts/testing/hard-probe.mjs [--root <dir>] [--worktree-root <dir>] [--out <file>] [--seed <n>] [--limit <n> | --only <path::title>]";
/** Git without the variables a hook exports, which would point it at another repository. */
const GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
);
/** The signals that stop a run. */
const STOP_SIGNALS = /** @type {const} */ (["SIGINT", "SIGTERM", "SIGHUP"]);

/**
 * @template T
 * @typedef {import("./lib/record-helpers.mjs").Result<T>} Result
 */

/**
 * @typedef {import("./lib/record-helpers.mjs").CliResult} CliResult
 * @typedef {import("./lib/hard-probe-core.mjs").ProbeLedger} ProbeLedger
 * @typedef {import("./lib/hard-probe-core.mjs").PlannedProbe} PlannedProbe
 * @typedef {import("./lib/hard-probe-core.mjs").ProbeEntry} ProbeEntry
 * @typedef {import("./lib/ledger-imports.mjs").ImportContext} ImportContext
 * @typedef {typeof STOP_SIGNALS[number]} StopSignal
 *
 * @typedef {object} Ran What one process did.
 * @property {number | null} status Its exit code, `null` when it was killed or never started.
 * @property {string} stdout
 * @property {string} stderr
 * @property {boolean} timedOut
 * @property {string | null} spawnError Why it could not start, else `null`.
 *
 * @typedef {object} ProbeSeams What the suite replaces; the command passes none. Git is never
 *   replaced.
 * @property {(command: string, args: readonly string[], cwd: string, timeout: number) => Ran | Promise<Ran>} [exec]
 *   Runs the install and each block.
 * @property {(root: string) => Result<ProbeLedger>} [buildLedger] Replaces the ledger's build.
 * @property {(line: string) => void} [progress] Where each step is reported, stderr by default.
 * @property {(fd: number, text: string) => void} [writeText] Writes `probes.json`'s text into its
 *   open temp file; the suite replaces it to fail a write after the file is open.
 *
 * @typedef {object} Options
 * @property {string} root Absolute.
 * @property {string} worktreeRoot Absolute.
 * @property {string} out Absolute.
 * @property {number} seed
 * @property {number | null} limit
 * @property {string | null} only
 *
 * @typedef {object} PendingWrite `probes.json`, rendered and not yet written.
 * @property {string} out Absolute.
 * @property {string} text
 * @property {string[]} lines The summary printed once it is written.
 * @property {string} wrote The line that says it was written.
 *
 * @typedef {{ result: CliResult } | { pending: PendingWrite }} Finished What a run hands back: its
 *   result, or the `probes.json` it is ready to write, which only `main` writes.
 *
 * @typedef {object} Created What a run has created, each `null` until it exists.
 * @property {string | null} parent The private directory under `--worktree-root`.
 * @property {string | null} target The worktree, `tree/` inside it.
 *
 * @typedef {object} Probing What every probe of one run reads.
 * @property {string} target The probe worktree, absolute.
 * @property {ImportContext} context
 * @property {ReadonlyMap<string, readonly string[]>} imports Each module's run-time imports.
 * @property {NonNullable<ProbeSeams["exec"]>} exec
 */

/** A failure that ends the run with its code. */
class Stop extends Error {
  /**
   * @param {number} code
   * @param {string} line
   */
  constructor(code, line) {
    super(line);
    this.code = code;
  }
}

/** The leaders of the process groups of the runners alive now. */
const RUNNING = new Set();

/** The signal that stopped the run, once one has; a later one changes nothing. */
const STOPPED = { signal: /** @type {StopSignal | null} */ (null) };

/**
 * @description Kills every process of a group: the runner, which leads it, and the workers it
 *   started, which inherit it. A group that is already gone is no failure.
 * @param {number | undefined} leader The pid of the process the group was started with.
 * @returns {void}
 */
function killGroup(leader) {
  if (leader === undefined) return;
  try {
    process.kill(-leader, "SIGKILL");
  } catch {
    // ESRCH: no process of the group is left.
  }
}

/**
 * @description Stops the run on its first signal: records it and kills every runner's process
 *   group, so the run unwinds to its cleanup. A second signal does nothing.
 * @param {StopSignal} signal
 * @returns {void}
 */
function stopOn(signal) {
  if (STOPPED.signal !== null) return;
  STOPPED.signal = signal;
  for (const leader of RUNNING) killGroup(leader);
}

/**
 * @description The exit code of a run a signal stopped: 128 plus the signal's number.
 * @param {StopSignal} signal
 * @returns {number}
 */
function stoppedCode(signal) {
  return 128 + constants.signals[signal];
}

/**
 * @description Ends the run here when a signal has stopped it.
 * @returns {void}
 * @throws {Stop} With the signal's exit code.
 */
function unlessStopped() {
  if (STOPPED.signal !== null) {
    throw new Stop(stoppedCode(STOPPED.signal), `hard-probe: stopped by ${STOPPED.signal}`);
  }
}

/**
 * @description Runs one process to its end as the leader of a process group of its own and reports
 *   what it did. A run past its timeout has its whole group killed and is reported as timed out;
 *   when the process ends on its own, what is left of its group is killed too.
 * @param {{ command: string, args: readonly string[], cwd: string, timeout: number, env: NodeJS.ProcessEnv, stoppable: boolean }} run
 *   `stoppable` lists the group among the runners a signal kills.
 * @returns {Promise<Ran>}
 */
function runGroup({ command, args, cwd, timeout, env, stoppable }) {
  return new Promise((resolve) => {
    /** @type {Buffer[]} */
    const stdout = [];
    /** @type {Buffer[]} */
    const stderr = [];
    let timedOut = false;
    let settled = false;
    const child = spawn(command, [...args], {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (stoppable && child.pid !== undefined) RUNNING.add(child.pid);
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, timeout);
    /** @type {(status: number | null, spawnError: string | null) => void} */
    const settle = (status, spawnError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      RUNNING.delete(child.pid);
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        spawnError,
      });
    };
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      if (child.pid === undefined) settle(null, messageOf(error));
    });
    child.on("exit", () => killGroup(child.pid));
    child.on("close", (status) => settle(status, null));
  });
}

/**
 * @description Runs one process to its end, with the caller's environment, as the leader of a
 *   process group of its own, and reports what it did. A run past its timeout has its whole group
 *   killed and is reported as timed out; when the process ends on its own, what is left of its group
 *   is killed too, so no worker it started outlives it; a signal that stops the run kills it too. A
 *   command that cannot start is reported by why. Once a run is stopped, nothing more starts.
 * @param {string} command
 * @param {readonly string[]} args
 * @param {string} cwd
 * @param {number} timeout In milliseconds.
 * @returns {Promise<Ran>}
 */
export function runTool(command, args, cwd, timeout) {
  if (STOPPED.signal !== null) {
    return Promise.resolve({
      status: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      spawnError: null,
    });
  }
  return runGroup({ command, args, cwd, timeout, env: process.env, stoppable: true });
}

/**
 * @description Runs git in a directory.
 * @param {string} cwd
 * @param {readonly string[]} args
 * @returns {string} What it printed.
 * @throws {Stop} Exit 3 when git fails.
 */
function git(cwd, args) {
  try {
    return execFileSync("git", [...args], {
      cwd,
      encoding: "utf8",
      env: GIT_ENV,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Stop(
      EXIT.UNREAD,
      `hard-probe: unread: git ${args.join(" ")} failed: ${messageOf(error)}`
    );
  }
}

/**
 * @description Lists what `git status` reports in a tree, untracked files one by one, each path
 *   relative to the repository's root as porcelain writes it; a rename or a copy is listed by its
 *   new path.
 * @param {string} cwd
 * @returns {string[]} The paths, sorted.
 */
function dirtyPaths(cwd) {
  const fields = git(cwd, ["status", "--porcelain", "-z", "--untracked-files=all"]).split("\0");
  /** @type {string[]} */
  const paths = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? "";
    if (field.length <= 3) continue;
    paths.push(field.slice(3));
    if (/[RC]/.test(field.slice(0, 2))) index += 1;
  }
  return paths.sort();
}

/**
 * @description Places a path inside a repository, resolving the symbolic links of the part of it
 *   that exists.
 * @param {string} top The repository's root, as `git rev-parse --show-toplevel` prints it.
 * @param {string} file Absolute; it need not exist.
 * @returns {string | null} The path relative to `top`, `""` for `top` itself, or `null` when it
 *   lies outside.
 */
function insideRepository(top, file) {
  /** @type {string[]} */
  const missing = [];
  let existing = file;
  while (!existsSync(existing) && path.dirname(existing) !== existing) {
    missing.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  const relative = path.relative(top, path.join(realpathSync(existing), ...missing));
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}

/**
 * @description Reads the command line. Every flag takes a value; an unknown flag, a positional
 *   argument, an empty value, a seed that is no unsigned 32-bit integer, a limit that is no positive
 *   integer and `--limit` with `--only` are usage errors.
 * @param {readonly string[]} argv
 * @returns {Result<Options>}
 */
function parseArguments(argv) {
  /** @type {Record<string, string | undefined>} */
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: Object.fromEntries(
        ["root", "worktree-root", "out", "seed", "limit", "only"].map((flag) => [
          flag,
          { type: /** @type {const} */ ("string") },
        ])
      ),
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    return { error: messageOf(error) };
  }
  for (const [flag, value] of Object.entries(values)) {
    if (value === "") return { error: `--${flag} takes a non-empty value` };
  }
  const seed = values["seed"] === undefined ? DEFAULT_SEED : Number(values["seed"]);
  if (!/^\d+$/.test(values["seed"] ?? "0") || seed > MAX_SEED) {
    return { error: `--seed takes an integer from 0 to ${MAX_SEED}` };
  }
  const limit = values["limit"] === undefined ? null : Number(values["limit"]);
  if (limit !== null && (!/^\d+$/.test(values["limit"] ?? "") || limit < 1)) {
    return { error: "--limit takes a positive integer" };
  }
  const only = values["only"] ?? null;
  if (limit !== null && only !== null)
    return { error: "--only probes one block and takes no --limit" };
  const root = path.resolve(values["root"] ?? ROOT);
  return {
    value: {
      root,
      worktreeRoot: path.resolve(values["worktree-root"] ?? tmpdir()),
      out: path.resolve(values["out"] ?? path.join(root, OUT_FILE)),
      seed,
      limit,
      only,
    },
  };
}

/**
 * @description Finds a block's titles: the classifier reads the test, and `blockRows` gives its
 *   blocks the ledger's ids in the same order.
 * @param {string} file Repository-relative.
 * @param {string} text
 * @param {string} id
 * @returns {{ describe: string[], title: string }}
 * @throws {Stop} Exit 3 when the classifier finds no block with that id.
 */
function titlesOf(file, text, id) {
  const classification = classifyFile(text, file);
  const index = blockRows(classification).findIndex((row) => row.id === id);
  const found = classification.blocks[index];
  if (found === undefined) {
    throw new Stop(
      EXIT.UNREAD,
      `hard-probe: unread: the ledger names ${id}, which the classifier does not find`
    );
  }
  return { describe: found.describe, title: found.title };
}

/**
 * @description Adds to an import closure every module a module of it re-exports from, any module
 *   and not only an `index`, resolved as the ledger resolves a specifier, until nothing is added.
 * @param {readonly string[]} closure
 * @param {Probing} probing
 * @returns {string[]} Sorted.
 */
function withReExports(closure, { target, context }) {
  const reached = new Set(closure);
  const pending = [...closure];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const module = next;
    if (!SOURCE_EXTENSIONS.some((extension) => module.endsWith(extension))) continue;
    const text = readText(target, module);
    if ("error" in text) continue;
    const specifiers = reExportSpecifiers(text.value, module);
    if (specifiers.length === 0) continue;
    const reExports = specifiers.map((specifier) => `export * from ${JSON.stringify(specifier)};`);
    /** @type {string[]} */
    let found = [];
    try {
      found = moduleReferences(module, reExports.join("\n"), context).imports;
    } catch {
      found = [];
    }
    for (const file of found.filter((candidate) => !reached.has(candidate))) {
      reached.add(file);
      pending.push(file);
    }
  }
  return [...reached].sort(byCodeUnit);
}

/**
 * @description Adds to an import closure the module that defines each base class a class of a
 *   subject module extends, any class of it, exported or not, and then that module's own bases, up
 *   every chain. A base is resolved through the module's own import of it, as the ledger resolves a
 *   specifier, and followed through the re-exports of the module the import lands on to the
 *   module that declares it; a base from a third-party package is not followed, and nothing is
 *   followed out of a module that is not a subject (test code or the listed test infrastructure),
 *   though such a module is still added for `subjectModules` to leave out.
 * @param {readonly string[]} closure
 * @param {Probing} probing
 * @returns {string[]} Sorted.
 */
function withBaseClasses(closure, { target, context }) {
  /** @param {string} file @returns {string | null} */
  const textOf = (file) => {
    const text = readText(target, file);
    return "error" in text ? null : text.value;
  };
  /** @type {(from: string, specifier: string) => string | null} */
  const resolve = (from, specifier) => {
    try {
      const [found] = moduleReferences(
        from,
        `import ${JSON.stringify(specifier)};\n`,
        context
      ).imports;
      return found ?? null;
    } catch {
      return null;
    }
  };
  /** @type {(module: string, name: string, seen: Set<string>) => string | null} */
  const definer = (module, name, seen) => {
    const key = `${module}\0${name}`;
    const text = seen.has(key) ? null : textOf(module);
    seen.add(key);
    if (text === null) return null;
    const { local, sources } = exportSources(text, module, name);
    if (local) return module;
    for (const from of sources) {
      const next = resolve(module, from.specifier);
      const found = next === null ? null : definer(next, from.name, seen);
      if (found !== null) return found;
    }
    return null;
  };
  const reached = new Set(closure);
  const pending = subjectModules(closure);
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const module = next;
    const text = textOf(module);
    if (text === null) continue;
    for (const base of classBases(text, module)) {
      const landed = resolve(module, base.specifier);
      const defining = landed === null ? null : definer(landed, base.name, new Set());
      if (defining === null || reached.has(defining)) continue;
      reached.add(defining);
      if (subjectModules([defining]).length > 0) pending.push(defining);
    }
  }
  return [...reached].sort(byCodeUnit);
}

/**
 * @description Probes one block in the worktree and restores it.
 * @param {PlannedProbe} probe
 * @param {Probing} probing
 * @returns {Promise<ProbeEntry>}
 * @throws {Stop} Exit 3 when a runner cannot start or the worktree stays dirty.
 */
async function probeOne(probe, probing) {
  const { target, imports, exec } = probing;
  const read = (/** @type {string} */ file) => {
    const text = readText(target, file);
    if ("error" in text) throw new Stop(EXIT.UNREAD, `hard-probe: unread: ${text.error}`);
    return text.value;
  };
  const testText = read(probe.path);
  /** @param {string} file */
  const carries = (file) => ["runner", "helper"].includes(shapeOf(file) ?? "");
  const closure = withBaseClasses(
    withReExports(importClosure(probe.path, imports, carries), probing),
    probing
  );
  const subject = subjectModules(closure);
  const texts = subject.map((file) => ({ path: file, text: read(file) }));
  const base = {
    id: probe.id,
    blockClass: probe.blockClass,
    sample: probe.sample,
    subject,
    ...hashes(testText, texts),
  };
  /** @type {(reason: string, partial: string[]) => ProbeEntry} */
  const unrun = (reason, partial) => ({
    ...base,
    command: null,
    gutted: 0,
    outcome: OUTCOME.LOAD_ERROR,
    partial,
    reason,
  });
  if (probe.runner === null) return unrun("no-collector", []);
  if (subject.length === 0) return unrun("no-subject", []);
  const { describe, title } = titlesOf(probe.path, testText, probe.id);
  const command = probeCommand(probe.path, probe.runner, testNamePattern(describe, title));
  let gutted = 0;
  /** @type {string[]} */
  const partial = [];
  /** @type {ProbeEntry} */
  let entry;
  try {
    for (const { path: file, text } of texts) {
      const result = gutModule(text, file);
      partial.push(...result.ungutted.map((name) => `${file}: ${name}`));
      if (result.gutted.length === 0) continue;
      writeFileSync(path.join(target, file), result.text);
      gutted += result.gutted.length;
    }
    partial.sort(byCodeUnit);
    if (gutted === 0) {
      entry = unrun("nothing-gutted", partial);
    } else {
      const [tool = "", ...args] = command.argv;
      const ran = await exec(tool, args, path.join(target, command.cwd), PROBE_TIMEOUT);
      if (ran.spawnError !== null) {
        throw new Stop(EXIT.UNREAD, `hard-probe: unread: ${tool} could not run: ${ran.spawnError}`);
      }
      const verdict = ran.timedOut
        ? { outcome: OUTCOME.LOAD_ERROR, reason: "timeout" }
        : outcomeOf(command, ran.stdout);
      entry = {
        ...base,
        command: { argv: command.argv, cwd: command.cwd },
        gutted,
        partial,
        ...verdict,
      };
    }
  } finally {
    git(target, ["checkout", "--", "."]);
  }
  const dirty = dirtyPaths(target);
  if (dirty.length > 0) {
    throw new Stop(
      EXIT.UNREAD,
      `hard-probe: unread: the probe worktree is not clean after probing ${probe.id}: ${dirty.join(", ")}`
    );
  }
  return entry;
}

/**
 * @description Builds the ledger of the probe worktree, its overlay applied; its notes and refused
 *   overlay entries do not change which blocks it holds, so they are not read here.
 * @param {string} root
 * @returns {Result<ProbeLedger>}
 */
function ledgerOf(root) {
  const built = build(root);
  return "error" in built ? built : { value: built.value.ledger };
}

/**
 * @description Reads what every probe of the run needs from the probe worktree: the import context,
 *   and the run-time imports of every tracked module, from the ledger's import graph.
 * @param {string} target
 * @param {NonNullable<ProbeSeams["exec"]>} exec
 * @param {(line: string) => void} progress
 * @returns {Probing}
 * @throws {Stop} Exit 3 when the listing, the workspace or the graph cannot be read.
 */
function probingIn(target, exec, progress) {
  const tracked = listTrackedFiles(target);
  if ("error" in tracked) throw new Stop(EXIT.UNREAD, `hard-probe: unread: ${tracked.error}`);
  const workspace = readText(target, WORKSPACE_FILE);
  if ("error" in workspace) throw new Stop(EXIT.UNREAD, `hard-probe: unread: ${workspace.error}`);
  const packages = workspacePackages(target, workspace.value, tracked.value);
  if ("error" in packages) throw new Stop(EXIT.UNREAD, `hard-probe: unread: ${packages.error}`);
  const context = { tracked: new Set(tracked.value), packages: packages.value };
  const helpers = tracked.value.filter((file) =>
    ["runner", "helper"].includes(shapeOf(file) ?? "")
  );
  const graph = importGraph(target, tracked.value, context, helpers);
  if ("error" in graph) throw new Stop(EXIT.UNREAD, `hard-probe: unread: ${graph.error}`);
  if (graph.value.notes.length > 0) {
    progress(
      `hard-probe: note: ${graph.value.notes.length} modules' references could not be read; ` +
        "a test's closure stops at them"
    );
  }
  return { target, context, imports: graph.value.imports, exec };
}

/**
 * @description Runs the probes once the worktree exists: installs it, builds its ledger and its
 *   import graph, plans and probes, then renders `probes.json` and hands it back unwritten, so it is
 *   written only once the worktree is gone. It stops at the first step a signal reaches.
 * @param {Options} options
 * @param {{ target: string, sha: string }} worktree
 * @param {ProbeSeams} seams
 * @returns {Promise<Finished>}
 * @throws {Stop} Exit 3 on any input or environment failure, or the signal's code once stopped.
 */
async function probeIn(options, { target, sha }, seams) {
  const exec = seams.exec ?? runTool;
  const progress = seams.progress ?? ((line) => process.stderr.write(`${line}\n`));
  progress(`hard-probe: worktree ${target} at ${sha}`);
  const installed = await exec("pnpm", INSTALL, target, INSTALL_TIMEOUT);
  unlessStopped();
  if (installed.status !== 0 || installed.spawnError !== null) {
    const tail = installed.stderr.trim().split("\n").slice(-5).join(" | ");
    const why =
      installed.spawnError ??
      (installed.timedOut
        ? `timed out after ${INSTALL_TIMEOUT} ms`
        : `exit ${installed.status}: ${tail}`);
    throw new Stop(EXIT.UNREAD, `hard-probe: unread: pnpm ${INSTALL.join(" ")} failed: ${why}`);
  }
  const installDirt = dirtyPaths(target);
  if (installDirt.length > 0) {
    throw new Stop(
      EXIT.UNREAD,
      `hard-probe: unread: the install changed tracked files: ${installDirt.join(", ")}`
    );
  }
  const ledger = (seams.buildLedger ?? ledgerOf)(target);
  if ("error" in ledger) throw new Stop(EXIT.UNREAD, `hard-probe: unread: ${ledger.error}`);
  const planOptions = { seed: options.seed, limit: options.limit, only: options.only };
  const plan = planProbes(ledger.value, planOptions);
  if ("error" in plan) return { result: cliResult(EXIT.VERDICT, [`hard-probe: ${plan.error}`]) };
  const { probes, pool } = plan.value;
  if (options.only !== null) {
    progress(`hard-probe: 1 probe planned: only ${options.only}`);
  } else {
    const behavioural = probes.filter((probe) => probe.sample === "behavioural").length;
    progress(
      `hard-probe: ${probes.length} ${probes.length === 1 ? "probe" : "probes"} planned: ` +
        `${probes.length - behavioural} targeted, ${behavioural} behavioural of a population of ${pool}`
    );
  }
  unlessStopped();
  const probing = probingIn(target, exec, progress);
  /** @type {ProbeEntry[]} */
  const entries = [];
  for (const [index, probe] of probes.entries()) {
    unlessStopped();
    const entry = await probeOne(probe, probing);
    unlessStopped();
    entries.push(entry);
    const reason = entry.reason === null ? "" : ` (${entry.reason})`;
    progress(`hard-probe: [${index + 1}/${probes.length}] ${probe.id}: ${entry.outcome}${reason}`);
  }
  const record = probesRecord({ sha, options: planOptions, entries });
  const text = await renderProbes(record);
  unlessStopped();
  return {
    pending: {
      out: options.out,
      text,
      lines: summaryLines(record),
      wrote: `hard-probe: wrote ${options.out}: ${entries.length} probes of ${sha}`,
    },
  };
}

/**
 * @description Writes the `probes.json` a run handed back without ever truncating an earlier one:
 *   the text goes to a temp file beside the target, created exclusively under a name carrying the
 *   pid and a random suffix, so two runs never share it, and is then renamed onto the target. The
 *   target is `--out`, or, when `--out` exists, the file its symbolic links resolve to, so a link
 *   stays a link; the temp file takes an existing target's mode before the text is written, so the
 *   rename keeps it. On any failure the temp file this run created is removed, the target is left as
 *   it was, and the run exits 3; the summary and the `wrote` line are printed only once the rename
 *   is done. A temp file a SIGKILL leaves inside the source tree is an untracked file no ignore rule
 *   matches (`pendingTempPath`), so the next run refuses the dirty tree and names it, which is the
 *   loud outcome wanted.
 * @param {PendingWrite} pending
 * @param {(fd: number, text: string) => void} writeText Writes the text into the open temp file.
 * @returns {CliResult}
 */
function writePending({ out, text, lines, wrote }, writeText) {
  const suffix = `${process.pid}.${randomBytes(6).toString("hex")}`;
  /** @type {{ target: string, mode: number | null }} */
  const existing = { target: out, mode: null };
  let temp = "";
  let created = false;
  try {
    if (existsSync(out)) {
      existing.target = realpathSync(out);
      existing.mode = statSync(existing.target).mode & 0o7777;
    }
    temp = pendingTempPath(existing.target, suffix);
    const fd = openSync(temp, "wx");
    created = true;
    try {
      if (existing.mode !== null) fchmodSync(fd, existing.mode);
      writeText(fd, text);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, existing.target);
  } catch (error) {
    if (created) rmSync(temp, { force: true });
    return cliResult(EXIT.UNREAD, [
      `hard-probe: unread: ${out} could not be written: ${messageOf(error)}`,
    ]);
  }
  return cliResult(EXIT.CLEAN, [...lines, wrote]);
}

/**
 * @description Removes the probe worktree in a process group of its own, which no signal the run
 *   receives reaches.
 * @param {string} root
 * @param {string} target
 * @returns {Promise<string | null>} Why the removal failed, or `null`.
 */
async function removeWorktree(root, target) {
  const removed = await runGroup({
    command: "git",
    args: ["worktree", "remove", "--force", target],
    cwd: root,
    timeout: REMOVE_TIMEOUT,
    env: GIT_ENV,
    stoppable: false,
  });
  if (removed.status === 0) return null;
  const why = removed.spawnError ?? removed.stderr.trim();
  return `hard-probe: unread: git worktree remove --force ${target} failed: ${why}`;
}

/**
 * @description Removes what a run created: the worktree, then the private directory that held it.
 *   A worktree git could not remove leaves that directory in place, so the registration git keeps
 *   still points at something to inspect.
 * @param {string} root
 * @param {Created} created
 * @returns {Promise<string | null>} Why a removal failed, or `null`.
 */
async function removeCreated(root, created) {
  const failed = created.target === null ? null : await removeWorktree(root, created.target);
  if (failed !== null || created.parent === null) return failed;
  try {
    rmSync(created.parent, { recursive: true, force: true });
    return null;
  } catch (error) {
    return `hard-probe: unread: ${created.parent} could not be removed: ${messageOf(error)}`;
  }
}

/**
 * @description The command line, as a function: refuse what the run may not touch, create the
 *   worktree, probe in it, and remove it whatever happened, a signal included. `probes.json` is
 *   written last, and only when the worktree and its directory were removed and no signal stopped
 *   the run, so a run that exits non-zero leaves an earlier `probes.json` as it was.
 * @param {readonly string[]} argv The arguments after the script path.
 * @param {ProbeSeams} [seams] Replacements for the suite; the command passes none.
 * @returns {Promise<CliResult>} The text to print and the exit code.
 */
export async function main(argv, seams = {}) {
  const parsed = parseArguments(argv);
  if ("error" in parsed) return cliResult(EXIT.USAGE, [`hard-probe: ${parsed.error}`, USAGE]);
  const options = parsed.value;
  /** @type {Created} */
  const created = { parent: null, target: null };
  /** @type {Finished} */
  let finished;
  try {
    finished = await probeRun(options, seams, created);
  } catch (error) {
    finished = {
      result:
        error instanceof Stop
          ? cliResult(error.code, [error.message])
          : cliResult(EXIT.UNREAD, [`hard-probe: unread: the run failed: ${messageOf(error)}`]),
    };
  }
  const removal = await removeCreated(options.root, created);
  if (STOPPED.signal !== null) {
    const lines = [`hard-probe: stopped by ${STOPPED.signal}`];
    return cliResult(stoppedCode(STOPPED.signal), removal === null ? lines : [...lines, removal]);
  }
  if (removal !== null) {
    const done =
      "result" in finished
        ? finished.result.output
        : cliResult(EXIT.UNREAD, finished.pending.lines).output;
    return { code: EXIT.UNREAD, output: done + cliResult(EXIT.UNREAD, [removal]).output };
  }
  if ("result" in finished) return finished.result;
  return writePending(finished.pending, seams.writeText ?? ((fd, text) => writeFileSync(fd, text)));
}

/**
 * @description Refuses a `--worktree-root` inside the source tree, an `--out` that names a tracked
 *   file which is no `probes.json` of this tool, or a dirty source tree (the tool's own `--out`
 *   aside), then creates a private directory under `--worktree-root`, the worktree at its `tree/`,
 *   and probes in it. The caller removes what `created` names, whatever this returns or throws.
 * @param {Options} options
 * @param {ProbeSeams} seams
 * @param {Created} created Each part set once it exists.
 * @returns {Promise<Finished>} A refusal's result, or what `probeIn` hands back.
 * @throws {Stop} Exit 3 on any input or environment failure.
 */
async function probeRun(options, seams, created) {
  const top = git(options.root, ["rev-parse", "--show-toplevel"]).trim();
  if (insideRepository(top, options.worktreeRoot) !== null) {
    return {
      result: cliResult(EXIT.UNREAD, [
        `hard-probe: refused: --worktree-root ${options.worktreeRoot} lies inside the source tree`,
      ]),
    };
  }
  const own = insideRepository(top, options.out);
  if (own !== null && git(options.root, ["ls-files", "--", own]).trim() !== "") {
    const text = readText(top, own);
    if ("error" in text || !isProbesRecord(text.value)) {
      return {
        result: cliResult(EXIT.UNREAD, [
          `hard-probe: refused: --out names ${own}, a tracked file that is no probes.json of this tool`,
        ]),
      };
    }
  }
  const dirty = dirtyPaths(options.root).filter((file) => file !== own);
  if (dirty.length > 0) {
    return {
      result: cliResult(EXIT.UNREAD, [
        `hard-probe: refused: the source tree is not clean: ${dirty.join(", ")}`,
      ]),
    };
  }
  const sha = git(options.root, ["rev-parse", "HEAD"]).trim();
  unlessStopped();
  try {
    created.parent = mkdtempSync(path.join(options.worktreeRoot, "hard-probe-"));
  } catch (error) {
    throw new Stop(
      EXIT.UNREAD,
      `hard-probe: unread: --worktree-root ${options.worktreeRoot} cannot hold a private directory: ${messageOf(error)}`
    );
  }
  const target = path.join(created.parent, "tree");
  git(options.root, ["worktree", "add", "--detach", target, sha]);
  created.target = target;
  return probeIn(options, { target, sha }, seams);
}

if (isEntryPoint(import.meta.url)) {
  for (const signal of STOP_SIGNALS) process.on(signal, () => stopOn(signal));
  const { code, output } = await main(process.argv.slice(2));
  // Exit from the write's callback rather than by draining the event loop: a natural exit closes
  // the signal handles first, and a signal in that window would kill the process by its default
  // action instead of reaching the handler above.
  (code === EXIT.CLEAN ? process.stdout : process.stderr).write(output, () => process.exit(code));
}
