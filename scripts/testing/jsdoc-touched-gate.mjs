// @ts-check
/**
 * @file jsdoc-touched-gate.mjs
 * @description The gate behind `pnpm check:jsdoc`: every in-scope source file a change adds or
 *   modifies ends with ZERO violations of the method-level JSDoc rules in `eslint.jsdoc.config.ts`,
 *   the whole file and not only its edited lines. A file the change does not touch is never read, so
 *   there is no repository-wide baseline and no suppressions file: the backlog shrinks as the plans
 *   touch files, and `--all` lists what is left for the reconciliation at the end of the plan.
 *
 *   The scope is the config's own: a path is in scope when the config does not ignore it and its
 *   rules for that path include a `jsdoc/` rule, so this script restates no glob.
 *
 *   Modes, one per run:
 *   - default: the files added or modified (`--diff-filter=AM`, a rename counted as an addition)
 *     between the merge base of the base ref and HEAD; the base ref is `--base <ref>`, else
 *     `JSDOC_BASE_REF`, else `origin/main`. Each file is read from the working tree;
 *   - `--staged`: the staged files, each read from the index, so one the working tree has since
 *     deleted is still read;
 *   - `<file>...`: exactly the files named, as lint-staged passes them; a name that resolves
 *     outside the repository is refused, never skipped;
 *   - `--all`: every tracked in-scope file under `apps/` and `packages/`, the reconciliation. It
 *     prints each violating file with its count and exits 1 while any exists: a report, not a pass.
 *
 *   An `eslint-disable` directive does not exempt a file: a jsdoc message it suppressed is a
 *   violation. Any other message the config produces (a parse error, a directive naming a rule no
 *   registered plugin defines) is one too, because a file the config cannot read was not checked.
 *
 *   FAIL-CLOSED, exit 2: a base ref that does not resolve after three fetch attempts, a merge base
 *   that cannot be found (a shallow clone is deepened, with the same attempts), a config whose scope
 *   no longer reaches `SCOPE_PROBE`, a named file outside the repository, `--all` finding no
 *   in-scope file, or a usage error. A change that touches no in-scope file is a clean pass, and
 *   its line says so.
 *
 *   Usage: `node scripts/testing/jsdoc-touched-gate.mjs [--base <ref> | --staged | --all | <file>...]`.
 *   Exit 0 when every touched in-scope file is clean; 1 listing `file:line rule message` for each
 *   violation; 2 on a scope, base or usage error.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

/** The dedicated config this gate, and nothing else, loads. */
export const CONFIG_FILE = fileURLToPath(new URL("../../eslint.jsdoc.config.ts", import.meta.url));
/** A path the config must reach; when it does not, its scope moved and a pass would be blind. */
export const SCOPE_PROBE = "apps/api/src/index.ts";
const DEFAULT_BASE = "origin/main";
const FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3000;
const CHANGED = ["--name-only", "--no-renames", "--diff-filter=AM", "-z"];
const USAGE =
  "usage: node scripts/testing/jsdoc-touched-gate.mjs [--base <ref> | --staged | --all | <file>...]";

/**
 * @typedef {{ exitCode: 0 | 1 | 2, messages: string[] }} Outcome
 * @typedef {{ mode: "base", base: string } | { mode: "staged" } | { mode: "all" }
 *   | { mode: "files", files: string[] }} Request
 */

/** @type {(messages: string[]) => Outcome} */
const refuse = (messages) => ({ exitCode: 2, messages });

/**
 * @description Runs git and returns its output, or null when it exits non-zero.
 * @param {string} cwd - The directory git runs in.
 * @param {string[]} args - The git arguments.
 * @returns {string | null} The output, or null on failure.
 */
