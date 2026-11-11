// @ts-check
/**
 * @file platform-start.mjs
 * @description The start sequence of a clean checkout, as far as it goes today: its environment.
 *
 *   ENVIRONMENT. A checkout with no root environment file receives one, its secrets random
 *   (`lib/start-environment.mjs` says which variables and why). An existing file is never written:
 *   it is read, and the run fails naming each required variable it lacks.
 *
 *   HOST PORTS. The compose file publishes Postgres and Redis on loopback, on 5432 and 6379 unless
 *   `POSTGRES_HOST_PORT` and `REDIS_HOST_PORT` say otherwise. Set in the calling shell when the file
 *   is generated, they are written into it, and into its URLs; from then on the file is their one
 *   source, and a shell value that disagrees with it is refused instead of ignored.
 *
 *   Exit codes: 0 the environment file is complete; 1 it is not, each cause on its own line; 2 a
 *   usage error.
 *
 *   Usage: `node scripts/start/platform-start.mjs [--root <dir>]`
 * @layer infrastructure
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_POSTGRES_HOST_PORT,
  DEFAULT_REDIS_HOST_PORT,
  ENVIRONMENT_FILE,
  LOOPBACK,
  generateEnvironment,
  missingKeys,
  parsePort,
  readEnvironment,
  renderEnvironmentFile,
} from "./lib/start-environment.mjs";

const NAME = "platform-start";

const USAGE = `usage: node scripts/start/platform-start.mjs [--root <dir>]

Gives a checkout the environment it starts from.

  --root <dir>   the checkout to start (default: the one this script is in)

A checkout with no ${ENVIRONMENT_FILE} file receives one, its secrets random; an existing file is
never written, and the run fails naming each required variable it lacks. POSTGRES_HOST_PORT and
REDIS_HOST_PORT, set when the file is generated, choose the host ports the compose file publishes
Postgres and Redis on.
`;

/** The variable that chooses the host port each service is published on. */
const PORT_KEYS = /** @type {const} */ ({
  Postgres: "POSTGRES_HOST_PORT",
  Redis: "REDIS_HOST_PORT",
});

/** A run that failed, with one line per cause. */
class StartFailure extends Error {
  /** @param {string[]} lines - The causes. */
  constructor(lines) {
    super(lines.join("; "));
    this.lines = lines;
  }
}

/**
 * @param {string} key - The variable that carries the port.
 * @param {string | undefined} raw - Its value, when it is set.
 * @param {string[]} problems - Where a value that is not a port is reported.
 * @returns {number | undefined} The port, or `undefined` when the variable is unset or is not one.
 */
function portOf(key, raw, problems) {
  if (raw === undefined || raw === "") return undefined;
  const port = parsePort(raw);
  if (port === null) problems.push(`${key}=${raw} is not a port`);
  return port ?? undefined;
}

/**
 * @param {unknown} error - What a read or a write of the environment file threw.
 * @param {string} file - The environment file's path.
 * @returns {unknown} A one-line failure when the checkout is missing or is not a directory, or when
 *   the write found something where the read had found nothing; otherwise the error as it came.
 */
function explained(error, file) {
  const code = /** @type {NodeJS.ErrnoException} */ (error).code;
  if (code === "ENOENT" || code === "ENOTDIR") {
    return new StartFailure([`${path.dirname(file)} is not a directory`]);
  }
  if (code === "EEXIST") {
    return new StartFailure([
      `${file} exists but reads as absent (a link that leads nowhere?): nothing was written`,
    ]);
  }
  return error;
}

/**
 * @param {string} file - The environment file's path.
 * @returns {string | null} Its text, or `null` when there is no such file.
 */
function readIfPresent(file) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return null;
    throw explained(error, file);
  }
}

/**
 * @function prepareEnvironment
 * @description Writes the environment file when the checkout has none; otherwise checks the one it
 *   has, without writing it. Every cause of a refusal is collected before the run fails, so one run
 *   names them all. Nothing asks whether the file exists before acting on it: the file is read, a
 *   missing one reads as absent, and the write creates it only if nothing is there, so it never
 *   replaces a file that appeared meanwhile and never writes through a link.
 * @param {string} file - The environment file's path.
 * @returns {{ Postgres: number, Redis: number }} The host port each service is published on.
 */
function prepareEnvironment(file) {
  const text = readIfPresent(file);
  const values = text === null ? null : readEnvironment(text);
  const problems = values === null ? [] : missingKeys(values).map((key) => `${file} lacks ${key}`);
  const ports = { Postgres: DEFAULT_POSTGRES_HOST_PORT, Redis: DEFAULT_REDIS_HOST_PORT };
  for (const name of /** @type {const} */ (["Postgres", "Redis"])) {
    const key = PORT_KEYS[name];
    const asked = portOf(key, process.env[key], problems);
    if (values === null) {
      ports[name] = asked ?? ports[name];
      continue;
    }
    ports[name] = portOf(key, values[key], problems) ?? ports[name];
    if (asked !== undefined && asked !== ports[name]) {
      problems.push(
        `${file} publishes ${name} on ${ports[name]}, and ${key}=${asked} would not change it: ` +
          `edit the file or unset the variable`
      );
    }
  }
  if (ports.Postgres === ports.Redis) {
    problems.push(
      `Postgres and Redis are both published on host port ${ports.Postgres}: give each its own`
    );
  }
  if (problems.length > 0) throw new StartFailure(problems);

  if (values !== null) {
    process.stdout.write(`${NAME}: ${file} holds every required variable\n`);
    return ports;
  }
  const entries = generateEnvironment({
    randomBytes,
    ...(ports.Postgres !== DEFAULT_POSTGRES_HOST_PORT && { postgresHostPort: ports.Postgres }),
    ...(ports.Redis !== DEFAULT_REDIS_HOST_PORT && { redisHostPort: ports.Redis }),
  });
  try {
    writeFileSync(file, renderEnvironmentFile(entries), { flag: "wx", mode: 0o600 });
  } catch (error) {
    throw explained(error, file);
  }
  process.stdout.write(
    `${NAME}: wrote ${file} with ${entries.length} variables, its secrets random\n`
  );
  return ports;
}

/**
 * @param {string[]} argv - The command's arguments.
 * @returns {{ root: string, help: boolean } | null} `null` on a usage error.
 */
function parseOptions(argv) {
  const options = {
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--help") {
      options.help = true;
    } else if (flag === "--root" && value !== undefined) {
      options.root = path.resolve(value);
      index += 1;
    } else {
      return null;
    }
  }
  return options;
}

/**
 * @param {string[]} argv - The command's arguments.
 * @returns {number} The exit code.
 */
function main(argv) {
  const options = parseOptions(argv);
  if (options === null) {
    process.stderr.write(USAGE);
    return 2;
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const file = path.join(options.root, ENVIRONMENT_FILE);
  try {
    const ports = prepareEnvironment(file);
    process.stdout.write(
      `${NAME}: the compose file publishes Postgres on ${LOOPBACK}:${ports.Postgres} and Redis on ` +
        `${LOOPBACK}:${ports.Redis}\n`
    );
  } catch (error) {
    if (!(error instanceof StartFailure)) throw error;
    for (const line of error.lines) process.stderr.write(`${NAME}: ${line}\n`);
    return 1;
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
