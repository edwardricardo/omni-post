// @ts-check
/**
 * @file platform-start.mjs
 * @description The start sequence of a clean checkout, as far as it goes today: its environment,
 *   then Postgres and Redis from the repository's `docker-compose.yml`, then the database's
 *   migration, then the API.
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
 *   then run a query for the user, the password and the database the file names, whatever its
 *   data volume was initialised with. Before that query, and inside the container, the three
 *   values the container received from Compose are compared with the three this command read
 *   from the file: Compose and Node do not read every line of an environment file alike (a `#`
 *   or a backtick in a value is enough), and a container created with another value than the
 *   one checked here ends the run in one line that names the variable. `--wait-seconds` bounds
 *   each service: a query still running when
 *   it runs out is stopped, and an attempt on a port that says nothing ends at most two seconds
 *   after it.
 *
 *   MIGRATION. `pnpm --filter @infra/prisma run migrate`, the script CI runs (`prisma migrate
 *   deploy`), in the checkout. Prisma's configuration loads the checkout's environment file and
 *   lets a variable the process already holds win over it, so the variables the file owns are
 *   removed here too, and with them a `MIGRATE_DATABASE_URL` of the calling shell, which that
 *   configuration prefers to `DATABASE_URL`: the migration connects where the file says, as the
 *   role the file names. A database that is already migrated is left as it is. Only the database
 *   this run started is migrated, and that is proven against the server, never read off a URL's
 *   text, which Compose, Node and Prisma each read their own way. The query that shows Postgres
 *   ready, run inside the container for the database the file names (the one the container was
 *   created with, as the services step has just shown), returns which database it reached (the
 *   identifier its cluster was given when it was initialised, and the database's oid) and
 *   whether that database is the one its data volume was initialised for: the image's init
 *   script, `postgres/init/mark-initial-database.sql`, marks that one, once, when it creates the
 *   volume. A database without the mark is not migrated, whether the volume was initialised for
 *   another database or before the mark existed. Then, before anything is applied, Prisma runs
 *   through the connection the migration will use (`prisma db execute`, same checkout, same
 *   environment) a statement that fails unless it reached that same database. Another server,
 *   another database of the same server and a database that does not exist each end the run
 *   with nothing applied, because a migration cannot be taken back; a URL spelled another way
 *   that reaches the same database is accepted, since it is that database. Four
 *   limits, stated: the proof and the migration are two connections, resolved alike a moment
 *   apart; a `schema` parameter in the file's URL moves the migration to another schema of that
 *   database, and the run still ends by calling the database migrated; `--wait-seconds` bounds
 *   the proof, which writes nothing and is stopped when it runs out (with SIGTERM, so a proof that
 *   ignores that signal is not cut), and not the migration, which is left to finish because one
 *   stopped half-way leaves a database that no later run repairs by itself; and Prisma hands its
 *   schema engine the URL, password included, on a command line, as it does for every migration of
 *   this repository, so `ps` on the host shows it during both calls.
 *
 *   API. `pnpm --filter @apps/api dev`, the script that starts the API from source, run in the
 *   checkout detached: the run returns once `/health` answers 200 on loopback and leaves the API
 *   running. The API loads the environment file itself and lets a variable its process holds win,
 *   so it receives the calling shell's environment without the variables the file owns, and its
 *   port is the one it would take alone: `PORT` of the calling shell if the shell sets it, else of
 *   the file, else 3000 (no variable is generated for it). An empty `PORT` in the calling shell is
 *   a value that is set: the API's schema reads an empty value as absent, so the port is the
 *   default 3000 and the file's value is not consulted (an empty value in the file gives 3000
 *   too). A value that is not a port is refused with the other problems, before anything is written
 *   or started, and the run says which port it settled on.
 *
 *   WHAT THE RUN STARTS, AND WHAT IT LEAVES. It starts pnpm, detached, so pnpm leads a process
 *   group and a session of its own; its shell and the API's node run in another process group of
 *   that session (measured on the real pnpm). What the run records in `api.pid`, and names in its
 *   lines, is that pnpm process: the one this run started to run the API, whose session holds the
 *   API. It is not the API, and it can end while the API lives on. The output goes to `api.log`,
 *   both under `.tmp/` in the checkout, which git ignores. The run prints both and how to stop the
 *   API: `kill -s TERM -- -<id>`, a normal termination signal sent to pnpm's process group, which
 *   passes it on. That ends the API only if the API attends the signal, and the text says so, how
 *   to see whether it still runs (the port, or the recorded pnpm, which settles less) and that its
 *   session is then ended by hand. This command sends no signal to the API it starts nor to the
 *   recorded process (its calls of `kill` there only ask, with signal 0, whether the recorded
 *   process exists); the SIGTERM it sends to the Docker query and to Prisma's proof when
 *   `--wait-seconds` runs out belongs to the steps before. It does not stop the API it started. A
 *   wait that runs out fails the run and says, by name, that the pnpm process is still running and
 *   has not been stopped; a pnpm that ended first fails it at once, says that pnpm ended and that
 *   the other processes of its session, the API among them, were not checked.
 *   The process an earlier run recorded is consulted before the port (a record that is not an
 *   integer greater than 1 is read as no record: 1 is init, which always exists). While that
 *   process exists no second API is started and the record and the log are left alone: if the
 *   port accepts connections and `/health` answers 200, the run says so and goes on, as a second
 *   run; if nothing accepts connections yet (the real API binds only at the end of its boot) the
 *   run waits within `--wait-seconds` for `/health`, looking at the recorded process again after
 *   each attempt. One that ends during the wait fails the run at once, which says that it ended
 *   without `/health` answering 200 and that no API was started, and leaves the record as it is
 *   (a next run reads a record of a process that is gone as no record). If the wait runs out with
 *   the process still there, the run says only what it knows: the recorded process exists, it may
 *   be the pnpm of an API an earlier run started that is still starting or failed to start, and
 *   nothing was started or stopped. With nothing recorded, and something accepting connections on
 *   the port, the run refuses and claims only that the port is in use and that it holds no record
 *   of a running API it started. A recorded id that the system has given to another process cannot
 *   be told from the pnpm of the API, a limit. Both failures of a start end with the last lines of
 *   the log. Polling `/health` is a request like any other: the API's memory alert may log once at
 *   error level a few seconds after it boots, which says nothing about memory left.
 *
 *   THE SEQUENCE IS CUMULATIVE. A step that fails leaves what the steps before it did (the
 *   environment file, the running services, the migrations already applied), and a second run
 *   goes on from there.
 *
 *   Exit codes: 0 both services accept connections, the database is migrated and the API answers
 *   `/health` with 200; 1 a step failed, each cause on its own line; 2 a usage error.
 *
 *   Usage: `node scripts/start/platform-start.mjs [--root <dir>] [--wait-seconds <n>]`
 * @layer infrastructure
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
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
  apiPort,
  generateEnvironment,
  missingKeys,
  parsePort,
  readEnvironment,
  renderEnvironmentFile,
} from "./lib/start-environment.mjs";

const NAME = "platform-start";

const USAGE = `usage: node scripts/start/platform-start.mjs [--root <dir>] [--wait-seconds <n>]

Takes a checkout to a generated environment, to Postgres and Redis accepting connections, to a
migrated database and to an API running from source that answers /health with 200.

  --root <dir>         the checkout to start (default: the one this script is in)
  --wait-seconds <n>   how long each service may take to accept a connection, Prisma's proof
                       of the database to answer and the API to answer /health (default: 60)
  --help               print this text

A checkout with no ${ENVIRONMENT_FILE} file receives one, its secrets random; an existing file is
never written, and the run fails naming each required variable it lacks. POSTGRES_HOST_PORT and
REDIS_HOST_PORT, set when the file is generated, choose the host ports the compose file publishes
Postgres and Redis on.

The database is migrated with \`pnpm --filter @infra/prisma run migrate\`, so pnpm must be on PATH,
and only after Prisma proves, through the connection the migration will use, that it reaches the
database this run started, the one its data volume was initialised for: another server or another
database ends the run with nothing applied.

The API is started detached with \`pnpm --filter @apps/api dev\` and left running; its port is PORT,
of the calling shell or else of the file, else 3000, and a port something else holds refuses the run.
Its pnpm process's id and its log are under .tmp/ in the checkout, and the run prints how to stop
it. A run whose wait for the API runs out leaves the API it started running, says so, and sends
no signal to it. An empty PORT in the calling shell counts as set and gives 3000, as it does for
the API.
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
 * Which database a connection reached, as the server itself says it: the identifier its cluster
 * was given when it was initialised, and the oid of the database. Two numbers, the same on every
 * connection to that database of that server and on no other; any role may ask for them.
 */
