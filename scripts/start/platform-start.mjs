// @ts-check
/**
 * @file platform-start.mjs
 * @description The start sequence of a clean checkout, as far as it goes today: its environment,
 *   then Postgres and Redis from the repository's `docker-compose.yml`.
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
 *   SERVICES. `docker compose up -d postgres redis`, run in the checkout so Compose interpolates the
 *   same file, with every variable the file owns removed from Compose's own environment: a variable
 *   of the calling shell would otherwise win over the file, and the services would start on values
 *   the file does not name. The run returns only when both accept a connection, and a bare TCP
 *   connect does not show that, because Docker's proxy accepts on the published port before the
 *   server behind it is up. Redis must answer `PING` on its published port. Postgres must answer
 *   the protocol's SSL request there, and then run `SELECT 1` for the file's user and password.
 *
 *   Exit codes: 0 both services accept connections; 1 a step failed, each cause on its own line;
 *   2 a usage error.
 *
 *   Usage: `node scripts/start/platform-start.mjs [--root <dir>] [--wait-seconds <n>]`
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_POSTGRES_HOST_PORT,
  DEFAULT_REDIS_HOST_PORT,
  ENVIRONMENT_FILE,
  LOOPBACK,
  REQUIRED_KEYS,
  generateEnvironment,
  missingKeys,
  parsePort,
  readEnvironment,
  renderEnvironmentFile,
} from "./lib/start-environment.mjs";

const NAME = "platform-start";

const USAGE = `usage: node scripts/start/platform-start.mjs [--root <dir>] [--wait-seconds <n>]

Takes a checkout to a generated environment and to Postgres and Redis accepting connections.

  --root <dir>         the checkout to start (default: the one this script is in)
  --wait-seconds <n>   how long each service may take to accept a connection (default: 60)

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

/** Every variable the environment file owns: none of them reaches Compose from the calling shell. */
const OWNED_BY_THE_FILE = new Set([...REQUIRED_KEYS, ...Object.values(PORT_KEYS)]);

/** The startup packet a Postgres client opens with to ask for TLS; the server answers `S` or `N`. */
const SSL_REQUEST = Buffer.from("0000000804d2162f", "hex");

/**
 * Run inside the Postgres container, against its own network address: the image trusts loopback and
 * the local socket without a password, so this is the route that checks the file's password.
 */
const AUTHENTICATED_SELECT =
  'PGPASSWORD="$POSTGRES_PASSWORD" PGCONNECT_TIMEOUT=3 psql -h "$(hostname -i)" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT 1"';

/** A run that failed, with one line per cause. */
class StartFailure extends Error {
  /** @param {string[]} lines - The causes. */
  constructor(lines) {
    super(lines.join("; "));
    this.lines = lines;
  }
}

/**
 * @function portOrProblem
 * @description Reads a port from a variable's value and, when the value is not a port, adds that
 *   to the run's list of problems.
 * @param {string} key - The variable that carries the port.
 * @param {string | undefined} raw - Its value, when it is set.
 * @param {string[]} problems - The list a value that is not a port is added to.
 * @returns {number | undefined} The port, or `undefined` when the variable is unset or is not one.
 */
function portOrProblem(key, raw, problems) {
  if (raw === undefined || raw === "") return undefined;
  const port = parsePort(raw);
  if (port === null) problems.push(`${key}=${raw} is not a port`);
  return port ?? undefined;
}

/**
 * @function startFailureFor
 * @description Turns the three error codes a read or a write of the environment file can end in
 *   for a reason the operator can act on into a one-line failure.
 * @param {unknown} error - What the read or the write threw.
 * @param {string} file - The environment file's path.
 * @returns {unknown} A `StartFailure` when the checkout does not exist (`ENOENT`), when it is not a
 *   directory (`ENOTDIR`), or when the write found something where the read had found nothing
 *   (`EEXIST`); any other error as it came.
 */
function startFailureFor(error, file) {
  const code = /** @type {NodeJS.ErrnoException} */ (error).code;
  if (code === "ENOENT") return new StartFailure([`${path.dirname(file)} does not exist`]);
  if (code === "ENOTDIR") return new StartFailure([`${path.dirname(file)} is not a directory`]);
  if (code === "EEXIST") {
    return new StartFailure([
      `${file} exists but reads as absent (a link that leads nowhere?): nothing was written`,
    ]);
  }
  return error;
}

/**
 * @function readIfPresent
 * @description Reads the environment file. `ENOENT` is taken as "no file" and never reported from
 *   here, although a checkout that does not exist ends in the same code: the two cannot be told
 *   apart by a read, and the write that follows an absent file fails with `ENOENT` again when the
 *   checkout is the thing missing, which is where that case is reported.
 * @param {string} file - The environment file's path.
 * @returns {string | null} Its text, or `null` when there is no such file.
 */
function readIfPresent(file) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return null;
    throw startFailureFor(error, file);
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
    const asked = portOrProblem(key, process.env[key], problems);
    if (values === null) {
      ports[name] = asked ?? ports[name];
      continue;
    }
    ports[name] = portOrProblem(key, values[key], problems) ?? ports[name];
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
    throw startFailureFor(error, file);
  }
  process.stdout.write(
    `${NAME}: wrote ${file} with ${entries.length} variables, its secrets random\n`
  );
  return ports;
}

