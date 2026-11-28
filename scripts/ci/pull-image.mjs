// @ts-check
/**
 * @file pull-image.mjs
 * @description Pulls one Docker Hub image for a CI job, the mirror first and Docker Hub second, so
 *   a transient failure or an outage at one registry does not fail the job. The images a job
 *   starts as containers (its Postgres and its Redis, and the two Compose starts) never pass
 *   through BuildKit, so the mirror the image builds configure does not reach them: this routine
 *   is their one way in.
 *
 *   THE RULE. The sources are tried in order, `mirror.gcr.io` and then `docker.io` unless the
 *   command line names others with `--source`, each up to `--attempts` times (3). After a failed
 *   attempt of a source the routine pauses the attempt's number times `--wait-seconds` (5), then
 *   tries that source again; after a source's last attempt it moves to the next source at once.
 *   Each attempt is bounded by `--attempt-timeout-seconds` (90): a pull that gives no answer
 *   within it is ended and counted as failed. `docker.io` is pulled by the reference as given. Any
 *   other source is pulled at `<source>/<path>`, where an official image's path takes the
 *   `library/` prefix Docker Hub keeps it under, and the image is then tagged under the reference
 *   the caller asked for, so `docker run` and Compose find it by that name; a failed tag fails the
 *   attempt. Google's cache holds only the Docker Hub images pulled often enough and keeps none for
 *   sure, so the mirror is a first source and never the only one
 *   (https://docs.cloud.google.com/artifact-registry/docs/pull-cached-dockerhub-images).
 *
 *   WHAT IS RETRIED. Every refusal by a registry, every exit of `docker` other than 0, a signal,
 *   an attempt its bound ended, and every other error `spawnSync` reports for a call (such as
 *   EAGAIN or ENOMEM under resource pressure, or ENOBUFS when `docker` started and its output
 *   passed the buffer): the routine reads no meaning into `docker`'s text, since a tag the mirror
 *   lacks is the very case the fallback exists for. Only a `docker` that cannot be executed at
 *   all is not retried, the codes of `UNSTARTABLE_CODES` (ENOENT when no `docker` is on the
 *   runner, among them): it will not start at the next attempt or at the next source, so the
 *   routine stops at that call.
 *
 *   OUTPUT. The served image is one line on stdout naming the source; each failed attempt is one
 *   line on stderr with its reason and what comes next; when no source serves the image, a last
 *   line names it; a `docker` that cannot be started is one line naming the cause. Every line
 *   starts with the routine's name.
 *
 *   EXIT CODES: 0 an image served; 1 no source served it; 2 a usage error, which calls no docker;
 *   3 `docker` could not be started. Code 3 is its own because each other code points elsewhere:
 *   1 at the registries, which were never reached, and 2 at the command line, which was right;
 *   the fault is the runner's.
 *
 *   WHAT IT BOUNDS. `--attempts` and the two durations are whole numbers from 1: a fraction of an
 *   attempt means nothing, a pause of 0 is no pause, and a bound below a millisecond is no bound
 *   at all to `spawnSync`. Both durations are capped by what a Node timer takes, 2,147,483,647
 *   ms (a `setTimeout` past it fires after 1 ms). The pauses come after every attempt but the
 *   last, so the longest is `--attempts` minus 1 times `--wait-seconds`; it and
 *   `--attempt-timeout-seconds` are each at most 2,147,483 s, and a value past that is a usage
 *   error. A single attempt never pauses, so it takes any wait. `spawnSync` would take a longer
 *   bound; the bound shares the pause's cap so that both durations follow one rule.
 *
 *   WHAT IT TRUSTS. The reference comes from the command line alone and must read as a Docker Hub
 *   reference, `name[:tag]`, so it cannot start with a dash and be taken for an option of
 *   `docker`, and its path at Docker Hub, `library/` counted, is at most the 255 characters Docker
 *   takes; it reaches `docker` as one argument of `spawnSync`, with no shell to read it. The
 *   routine reads no credential and no environment file, and prints none: it pulls anonymously.
 *
 *   NODE'S OWN MODULES ONLY: a job may run it before anything is installed, on the runner's Node,
 *   so it imports no package. `util.parseArgs` needs Node 18.3.0 or later.
 *
 *   Usage: `node scripts/ci/pull-image.mjs [--source <registry>]... [--attempts <n>]
 *   [--wait-seconds <s>] [--attempt-timeout-seconds <s>] <image>`. Pinned by
 *   apps/api/tests/unit/scripts/pullImage.test.ts, which also calls `main` with seams of its own.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const NAME = "pull-image";
const USAGE =
  "usage: node scripts/ci/pull-image.mjs [--source <registry>]... [--attempts <n>] " +
  "[--wait-seconds <s>] [--attempt-timeout-seconds <s>] <image>";

/** Docker Hub, the source pulled by the reference exactly as the caller gave it. */
const DOCKER_HUB = "docker.io";
const DEFAULT_SOURCES = ["mirror.gcr.io", DOCKER_HUB];
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_WAIT_SECONDS = 5;
/** Bounds a pull that hangs; an image of these jobs pulls in seconds on a hosted runner. */
const DEFAULT_ATTEMPT_TIMEOUT_SECONDS = 90;