const DATABASE_IDENTITY =
  "(SELECT system_identifier FROM pg_control_system())::text || ' ' || " +
  "(SELECT oid FROM pg_database WHERE datname = current_database())::text";

/**
 * Whether the database a connection reached is the one its data volume was initialised for: the
 * image's init script (`postgres/init/mark-initial-database.sql`) leaves this setting on that
 * database and on no other, at the one moment the answer is knowable.
 */
const INITIAL_DATABASE =
  "CASE WHEN current_setting('omnipost.initial_database', true) = 'on' THEN 'on' ELSE 'off' END";

/**
 * What the readiness query answers: `DATABASE_IDENTITY`, then `INITIAL_DATABASE`. Of an answer,
 * nothing but the identity's two numbers is ever written into a statement.
 */
const ANSWER_SHAPE = /^(\d+ \d+) (on|off)$/;

/**
 * The variable of the environment file behind each one `psql` reads. Each is handed to the
 * container by name alone (`-e PGPASSWORD`): its value travels in the Docker client's environment,
 * never on a command line, and it is the file's, so the query proves the credentials the file's
 * URLs carry. The order of the entries is observable: it fixes the order of the `-e` flags, of the
 * comparisons in `SAME_READING` and of the names its message prints.
 */
const QUERY_AS = /** @type {const} */ ({
  PGUSER: "POSTGRES_USER",
  PGPASSWORD: "POSTGRES_PASSWORD",
  PGDATABASE: "POSTGRES_DB",
});

