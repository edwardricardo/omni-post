// @ts-check
/**
 * @file node-runtime-advisory-gate.mjs
 * @description The Node runtime advisory gate, run by the `Container Security` job of
 *   `.github/workflows/production-ci.yml` on the version each image's `node --version` prints. The
 *   image scanner reads an image's OS packages and the `package.json` of each module, never the
 *   `node` executable a distroless base ships without a package record, so an image could run a Node
 *   release with published advisories while every scan passed. This gate holds that executable to
 *   Node's own release index, `https://nodejs.org/dist/index.json`.
 *
 *   THE RULE. The releases of the image's major line are the index entries whose version starts
 *   with the same `v<major>.`. The image fails, exit 1, when at least one stable release of that line
 *   with a higher version than the image's has `security: true`: the output names the image's
 *   version, every such release, newest first, with its date, and the remedy, the newest of them as
 *   the floor for the Node base. Otherwise it passes, exit 0, in one line: the version, how many
 *   later stable releases its line has, and that none is a security release.
 *
 *   PRE-RELEASES AND NIGHTLIES. An image version with a pre-release suffix (`v27.0.0-alpha.0.1.1`,
 *   `v27.0.0-nightly20261116…`) is a usage error, exit 2: the images' Node bases ship stable
 *   releases, and a pre-release has no line of security releases to be measured against. A
 *   pre-release entry of the index is read and checked like every entry of its line, and never
 *   counted as a later release: no stable base moves to it, so it neither fails nor passes an image.
 *
 *   THE INDEX IS FETCHED with the global `fetch`, in at most ATTEMPTS attempts, each bounded by its
 *   own timeout, fetch and body together. A rejected fetch, a timeout, a status outside 2xx or a
 *   body that cannot be read is a failed attempt, and the gate waits the attempt's number times
 *   RETRY_DELAY_MS before the next. A body that arrives but is not JSON is an answer, not a failed
 *   attempt, and is not fetched again.
 *
 *   EXIT CODES: 0 a pass; 1 a later security release of the image's line; 2 a usage error; 3 an
 *   index the gate could not read in full. A pass prints to stdout; a verdict, a usage error and an
 *   unread index print to stderr, each line prefixed by the gate's name.
 *
 *   FAIL-CLOSED, exit 3, never 0 and never 1: the index unreachable after the attempts; a body that
 *   is not JSON, or JSON that is not an array; an entry whose `version` reads as neither `vX.Y.Z`
 *   nor `vX.Y.Z-<pre-release>`, since its line is unknown and it may be the image's; an entry of the
 *   image's line whose `security` is not a boolean or whose `date` is not `YYYY-MM-DD`; a major line
 *   with no entry at all; and the image's own version absent from its line, since a version the
 *   index does not know cannot be placed in it. The first such input stops the gate and is named.
 *   The `security` and `date` of other lines are never read, because no verdict depends on them.
 *
 *   THE REMEDY IS STATED, NOT READ FROM THE TREE. The verdict names the four Dockerfiles and the
 *   two stages that pin Node in each (the build stage's `node:` image and the runtime stage's
 *   distroless one). The gate judges the image it was handed, and reading the checkout would add a
 *   failure, a moved Dockerfile, to an answer that does not need it; the suite reads the four
 *   Dockerfiles instead and fails when the stated paths or stages stop matching them.
 *
 *   NODE'S OWN MODULES ONLY: the job runs this file on the runner's Node with nothing installed, so
 *   it imports no package and none of the shared helpers of `scripts/testing/lib/`
 *   (`record-helpers.mjs`, which holds `isEntryPoint`, loads prettier).
 *
 *   RESIDUAL LIMITS, stated rather than implied. (1) The gate trusts the index's `security` flag: a
 *   fix released without it, or an advisory no release fixes yet, passes. (2) It judges the image
 *   against its own line only: a line past its end of life, whose advisories get no release, passes;
 *   the maturity watchlist's review reads Node's schedule. (3) It reads the version the executable
 *   prints, not how it was built: a base rebuilt with a backported fix still reads as its older
 *   version and fails. (4) A security release published between two runs of the job is seen by the
 *   next run only.
 *
 *   Usage: `node scripts/testing/node-runtime-advisory-gate.mjs --version <vX.Y.Z>`. Pinned by
 *   apps/api/tests/unit/scripts/nodeRuntimeAdvisoryGate.test.ts.
 * @layer infrastructure
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const GATE = "node-runtime-advisory-gate";
const USAGE = "usage: node scripts/testing/node-runtime-advisory-gate.mjs --version <vX.Y.Z>";

/** Node's release index: every release with its version, date and security flag. */
export const INDEX_URL = "https://nodejs.org/dist/index.json";
const ATTEMPTS = 3;
/** One attempt's bound, fetch and body together; the index is well under a megabyte. */
const ATTEMPT_TIMEOUT_MS = 30_000;
/** The pause after a failed attempt, multiplied by that attempt's number. */
export const RETRY_DELAY_MS = 5_000;

