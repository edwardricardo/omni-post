// @ts-check
/**
 * @file platform-start.mjs
 * @description The start sequence of a clean checkout, as far as it goes today: its environment,
 *   then Postgres and Redis from the repository's `docker-compose.yml`, then the database's
 *   migration.
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
 *   SERVICES. `docker compose up -d postgres redis`, run in the checkout and told which two files to
 *   read (`-f docker-compose.yml --env-file .env`), so neither `COMPOSE_FILE` nor
 *   `COMPOSE_ENV_FILES` of the calling shell points it elsewhere, and with every variable the file
 *   owns removed from Compose's own environment: a variable of the calling shell would otherwise
 *   win over the file, and the services would start on values the file does not name. The run
 *   returns only when both accept a connection, and a bare TCP connect does not show that, because
 *   Docker's proxy accepts on the published port before the server behind it is up. Redis must
 *   answer `PING` on its published port. Postgres must answer the protocol's SSL request there, and
 *   then run `SELECT 1` for the user, the password and the database the file names, whatever the
 *   container was started with. `--wait-seconds` bounds each service: a query still running when
 *   it runs out is stopped, and an attempt on a port that says nothing ends at most two seconds
 *   after it.
 *
 *   MIGRATION. `pnpm --filter @infra/prisma run migrate`, the script CI runs (`prisma migrate
 *   deploy`), in the checkout. Prisma's configuration loads the checkout's environment file and
 *   lets a variable the process already holds win over it, so the variables the file owns are
 *   removed here too, and with them a `MIGRATE_DATABASE_URL` of the calling shell, which that
 *   configuration prefers to `DATABASE_URL`: the migration connects where the file says, as the
 *   role the file names. A database that is already migrated is left as it is. Only the database
 *   this run started is migrated: a file whose `MIGRATE_DATABASE_URL`, or else `DATABASE_URL`,
 *   names another host, port, user, password or database is refused before anything is applied,
 *   because a migration cannot be taken back.
 *
 *   Exit codes: 0 both services accept connections and the database is migrated; 1 a step failed,
 *   each cause on its own line; 2 a usage error.
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

Takes a checkout to a generated environment, to Postgres and Redis accepting connections and to
a migrated database.

  --root <dir>         the checkout to start (default: the one this script is in)
  --wait-seconds <n>   how long each service may take to accept a connection (default: 60)
  --help               print this text

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

/**
 * Every variable the environment file owns: none of them reaches Compose from the calling shell.
 * The two port variables are added by name because `REQUIRED_KEYS` is read off a generation that
 * chose no port, and the generator writes a port variable only when one was chosen.
 */
const OWNED_BY_THE_FILE = new Set([...REQUIRED_KEYS, ...Object.values(PORT_KEYS)]);

/**
 * How every call after the first names its two files to Compose, both relative to the checkout it
 * runs in. Named on the command line, they win over `COMPOSE_FILE` and `COMPOSE_ENV_FILES`, which
 * would otherwise let the calling shell start another file's services or interpolate another
 * file's values.
 */
const COMPOSE = ["compose", "-f", "docker-compose.yml", "--env-file", ENVIRONMENT_FILE];

/** How long one attempt waits for a peer that says nothing; a loopback round trip takes far less. */
const PROBE_TIMEOUT_MS = 2000;

/** The pause between two attempts: short beside the default wait, long beside one Compose call. */
const POLL_INTERVAL_MS = 500;

/** The startup packet a Postgres client opens with to ask for TLS; the server answers `S` or `N`. */
const SSL_REQUEST = Buffer.from("0000000804d2162f", "hex");

/**
 * Run inside the Postgres container, against its own network address: the image trusts loopback and
 * the local socket without a password, so this is the route that checks one. `psql` reads the user,
 * the password and the database from the three variables `QUERY_AS` names.
 */
const AUTHENTICATED_SELECT = 'PGCONNECT_TIMEOUT=3 psql -h "$(hostname -i)" -tAc "SELECT 1"';

/**
 * The variable of the environment file behind each one `psql` reads. Each is handed to the
 * container by name alone (`-e PGPASSWORD`): its value travels in the Docker client's environment,
 * never on a command line, and it is the file's, so the query proves the credentials the file's
 * URLs carry.
 */
const QUERY_AS = /** @type {const} */ ({
  PGUSER: "POSTGRES_USER",
  PGPASSWORD: "POSTGRES_PASSWORD",
  PGDATABASE: "POSTGRES_DB",
});

/** What pnpm is asked for: the migration script of the package that holds the schema. */
const MIGRATE = ["--filter", "@infra/prisma", "run", "migrate"];

/** A run that failed, with one line per cause. */
class StartFailure extends Error {
  /** @param {string[]} lines - The causes. */
  constructor(lines) {
    super(lines.join("; "));
    this.lines = lines;
  }
}