/** How the container says that Compose gave it another value than this command read. */
const READ_DIFFERENTLY = "read differently:";

/**
 * Run inside the Postgres container before the query: each value the container was created with
 * (`$POSTGRES_DB`, Compose's reading of the file) against the one this command read and handed in
 * by name (`$PGDATABASE`, Node's reading). The two readers do not take every line alike, and the
 * database the query names must be the one the container was told to create. A value is compared
 * where both readings are, and never printed: only the variable's name is.
 */
const SAME_READING =
  "d=; " +
  Object.entries(QUERY_AS)
    .map(([asked, key]) => `[ "$${key}" = "$${asked}" ] || d="$d ${key}"; `)
    .join("") +
  `if [ -n "$d" ]; then echo "${READ_DIFFERENTLY}$d" >&2; exit 3; fi`;

/**
 * What the comparison's message is, and the only thing it is: the text, then one or more names of
 * the variables `QUERY_AS` holds, each after a space. `psql` forwards the server's own messages to
 * the same stream, so a line that merely starts like the verdict is not one.
 */
const VERDICT = new RegExp(`^${READ_DIFFERENTLY}(?: (?:${Object.values(QUERY_AS).join("|")}))+$`);

/**
 * Run inside the Postgres container, against its own network address: the image trusts loopback and
 * the local socket without a password, so this is the route that checks one. `psql` reads the user,
 * the password and the database from the three variables `QUERY_AS` names, and prints which
 * database answered and whether it is the initial one. The line is not a straight run to `psql`:
 * `SAME_READING` comes first and can end it with exit 3 before `psql` is called, so an exit 3 from
 * this line is the comparison's, never a query's.
 */
const AUTHENTICATED_IDENTITY = `${SAME_READING}; PGCONNECT_TIMEOUT=3 psql -h "$(hostname -i)" -tAc "SELECT ${DATABASE_IDENTITY} || ' ' || ${INITIAL_DATABASE}"`;

/**
 * What pnpm is asked for first: Prisma, in the package that holds the schema, running the statement
 * it is given on its input through the connection its configuration resolves, the migration's own.
 */
const PROVE = ["--filter", "@infra/prisma", "exec", "prisma", "db", "execute", "--stdin"];

/** What pnpm is asked for then: the migration script of that package. */
const MIGRATE = ["--filter", "@infra/prisma", "run", "migrate"];

/** What pnpm is asked for last: the script that starts the API from source. */
const API = ["--filter", "@apps/api", "dev"];

/** Where the API's process group id and output go, in a directory git ignores. */
const API_DIRECTORY = ".tmp";

