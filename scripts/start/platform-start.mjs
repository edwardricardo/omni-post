// @ts-check
/**
 * @file platform-start.mjs
 * @description The start sequence of a clean checkout, as far as it goes today: its environment,
 *   then Postgres and Redis from the repository's `docker-compose.yml`, then the database's
 *   migration, then the API, then the workers, then the administration portal.
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
 *   WORKERS. Once the API answers, `pnpm --filter @apps/workers dev` starts the workers from
 *   source, detached, in the same stage the API went through: the run returns once
 *   `/health/ready` answers 200 on their port and leaves them running. Their port is `METRICS_PORT`,
 *   read as `PORT` is: of the calling shell if the shell sets it, else of the file, else 3300, the
 *   workers' own default, and an empty value in the shell or in the file gives 3300 too. A value
 *   that is not a port is refused, and so is a port equal to the API's, both with the other
 *   problems, before anything is written or started; the run says which port they take. The
 *   workers load the checkout's environment file themselves, and they choose it by `NODE_ENV`
 *   (`.env.test` when it is `test`), so they receive the API's environment without `NODE_ENV` as
 *   well: a calling shell's `NODE_ENV=test` would send them to another file, which a clean checkout
 *   lacks, while the run generated and checked `.env`. The API still receives it.
 *
 *   ADMINISTRATION PORTAL. Once the workers answer, `pnpm --filter @apps/admin dev` starts the
 *   administration portal from source, detached, in the same stage again. Its port is the one its
 *   package fixes on that script (`next dev -p 3100` in `apps/admin/package.json`, read from the
 *   checkout's own file), never one settled from the environment, since `-p` wins over `PORT`; a
 *   checkout whose file names no port that is a port is refused with the other problems, and one
 *   with no such file fails at this stage, before anything is started for the portal. The run
 *   returns once three paths answer 200 on that port, each asked once the one before it does:
 *   `/api/health`, which touches nothing; `/en/login`, exactly 200 and never a redirect, since a
 *   page is what fails while a workspace package the portal imports is not built (DEF-85); and
 *   `/api/backend/health`, which the portal forwards to the API, so the run proves the portal
 *   reaches the API it started. For that the portal receives
 *   `API_URL=http://127.0.0.1:<the API's port>`, unless the calling shell sets `API_URL`, whose
 *   value then wins, as a shell's `PORT` does for the API. It receives the API's environment
 *   without `NODE_ENV`, as the workers do: Next.js chooses the portal's own environment files by
 *   it (`apps/admin/.env.test*` under `test`). Its `predev` script builds every workspace package
 *   the portal depends on before `next dev` starts.
 *
 *   PORTS. The API, the workers and the portal each take a port of their own: a port two of them
 *   would share is refused with the other problems, before anything is written or started.
 *
 *   THE APP DESCRIPTOR. The stage runs over a descriptor of the app it starts (`App`; `API`,
 *   `WORKERS` and `ADMIN` its three values): the name every line of the stage calls the app and the
 *   words that agree with it (the API is named by a singular noun, the workers by a plural one),
 *   what pnpm is asked for, what of the calling shell's environment the app must not receive and
 *   what is added to it, the record and the log under the checkout, the path that must answer 200,
 *   the pages that must answer 200 after it, and the port. What this header says of the API,
 *   `api.pid`, `api.log` and `/health` holds for the workers with `workers.pid`, `workers.log` and
 *   `/health/ready`, and for the portal with `admin.pid`, `admin.log` and its three paths.
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
 *   session is then ended by hand. The run never signals the process an earlier run recorded (its
 *   calls of `kill` on it only ask, with signal 0, whether it exists). It signals only the session
 *   of the pnpm it started itself, and only when that start fails: a wait that runs out, or a pnpm
 *   that ends before `/health` answers 200. It then lists that session's processes from `/proc`
 *   (Linux only), whatever process group each is in, sends SIGTERM to each and SIGKILL to those
 *   still running 10 s later, and says which it signalled, each with its command, and whether any
 *   is left: the record is removed only when none is, and otherwise kept, with each survivor
 *   named. A process that ends while it is listed is not counted (its entry is gone, or reading it
 *   fails with ESRCH); any other failure to read `/proc` ends the sweep and keeps the record, and so
 *   does a host where this command cannot read its own ids there (`/proc/self/stat`, which macOS
 *   does not have) or a session id the guard refuses: an empty listing then says nothing of the
 *   session, so it is never reported as an empty session. Every signal it sends a process goes
 *   through one guard, which refuses a target whose absolute value is not an integer greater than
 *   1, and this command's own process, group and session. While a process of the session lives,
 *   the system gives its id to no other process; once the session is empty and pnpm is reaped the
 *   id is free again, and a new session leader given it before the sweep reads `/proc` would be
 *   swept, a limit. The SIGTERM that Node's own timeout sends to the Docker query and to Prisma's
 *   proof when `--wait-seconds` runs out belongs to the steps before.
 *   Each app's pnpm leads a session of its own, so the run prints a stop line for each, and each
 *   line ends one app's session: stopping the API leaves the workers running, and the other way
 *   round. A failed start of the workers sweeps their session alone, and the API, which answered
 *   before it, is left running (the sequence is cumulative, below); a failed start of the portal
 *   sweeps its session alone, and leaves the API and the workers running.
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
 *   Exit codes: 0 both services accept connections, the database is migrated, the API answers
 *   `/health` with 200, the workers answer `/health/ready` with 200 and the administration portal
 *   answers `/api/health`, `/en/login` and `/api/backend/health` with 200; 1 a step failed, each
 *   cause on its own line; 2 a usage error.
 *
 *   Usage: `node scripts/start/platform-start.mjs [--root <dir>] [--wait-seconds <n>]`
 * @layer infrastructure
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
migrated database, to an API running from source that answers /health with 200 and then to
workers running from source that answer /health/ready with 200.

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
it. A run whose start of the API fails (the wait runs out, or pnpm ends first) ends the processes
of the session it started: SIGTERM, then SIGKILL to those still running 10 s later. It names each,
removes the pid file only when none is left, and names any that is. It lists them from /proc, so on
a host without one it ends none, says so and keeps the pid file.
An empty PORT in the calling shell counts as set and gives 3000, as it does for
the API.

The workers are started next, once the API answers, the same way, with
\`pnpm --filter @apps/workers dev\`, and left running; --wait-seconds bounds their answer on
/health/ready too. Their port is METRICS_PORT, of the calling shell or else of the file, else 3300
(an empty METRICS_PORT gives 3300), and the run refuses one that is not a port or that is the API's.
They receive the API's environment without NODE_ENV, so that they read the checkout's .env and not
.env.test. Their pnpm process's id and their log are under .tmp/ as well, and the run prints a stop
line of their own: each stop line ends one app's session, so stopping the API leaves the workers
running. A run whose start of the workers fails ends their session alone; the API stays up.

The administration portal is started last, once the workers answer, the same way, with
\`pnpm --filter @apps/admin dev\`, and left running, on the port its dev script fixes in
apps/admin/package.json (next dev -p 3100). It must answer /api/health with 200, then /en/login
with exactly 200 and /api/backend/health, which it forwards to the API, with 200; --wait-seconds
bounds that too. It receives API_URL=http://127.0.0.1:<the API's port>, unless the calling shell
sets API_URL, and no NODE_ENV. Its pnpm process's id and its log are under .tmp/ as well, with a
stop line of its own. A run whose start of the portal fails ends its session alone; the API and
the workers stay up. The API, the workers and the portal each take a port of their own, and the
run refuses two of them on one port.
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

/**
 * @typedef {object} Words The words of the stage's lines that agree with the name of the app they
 *   speak of: those of a singular noun for the API, those of a plural one for the workers.
 * @property {string} some - The app named without `the` (`an API`, `workers`).
 * @property {string} someRunning - The same, as running (`a running API`, `running workers`).
 * @property {string} s - The ending a verb in the present takes after the name (`s`, none).
 * @property {string} is - `is` or `are`.
 * @property {string} was - `was` or `were`.
 * @property {string} it - The pronoun that stands for the app (`it`, `them`).
 * @property {string} one - The pronoun for any app of the kind (`one`, `ones`).
 */