/**
 * @function answers
 * @description Sends one message to a loopback port and judges the first reply.
 * @param {number} port - The port.
 * @param {string | Buffer} message - What to send once connected.
 * @param {(reply: string) => boolean} accept - Whether the reply is the service's.
 * @returns {Promise<boolean>} `false` on a refused connection, a silent peer or another reply.
 */
function answers(port, message, accept) {
  return new Promise((resolve) => {
    const socket = connect({ host: LOOPBACK, port });
    const finish = (/** @type {boolean} */ verdict) => {
      socket.destroy();
      resolve(verdict);
    };
    socket.setTimeout(2000, () => finish(false));
    socket.once("connect", () => socket.write(message));
    socket.once("data", (reply) => finish(accept(reply.toString("latin1"))));
    socket.once("error", () => finish(false));
    socket.once("close", () => resolve(false));
  });
}

/**
 * @function waitFor
 * @description Repeats a probe twice a second until it succeeds or its time runs out.
 * @param {string} failure - What to report when the time runs out.
 * @param {number} seconds - How long the probe may keep failing.
 * @param {() => Promise<boolean>} probe - One attempt.
 * @returns {Promise<void>} Resolves once an attempt succeeds.
 */
async function waitFor(failure, seconds, probe) {
  const deadline = Date.now() + seconds * 1000;
  while (!(await probe())) {
    if (Date.now() >= deadline) throw new StartFailure([failure]);
    await sleep(500);
  }
}

/**
 * @function startServices
 * @description Starts Postgres and Redis from the compose file and waits until both accept a
 *   connection.
 * @param {string} root - The checkout, where `docker-compose.yml` and the environment file are.
 * @param {string} file - The environment file's path, for the messages.
 * @param {{ Postgres: number, Redis: number }} ports - The host port each service is published on.
 * @param {number} waitSeconds - How long each service may take.
 * @returns {Promise<void>} Resolves once both accept a connection.
 */
async function startServices(root, file, ports, waitSeconds) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !OWNED_BY_THE_FILE.has(key))
  );
  const docker = (/** @type {string[]} */ args, /** @type {"ignore" | "inherit" | "pipe"} */ out) =>
    spawnSync("docker", args, { cwd: root, env, encoding: "utf8", stdio: ["ignore", out, out] });

  const version = docker(["compose", "version"], "ignore");
  if (/** @type {NodeJS.ErrnoException | undefined} */ (version.error)?.code === "ENOENT") {
    throw new StartFailure([
      "docker is not on PATH: install Docker Engine with its Compose plugin",
    ]);
  }
  if (version.status !== 0) {
    throw new StartFailure(["`docker compose version` failed: install the Docker Compose plugin"]);
  }

  const up = docker(["compose", "up", "-d", "postgres", "redis"], "inherit");
  if (up.status !== 0) {
    throw new StartFailure([`\`docker compose up -d postgres redis\` exited ${up.status}`]);
  }

  await waitFor(
    `Postgres did not accept a connection on ${LOOPBACK}:${ports.Postgres} within ${waitSeconds} s ` +
      `(\`docker compose logs postgres\`)`,
    waitSeconds,
    async () => {
      const listening = await answers(ports.Postgres, SSL_REQUEST, (reply) => /^[SN]/.test(reply));
      if (!listening) return false;
      const select = docker(
        ["compose", "exec", "-T", "postgres", "sh", "-c", AUTHENTICATED_SELECT],
        "pipe"
      );
      if (/password authentication failed/.test(select.stderr ?? "")) {
        throw new StartFailure([
          `Postgres refused the credentials of ${file}: its data volume was initialised with ` +
            `others (\`docker compose down --volumes\` removes it)`,
        ]);
      }
      return select.status === 0;
    }
  );
  await waitFor(
    `Redis did not answer PING on ${LOOPBACK}:${ports.Redis} within ${waitSeconds} s ` +
      `(\`docker compose logs redis\`)`,
    waitSeconds,
    () => answers(ports.Redis, "PING\r\n", (reply) => reply.startsWith("+PONG"))
  );
  process.stdout.write(
    `${NAME}: Postgres on ${LOOPBACK}:${ports.Postgres} and Redis on ${LOOPBACK}:${ports.Redis} ` +
      `accept connections\n`
  );
}

/**
 * @param {string[]} argv - The command's arguments.
 * @returns {{ root: string, waitSeconds: number, help: boolean } | null} `null` on a usage error.
 */
function parseOptions(argv) {
  const options = {
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
    waitSeconds: 60,
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
    } else if (flag === "--wait-seconds" && /^[1-9]\d*$/.test(value ?? "")) {
      options.waitSeconds = Number(value);
      index += 1;
    } else {
      return null;
    }
  }
  return options;
}

/**
 * @param {string[]} argv - The command's arguments.
 * @returns {Promise<number>} The exit code.
 */
async function main(argv) {
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
    await startServices(options.root, file, ports, options.waitSeconds);
  } catch (error) {
    if (!(error instanceof StartFailure)) throw error;
    for (const line of error.lines) process.stderr.write(`${NAME}: ${line}\n`);
    return 1;
  }
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