const EXIT_SERVED = 0;
const EXIT_UNSERVED = 1;
const EXIT_USAGE = 2;
const EXIT_UNSTARTABLE = 3;

/**
 * The longest delay a Node timer takes, 2^31 - 1 ms, as whole seconds: a longer `setTimeout`
 * fires after 1 ms with a TimeoutOverflowWarning (Node's documentation of `setTimeout`).
 */
const TIMER_MAX_SECONDS = Math.floor(2_147_483_647 / 1000);

/**
 * The codes with which `spawnSync` reports that the program cannot be executed at all, each a
 * property of the file or of its path that no later attempt changes (POSIX `execve`, through
 * libuv): ENOENT, no `docker` on `PATH`; EACCES, no permission to execute it or to search a
 * directory of its path; ENOTDIR, a component of its path is not a directory; ELOOP, a loop of
 * symbolic links; ENAMETOOLONG, a path past the system's limit; ENOEXEC, a file whose format the
 * system cannot execute. Every other code, such as EAGAIN or ENOMEM under resource pressure, is
 * retried.
 */
const UNSTARTABLE_CODES = new Set([
  "ENOENT",
  "EACCES",
  "ENOTDIR",
  "ELOOP",
  "ENAMETOOLONG",
  "ENOEXEC",
]);

/** One path component of a repository, as Docker's reference grammar writes it. */
const COMPONENT = "[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*";
/** A Docker Hub reference: an optional `docker.io/`, the repository path and an optional tag. */
const HUB_REFERENCE = new RegExp(
  `^(?:docker\\.io/)?(${COMPONENT}(?:/${COMPONENT})*)(:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?$`
);
/**
 * The longest repository path Docker takes: `RepositoryNameTotalLengthMax` of
 * github.com/distribution/reference (`reference.go`), checked on the path without the registry,
 * after Docker Hub's normalization has added `library/` to an official image.
 */
const REPOSITORY_PATH_MAX = 255;
/** A whole number from 1, the form `--attempts` and the two durations take. */
const WHOLE_FROM_ONE = /^[1-9][0-9]*$/;
/** A registry host, with an optional port. */
const REGISTRY_HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d+)?$/;
/** A first path component Docker reads as a registry rather than a namespace. */
const NAMES_A_REGISTRY = /[.:]|^localhost$/;

/**
 * @typedef {{ status: number | null, signal?: string | null, stderr: string,
 *   error?: Error & { code?: string } }} DockerResult
 * @typedef {{
 *   docker: (args: readonly string[], timeoutMs: number) => DockerResult,
 *   wait: (ms: number) => Promise<void>,
 *   out: (line: string) => void,
 *   err: (line: string) => void,
 * }} Io
 * @typedef {{ image: string, path: string, tag: string, sources: string[], attempts: number,
 *   waitMs: number, timeoutMs: number }} Request
 */

/** @type {Io} */
const DEFAULT_IO = {
  docker: (args, timeoutMs) =>
    spawnSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      killSignal: "SIGTERM",
    }),
  wait: (ms) => new Promise((settle) => setTimeout(settle, ms)),
  out: (line) => process.stdout.write(`${NAME}: ${line}\n`),
  err: (line) => process.stderr.write(`${NAME}: ${line}\n`),
};