/**
 * @typedef {object} App An app the run starts from source, detached, and leaves running: what the
 *   stage that starts it (`startApp`) needs to know of it, and nothing else.
 * @property {string} name - What every line the stage prints calls the app, read after `the`, `no`
 *   and `second` (`API`, `workers`).
 * @property {Words} words - The words of those lines that agree with the name.
 * @property {readonly string[]} pnpm - What pnpm is asked for: the script that starts the app from
 *   source.
 * @property {readonly string[]} without - The variables of the calling shell the app's process
 *   must not receive, besides those the environment file owns.
 * @property {Readonly<Record<string, string>>} [with] - Variables added to the environment the
 *   app's process receives, after those it must not receive are removed.
 * @property {string} record - Where the id of the pnpm process that runs the app is kept, relative
 *   to the checkout, in a directory git ignores.
 * @property {string} log - Where the app's output goes, relative to the checkout, beside the record.
 * @property {string} probe - The path that answers 200 on the app's port once the app is up.
 * @property {readonly string[]} [pages] - Paths that must answer exactly 200 too, each asked once
 *   the probe and the pages before it do: what the app is held to beyond the probe.
 * @property {number} port - The loopback port the app takes.
 */

/**
 * The API, the first app the run starts: every field of an `App` but its port, which the run
 * settles from the environment (`apiPort`).
 */
const API = /** @type {const} */ ({
  name: "API",
  words: {
    some: "an API",
    someRunning: "a running API",
    s: "s",
    is: "is",
    was: "was",
    it: "it",
    one: "one",
  },
  pnpm: ["--filter", "@apps/api", "dev"],
  without: [],
  record: ".tmp/api.pid",
  log: ".tmp/api.log",
  probe: "/health",
});

/**
 * The workers, the app the run starts once the API answers: every field of an `App` but its port,
 * which the run settles from the environment (`workersPort`). `/health/ready` answers 200 only
 * once their database, Redis and publish consumer checks pass (`apps/workers/src/bootstrap.ts`).
 */
const WORKERS = /** @type {const} */ ({
  name: "workers",
  words: {
    some: "workers",
    someRunning: "running workers",
    s: "",
    is: "are",
    was: "were",
    it: "them",
    one: "ones",
  },
  pnpm: ["--filter", "@apps/workers", "dev"],
  // The workers pick the environment file they load by NODE_ENV (`apps/workers/src/config/env.ts`
  // loads `.env.test` when it is `test`), and their `dev` script names no file, so a calling
  // shell's NODE_ENV=test would send them to another file than the `.env` this run generated or
  // checked: one a clean checkout lacks, or one that names another database and Redis. Without it
  // they read `.env`. The API names its file on its command line, and keeps the shell's NODE_ENV.
  without: ["NODE_ENV"],
  record: ".tmp/workers.pid",
  log: ".tmp/workers.log",
  probe: "/health/ready",
});