function tryGit(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

/**
 * @description Runs git and returns its output, throwing when it exits non-zero.
 * @param {string} cwd - The directory git runs in.
 * @param {string[]} args - The git arguments.
 * @returns {string} The output.
 */
function git(cwd, args) {
  const output = tryGit(cwd, args);
  if (output === null) throw new Error(`git ${args.join(" ")} failed in ${cwd}`);
  return output;
}

/** @type {(output: string) => string[]} The paths of a `git -z` list. */
const nulList = (output) => output.split("\0").filter((entry) => entry.length > 0);

/**
 * @description Reads the command line, with `JSDOC_BASE_REF` standing in for a missing `--base`.
 * @param {string[]} argv - The arguments after the script path.
 * @param {NodeJS.ProcessEnv} env - The environment.
 * @returns {Request | null} The request, or null on a usage error.
 */
export function parseRequest(argv, env) {
  const [first, second] = argv;
  if (first === undefined) return { mode: "base", base: env.JSDOC_BASE_REF || DEFAULT_BASE };
  if (first === "--base")
    return argv.length === 2 && second ? { mode: "base", base: second } : null;
  if (first === "--staged") return argv.length === 1 ? { mode: "staged" } : null;
  if (first === "--all") return argv.length === 1 ? { mode: "all" } : null;
  return argv.some((arg) => arg.startsWith("-")) ? null : { mode: "files", files: argv };
}

/**
 * @description Fetches from origin up to `FETCH_ATTEMPTS` times, until `done` holds.
 * @param {string} root - The repository root.
 * @param {string[]} args - The fetch arguments.
 * @param {() => boolean} done - Whether what the fetch is for is already there.
 * @returns {Promise<boolean>} Whether `done` holds at the end.
 */
async function fetchUntil(root, args, done) {
  if (done() || tryGit(root, ["remote", "get-url", "origin"]) === null) return done();
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    tryGit(root, ["fetch", "--quiet", "origin", ...args]);
    if (done()) return true;
    if (attempt < FETCH_ATTEMPTS) {
      await new Promise((settle) => setTimeout(settle, attempt * RETRY_DELAY_MS));
    }
  }
  return false;
}

/**
 * @description Resolves the merge base of a ref and HEAD, fetching the ref when it is missing and
 *   deepening a shallow clone when the two share no history in it.
 * @param {string} root - The repository root.
 * @param {string} ref - The base ref.
 * @returns {Promise<{ mergeBase: string } | { error: string }>} The merge base, or why there is none.
 */