/** The four images' Dockerfiles; each pins Node in its build stage and in its runtime stage. */
export const DOCKERFILES = [
  "apps/api/Dockerfile",
  "apps/workers/Dockerfile",
  "apps/admin/Dockerfile",
  "apps/client/Dockerfile",
];

const EXIT_CLEAN = 0;
const EXIT_VERDICT = 1;
const EXIT_USAGE = 2;
const EXIT_UNREAD = 3;

/** A stable release, as `node --version` prints one. */
const STABLE = /^v(\d+)\.(\d+)\.(\d+)$/;
/** Any version the index may list: a stable release, or one with a pre-release suffix. */
const RELEASE = /^v(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @typedef {{ text: string, major: number, minor: number, patch: number }} ImageVersion
 * @typedef {ImageVersion & { prerelease: boolean, date: string, security: boolean }} LineRelease
 * @typedef {{ exitCode: number, lines: string[] }} Outcome The exit code and the lines, unprefixed.
 * @typedef {{ code: number, stdout: string, stderr: string }} Run What the process prints and exits with.
 * @typedef {{ fetchImpl: typeof fetch, wait: (ms: number) => Promise<void>, timeoutMs: number }} Io
 *   The fetch, the pause between attempts and one attempt's bound, injected so the suite reaches no
 *   network and waits on no real time.
 */

/** @type {Io} */
const DEFAULT_IO = {
  fetchImpl: globalThis.fetch,
  wait: (ms) => new Promise((settle) => setTimeout(settle, ms)),
  timeoutMs: ATTEMPT_TIMEOUT_MS,
};

/**
 * @param {unknown} error
 * @returns {string} The error's message, or the value itself as text.
 */
function reason(error) {
  return error instanceof Error ? error.message : String(error);
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
 * @param {unknown} value
 * @returns {string} The value as JSON, and `undefined` for a value JSON cannot write.
 */
function shown(value) {
  return String(JSON.stringify(value));
}

/**
 * @param {number} count
 * @param {string} noun
 * @returns {string} The count and the noun, plural unless the count is one.
 */
function counted(count, noun) {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * @param {ImageVersion} left
 * @param {ImageVersion} right
 * @returns {number} Negative when `left` precedes `right`, zero when they are the same release.
 */
function compare(left, right) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/**
 * @param {ImageVersion} image
 * @param {string} problem
 * @returns {Outcome} Exit 3, naming what could not be read and the image it left unjudged.
 */
function unread(image, problem) {
  return {
    exitCode: EXIT_UNREAD,
    lines: [`could not read the release index, so ${image.text} was not judged: ${problem}`],
  };
}

/**
 * @description Judges an image's Node version against Node's release index. Pure: it reads only
 *   its arguments, so the suite pins the rule without a network.
 * @param {ImageVersion} image The stable version the image runs.
 * @param {unknown} index The parsed body of the release index.
 * @returns {Outcome} Exit 1 when a later stable release of the image's line is a security release,
 *   0 when none is, 3 when the index cannot be read in full.
 */
export function evaluate(image, index) {
  if (!Array.isArray(index)) {
    return unread(image, `${INDEX_URL} answered JSON that is not an array of releases`);
  }
  /** @type {LineRelease[]} */
  const line = [];
  for (const [position, entry] of index.entries()) {
    const { version, date, security } = fieldsOf(entry);
    const hit = typeof version === "string" ? RELEASE.exec(version) : null;
    if (hit === null) {
      return unread(
        image,
        `entry ${String(position)} of the index has the version ${shown(version)}, which reads ` +
          `as neither vX.Y.Z nor vX.Y.Z-<pre-release>, so its line is unknown and it may be of ` +
          `v${String(image.major)}`
      );
    }
    if (Number(hit[1]) !== image.major) continue;
    if (typeof security !== "boolean") {
      return unread(
        image,
        `${hit[0]} has the security flag ${shown(security)}, not a boolean, so whether it is a ` +
          `security release is unknown`
      );
    }
    if (typeof date !== "string" || !DATE.test(date)) {
      return unread(image, `${hit[0]} has the date ${shown(date)}, not YYYY-MM-DD`);
    }
    line.push({
      text: hit[0],
      major: image.major,
      minor: Number(hit[2]),
      patch: Number(hit[3]),
      prerelease: hit[4] !== undefined,
      date,
      security,
    });
  }
  const major = `v${String(image.major)}`;
  if (line.length === 0) return unread(image, `the index lists no release of the ${major} line`);
  const stable = line.filter((release) => !release.prerelease);
  if (!stable.some((release) => compare(release, image) === 0)) {
    return unread(
      image,
      `the index lists the ${major} line but not ${image.text}, so ${image.text} cannot be placed in it`
    );
  }
  const later = stable.filter((release) => compare(release, image) > 0);
  const fixes = later.filter((release) => release.security).sort((a, b) => compare(b, a));
  const newest = fixes[0];
  if (newest === undefined) {
    return {
      exitCode: EXIT_CLEAN,
      lines: [
        `${image.text}: the ${major} line has ${counted(later.length, "later release")} in ` +
          `${INDEX_URL}, and none is a security release`,
      ],
    };
  }
  return {
    exitCode: EXIT_VERDICT,
    lines: [
      `${image.text} is older than ${counted(fixes.length, "security release")} of the ${major} ` +
        `line in ${INDEX_URL}:`,
      ...fixes.map((release) => `  ${release.text} (${release.date})`),
      `raise the Node base to ${newest.text} or later in both stages of ${DOCKERFILES.join(", ")}: ` +
        "the build stage's `FROM node:<version>-bookworm-slim@sha256:<digest>` and the runtime " +
        `stage's \`FROM gcr.io/distroless/nodejs${String(image.major)}-debian13@sha256:<digest>\`, ` +
        "each at a digest that runs that release (docs/deployment/base-images.md)",
    ],
  };
}

/**
 * Fetches the index in at most ATTEMPTS attempts, each bounded by its own timeout.
 *
 * @param {Io} io
 * @returns {Promise<{ body: string } | { error: string }>} The body of the first success, or every
 *   attempt's failure.
 */
async function readIndex(io) {
  /** @type {string[]} */
  const failures = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await io.fetchImpl(INDEX_URL, {
        signal: globalThis.AbortSignal.timeout(io.timeoutMs),
      });
      if (response.ok) return { body: await response.text() };
      failures.push(`attempt ${String(attempt)}: HTTP ${String(response.status)}`);
    } catch (error) {
      failures.push(`attempt ${String(attempt)}: ${reason(error)}`);
    }
    if (attempt < ATTEMPTS) await io.wait(attempt * RETRY_DELAY_MS);
  }
  return {
    error:
      `${INDEX_URL} did not answer after ${String(ATTEMPTS)} attempts ` +
      `(${failures.join("; ")})`,
  };
}

/**
 * @param {readonly string[]} argv
 * @returns {{ image: ImageVersion } | { usage: string }}
 */
function parseOptions(argv) {
  /** @type {string | undefined} */
  let version;
  try {
    const { values } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: { version: { type: "string" } },
    });
    version = values.version;
  } catch (error) {
    return { usage: reason(error) };
  }
  if (version === undefined) {
    return { usage: "give --version <vX.Y.Z>, the line `node --version` prints" };
  }
  const hit = STABLE.exec(version);
  if (hit !== null) {
    return {
      image: { text: version, major: Number(hit[1]), minor: Number(hit[2]), patch: Number(hit[3]) },
    };
  }
  if (RELEASE.test(version)) {
    return {
      usage:
        `${shown(version)} is a pre-release or nightly build: the gate judges stable releases ` +
        "only, the kind the images' Node bases ship",
    };
  }
  return { usage: `${shown(version)} is not a version as \`node --version\` prints it (vX.Y.Z)` };
}