/**
 * @function shellEnvironment
 * @description The calling shell's environment as a child of this command receives it: without the
 *   variables the environment file owns, so the file stays their one source.
 * @param {...string} alsoWithout - Other variables this child must not receive.
 * @returns {Record<string, string | undefined>} The environment to hand to the child.
 */
function shellEnvironment(...alsoWithout) {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !OWNED_BY_THE_FILE.has(key) && !alsoWithout.includes(key)
    )
  );
}

/**
 * @function couldNotStart
 * @description The failure of a program that could not be run at all.
 * @param {string} program - The program's name.
 * @param {Error} error - What the attempt to run it reported.
 * @param {string} whenMissing - What to say when it is not on `PATH`.
 * @returns {StartFailure} The failure, in one line.
 */
function couldNotStart(program, error, whenMissing) {
  const { code } = /** @type {NodeJS.ErrnoException} */ (error);
  return new StartFailure([
    code === "ENOENT" ? whenMissing : `${program} could not be run (${code})`,
  ]);
}

/**
 * @function endOf
 * @description How a child that did not succeed ended, for a failure line.
 * @param {{ status: number | null, signal: NodeJS.Signals | null }} child - What the run returned.
 * @returns {string} `exited <code>`, or `was ended by <signal>` when a signal stopped it.
 */
function endOf(child) {
  return child.status === null ? `was ended by ${child.signal}` : `exited ${child.status}`;
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
 * @description Turns what a read or a write of the environment file threw into a one-line failure,
 *   in words the operator can act on for the three error codes whose cause is known.
 * @param {unknown} error - What the read or the write threw.
 * @param {string} file - The environment file's path.
 * @returns {unknown} A `StartFailure` when the checkout does not exist (`ENOENT`), when it is not a
 *   directory (`ENOTDIR`), when the write found something where the read had found nothing
 *   (`EEXIST`), and, with the system's own message, for any other system error (a directory at
 *   the file's path, a link that leads to itself); an error with no system code as it came.
 */
function startFailureFor(error, file) {
  const { code, message } = /** @type {NodeJS.ErrnoException} */ (error);
  if (code === "ENOENT") return new StartFailure([`${path.dirname(file)} does not exist`]);
  if (code === "ENOTDIR") return new StartFailure([`${path.dirname(file)} is not a directory`]);
  if (code === "EEXIST") {
    return new StartFailure([
      `${file} exists but reads as absent (a link that leads nowhere?): nothing was written`,
    ]);
  }
  if (typeof code === "string") return new StartFailure([`cannot use ${file}: ${message}`]);
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
 * @returns {{ values: Record<string, string>, ports: { Postgres: number, Redis: number } }} What
 *   the file holds, and the host port each service is published on.
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
    return { values, ports };
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
  return { values: Object.fromEntries(entries), ports };
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
    socket.setTimeout(PROBE_TIMEOUT_MS, () => finish(false));
    socket.once("connect", () => socket.write(message));
    // Read as `latin1`, which maps each byte to one character: a reply that is not text is still
    // judged byte for byte, where `utf8` would replace the bytes it cannot decode.
    socket.once("data", (reply) => finish(accept(reply.toString("latin1"))));
    socket.once("error", () => finish(false));
    socket.once("close", () => resolve(false));
  });
}

/**
 * @function waitFor
 * @description Repeats a probe, with a pause after each failed attempt, until it succeeds or its
 *   time runs out. At least one attempt is made.
 * @param {string} failure - What to report when the time runs out.
 * @param {number} seconds - How long the probe may keep failing.
 * @param {(msLeft: () => number) => Promise<boolean>} probe - One attempt; it is handed a reading
 *   of the time left, never less than a millisecond, to bound what it waits for.
 * @returns {Promise<void>} Resolves once an attempt succeeds.
 */