/** How many of the log's last lines a failure shows. */
const LOG_LINES = 10;

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
 * @returns {{ values: Record<string, string>, ports: { Postgres: number, Redis: number },
 *   api: number }} What the file holds, the host port each service is published on and the port the
 *   API takes.
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
  const api = apiPort(process.env.PORT, values?.PORT);
  if (api === null) problems.push(`PORT=${process.env.PORT ?? values?.PORT} is not a port`);
  if (problems.length > 0) throw new StartFailure(problems);

  if (values !== null) {
    process.stdout.write(`${NAME}: ${file} holds every required variable\n`);
    process.stdout.write(`${NAME}: the API takes port ${api}\n`);
    return { values, ports, api };
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
  process.stdout.write(`${NAME}: the API takes port ${api}\n`);
  return { values: Object.fromEntries(entries), ports, api };
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
 * @returns {Promise<string>} Resolves once both accept a connection, with what Postgres answered
 *   inside the container when asked which database it is.
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
    AUTHENTICATED_IDENTITY,
  ];
  const queryAs = Object.fromEntries(
    Object.entries(QUERY_AS).map(([name, key]) => [name, values[key]])
  );
  // `waitFor` reports only whether an attempt succeeded, so the identity leaves the probe through
  // this variable: every attempt sets it, and the one that succeeds is the last.
  let answered = "";
  await waitFor(
    `Postgres on ${LOOPBACK}:${ports.Postgres} did not answer a query within ${waitSeconds} s ` +
      `(\`docker compose logs postgres\`)`,
    waitSeconds,
    async (msLeft) => {
      const speaks = await answers(ports.Postgres, SSL_REQUEST, (reply) => /^[SN]/.test(reply));
      if (!speaks) return false;
      const select = docker(query, "pipe", { add: queryAs, timeout: msLeft() });
      const said =
        select.status === 3
          ? (select.stderr ?? "").split("\n").find((line) => VERDICT.test(line))
          : undefined;
      if (said !== undefined) {
        const names = Object.values(QUERY_AS).filter((key) => said.split(" ").includes(key));
        throw new StartFailure([
          `${names.join(", ")} of ${file}: Docker Compose read another value than this command ` +
            `did, so the Postgres container was not created with what the file's URLs name ` +
            `(between single quotes both read a value alike)`,
        ]);
      }
      if (/password authentication failed/.test(select.stderr ?? "")) {
        throw new StartFailure([
          `Postgres refused the credentials of ${file}: its data volume was initialised with ` +
            `others (\`docker compose down --volumes\` removes it)`,
        ]);
      }
      answered = (select.stdout ?? "").trim();
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
  return answered;
}

/**
 * @function migrateDatabase
 * @description Applies the migrations the database lacks, through the repository's own script,
 *   with its output shown as it comes, and only to the database this run started: it must be
 *   the one its data volume was initialised for, and Prisma first proves, through the connection
 *   the migration will use, that it reaches it. What that proof prints is shown only when it
 *   fails.
 * @param {string} root - The checkout.
 * @param {string} file - The environment file's path, for the messages.
 * @param {string} answered - What the database said of itself inside the container.
 * @param {number} waitSeconds - How long the proof may take; the migration has no limit.
 * @returns {void}
 */
function migrateDatabase(root, file, answered, waitSeconds) {
  const said = ANSWER_SHAPE.exec(answered);
  if (said === null) {
    throw new StartFailure([
      `Postgres did not say which database it is (a cluster identifier, a database oid and ` +
        `whether it is the initial one were expected): nothing was migrated`,
    ]);
  }
  const [, started, initial] = said;
  if (initial !== "on") {
    throw new StartFailure([
      `POSTGRES_DB of ${file} names a database without the mark the Postgres image leaves on the ` +
        `one its data volume is initialised for: the volume was initialised for another ` +
        `database, or before that mark existed; nothing was migrated (\`docker compose down ` +
        `--volumes\` removes the volume and its data, and the next run initialises a new one; ` +
        `\`pnpm db:migrate\` migrates the database the file names, keeping its data, outside ` +
        `this command's guard)`,
    ]);
  }
  // Both calls get the same environment, so Prisma's configuration resolves the same URL for the
  // proof and for the migration.
  const env = shellEnvironment("MIGRATE_DATABASE_URL");
  /**
   * @param {string[]} args - pnpm's arguments.
   * @param {import("node:child_process").SpawnSyncOptionsWithStringEncoding} how - Its input,
   *   where its output goes and, for a call that may be stopped, how long it may run.
   */
  const pnpm = (args, how) => {
    const child = spawnSync("pnpm", args, { cwd: root, env, ...how });
    // A call stopped for running out of time is the caller's to report: the program did run.
    if (child.error && /** @type {NodeJS.ErrnoException} */ (child.error).code !== "ETIMEDOUT") {
      throw couldNotStart(
        "pnpm",
        child.error,
        "pnpm is not on PATH: the migration runs through it"
      );
    }
    return child;
  };

  const proof = pnpm(PROVE, {
    encoding: "utf8",
    timeout: waitSeconds * 1000,
    input:
      `DO $$ BEGIN IF (${DATABASE_IDENTITY}) IS DISTINCT FROM '${started}' THEN ` +
      `RAISE EXCEPTION 'this connection is not the database this run started'; END IF; END $$;\n`,
  });
  if (proof.status !== 0) {
    process.stderr.write(`${proof.stdout}${proof.stderr}`);
    if (proof.error) {
      throw new StartFailure([
        `\`pnpm ${PROVE.join(" ")}\` did not answer within ${waitSeconds} s and was stopped: ` +
          `nothing was migrated`,
      ]);
    }
    throw new StartFailure([
      `MIGRATE_DATABASE_URL of ${file}, or else its DATABASE_URL, does not reach the database ` +
        `this run started, or could not be asked (\`pnpm ${PROVE.join(" ")}\` ${endOf(proof)}): ` +
        `nothing was migrated, because a migration cannot be taken back`,
    ]);
  }
  const migrate = pnpm(MIGRATE, { encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] });
  if (migrate.status !== 0) {
    throw new StartFailure([`\`pnpm ${MIGRATE.join(" ")}\` ${endOf(migrate)}`]);
  }
  process.stdout.write(`${NAME}: the database is migrated\n`);
}