/**
 * @param {Outcome} outcome
 * @returns {Run} A pass on stdout, anything else on stderr, every line prefixed by the gate's name.
 */
function render(outcome) {
  const text = outcome.lines.map((line) => `${GATE}: ${line}\n`).join("");
  return outcome.exitCode === EXIT_CLEAN
    ? { code: outcome.exitCode, stdout: text, stderr: "" }
    : { code: outcome.exitCode, stdout: "", stderr: text };
}

/**
 * @description Runs the gate: reads the command line, fetches the index, judges the image.
 * @param {readonly string[]} argv The arguments after the script's path.
 * @param {Io} [io] The fetch, the pause and the per-attempt bound; the real ones by default.
 * @returns {Promise<Run>} What to print and the exit code.
 */
export async function main(argv, io = DEFAULT_IO) {
  const options = parseOptions(argv);
  if ("usage" in options) {
    return { code: EXIT_USAGE, stdout: "", stderr: `${GATE}: ${options.usage}\n${USAGE}\n` };
  }
  const { image } = options;
  const read = await readIndex(io);
  if ("error" in read) return render(unread(image, read.error));
  /** @type {unknown} */
  let index;
  try {
    index = JSON.parse(read.body);
  } catch (error) {
    return render(unread(image, `the body of ${INDEX_URL} is not JSON: ${reason(error)}`));
  }
  return render(evaluate(image, index));
}

/**
 * True only when node was started with this file, so the suite's import runs nothing.
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

if (invokedAsScript()) {
  const run = await main(process.argv.slice(2));
  process.stdout.write(run.stdout);
  process.stderr.write(run.stderr);
  process.exitCode = run.code;
}