async function waitFor(failure, seconds, probe) {
  const deadline = Date.now() + seconds * 1000;
  const msLeft = () => Math.max(deadline - Date.now(), 1);
  while (!(await probe(msLeft))) {
    if (Date.now() >= deadline) throw new StartFailure([failure]);
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * @function startServices
 * @description Starts Postgres and Redis from the compose file and waits until both accept a
 *   connection.
 * @param {string} root - The checkout, where `docker-compose.yml` and the environment file are.
 * @param {string} file - The environment file's path, for the messages.
 * @param {Record<string, string>} values - What the environment file holds.
 * @param {{ Postgres: number, Redis: number }} ports - The host port each service is published on.
 * @param {number} waitSeconds - How long each service may take.
 * @returns {Promise<void>} Resolves once both accept a connection.
 */
async function startServices(root, file, values, ports, waitSeconds) {
  const env = shellEnvironment();
  /**
   * @param {string[]} args - Docker's arguments.
   * @param {"ignore" | "inherit" | "pipe"} out - Where its output goes.
   * @param {{ add?: Record<string, string | undefined>, timeout?: number }} [more] - Variables
   *   for this call alone, and how long it may run before it is stopped.
   */
  const docker = (args, out, more = {}) =>
    spawnSync("docker", args, {
      cwd: root,
      env: { ...env, ...more.add },
      encoding: "utf8",
      stdio: ["ignore", out, out],
      ...(more.timeout !== undefined && { timeout: more.timeout }),
    });

  const version = docker(["compose", "version"], "ignore");
  if (version.error) {
    throw couldNotStart(
      "docker",
      version.error,
      "docker is not on PATH: install Docker Engine with its Compose plugin"
    );
  }
  if (version.status !== 0) {
    throw new StartFailure(["`docker compose version` failed: install the Docker Compose plugin"]);
  }

  const up = docker([...COMPOSE, "up", "-d", "postgres", "redis"], "inherit");
  if (up.status !== 0) {
    throw new StartFailure([`\`docker compose up -d postgres redis\` ${endOf(up)}`]);
  }

  const query = [
    ...COMPOSE,
    "exec",
    "-T",
    ...Object.keys(QUERY_AS).flatMap((name) => ["-e", name]),
    "postgres",
    "sh",
    "-c",
    AUTHENTICATED_SELECT,
  ];
  const queryAs = Object.fromEntries(
    Object.entries(QUERY_AS).map(([name, key]) => [name, values[key]])
  );
  await waitFor(
    `Postgres on ${LOOPBACK}:${ports.Postgres} did not answer a query within ${waitSeconds} s ` +
      `(\`docker compose logs postgres\`)`,
    waitSeconds,
    async (msLeft) => {
      const speaks = await answers(ports.Postgres, SSL_REQUEST, (reply) => /^[SN]/.test(reply));
      if (!speaks) return false;
      const select = docker(query, "pipe", { add: queryAs, timeout: msLeft() });
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
 * @function namesTheStartedDatabase
 * @description Whether a connection URL names the Postgres this run started: loopback, the
 *   published port, spelled out, and the user, the password and the database the environment file
 *   gives the container. Of its query string one parameter is read, `host`, because Prisma connects
 *   to that host in place of the URL's (measured: with `?host=` set it reaches for the other server
 *   while it prints the URL's); a URL that carries one is not this run's database.
 * @param {string} raw - The URL, as the environment file holds it.
 * @param {Record<string, string>} values - What the environment file holds.
 * @param {number} port - The host port Postgres is published on.
 * @returns {boolean} `false` for another database, and for text that is not a URL.
 */
function namesTheStartedDatabase(raw, values, port) {
  try {
    const url = new URL(raw);
    return (
      [LOOPBACK, "localhost"].includes(url.hostname) &&
      !url.searchParams.has("host") &&
      Number(url.port) === port &&
      decodeURIComponent(url.username) === values.POSTGRES_USER &&
      decodeURIComponent(url.password) === values.POSTGRES_PASSWORD &&
      decodeURIComponent(url.pathname.slice(1)) === values.POSTGRES_DB
    );
  } catch (error) {
    if (error instanceof TypeError || error instanceof URIError) return false;
    throw error;
  }
}

/**
 * @function migrateDatabase
 * @description Applies the migrations the database lacks, through the repository's own script,
 *   with its output shown as it comes.
 * @param {string} root - The checkout.
 * @param {string} file - The environment file's path, for the messages.
 * @param {Record<string, string>} values - What the environment file holds.
 * @param {number} port - The host port Postgres is published on.
 * @returns {void}
 */
function migrateDatabase(root, file, values, port) {
  const key = values.MIGRATE_DATABASE_URL ? "MIGRATE_DATABASE_URL" : "DATABASE_URL";
  if (!namesTheStartedDatabase(values[key] ?? "", values, port)) {
    throw new StartFailure([
      `${key} of ${file} does not name the database this run started (${LOOPBACK}:${port}, with ` +
        `the file's POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB): nothing was migrated, ` +
        `because a migration cannot be taken back (\`pnpm db:migrate\` migrates the database ` +
        `the file names)`,
    ]);
  }
  const migrate = spawnSync("pnpm", MIGRATE, {
    cwd: root,
    env: shellEnvironment("MIGRATE_DATABASE_URL"),
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (migrate.error) {
    throw couldNotStart(
      "pnpm",
      migrate.error,
      "pnpm is not on PATH: the migration runs through it"
    );
  }
  if (migrate.status !== 0) {
    throw new StartFailure([`\`pnpm ${MIGRATE.join(" ")}\` ${endOf(migrate)}`]);
  }
  process.stdout.write(`${NAME}: the database is migrated\n`);
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
    const { values, ports } = prepareEnvironment(file);
    await startServices(options.root, file, values, ports, options.waitSeconds);
    migrateDatabase(options.root, file, values, ports.Postgres);
  } catch (error) {
    if (!(error instanceof StartFailure)) throw error;
    for (const line of error.lines) process.stderr.write(`${NAME}: ${line}\n`);
    return 1;
  }
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