/**
 * @param {number} ms
 * @returns {string} The milliseconds as seconds, the way the options take them.
 */
const seconds = (ms) => String(ms / 1000);

/**
 * @param {string | undefined} text What the option was given.
 * @param {number} fallback The default.
 * @returns {number | undefined} The whole number from 1 the text writes, the default when the
 *   option is absent, or `undefined` when the text is anything else.
 */
function wholeOption(text, fallback) {
  if (text === undefined) return fallback;
  return WHOLE_FROM_ONE.test(text) ? Number(text) : undefined;
}

/**
 * Reads the command line.
 *
 * @param {readonly string[]} argv The arguments after the script's path.
 * @returns {{ request: Request } | { usage: string }} The request, or the usage problem.
 */
function parseRequest(argv) {
  /** @type {ReturnType<typeof parseArgs>} */
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        source: { type: "string", multiple: true },
        attempts: { type: "string" },
        "wait-seconds": { type: "string" },
        "attempt-timeout-seconds": { type: "string" },
      },
    });
  } catch (error) {
    return { usage: error instanceof Error ? error.message : String(error) };
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1) {
    return {
      usage:
        positionals.length === 0
          ? "give one image reference"
          : `give one image reference, not ${String(positionals.length)}`,
    };
  }
  const image = String(positionals[0]);
  const [first, ...rest] = image.split("/");
  if (rest.length > 0 && first !== DOCKER_HUB && NAMES_A_REGISTRY.test(String(first))) {
    return {
      usage:
        `"${image}" names the registry ${String(first)}: the routine pulls Docker Hub images, ` +
        "the ones the mirror caches",
    };
  }
  const reference = HUB_REFERENCE.exec(image);
  if (reference === null) {
    return { usage: `"${image}" is not a Docker Hub image reference (name[:tag])` };
  }
  const repository = String(reference[1]);
  const path = repository.includes("/") ? repository : `library/${repository}`;
  if (path.length > REPOSITORY_PATH_MAX) {
    return {
      usage:
        `"${image}" names a repository path of ${String(path.length)} characters at Docker Hub, ` +
        `over Docker's limit of ${String(REPOSITORY_PATH_MAX)}`,
    };
  }

  const sources = /** @type {string[] | undefined} */ (values.source) ?? DEFAULT_SOURCES;
  const badSource = sources.find((source) => !REGISTRY_HOST.test(source));
  if (badSource !== undefined) {
    return { usage: `"${badSource}" is not a registry host (host or host:port)` };
  }

  const attemptsText = /** @type {string | undefined} */ (values.attempts);
  const attempts = wholeOption(attemptsText, DEFAULT_ATTEMPTS);
  if (attempts === undefined) {
    return { usage: `--attempts takes a whole number from 1, not "${String(attemptsText)}"` };
  }
  const waitText = /** @type {string | undefined} */ (values["wait-seconds"]);
  const wait = wholeOption(waitText, DEFAULT_WAIT_SECONDS);
  if (wait === undefined) {
    return {
      usage: `--wait-seconds takes a whole number of seconds from 1, not "${String(waitText)}"`,
    };
  }
  const pauses = attempts - 1;
  if (pauses * wait > TIMER_MAX_SECONDS) {
    return {
      usage:
        `--wait-seconds ${String(wait)} makes the longest pause, after attempt ${String(pauses)} ` +
        `of ${String(attempts)}, ${String(pauses * wait)} s, over the ` +
        `${String(TIMER_MAX_SECONDS)} s a timer takes`,
    };
  }
  const timeoutText = /** @type {string | undefined} */ (values["attempt-timeout-seconds"]);
  const timeout = wholeOption(timeoutText, DEFAULT_ATTEMPT_TIMEOUT_SECONDS);
  if (timeout === undefined) {
    return {
      usage:
        "--attempt-timeout-seconds takes a whole number of seconds from 1, " +
        `not "${String(timeoutText)}"`,
    };
  }
  if (timeout > TIMER_MAX_SECONDS) {
    return {
      usage:
        `--attempt-timeout-seconds ${String(timeout)} is over the ` +
        `${String(TIMER_MAX_SECONDS)} s a timer takes`,
    };
  }

  return {
    request: {
      image,
      path,
      tag: reference[2] ?? "",
      sources,
      attempts,
      waitMs: wait * 1000,
      timeoutMs: timeout * 1000,
    },
  };
}