/**
 * @function accepts
 * @description Whether something accepts connections on a loopback port.
 * @param {number} port - The port.
 * @returns {Promise<boolean>} `true` when a connection is made, and also when the attempt neither
 *   succeeds nor fails in time, because a port that cannot be told apart from a held one is not
 *   free; `false` when the connection is refused.
 */
function accepts(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: LOOPBACK, port });
    socket.setTimeout(PROBE_TIMEOUT_MS, () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

/**
 * @function healthy
 * @description Whether `/health` answers 200 on a loopback port.
 * @param {number} port - The port.
 * @param {number} msLeft - How long the whole wait has left, to bound the attempt by.
 * @returns {Promise<boolean>} `false` on a refused connection, a silent peer or another status.
 */
function healthy(port, msLeft) {
  return new Promise((resolve) => {
    const request = get(
      { host: LOOPBACK, port, path: "/health", timeout: Math.min(PROBE_TIMEOUT_MS, msLeft) },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      }
    );
    request.once("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.once("error", () => resolve(false));
  });
}

/**
 * @function recordedProcess
 * @description The process the run before this one recorded for its API, when it still exists. What
 *   is recorded is the pnpm process that run started to run the API, which leads the session that
 *   holds the API. It is only looked at: nothing here ever signals it. Only a decimal integer
 *   greater than 1 is a record: 1 is init, which always exists and is never a pnpm this command
 *   started, so a record holding it reads as no record, as one of a process that is gone does.
 * @param {string} pidFile - The file the process id is kept in.
 * @returns {number | null} The id, or `null` when none is recorded, the record is not an integer
 *   greater than 1 or no such process exists.
 */
function recordedProcess(pidFile) {
  let recorded;
  try {
    recorded = readFileSync(pidFile, "utf8").trim();
  } catch {
    return null;
  }
  if (!/^[1-9]\d*$/.test(recorded) || Number(recorded) < 2) return null;
  return exists(Number(recorded)) ? Number(recorded) : null;
}

/**
 * @function exists
 * @description Whether a process with this id exists, asked with signal 0, which delivers nothing:
 *   the only way this command calls `kill` on the recorded process.
 * @param {number} pid - The process id, an integer greater than 1.
 * @returns {boolean} `true` also for another user's process, which exists but may not be signalled.
 */
function exists(pid) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === "EPERM";
  }
  return true;
}