/**
 * The administration portal, the app the run starts once the workers answer: every field of an
 * `App` but its port, which its package fixes (`ADMIN_MANIFEST`), and the `API_URL` it receives,
 * which names the API's port (`main`). `/api/health` touches nothing, so it answers 200 while a
 * page still fails; `/en/login` is the page that fails while a workspace package the portal
 * imports is unbuilt (DEF-85), asked rather than `/`, which redirects; `/api/backend/health` is
 * forwarded to `${API_URL}/health`, and answers 200 only when the API does.
 */
const ADMIN = /** @type {const} */ ({
  name: "administration portal",
  words: {
    some: "an administration portal",
    someRunning: "a running administration portal",
    s: "s",
    is: "is",
    was: "was",
    it: "it",
    one: "one",
  },
  pnpm: ["--filter", "@apps/admin", "dev"],
  // Next.js chooses the portal's environment files by NODE_ENV: under `test` it loads
  // `apps/admin/.env.test*` and not the files of a development run, so a calling shell's
  // NODE_ENV=test would start the portal on other values than a development run reads.
  without: ["NODE_ENV"],
  record: ".tmp/admin.pid",
  log: ".tmp/admin.log",
  probe: "/api/health",
  pages: ["/en/login", "/api/backend/health"],
});

/**
 * The administration portal's package, relative to the checkout: its `dev` script (`next dev -p
 * 3100`) fixes the portal's port, and the run reads it there rather than keep a second copy.
 */
const ADMIN_MANIFEST = "apps/admin/package.json";

/** The port the workers take when neither the calling shell nor the file sets `METRICS_PORT`. */
const DEFAULT_WORKERS_PORT = 3300;

/** How many of the log's last lines a failure shows. */
const LOG_LINES = 10;

/**
 * How long the processes of a failed start's session have, after SIGTERM, to end before SIGKILL,
 * and then how long the system has, after SIGKILL, to take them away.
 */
const STOP_TIMING = /** @type {const} */ ({ graceMs: 10_000, killWaitMs: 5_000 });

/** How often the stop looks at the session it is ending. */
const SESSION_POLL_MS = 100;

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
 * @function workersPort
 * @description The port the workers alone would listen on, read as `apiPort` reads the API's: they
 *   load the environment file without overriding a variable their process already holds, so a
 *   `METRICS_PORT` the calling shell sets wins over the file's, and with neither they take 3300.
 *   Their schema reads an empty value as absent, so an empty one, in either place, gives 3300, and
 *   the file is not consulted behind an empty one in the shell.
 * @param {string | undefined} fromShell - `METRICS_PORT` in the calling shell.
 * @param {string | undefined} fromFile - `METRICS_PORT` in the environment file.
 * @returns {number | null} The port, or `null` when the value that wins is not a port.
 */
function workersPort(fromShell, fromFile) {
  const raw = fromShell ?? fromFile;
  return raw ? parsePort(raw) : DEFAULT_WORKERS_PORT;
}

/**
 * @function manifestPort
 * @description The port an app's package fixes on its `dev` script (`-p <port>` or `--port
 *   <port>`), read from the checkout's own manifest: the port the app takes whatever the
 *   environment says, since the flag wins over `PORT`.
 * @param {string} manifest - The manifest's path.
 * @returns {{ port: number | null, problem: string | null }} The port; or a problem when the
 *   manifest cannot be read or parsed, has no `dev` script with a port, or names one that is not a
 *   port; or neither when the manifest does not exist (`ENOENT`, `ENOTDIR`), which the stage that
 *   would start the app reports, as a checkout that does not exist is reported where it is used.
 */