async function resolveMergeBase(root, ref) {
  const resolves = () =>
    tryGit(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== null;
  const refspec = ref.startsWith("origin/")
    ? `+refs/heads/${ref.slice(7)}:refs/remotes/${ref}`
    : ref;
  if (!(await fetchUntil(root, [refspec], resolves))) {
    const cause =
      tryGit(root, ["remote", "get-url", "origin"]) === null
        ? "and the repository has no origin to fetch it from"
        : `after ${FETCH_ATTEMPTS} fetches from origin: the base is gone or the fetch failed`;
    return {
      error: `base ref ${ref} did not resolve ${cause}. Failing closed rather than diffing against nothing.`,
    };
  }
  let mergeBase = "";
  const found = () => (mergeBase = tryGit(root, ["merge-base", ref, "HEAD"])?.trim() ?? "") !== "";
  const shallow = tryGit(root, ["rev-parse", "--is-shallow-repository"])?.trim() === "true";
  if (!found() && shallow) await fetchUntil(root, ["--unshallow"], found);
  if (mergeBase !== "") return { mergeBase };
  return {
    error: `${ref} and HEAD share no merge base${shallow ? ", even after deepening the clone" : ""}.`,
  };
}

/**
 * @description Whether the config checks a path, by its own ignores and rules.
 * @param {ESLint} eslint - The linter.
 * @param {string} file - The absolute path.
 * @returns {Promise<boolean>} True when a `jsdoc/` rule applies to it.
 */
async function inScope(eslint, file) {
  if (await eslint.isPathIgnored(file)) return false;
  /** @type {{ rules?: Record<string, unknown> } | undefined} */
  const config = await eslint.calculateConfigForFile(file);
  return Object.keys(config?.rules ?? {}).some((rule) => rule.startsWith("jsdoc/"));
}

/**
 * @description The candidate paths of a request, relative to the root, and where they came from.
 * @param {string} root - The repository root.
 * @param {Request} request - The request.
 * @returns {Promise<{ files: string[], source: string } | { error: string }>} The paths, or an error.
 */
async function candidates(root, request) {
  if (request.mode === "all") {
    return {
      files: nulList(git(root, ["ls-files", "-z", "--", "apps", "packages"])),
      source: "the tree",
    };
  }
  if (request.mode === "staged") {
    return { files: nulList(git(root, ["diff", "--cached", ...CHANGED])), source: "the index" };
  }
  if (request.mode === "files") {
    const absolute = request.files.map((file) => path.resolve(root, file));
    const outside = absolute.filter((file) => {
      const relative = path.relative(root, file);
      return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
    });
    if (outside.length > 0) {
      const verb = outside.length === 1 ? "is" : "are";
      return {
        error: `${outside.join(", ")} ${verb} outside the repository at ${root}: the gate checks only its files`,
      };
    }
    return { files: absolute.map((file) => path.relative(root, file)), source: "the named files" };
  }
  const resolved = await resolveMergeBase(root, request.base);
  if ("error" in resolved) return resolved;
  const files = nulList(git(root, ["diff", ...CHANGED, resolved.mergeBase, "HEAD"]));
  return { files, source: `${request.base} (merge base ${resolved.mergeBase.slice(0, 8)})` };
}

/**
 * @description Formats every finding of one lint result, suppressed jsdoc findings included.
 * @param {string} file - The path relative to the root.
 * @param {ESLint.LintResult} result - The result.
 * @returns {string[]} One `file:line rule message` line per finding.
 */
function findings(file, result) {
  const suppressed = (result.suppressedMessages ?? []).filter((m) =>
    m.ruleId?.startsWith("jsdoc/")
  );
  return [
    ...result.messages.map((m) => `${file}:${m.line ?? 0} ${m.ruleId ?? "fatal"} ${m.message}`),
    ...suppressed.map(
      (m) =>
        `${file}:${m.line} ${m.ruleId} ${m.message} (an eslint-disable directive does not exempt it)`
    ),
  ];
}

/**
 * @description Runs the gate for one request in a repository.
 * @param {{ cwd: string, request: Request }} input - A directory inside the repository, and what to check.
 * @returns {Promise<Outcome>} The exit code and the lines to print.
 */
export async function runGate({ cwd, request }) {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: CONFIG_FILE,
    errorOnUnmatchedPattern: false,
  });
  if (!(await inScope(eslint, path.join(root, SCOPE_PROBE)))) {
    return refuse([
      `the config no longer reaches ${SCOPE_PROBE}: its scope moved, so a pass would be blind`,
    ]);
  }
  const listed = await candidates(root, request);
  if ("error" in listed) return refuse([listed.error]);
  /** @type {string[]} */
  const scoped = [];
  for (const file of listed.files) {
    const absolute = path.join(root, file);
    // `--staged` reads the index, so a file the working tree no longer holds is still checked.
    const readable = request.mode === "staged" || existsSync(absolute);
    if (readable && (await inScope(eslint, absolute))) scoped.push(file);
  }
  if (scoped.length === 0) {
    if (request.mode === "all")
      return refuse(["--all found no in-scope file: the scan would read nothing"]);
    const changed = `${listed.files.length} changed, none in scope`;
    return {
      exitCode: 0,
      messages: [`0 touched in-scope files in ${listed.source} (${changed}): a clean pass`],
    };
  }
  /** @type {ESLint.LintResult[]} */
  const results = [];
  if (request.mode === "staged") {
    for (const file of scoped) {
      const text = git(root, ["show", `:${file}`]);
      results.push(...(await eslint.lintText(text, { filePath: path.join(root, file) })));
    }
  } else {
    results.push(...(await eslint.lintFiles(scoped.map((file) => path.join(root, file)))));
  }
  if (results.length !== scoped.length) {
    return refuse([
      `ESLint returned ${results.length} results for ${scoped.length} files: nothing is certain`,
    ]);
  }
  const perFile = results
    .map((result) => path.relative(root, result.filePath))
    .map((file, index) => ({
      file,
      lines: findings(file, /** @type {ESLint.LintResult} */ (results[index])),
    }))
    .sort((left, right) => left.file.localeCompare(right.file));
  const failing = perFile.filter(({ lines }) => lines.length > 0);
  const total = failing.reduce((sum, { lines }) => sum + lines.length, 0);
  const tally = `${failing.length} of ${scoped.length} in-scope files in ${listed.source} violate (${total} violations)`;
  if (request.mode === "all") {
    const counts = failing.map(({ file, lines }) => `${file}\t${lines.length}`);
    return { exitCode: failing.length > 0 ? 1 : 0, messages: [...counts, tally] };
  }
  if (failing.length > 0)
    return { exitCode: 1, messages: [...failing.flatMap(({ lines }) => lines), tally] };
  return {
    exitCode: 0,
    messages: [`${scoped.length} touched in-scope files in ${listed.source}: zero violations`],
  };
}

/**
 * @description The command line: reads the request, runs the gate, prints its lines.
 * @param {string[]} argv - The arguments after the script path.
 * @returns {Promise<number>} The exit code.
 */
async function main(argv) {
  const request = parseRequest(argv, process.env);
  /** @type {Outcome} */
  let outcome;
  try {
    outcome = request === null ? refuse([USAGE]) : await runGate({ cwd: process.cwd(), request });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    outcome = refuse([`the gate could not run, so nothing was checked: ${reason}`]);
  }
  const stream = outcome.exitCode === 0 ? process.stdout : process.stderr;
  for (const message of outcome.messages) stream.write(`jsdoc-touched-gate: ${message}\n`);
  return outcome.exitCode;
}

/** True only when this file is the process entry point, so importing its exports runs nothing. */
const entryPoint = process.argv[1];
if (entryPoint !== undefined && existsSync(entryPoint)) {
  if (realpathSync(entryPoint) === fileURLToPath(import.meta.url)) {
    process.exitCode = await main(process.argv.slice(2));
  }
}