/**
 * @function reportApi
 * @description Says where the API answers, where its output goes and how to stop it.
 * @param {boolean} earlier - Whether the API is one this command started in an earlier run.
 * @param {number} port - The port.
 * @param {number} pid - The pnpm process that runs the API: it leads the process group the stop
 *   signal is sent to and the session that holds the API, and it is what `api.pid` records.
 * @param {string} logFile - The log's path.
 * @param {string} pidFile - The path of the file that records the process.
 * @returns {void}
 */
function reportApi(earlier, port, pid, logFile, pidFile) {
  const where = `on ${LOOPBACK}:${port} (run by the pnpm process ${pid}, log ${logFile})`;
  process.stdout.write(
    earlier
      ? `${NAME}: the API this command started earlier already answers /health with 200 ${where}: no second API was started\n`
      : `${NAME}: the API answers /health with 200 ${where}\n`
  );
  // The signal reaches pnpm alone, and pnpm passes it on: whether the API ends depends on the API.
  process.stdout.write(
    `${NAME}: stop it with \`kill -s TERM -- -${pid}\`: a normal termination signal, sent to the ` +
      `process group of pnpm (process ${pid}, which runs the API and leads the session that holds ` +
      `it), which passes it on; it ends the API only if the API attends it, and one that ignores ` +
      `it keeps running. To see whether the API still runs, check whether ${LOOPBACK}:${port} ` +
      `accepts connections, or whether the pnpm process ${pid}, recorded in ${pidFile}, still ` +
      `exists (it can end while the API lives on, so only the port settles it); if the API still ` +
      `runs, end the processes of the session by hand (\`ps -s ${pid}\` lists them). pnpm writes a ` +
      `failed-command line in the log when the API ends, which is expected\n`
  );
}

/**
 * @function recordedNote
 * @description What the run says of a recorded process that still exists and that it starts no
 *   second API for: only what it knows. The id could also have been given to another process.
 * @param {string} pidFile - The file the process is recorded in.
 * @param {string} logFile - The log's path.
 * @param {number} recorded - The recorded process.
 * @returns {string} One failure line.
 */
function recordedNote(pidFile, logFile, recorded) {
  return (
    `the process recorded in ${pidFile} (${recorded}) still exists and may be the pnpm of an API ` +
    `an earlier run started, which is still starting or failed to start: nothing was started and ` +
    `nothing was stopped (\`ps -s ${recorded}\` lists its session, ${logFile} its output)`
  );
}

/**
 * @function startApi
 * @description Starts the API from source, detached, and waits until `/health` answers 200. The
 *   process an earlier run recorded is consulted first: while it exists no second API is started,
 *   and the run goes on as a second run once `/health` answers, whether or not the port is bound
 *   yet (the real API binds it only at the end of its boot). While it waits on that process it
 *   looks at it again after each attempt: one that has ended fails the run at once, the record
 *   left as it is, and a wait that runs out with the process still there fails it with a note that
 *   says only what is known. With nothing recorded, nothing is started when something accepts
 *   connections on the port. While it waits the run watches its child: a child that exits fails
 *   the run at once, and a wait that runs out fails it with the API still running. No signal
 *   reaches the API or the recorded process.
 * @param {string} root - The checkout.
 * @param {number} port - The port the API takes.
 * @param {number} waitSeconds - How long `/health` may take to answer 200.
 * @returns {Promise<void>} Resolves once the API answers, or once the earlier one is found to.
 */