function manifestPort(manifest) {
  let text;
  try {
    text = readFileSync(manifest, "utf8");
  } catch (error) {
    const { code, message } = /** @type {NodeJS.ErrnoException} */ (error);
    if (code === "ENOENT" || code === "ENOTDIR") return { port: null, problem: null };
    return { port: null, problem: `cannot use ${manifest}: ${message}` };
  }
  let dev;
  try {
    dev = JSON.parse(text)?.scripts?.dev;
  } catch {
    return { port: null, problem: `${manifest} is not JSON` };
  }
  const flag = typeof dev === "string" ? /(?:^|\s)(?:-p|--port)(?:\s+|=)(\S+)/.exec(dev) : null;
  if (flag === null) {
    return { port: null, problem: `${manifest} fixes no port on its dev script (-p <port>)` };
  }
  const port = parsePort(/** @type {string} */ (flag[1]));
  if (port === null) {
    return { port: null, problem: `${manifest} starts its app on ${flag[1]}, which is not a port` };
  }
  return { port, problem: null };
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
 * @param {{ port: number | null, problem: string | null }} portal - The port the administration
 *   portal's package fixes (`manifestPort`), or the problem that kept it from being read: the
 *   problem is refused with the others, and a port is held distinct from the API's and the
 *   workers'.
 * @returns {{ values: Record<string, string>, ports: { Postgres: number, Redis: number },
 *   api: number, workers: number }} What the file holds, the host port each service is published
 *   on, the port the API takes and the port the workers take.
 */
function prepareEnvironment(file, portal) {
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
  const workers = workersPort(process.env.METRICS_PORT, values?.METRICS_PORT);
  if (workers === null) {
    problems.push(`METRICS_PORT=${process.env.METRICS_PORT ?? values?.METRICS_PORT} is not a port`);
  }
  if (portal.problem !== null) problems.push(portal.problem);
  // Every app the run starts, with where its port comes from: each pair of them that would share a
  // port is refused, so a fourth app is one more entry here.
  const takers = [
    { name: `the ${API.name}`, port: api, from: "PORT" },
    { name: `the ${WORKERS.name}`, port: workers, from: "METRICS_PORT" },
    { name: `the ${ADMIN.name}`, port: portal.port, from: `the dev script of ${ADMIN_MANIFEST}` },
  ];
  for (const [index, one] of takers.entries()) {
    for (const other of takers.slice(index + 1)) {
      if (one.port === null || one.port !== other.port) continue;
      problems.push(
        `${one.name} and ${other.name} would both take port ${one.port} (${one.from} and ` +
          `${other.from}): give each its own`
      );
    }
  }
  if (problems.length > 0 || api === null || workers === null) throw new StartFailure(problems);
  const settled = `${NAME}: the API takes port ${api}\n${NAME}: the workers take port ${workers}\n`;

  if (values !== null) {
    process.stdout.write(`${NAME}: ${file} holds every required variable\n`);
    process.stdout.write(settled);
    return { values, ports, api, workers };
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
  process.stdout.write(settled);
  return { values: Object.fromEntries(entries), ports, api, workers };
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
 * @param {string | (() => string)} failure - What to report when the time runs out, or how to
 *   say it then, from what the last attempt found.
 * @param {number} seconds - How long the probe may keep failing.
 * @param {(msLeft: () => number) => Promise<boolean>} probe - One attempt; it is handed a reading
 *   of the time left, never less than a millisecond, to bound what it waits for.
 * @returns {Promise<void>} Resolves once an attempt succeeds.
 */
async function waitFor(failure, seconds, probe) {
  const deadline = Date.now() + seconds * 1000;
  const msLeft = () => Math.max(deadline - Date.now(), 1);
  while (!(await probe(msLeft))) {
    if (Date.now() >= deadline) {
      throw new StartFailure([typeof failure === "string" ? failure : failure()]);
    }
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
 * @function statusOf
 * @description What a path answers on a loopback port: the probe of an app (`App.probe`, `/health`
 *   for the API) or one of its pages. A redirect is not followed: it is its own status.
 * @param {number} port - The port.
 * @param {string} asked - The path asked for.
 * @param {number} msLeft - How long the whole wait has left, to bound the attempt by.
 * @returns {Promise<number | null>} The status, or `null` on a refused connection or a silent peer.
 */
function statusOf(port, asked, msLeft) {
  return new Promise((resolve) => {
    const request = get(
      { host: LOOPBACK, port, path: asked, timeout: Math.min(PROBE_TIMEOUT_MS, msLeft) },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? null);
      }
    );
    request.once("timeout", () => {
      request.destroy();
      resolve(null);
    });
    request.once("error", () => resolve(null));
  });
}

/**
 * @typedef {object} Missing The first path of an app that did not answer 200 when asked.
 * @property {string} path - The probe, or one of the pages.
 * @property {number | null} status - What it answered, `null` when nothing did.
 */

/**
 * @function lacking
 * @description What of an app does not answer 200 yet: its probe, then each of its pages in turn,
 *   each asked only once the one before it answered 200. An app with no pages is asked its probe
 *   alone, once.
 * @param {App} app - The app, by its descriptor: its probe, its pages and its port.
 * @param {() => number} msLeft - A reading of how long the whole wait has left, taken before each
 *   path is asked.
 * @returns {Promise<Missing | null>} The first path that did not answer 200, or `null` when every
 *   one did.
 */
async function lacking(app, msLeft) {
  for (const asked of [app.probe, ...(app.pages ?? [])]) {
    const status = await statusOf(app.port, asked, msLeft());
    if (status !== 200) return { path: asked, status };
  }
  return null;
}

/**
 * @function everyPath
 * @description The paths an app must answer 200 on, as the lines name them: its probe alone, or
 *   its probe and its pages (`/api/health, /en/login and /api/backend/health`).
 * @param {App} app - The app, by its descriptor.
 * @returns {string} The paths, in the order they are asked.
 */
function everyPath(app) {
  const paths = [app.probe, ...(app.pages ?? [])];
  return paths.length === 1 ? app.probe : `${paths.slice(0, -1).join(", ")} and ${paths.at(-1)}`;
}

/**
 * @function lastAnswer
 * @description What a path that did not answer 200 answered, for a failure line.
 * @param {number | null} status - The status it answered with, `null` when nothing answered.
 * @returns {string} `it answered <status>`, or `nothing answered it`.
 */
function lastAnswer(status) {
  return status === null ? "nothing answered it" : `it answered ${status}`;
}

/**
 * @function notAnswered
 * @description The line of a wait that ran out, from what its last attempt found: the probe that
 *   did not answer 200, or, once it did, the page that did not, with the port and what that page
 *   answered.
 * @param {App} app - The app, by its descriptor.
 * @param {Missing} missing - What the last attempt found.
 * @param {number} waitSeconds - How long the wait was.
 * @returns {string} One failure line.
 */
function notAnswered(app, missing, waitSeconds) {
  const at = `${LOOPBACK}:${app.port}`;
  if (missing.path === app.probe) {
    return `${app.probe} on ${at} did not answer 200 within ${waitSeconds} s`;
  }
  return (
    `${app.probe} on ${at} answered 200, but ${missing.path} there did not answer 200 within ` +
    `${waitSeconds} s (the last time it was asked, ${lastAnswer(missing.status)})`
  );
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
 * @function reportApp
 * @description Says where an app answers its probe, where its output goes and how to stop it.
 * @param {App} app - The app, by its descriptor: the lines name it and its probe, on its port.
 * @param {boolean} earlier - Whether the app is one this command started in an earlier run.
 * @param {number} pid - The pnpm process that runs the app: it leads the process group the stop
 *   signal is sent to and the session that holds the app, and it is what the app's record holds.
 * @param {string} logFile - The log's path.
 * @param {string} pidFile - The path of the file that records the process.
 * @returns {void}
 */
function reportApp(app, earlier, pid, logFile, pidFile) {
  const { name, port } = app;
  const { s, was, it, one } = app.words;
  const paths = everyPath(app);
  const where = `on ${LOOPBACK}:${port} (run by the pnpm process ${pid}, log ${logFile})`;
  process.stdout.write(
    earlier
      ? `${NAME}: the ${name} this command started earlier already answer${s} ${paths} with 200 ${where}: no second ${name} ${was} started\n`
      : `${NAME}: the ${name} answer${s} ${paths} with 200 ${where}\n`
  );
  // The signal reaches pnpm alone, and pnpm passes it on: whether the app ends depends on the app.
  process.stdout.write(
    `${NAME}: stop ${it} with \`kill -s TERM -- -${pid}\`: a normal termination signal, sent to ` +
      `the process group of pnpm (process ${pid}, which runs the ${name} and leads the session ` +
      `that holds ${it}), which passes it on; it ends the ${name} only if the ${name} attend${s} ` +
      `it, and ${one} that ignore${s} it keep${s} running. To see whether the ${name} still ` +
      `run${s}, check whether ${LOOPBACK}:${port} accepts connections, or whether the pnpm process ` +
      `${pid}, recorded in ${pidFile}, still exists (it can end while the ${name} live${s} on, so ` +
      `only the port settles it); if the ${name} still run${s}, end the processes of the session ` +
      `by hand (\`ps -s ${pid}\` lists them). pnpm writes a failed-command line in the log when ` +
      `the ${name} end${s}, which is expected\n`
  );
}

/**
 * @function recordedNote
 * @description What the run says of a recorded process that still exists and that it starts no
 *   second app for: only what it knows. The id could also have been given to another process.
 * @param {App} app - The app, by its descriptor: the line names it without `the`.
 * @param {string} pidFile - The file the process is recorded in.
 * @param {string} logFile - The log's path.
 * @param {number} recorded - The recorded process.
 * @returns {string} One failure line.
 */
function recordedNote(app, pidFile, logFile, recorded) {
  return (
    `the process recorded in ${pidFile} (${recorded}) still exists and may be the pnpm of ` +
    `${app.words.some} an earlier run started, which ${app.words.is} still starting or failed to ` +
    `start: nothing was started and ` +
    `nothing was stopped (\`ps -s ${recorded}\` lists its session, ${logFile} its output)`
  );
}

/**
 * @function readFromStart
 * @description Reads what the file behind an open descriptor holds, from its first byte up to the
 *   size it has when asked, as `readFileSync` does with a path. No path is resolved again, so the
 *   bytes are those of the file the descriptor was opened on even if the path has since been
 *   removed or replaced; and the reads are positional, so they leave alone the descriptor's offset,
 *   which a child given the descriptor shares and writes at.
 * @param {number} descriptor - The file's descriptor, opened for reading.
 * @returns {string} Its text, decoded as UTF-8.
 */
function readFromStart(descriptor) {
  const { size } = fstatSync(descriptor);
  const buffer = Buffer.alloc(size);
  let read = 0;
  while (read < size) {
    const count = readSync(descriptor, buffer, read, size - read, read);
    if (count === 0) break;
    read += count;
  }
  return buffer.toString("utf8", 0, read);
}

/**
 * How the stop reads `/proc`, on one object of its own: the suite replaces a read with one that
 * fails as the read of a process that ends in the middle of it does, or as every read does on a host
 * without `/proc`: neither failure can be had here on demand.
 */
export const proc = {
  /** @returns {string[]} The entries of `/proc`. */
  list: () => readdirSync("/proc"),
  /**
   * @param {string} file - A file under `/proc`.
   * @returns {string} Its text.
   */
  read: (file) => readFileSync(file, "utf8"),
};

/**
 * @typedef {{ pid: number, name: string }} Member A process of a session: its id and its command.
 */

/**
 * @function ownIds
 * @description This command's own process group and session, as the kernel reports them.
 * @returns {{ group: number, session: number }} The two ids.
 * @throws {Error} The read's own error when `/proc/self/stat` cannot be read.
 */
function ownIds() {
  const stat = proc.read("/proc/self/stat");
  const [, , group, session] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return { group: Number(group), session: Number(session) };
}

/**
 * @function separate
 * @description Whether a signal target names a process of its own, or the group one leads: its
 *   absolute value an integer greater than 1, and neither this command's process nor its process
 *   group nor its session. `0` is the sender's own group, `-1` every process the sender may signal
 *   (as root, every process of the host but init) and `1` is init.
 * @param {number} target - A process id, or the negative id of a process group.
 * @returns {boolean} Whether a signal may be sent to it: never when this command cannot read its own
 *   ids, since then no target can be told apart from it.
 */
export function separate(target) {
  const id = Math.abs(target);
  let own;
  try {
    own = ownIds();
  } catch {
    // No target can be told apart from this command: none is signalled.
    return false;
  }
  return (
    Number.isInteger(id) && id > 1 && id !== process.pid && id !== own.group && id !== own.session
  );
}

/**
 * @function signal
 * @description Every signal this command sends to a process goes through here, and reaches only a
 *   target `separate` accepts.
 * @param {number} target - A process id, or the negative id of a process group.
 * @param {NodeJS.Signals} name - The signal.
 * @returns {boolean} Whether it was sent: `false` for a target the guard refuses, and for one that
 *   ended between the listing and the signal or may not be signalled.
 */
export function signal(target, name) {
  if (!separate(target)) return false;
  try {
    process.kill(target, name);
    return true;
  } catch {
    // It ended after it was listed, or it may not be signalled: nothing was sent.
    return false;
  }
}

/**
 * @function commandOf
 * @description The command a process runs, as `ps` shows it: its command line, or, when that is
 *   empty or cannot be read, the name its `stat` entry carries.
 * @param {string} entry - The process's id, as `/proc` lists it.
 * @param {string} stat - What its `stat` entry held.
 * @returns {string} The command.
 */
function commandOf(entry, stat) {
  try {
    const line = proc.read(`/proc/${entry}/cmdline`).split("\0").filter(Boolean);
    if (line.length > 0) return line.join(" ");
  } catch {
    // It ended after its `stat` was read: the name read with it stands.
  }
  return stat.slice(stat.indexOf("(") + 1, stat.lastIndexOf(")"));
}

/**
 * @function sessionMembers
 * @description The live processes of a session, whatever process group each is in, read from
 *   `/proc` (Linux only). The pnpm this command starts leads a session of its own and every
 *   process it runs stays in it unless it leaves on purpose, so these are the processes of that
 *   start. A session whose id the guard refuses is not listed.
 * @param {number} session - The session's id, which is its leader's.
 * @returns {Member[]} Its members; a process that has ended and waits to be reaped is not one.
 */
export function sessionMembers(session) {
  /** @type {Member[]} */
  const members = [];
  if (!separate(session)) return members;
  for (const entry of proc.list()) {
    if (!/^\d+$/.test(entry)) continue;
    let stat;
    try {
      stat = proc.read(`/proc/${entry}/stat`);
    } catch (error) {
      // A process that ends between the listing and the read is not a member: its entry is gone
      // (ENOENT), or the read finds the process gone (ESRCH).
      const { code } = /** @type {NodeJS.ErrnoException} */ (error);
      if (code !== "ENOENT" && code !== "ESRCH") throw error;
      continue;
    }
    // After the command's name, which may hold spaces and brackets: state, parent, group, session.
    const [state, , , sid] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (Number(sid) === session && state !== "Z") {
      members.push({ pid: Number(entry), name: commandOf(entry, stat) });
    }
  }
  return members;
}

/**
 * @function sessionEnds
 * @description Waits until no process is left in a session, or the time is up.
 * @param {number} session - The session's id.
 * @param {number} ms - How long to wait.
 * @returns {Promise<Member[]>} The processes still there: none when the session has ended.
 */
async function sessionEnds(session, ms) {
  const deadline = Date.now() + ms;
  let left = sessionMembers(session);
  while (left.length > 0 && Date.now() < deadline) {
    await sleep(Math.min(SESSION_POLL_MS, Math.max(deadline - Date.now(), 1)));
    left = sessionMembers(session);
  }
  return left;
}

/**
 * @function endSession
 * @description Ends every process of a session: SIGTERM to each, the grace period for them all to
 *   end, then SIGKILL to what remains, and a short wait for the system to take it away.
 * @param {number} session - The session's id.
 * @param {{ graceMs: number, killWaitMs: number }} [timing] - How long each signal waits.
 * @returns {Promise<{ found: Member[], termed: Member[], killed: Member[], left: Member[] }>} What
 *   the session held, what was sent SIGTERM and SIGKILL, and what is still running at the end.
 */
export async function endSession(session, timing = STOP_TIMING) {
  const found = sessionMembers(session);
  const termed = found.filter((member) => signal(member.pid, "SIGTERM"));
  let left = await sessionEnds(session, timing.graceMs);
  /** @type {Member[]} */
  let killed = [];
  if (left.length > 0) {
    killed = left.filter((member) => signal(member.pid, "SIGKILL"));
    left = await sessionEnds(session, timing.killWaitMs);
  }
  return { found, termed, killed, left };
}

/**
 * @function unswept
 * @description The line of a sweep that could not tell what its session holds.
 * @param {number} pid - The pnpm process this run started.
 * @param {string} pidFile - The file that records it, which is kept.
 * @param {string} reason - Why: the code of the read that failed, or the guard's refusal.
 * @returns {string} One failure line.
 */
function unswept(pid, pidFile, reason) {
  return (
    `the session of process ${pid} could not be swept to the end (${reason}): ` +
    `${pidFile} is kept, and \`ps -s ${pid}\` lists any process still running`
  );
}

/**
 * @function named
 * @description Processes as a failure line names them.
 * @param {Member[]} members - The processes.
 * @returns {string} `<id> (<command>)` for each, or `none`.
 */
function named(members) {
  return members.map((member) => `${member.pid} (${member.name})`).join(", ") || "none";
}

/**
 * @function sweepSession
 * @description Ends the session of the pnpm process this run started, once its start has failed,
 *   and says only what the sweep saw: what was sent SIGTERM, what SIGKILL, and whether anything is
 *   left. The record is removed only when nothing is; what is left is named with its command and
 *   the record kept. A read of `/proc` that fails in any other way ends the sweep and keeps the
 *   record, and so does a sweep that cannot read this command's own ids or whose session id the
 *   guard refuses: either lists the session as empty whatever it holds.
 * @param {number} pid - The pnpm process this run started; its id is its session's.
 * @param {string} pidFile - The file that records it.
 * @param {{ graceMs: number, killWaitMs: number }} [timing] - How long each signal waits.
 * @returns {Promise<string>} The one line the run prints about the sweep, whether it found the
 *   session empty and removed the record, or names what is left and keeps it.
 */
export async function sweepSession(pid, pidFile, timing = STOP_TIMING) {
  let swept;
  try {
    // A session the guard refuses lists as empty, and so does every session once this command's
    // own ids cannot be read: ownIds throws the read's error here, before anything is listed.
    ownIds();
    if (!separate(pid)) return unswept(pid, pidFile, "the guard refuses its id");
    swept = await endSession(pid, timing);
  } catch (error) {
    const { code } = /** @type {NodeJS.ErrnoException} */ (error);
    return unswept(pid, pidFile, code ?? String(error));
  }
  const { found, termed, killed, left } = swept;
  const head = `the session of process ${pid} was swept: `;
  if (found.length === 0 && left.length === 0) {
    rmSync(pidFile, { force: true });
    return `${head}no process was found in it, and ${pidFile} was removed`;
  }
  const signalled =
    `SIGTERM was sent to ${named(termed)}` +
    (killed.length > 0
      ? `, and SIGKILL to ${named(killed)}, still running ${timing.graceMs / 1000} s later`
      : "");
  if (left.length > 0) {
    return (
      `${head}${signalled}; still running: ${named(left)}, so ${pidFile} is kept: ` +
      `\`ps -s ${pid}\` lists what is left, to end by hand`
    );
  }
  rmSync(pidFile, { force: true });
  return `${head}${signalled}; then no process was found in it, and ${pidFile} was removed`;
}

/**
 * @function startApp
 * @description Starts an app from source, detached, and waits until its probe answers 200, and
 *   then each of its pages. It runs over the app's descriptor (`App`): the run gives it the API
 *   (`API`), whose record, log and probe are `api.pid`, `api.log` and `/health`, then the workers
 *   (`WORKERS`), whose are `workers.pid`, `workers.log` and `/health/ready`, and then the
 *   administration portal (`ADMIN`), whose are `admin.pid`, `admin.log` and `/api/health`, with
 *   `/en/login` and `/api/backend/health` as its pages. Where these lines say the probe, an app
 *   with pages is held to its probe and to its pages. The process an earlier run recorded is
 *   consulted first: while it exists no second app is started, and the run goes on as a second run
 *   once the probe answers, whether or not the port is bound yet (the real API binds it only at the
 *   end of its boot). While it waits on that process it looks at it again after each attempt: one
 *   that has ended fails the run at once, the record left as it is, and a wait that runs out with
 *   the process still there fails it with a note that says only what is known. With nothing
 *   recorded, nothing is started when something accepts connections on the port. While it waits
 *   the run watches its child: a child that exits fails the run at once, a wait that runs out fails
 *   it too, and either way the run sweeps the session of that child before it ends
 *   (`sweepSession`). The process an earlier run recorded is never signalled.
 * @param {string} root - The checkout.
 * @param {App} app - The app, by its descriptor: what the lines call it and the words that agree
 *   with that, what pnpm is asked for, what of the calling shell's environment it must not
 *   receive and what is added to it, its record and its log under the checkout, the paths it must
 *   answer 200 on and its port.
 * @param {number} waitSeconds - How long the probe may take to answer 200.
 * @returns {Promise<void>} Resolves once the app answers, or once the earlier one is found to.
 */
async function startApp(root, app, waitSeconds) {
  const { name, probe, port } = app;
  const { s, is, was, someRunning } = app.words;
  const paths = everyPath(app);
  const pidFile = path.join(root, app.record);
  const logFile = path.join(root, app.log);
  /**
   * The furthest path the attempts of a wait reached without a 200, as the latest attempt that
   * reached it found it; the probe until an attempt is made. An attempt that the end of the wait
   * cuts short, or that finds the probe down again, says nothing of a page an earlier attempt got
   * to, so it does not replace that page.
   */
  let last = /** @type {Missing} */ ({ path: probe, status: null });
  const order = [probe, ...(app.pages ?? [])];
  const keep = (/** @type {Missing} */ missing) => {
    if (order.indexOf(missing.path) >= order.indexOf(last.path)) last = missing;
  };
  const ranOut = () => notAnswered(app, last, waitSeconds);

  const recorded = recordedProcess(pidFile);
  const bound = await accepts(port);
  if (recorded !== null) {
    if (bound) {
      const missing = await lacking(app, () => PROBE_TIMEOUT_MS);
      if (missing === null) {
        reportApp(app, true, recorded, logFile, pidFile);
        return;
      }
      throw new StartFailure([
        missing.path === probe
          ? `${LOOPBACK}:${port} is already in use, and ${probe} does not answer 200 there`
          : `${LOOPBACK}:${port} is already in use, and ${probe} answers 200 there but ` +
            `${missing.path} does not (${lastAnswer(missing.status)})`,
        recordedNote(app, pidFile, logFile, recorded),
      ]);
    }
    process.stdout.write(
      `${NAME}: the process recorded in ${pidFile} (${recorded}) still exists and nothing ` +
        `accepts connections on ${LOOPBACK}:${port} yet: no second ${name} ${is} started, and ` +
        `${paths} ${app.pages === undefined ? "is" : "are"} awaited for up to ${waitSeconds} s\n`
    );
    // The process was found to exist before the wait, and it can end during it: looked at only
    // then, an ended one would be waited on to the end and said to still exist. The id itself is
    // asked, not the record, which a removed or rewritten file would make read as an ended process.
    const ended =
      `the process recorded in ${pidFile} (${recorded}) ended during the wait without ${paths} ` +
      `on ${LOOPBACK}:${port} answering 200, and no ${name} ${was} started`;
    let gone = false;
    try {
      await waitFor(ranOut, waitSeconds, async (msLeft) => {
        const missing = await lacking(app, msLeft);
        if (missing === null) return true;
        keep(missing);
        gone = !exists(recorded);
        if (gone) throw new StartFailure([ended]);
        return false;
      });
    } catch (error) {
      if (!(error instanceof StartFailure) || gone) throw error;
      // It can end between the last attempt and the end of the wait.
      const note = exists(recorded) ? recordedNote(app, pidFile, logFile, recorded) : ended;
      throw new StartFailure([...error.lines, note]);
    }
    reportApp(app, true, recorded, logFile, pidFile);
    return;
  }
  if (bound) {
    throw new StartFailure([
      `${LOOPBACK}:${port} is already in use, and this command holds no record of ` +
        `${someRunning} it started: the port may be held by anything; no ${name} ${was} started`,
    ]);
  }

  for (const file of [pidFile, logFile]) mkdirSync(path.dirname(file), { recursive: true });
  // Opened for reading as well and held until this stage returns: the tail a failure shows is
  // read through this descriptor, from the file the child writes, never from whatever the path
  // names by then.
  const log = openSync(logFile, "w+");
  try {
    const child = spawn("pnpm", app.pnpm, {
      cwd: root,
      env: { ...shellEnvironment(...app.without), ...app.with },
      detached: true,
      stdio: ["ignore", log, log],
    });
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
        `pnpm is not on PATH: the ${name} start${s} through it`
      );
    }
    const pid = /** @type {number} */ (child.pid);
    writeFileSync(pidFile, `${pid}\n`);

    try {
      await waitFor(ranOut, waitSeconds, async (msLeft) => {
        if (state.ended !== null) {
          throw new StartFailure([
            `the pnpm process this run started to run the ${name} (process ${pid}) ` +
              `${endOf(state.ended)} before ${paths} answered 200`,
          ]);
        }
        const missing = await lacking(app, msLeft);
        if (missing === null) return true;
        keep(missing);
        return false;
      });
    } catch (error) {
      if (!(error instanceof StartFailure)) throw error;
      // So the run can end even when a process of the session outlives the sweep below.
      child.unref();
      const lines = [...error.lines];
      // Read before the sweep: ending the session ends the child too.
      if (state.ended === null) {
        lines.push(
          `the pnpm process this run started to run the ${name} (process ${pid}) was still ` +
            `running when the wait ended`
        );
      }
      lines.push(await sweepSession(pid, pidFile));
      let written = "";
      try {
        written = readFromStart(log);
      } catch {
        // No log to show: the failure stands without it.
      }
      const tail = written.trimEnd().split("\n").slice(-LOG_LINES).filter(Boolean);
      if (tail.length > 0)
        lines.push(`the last lines of ${logFile}:`, ...tail.map((line) => `  ${line}`));
      throw new StartFailure(lines);
    }
    child.unref();
    reportApp(app, false, pid, logFile, pidFile);
  } finally {
    closeSync(log);
  }
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
    const manifest = path.join(options.root, ADMIN_MANIFEST);
    const portal = manifestPort(manifest);
    const { values, ports, api, workers } = prepareEnvironment(file, portal);
    const answered = await startServices(options.root, file, values, ports, options.waitSeconds);
    migrateDatabase(options.root, file, answered, options.waitSeconds);
    await startApp(options.root, { ...API, port: api }, options.waitSeconds);
    await startApp(options.root, { ...WORKERS, port: workers }, options.waitSeconds);
    if (portal.port === null) {
      throw new StartFailure([`${manifest} does not exist: no ${ADMIN.name} was started`]);
    }
    // The portal forwards /api/backend/* to API_URL, so it is pointed at the API this run started,
    // unless the calling shell names another, which wins as a shell's PORT does for the API.
    const apiUrl = process.env.API_URL ?? `http://${LOOPBACK}:${api}`;
    await startApp(
      options.root,
      { ...ADMIN, port: portal.port, with: { API_URL: apiUrl } },
      options.waitSeconds
    );
  } catch (error) {
    if (!(error instanceof StartFailure)) throw error;
    for (const line of error.lines) process.stderr.write(`${NAME}: ${line}\n`);
    return 1;
  }
  return 0;
}

// Only a run of this file as the program starts the sequence: the suite imports the stop of a
// failed start, to drive it with spies in place of `process.kill` and of the reads of `/proc`.
// `import.meta.main` is a boolean on the Node.js line the repository requires (`engines.node`
// `>=26.12.1 <27`, `.nvmrc` 26); on a runtime without it the gate is false and nothing runs.
if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