/**
 * @typedef {{ reason: string, startable: boolean }} Failure Why a call or an attempt failed, and
 *   whether `docker` started at all, which decides whether another attempt can help.
 */

/**
 * @param {DockerResult} result One `docker` call.
 * @param {number} timeoutMs Its bound.
 * @returns {Failure | undefined} Why the call failed, or `undefined` when it succeeded.
 */
function failureOf(result, timeoutMs) {
  if (result.error !== undefined) {
    const code = result.error.code ?? result.error.message;
    if (code === "ETIMEDOUT") {
      return { reason: `docker gave no answer within ${seconds(timeoutMs)} s`, startable: true };
    }
    return UNSTARTABLE_CODES.has(code)
      ? { reason: `docker could not be started (${code})`, startable: false }
      : { reason: `docker call failed (${code})`, startable: true };
  }
  if (result.status === 0) return undefined;
  if (result.status === null) {
    return { reason: `docker ended by signal ${String(result.signal)}`, startable: true };
  }
  const last = result.stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .at(-1);
  return {
    reason: `docker exited ${String(result.status)}${last === undefined ? "" : `: ${last}`}`,
    startable: true,
  };
}

/**
 * One attempt at one source: the pull, and for a source other than Docker Hub, the tag.
 *
 * @param {Io} io
 * @param {Request} request
 * @param {string} pulled The reference pulled at this source.
 * @returns {Failure | undefined} Why the attempt failed, or `undefined` when it served the image.
 */
function attemptAt(io, request, pulled) {
  const pull = failureOf(io.docker(["pull", pulled], request.timeoutMs), request.timeoutMs);
  if (pull !== undefined || pulled === request.image) return pull;
  const tag = failureOf(
    io.docker(["tag", pulled, request.image], request.timeoutMs),
    request.timeoutMs
  );
  return tag === undefined
    ? undefined
    : {
        reason: `pulled ${pulled} but could not tag it ${request.image}: ${tag.reason}`,
        startable: tag.startable,
      };
}

/**
 * @description Runs the routine: reads the command line, then tries each source in turn.
 * @param {readonly string[]} argv The arguments after the script's path.
 * @param {Io} [io] The `docker` call, the pause and the two output streams; the real ones by default.
 * @returns {Promise<number>} The exit code.
 */
export async function main(argv, io = DEFAULT_IO) {
  const parsed = parseRequest(argv);
  if ("usage" in parsed) {
    io.err(`${parsed.usage}\n${USAGE}`);
    return EXIT_USAGE;
  }
  const { request } = parsed;
  const { image, sources, attempts } = request;
  for (const [index, source] of sources.entries()) {
    const pulled = source === DOCKER_HUB ? image : `${source}/${request.path}${request.tag}`;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const failure = attemptAt(io, request, pulled);
      if (failure === undefined) {
        io.out(
          pulled === image
            ? `${image} served by ${source}`
            : `${image} served by ${source} as ${pulled}, tagged ${image}`
        );
        return EXIT_SERVED;
      }
      if (!failure.startable) {
        io.err(`${image}: ${failure.reason}, so no attempt follows`);
        return EXIT_UNSTARTABLE;
      }
      const pauseMs = attempt * request.waitMs;
      const following = sources[index + 1];
      const next =
        attempt < attempts
          ? `; next attempt in ${seconds(pauseMs)} s`
          : following === undefined
            ? ""
            : `; trying ${following}`;
      io.err(
        `${image}: attempt ${String(attempt)} of ${String(attempts)} at ${source} failed: ${failure.reason}${next}`
      );
      if (attempt < attempts) await io.wait(pauseMs);
    }
  }
  const tries = attempts === 1 ? "1 attempt" : `${String(attempts)} attempts`;
  io.err(`no source served ${image} after ${tries} at each of ${sources.join(", ")}`);
  return EXIT_UNSERVED;
}

/**
 * @returns {boolean} True only when node was started with this file, so a suite's import of
 *   `main` runs nothing.
 */
function startedAsScript() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (startedAsScript()) process.exitCode = await main(process.argv.slice(2));