async function startApi(root, port, waitSeconds) {
  const directory = path.join(root, API_DIRECTORY);
  const pidFile = path.join(directory, "api.pid");
  const logFile = path.join(directory, "api.log");

  const recorded = recordedProcess(pidFile);
  const bound = await accepts(port);
  if (recorded !== null) {
    if (bound) {
      if (await healthy(port, PROBE_TIMEOUT_MS)) {
        reportApi(true, port, recorded, logFile, pidFile);
        return;
      }
      throw new StartFailure([
        `${LOOPBACK}:${port} is already in use, and /health does not answer 200 there`,
        recordedNote(pidFile, logFile, recorded),
      ]);
    }
    process.stdout.write(
      `${NAME}: the process recorded in ${pidFile} (${recorded}) still exists and nothing ` +
        `accepts connections on ${LOOPBACK}:${port} yet: no second API is started, and /health ` +
        `is awaited for up to ${waitSeconds} s\n`
    );
    // The process was found to exist before the wait, and it can end during it: looked at only
    // then, an ended one would be waited on to the end and said to still exist. The id itself is
    // asked, not the record, which a removed or rewritten file would make read as an ended process.
    const ended =
      `the process recorded in ${pidFile} (${recorded}) ended during the wait without /health ` +
      `on ${LOOPBACK}:${port} answering 200, and no API was started`;
    let gone = false;
    try {
      await waitFor(
        `/health on ${LOOPBACK}:${port} did not answer 200 within ${waitSeconds} s`,
        waitSeconds,
        async (msLeft) => {
          if (await healthy(port, msLeft())) return true;
          gone = !exists(recorded);
          if (gone) throw new StartFailure([ended]);
          return false;
        }
      );
    } catch (error) {
      if (!(error instanceof StartFailure) || gone) throw error;
      // It can end between the last attempt and the end of the wait.
      const note = exists(recorded) ? recordedNote(pidFile, logFile, recorded) : ended;
      throw new StartFailure([...error.lines, note]);
    }
    reportApi(true, port, recorded, logFile, pidFile);
    return;
  }
  if (bound) {
    throw new StartFailure([
      `${LOOPBACK}:${port} is already in use, and this command holds no record of a running API ` +
        `it started: the port may be held by anything, an API whose record was removed when its ` +
        `pnpm ended included; no API was started`,
    ]);
  }

  mkdirSync(directory, { recursive: true });
  const log = openSync(logFile, "w");
  const child = spawn("pnpm", API, {
    cwd: root,
    env: shellEnvironment(),
    detached: true,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  const state =
    /** @type {{ ended: { status: number | null, signal: NodeJS.Signals | null } | null }} */ ({
      ended: null,
    });
  child.once("exit", (status, signal) => {
    state.ended = { status, signal };
  });
  const notRun = await new Promise((resolve) => {
    child.once("spawn", () => resolve(null));
    child.once("error", resolve);
  });
  if (notRun !== null) {
    throw couldNotStart(
      "pnpm",
      /** @type {Error} */ (notRun),
      "pnpm is not on PATH: the API starts through it"
    );
  }
  const pid = /** @type {number} */ (child.pid);
  writeFileSync(pidFile, `${pid}\n`);

  try {
    await waitFor(
      `/health on ${LOOPBACK}:${port} did not answer 200 within ${waitSeconds} s`,
      waitSeconds,
      async (msLeft) => {
        if (state.ended !== null) {
          throw new StartFailure([
            `the pnpm process this run started to run the API (process ${pid}) ` +
              `${endOf(state.ended)} before /health answered 200`,
          ]);
        }
        return healthy(port, msLeft());
      }
    );
  } catch (error) {
    if (!(error instanceof StartFailure)) throw error;
    // So the run can end while the API it started still runs: nothing here signals it.
    child.unref();
    const lines = [...error.lines];
    if (state.ended === null) {
      lines.push(
        `the pnpm process this run started to run the API (process ${pid}, recorded in ` +
          `${pidFile}) was still running when the wait ended and has not been stopped; its ` +
          `session holds the API: \`ps -s ${pid}\` lists the processes of that session, to end by hand`
      );
    } else {
      // What pnpm ran may outlive it, and nothing here looked.
      lines.push(
        `the other processes of its session, the API among them, were not checked: ` +
          `\`ps -s ${pid}\` lists any still running`
      );
      rmSync(pidFile, { force: true });
    }
    let written = "";
    try {
      written = readFileSync(logFile, "utf8");
    } catch {
      // No log to show: the failure stands without it.
    }
    const tail = written.trimEnd().split("\n").slice(-LOG_LINES).filter(Boolean);
    if (tail.length > 0)
      lines.push(`the last lines of ${logFile}:`, ...tail.map((line) => `  ${line}`));
    throw new StartFailure(lines);
  }
  child.unref();
  reportApi(false, port, pid, logFile, pidFile);
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
    const { values, ports, api } = prepareEnvironment(file);
    const answered = await startServices(options.root, file, values, ports, options.waitSeconds);
    migrateDatabase(options.root, file, answered, options.waitSeconds);
    await startApi(options.root, api, options.waitSeconds);
  } catch (error) {
    if (!(error instanceof StartFailure)) throw error;
    for (const line of error.lines) process.stderr.write(`${NAME}: ${line}\n`);
    return 1;
  }
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
