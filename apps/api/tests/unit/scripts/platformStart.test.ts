/**
 * @file platformStart.test.ts
 * @description Pins `scripts/start/platform-start.mjs`, the start sequence of a clean checkout, and
 *   its pure core `scripts/start/lib/start-environment.mjs`: the environment a checkout with no
 *   environment file receives, what the command does with a file that is already there, and the
 *   start of Postgres and Redis from the repository's compose file, the database's migration, the
 *   API's start, then the workers' and then the administration portal's.
 *
 *   The generated environment is held to the API's own schema through `parseApiEnv` and to the
 *   variables `docker-compose.yml` refuses to start without, so a variable either of them starts to
 *   require goes red here until the generator learns it. The command is driven as a process against a
 *   root of its own (`--root`), never the repository's, because it reads and writes the root
 *   environment file. Docker is a stand-in script on `PATH` that records how it was called, and the
 *   two services are sockets this suite opens, so no container starts here: the run against real
 *   containers is the sequence's own proof. The API is a small Node script that the pnpm stand-in
 *   runs in its place, and the case says whether it answers 200, answers 503, never answers or
 *   exits; the workers are another, which answers 200 on `/health/ready` alone, and the portal a
 *   third, which takes its port from the checkout's `apps/admin/package.json`, as `next dev -p`
 *   does, and forwards `/api/backend/health` to `API_URL`. Every API, workers and portal stand-in a
 *   case leaves running is stopped by the suite's `afterEach`. Every signal the
 *   suite sends goes through one guard, `signal`, which sends nothing to a target that does not name
 *   a real, separate process: 0, 1 and -1 (as root, -1 reaches every process of the host but init),
 *   text read as a number, and the suite's own process, group and session.
 *
 *   The stop of a failed start is also imported from the command and driven in this process, for
 *   what no stand-in makes happen on demand: a target the command's own guard refuses, a read of
 *   `/proc` that fails with ESRCH while the session is swept, a process that survives SIGKILL. There
 *   `process.kill` or the stop's read of `/proc` is replaced by a spy, and each spy is restored
 *   before the case ends, so the teardown signals as it always does.
 * @layer infrastructure
 */
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { until, untilValue } from "@packages/vitest-shared/determinism";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseApiEnv } from "../../../src/config/env.js";

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const COMMAND = path.join(REPO_ROOT, "scripts", "start", "platform-start.mjs");
const CORE = path.join(REPO_ROOT, "scripts", "start", "lib", "start-environment.mjs");

type Entries = Array<[string, string]>;

interface EnvironmentModule {
  REQUIRED_KEYS: readonly string[];
  generateEnvironment(options: {
    randomBytes: (size: number) => Buffer;
    postgresHostPort?: number;
    redisHostPort?: number;
  }): Entries;
  renderEnvironmentFile(entries: Entries): string;
  readEnvironment(text: string): Record<string, string>;
  missingKeys(values: Record<string, string | undefined>): string[];
  apiPort(fromShell: string | undefined, fromFile: string | undefined): number | null;
}

const core = (await import(CORE)) as EnvironmentModule;

/** A process of a session, as the command's stop reads it: its id and the name `/proc` gives it. */
interface Member {
  pid: number;
  name: string;
}

/** What the stop did to a session: what it found, what it sent SIGTERM and SIGKILL, what is left. */
interface Swept {
  found: Member[];
  termed: Member[];
  killed: Member[];
  left: Member[];
}

/** How long the stop's SIGTERM, and then its SIGKILL, wait for the session to empty. */
interface Timing {
  graceMs: number;
  killWaitMs: number;
}

/** The stop of a failed start, as the command exports it. */
interface StopModule {
  proc: { list(): string[]; read(file: string): string };
  separate(target: number): boolean;
  signal(target: number, name: NodeJS.Signals): boolean;
  endSession(session: number, timing?: Timing): Promise<Swept>;
  sweepSession(pid: number, pidFile: string, timing?: Timing): Promise<string>;
}

// The command runs its sequence only as the program, so importing it here starts nothing.
const command = (await import(COMMAND)) as StopModule;

/**
 * The variables `docker-compose.yml` interpolates with `${NAME:?}`: Compose starts nothing without
 * them. Seven today: `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB`, Grafana's
 * `GF_SECURITY_ADMIN_USER` and `GF_SECURITY_ADMIN_PASSWORD`, MinIO's `MINIO_ROOT_USER` and
 * `MINIO_ROOT_PASSWORD`. A count that moves means the compose file gained or lost one.
 */
const COMPOSE_REQUIRED = [
  ...new Set(
    [
      ...readFileSync(path.join(REPO_ROOT, "docker-compose.yml"), "utf8").matchAll(
        /\$\{([A-Z_]+):\?/g
      ),
    ].map((match) => match[1] ?? "")
  ),
];

/** Every generated value that must be drawn from the random source. */
const SECRETS = [
  "POSTGRES_PASSWORD",
  "GF_SECURITY_ADMIN_PASSWORD",
  "MINIO_ROOT_PASSWORD",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "CUSTOMER_JWT_SECRET",
  "ADMIN_JWT_ACCESS_SECRET",
  "ADMIN_JWT_REFRESH_SECRET",
  "COOKIE_SECRET",
  "PLATFORM_ENCRYPTION_KEY",
  "OAUTH_ENCRYPTION_KEY",
  "DELETION_NAME_DIGEST_KEY_RING",
];

/** Which database a connection reached, as the command asks a server for it. */
const WHICH_DATABASE =
  "(SELECT system_identifier FROM pg_control_system())::text || ' ' || (SELECT oid FROM pg_database WHERE datname = current_database())::text";

/**
 * What the command has the container compare before it asks anything: each value Compose gave the
 * container against the one the command read from the file and hands in by name.
 */
const SAME_READING =
  'd=; [ "$POSTGRES_USER" = "$PGUSER" ] || d="$d POSTGRES_USER"; [ "$POSTGRES_PASSWORD" = "$PGPASSWORD" ] || d="$d POSTGRES_PASSWORD"; [ "$POSTGRES_DB" = "$PGDATABASE" ] || d="$d POSTGRES_DB"; if [ -n "$d" ]; then echo "read differently:$d" >&2; exit 3; fi';

/** Whether that database is the one its data volume was initialised for, as the command asks. */
const INITIAL_DATABASE =
  "CASE WHEN current_setting('omnipost.initial_database', true) = 'on' THEN 'on' ELSE 'off' END";

/**
 * What the stand-in's Postgres answers the readiness query, unless a case gives it another answer:
 * a database's identity, and that it is the initial one.
 */
const STARTED = "7707325603935821862 16384 on";

/**
 * The stand-in for the Docker CLI. It logs one line per call (its arguments and its working
 * directory), saves the environment it was given on `up` and on `exec`, saves the last argument of
 * `exec` (the shell line the command has the container run), and gives the exit code, the `psql`
 * answer or the slow query a case asks for. A query that runs prints which database answered:
 * `STARTED`, or what `FAKE_IDENTITY` holds when a case sets it. A message of its own ends with
 * exit 2, as `psql` does, unless it is the container's "read differently" verdict, which ends with
 * the exit 3 the comparison gives it; `FAKE_PSQL_EXIT` says another code.
 */
const DOCKER_DOUBLE = `#!/bin/sh
printf '%s|%s\\n' "$*" "$PWD" >> "$FAKE_DOCKER_LOG"
case " $* " in
  *" version "*) exit "\${FAKE_COMPOSE_VERSION_EXIT:-0}" ;;
  *" up "*)
    /usr/bin/env > "$FAKE_DOCKER_LOG.up"
    if [ -n "$FAKE_UP_SIGNAL" ]; then kill -s "$FAKE_UP_SIGNAL" $$; fi
    exit "\${FAKE_UP_EXIT:-0}" ;;
  *" exec "*)
    /usr/bin/env > "$FAKE_DOCKER_LOG.exec"
    for last; do :; done
    printf '%s' "$last" > "$FAKE_DOCKER_LOG.exec.sh"
    if [ -n "$FAKE_QUERY_SECONDS" ]; then exec /bin/sleep "$FAKE_QUERY_SECONDS"; fi
    if [ -n "$FAKE_PSQL_STDERR" ]; then
      printf '%s\\n' "$FAKE_PSQL_STDERR" >&2
      code=2
      case "$FAKE_PSQL_STDERR" in *"read differently:"*) code=3 ;; esac
      exit "\${FAKE_PSQL_EXIT:-$code}"
    fi
    printf '%s\\n' "\${FAKE_IDENTITY-${STARTED}}" ;;
esac
exit 0
`;

/**
 * The stand-in for pnpm: it logs its call and its working directory and saves the environment it
 * was given. Asked for the proof (`db execute`), it also saves the statement it reads on its
 * input; asked for the migration, it does not. For each of the two it says on both streams what a
 * case asks it to, first spends the seconds a case asks for (the proof's are the call's end, as a
 * process that never answers would be), and ends with the exit code or by the signal a case asks for.
 * Asked for the API (`@apps/api dev`), it logs the call and its environment apart from the other two
 * calls and becomes `API_PARENT`, which has the shape the measured pnpm has: it leads its own
 * process group and session, and the API is its child in another group of that session. Asked for
 * the workers (`@apps/workers dev`), it does the same apart again and becomes `WORKERS_PARENT`,
 * and asked for the administration portal (`@apps/admin dev`), it becomes `ADMIN_PARENT`.
 */
const PNPM_DOUBLE = `#!/bin/sh
case " $* " in
  *" @apps/api dev "*)
    printf '%s|%s\\n' "$*" "$PWD" >> "$FAKE_PNPM_LOG.api"
    /usr/bin/env > "$FAKE_PNPM_LOG.api.env"
    exec /bin/bash "$FAKE_API_PARENT" ;;
  *" @apps/workers dev "*)
    printf '%s|%s\\n' "$*" "$PWD" >> "$FAKE_PNPM_LOG.workers"
    /usr/bin/env > "$FAKE_PNPM_LOG.workers.env"
    exec /bin/bash "$FAKE_WORKERS_PARENT" ;;
  *" @apps/admin dev "*)
    printf '%s|%s\\n' "$*" "$PWD" >> "$FAKE_PNPM_LOG.admin"
    /usr/bin/env > "$FAKE_PNPM_LOG.admin.env"
    exec /bin/bash "$FAKE_ADMIN_PARENT" ;;
esac
printf '%s|%s\\n' "$*" "$PWD" >> "$FAKE_PNPM_LOG"
case " $* " in
  *" db execute "*)
    /usr/bin/env > "$FAKE_PNPM_LOG.proof.env"
    /bin/cat > "$FAKE_PNPM_LOG.proof.sql"
    if [ -n "$FAKE_PROOF_SECONDS" ]; then exec /bin/sleep "$FAKE_PROOF_SECONDS"; fi
    if [ -n "$FAKE_PROOF_SAYS" ]; then
      printf 'out: %s\\n' "$FAKE_PROOF_SAYS"
      printf 'err: %s\\n' "$FAKE_PROOF_SAYS" >&2
    fi
    if [ -n "$FAKE_PROOF_SIGNAL" ]; then kill -s "$FAKE_PROOF_SIGNAL" $$; fi
    exit "\${FAKE_PROOF_EXIT:-0}" ;;
esac
/usr/bin/env > "$FAKE_PNPM_LOG.env"
if [ -n "$FAKE_MIGRATE_SECONDS" ]; then /bin/sleep "$FAKE_MIGRATE_SECONDS"; fi
if [ -n "$FAKE_MIGRATE_SAYS" ]; then
  printf 'out: %s\\n' "$FAKE_MIGRATE_SAYS"
  printf 'err: %s\\n' "$FAKE_MIGRATE_SAYS" >&2
fi
if [ -n "$FAKE_MIGRATE_SIGNAL" ]; then kill -s "$FAKE_MIGRATE_SIGNAL" $$; fi
exit "\${FAKE_MIGRATE_EXIT:-0}"
`;

/**
 * What runs in place of pnpm for an app (`API` reads `FAKE_API_*`, `WORKERS` reads
 * `FAKE_WORKERS_*`, `ADMIN` reads `FAKE_ADMIN_*`): bash, so that job control puts the app in a process group of its own, as
 * measured on the real pnpm (it leads the group and the session, and its shell and node are in
 * another group of that session). On SIGTERM it passes the signal on to the app and ends when the
 * app has; it does not end it itself, which is the part of the real pnpm that cannot be relied on
 * once pnpm is killed. With `FAKE_<APP>_ORPHAN` it ends at once and leaves the app running, as a
 * pnpm killed first would.
 */
function parentFor(app: "API" | "WORKERS" | "ADMIN"): string {
  return `#!/bin/bash
set -m
"$FAKE_NODE" "$FAKE_${app}_SCRIPT" &
child=$!
if [ -n "$FAKE_${app}_ORPHAN" ]; then exit 1; fi
trap 'kill -s TERM "$child" 2>/dev/null' TERM
while kill -0 "$child" 2>/dev/null; do wait "$child"; done
`;
}

const API_PARENT = parentFor("API");
const WORKERS_PARENT = parentFor("WORKERS");
const ADMIN_PARENT = parentFor("ADMIN");

/**
 * The API as a case wants it, chosen by `FAKE_API_MODE`: `ok` answers every request with 200, `503`
 * with 503, `silent` takes the connection and never answers, `stubborn` answers 503 and ignores
 * SIGTERM, writing a line to its log each time it receives one, and `exit` ends at once with a line
 * on stderr. Like the real API, it takes `PORT` from its environment or else from the checkout's
 * environment file (a variable the process holds wins), and on SIGTERM it says it drained and ends
 * with 0. It binds only the port the case made (`FAKE_API_PORT`) and ends at once on any other, so
 * a case that names a port of its own, or none, never takes a real one. With
 * `FAKE_API_BIND_DELAY_MS` it binds that many milliseconds after it starts, as the real API binds
 * only at the end of its boot.
 */
const API_DOUBLE = `import { createServer } from "node:http";
try { process.loadEnvFile(".env"); } catch {}
const mode = process.env.FAKE_API_MODE ?? "ok";
console.log("api double starting in mode " + mode);
const port = Number(process.env.PORT ?? 3000);
if (mode === "exit" || port !== Number(process.env.FAKE_API_PORT)) {
  console.error("Error starting server: the port is taken");
  process.exit(1);
}
const server = createServer((request, response) => {
  if (mode === "silent") return;
  response.statusCode = mode === "503" || mode === "stubborn" ? 503 : 200;
  response.end("{}");
});
setTimeout(
  () => server.listen(port, "127.0.0.1"),
  Number(process.env.FAKE_API_BIND_DELAY_MS ?? 0)
);
process.on("SIGTERM", () => {
  if (mode === "stubborn") {
    console.log("received SIGTERM and ignored it");
    return;
  }
  console.log("drained");
  process.exit(0);
});
`;

/**
 * The workers as a case wants them, chosen by `FAKE_WORKERS_MODE`: `ok` answers 200 on
 * `/health/ready` and 404 on every other path, so a run that asked them anything else would wait
 * in vain; `503` answers `/health/ready` with 503, and `silent` takes the connection and never
 * answers. Like the real workers, they load the checkout's environment file themselves, `.env.test`
 * when `NODE_ENV` is `test` and `.env` otherwise (a variable the process holds wins), and take
 * `METRICS_PORT` from it, an empty value read as absent, else 3300. They bind only the port the
 * case made (`FAKE_WORKERS_PORT`) and end at once on any other, and on SIGTERM they say they shut
 * down and end with 0.
 */
const WORKERS_DOUBLE = `import { createServer } from "node:http";
try { process.loadEnvFile(process.env.NODE_ENV === "test" ? ".env.test" : ".env"); } catch {}
const mode = process.env.FAKE_WORKERS_MODE ?? "ok";
console.log("workers double starting in mode " + mode);
const port = Number(process.env.METRICS_PORT || 3300);
if (port !== Number(process.env.FAKE_WORKERS_PORT)) {
  console.error("Error: listen EADDRINUSE on " + port);
  process.exit(1);
}
const server = createServer((request, response) => {
  if (mode === "silent") return;
  response.statusCode = request.url !== "/health/ready" ? 404 : mode === "503" ? 503 : 200;
  response.end("{}");
});
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => {
  console.log("Worker shutdown complete");
  process.exit(0);
});
`;

/**
 * The administration portal as a case wants it, chosen by `FAKE_ADMIN_MODE`. Like `next dev -p`,
 * it takes its port from the `dev` script of the checkout's `apps/admin/package.json`, never from
 * `PORT`, and binds it only when it is the port the case made (`FAKE_ADMIN_PORT`), ending at once
 * on any other. `ok` answers `/api/health` and `/en/login` with 200 and forwards
 * `/api/backend/health` to `${API_URL}/health`, answering what the API answers, or 503 when the API
 * cannot be reached, as the portal's proxy does; every other path is a 404. `page500` is DEF-85's
 * shape, `/api/health` 200 and `/en/login` 500; `redirect307` answers `/en/login` with a 307 whose
 * `Location` is `/api/health`, which answers 200, so only a run that follows redirects would take
 * the page for answered; `page500ThenSilent` answers the first `/en/login` with 500 and leaves every
 * later one unanswered, as a page whose last attempt the end of a wait cuts short; `backend503`
 * answers `/api/backend/health` with
 * 503 as an unreachable API makes the proxy do; `silent` takes the connection and never answers;
 * `exit` ends at once with a line on stderr. On SIGTERM it says it stopped and ends with 0.
 */
const ADMIN_DOUBLE = `import { readFileSync } from "node:fs";
import { createServer } from "node:http";
const mode = process.env.FAKE_ADMIN_MODE ?? "ok";
console.log("admin double starting in mode " + mode);
const dev = JSON.parse(readFileSync("apps/admin/package.json", "utf8")).scripts.dev;
const port = Number(/-p (\\d+)/.exec(dev)?.[1]);
if (mode === "exit" || port !== Number(process.env.FAKE_ADMIN_PORT)) {
  console.error("Error: the portal could not start on " + port);
  process.exit(1);
}
async function backend() {
  if (mode === "backend503" || !process.env.API_URL) return 503;
  try {
    const answer = await fetch(process.env.API_URL + "/health", { signal: AbortSignal.timeout(1000) });
    return answer.status;
  } catch {
    return 503;
  }
}
let pagesAsked = 0;
const server = createServer(async (request, response) => {
  if (mode === "silent") return;
  if (request.url === "/en/login" && mode === "page500ThenSilent" && pagesAsked++ > 0) return;
  if (request.url === "/api/health") response.statusCode = 200;
  else if (request.url === "/en/login" && mode === "page500ThenSilent") response.statusCode = 500;
  else if (request.url === "/en/login" && mode === "redirect307") {
    response.statusCode = 307;
    response.setHeader("Location", "/api/health");
  } else if (request.url === "/en/login") response.statusCode = mode === "page500" ? 500 : 200;
  else if (request.url === "/api/backend/health") response.statusCode = await backend();
  else response.statusCode = 404;
  response.end("{}");
});
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => {
  console.log("portal stopped");
  process.exit(0);
});
`;

/** How every call after the first names the checkout's two files to Compose. */
const COMPOSE = "compose -f docker-compose.yml --env-file .env";

/** A socket standing for one service: the port it took and everything it was sent. */
interface Listener {
  readonly port: number;
  readonly received: Buffer[];
}

/** A checkout with the Docker stand-in on a `PATH` of its own, and a listener for each service. */
interface Stage {
  readonly root: string;
  readonly file: string;
  /** Where the stand-in logs its calls. */
  readonly log: string;
  /** Where the stand-in for pnpm logs its calls. */
  readonly pnpmLog: string;
  readonly postgres: Listener;
  readonly redis: Listener;
  /** The command's environment: the stand-in on `PATH`, and where it logs. */
  readonly env: Record<string, string>;
  /** The listeners' ports, as the variables a first run takes them from, and the API's as `PORT`. */
  readonly ports: {
    readonly POSTGRES_HOST_PORT: string;
    readonly REDIS_HOST_PORT: string;
    readonly PORT: string;
  };
  /** The port the API stand-in is told to answer on, in `ports` as `PORT`. */
  readonly apiPort: number;
  /**
   * The port the workers stand-in is told to answer on, in `env` as `METRICS_PORT`, so that no run
   * of any case takes the workers' default 3300: a case that asks for the default removes it.
   */
  readonly workersPort: number;
  /**
   * The port the portal stand-in is told to answer on, written into the checkout's
   * `apps/admin/package.json` as `next dev -p <port>`, where the command reads it.
   */
  readonly adminPort: number;
}

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))
  );
  for (const root of roots) {
    for (const record of RECORDS) endRecorded(root, record);
  }
  for (const pid of strays.splice(0)) endGroup(pid);
  // A command under mutation may record no process, or another one, and still start a stand-in.
  for (const root of roots) endStandIns(root);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** The record of each app the command starts, under the checkout's `.tmp`, in its order. */
const RECORDS = ["api.pid", "workers.pid", "admin.pid"] as const;

/** The name of one of the command's records (`RECORDS`). */
type RecordName = (typeof RECORDS)[number];

/**
 * Ends the app a case left running in a checkout under one record, with its whole session, which
 * is what the command made: the teardown's path for every record of every checkout a case used.
 */
function endRecorded(root: string, record: RecordName): void {
  const pid = recordedIn(root, record);
  if (pid !== null) endGroup(pid);
}

/** Ends the API a case left running in a checkout (`endRecorded`). */
function endRecordedApi(root: string): void {
  endRecorded(root, "api.pid");
}

/** Ends the workers a case left running in a checkout (`endRecorded`). */
function endRecordedWorkers(root: string): void {
  endRecorded(root, "workers.pid");
}

/**
 * Ends every process whose command line names a path inside a case's checkout: the stand-ins the
 * command started there, whatever it recorded about them.
 */
function endStandIns(root: string): void {
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if (readFileSync(`/proc/${entry}/cmdline`, "utf8").includes(`${root}/`)) {
        signal(Number(entry), "SIGKILL");
      }
    } catch {
      // It ended between the listing and the read: nothing is left to end.
    }
  }
}

/** Processes a case started itself, to be ended with it. */
const strays: number[] = [];

/** The process id the command recorded for its API in a checkout (`recordedIn`). */
function recordedApi(root: string): number | null {
  return recordedIn(root, "api.pid");
}

/** The process id the command recorded for its workers in a checkout (`recordedIn`). */
function recordedWorkers(root: string): number | null {
  return recordedIn(root, "workers.pid");
}

/**
 * The process id a record of the command under `.tmp` holds, or `null` when there is none or the
 * record is not a decimal integer greater than 1: `Number` reads an empty text as 0, and a record a
 * case or a mutation of the command leaves can hold 0, 1, a negative number or text, none of which
 * names a process of its own.
 */
function recordedIn(root: string, record: RecordName): number | null {
  let text: string;
  try {
    text = readFileSync(path.join(root, ".tmp", record), "utf8").trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return null;
  }
  return /^[1-9]\d*$/.test(text) && Number(text) > 1 ? Number(text) : null;
}

/** This process's own process group and session, read once from what the kernel reports. */
const OWN = (() => {
  const stat = readFileSync("/proc/self/stat", "utf8");
  const [, , group, session] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return { group: Number(group), session: Number(session) };
})();

/**
 * Whether a signal target names a real, separate process, or the group such a process leads: its
 * absolute value an integer greater than 1, and neither this suite's process nor its process group
 * nor its session. `0` is the sender's own process group, `-1` every process the sender may signal
 * (as root, every process of the host but init) and `1` is init.
 */
function separate(target: number): boolean {
  const id = Math.abs(target);
  return (
    Number.isInteger(id) && id > 1 && id !== process.pid && id !== OWN.group && id !== OWN.session
  );
}

/**
 * Every signal this suite sends goes through here: it is sent only to a target `separate` accepts,
 * and for any other nothing is sent. Returns whether it was sent; a process that is already gone
 * throws, as `process.kill` does.
 */
function signal(target: number, name: NodeJS.Signals): boolean {
  if (!separate(target)) return false;
  process.kill(target, name);
  return true;
}

/**
 * Whether a process is running. An orphan that has ended can stay a zombie until its new parent
 * reaps it, and the system still answers for it, so the state the kernel reports decides first.
 */
function alive(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch (error) {
    // A process that ends while it is read can fail the read with ESRCH instead of ENOENT.
    if (!["ENOENT", "ESRCH"].includes(String((error as NodeJS.ErrnoException).code))) throw error;
    return false;
  }
}

/**
 * The live processes of a session, whatever process group each is in: what a detached start leaves,
 * since the process it starts leads a session of its own and every process it runs stays in it.
 */
function sessionMembers(session: number): number[] {
  const members: number[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    let stat: string;
    try {
      stat = readFileSync(`/proc/${entry}/stat`, "utf8");
    } catch (error) {
      // It ended while it was listed: its entry is gone (ENOENT) or the read fails with ESRCH.
      if (!["ENOENT", "ESRCH"].includes(String((error as NodeJS.ErrnoException).code))) {
        throw error;
      }
      continue;
    }
    const [state, , , sid] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (Number(sid) === session && state !== "Z") members.push(Number(entry));
  }
  return members;
}

/**
 * Ends a session and its leader's group; a process already gone is fine. A pid that names no
 * process of its own ends nothing, and its session is not even listed.
 */
function endGroup(pid: number): void {
  if (!separate(pid)) return;
  for (const target of [-pid, pid, ...sessionMembers(pid)]) {
    try {
      signal(target, "SIGKILL");
    } catch {
      // Already gone, or never a group leader: nothing is left to end through this target.
    }
  }
}

/** A text as a regular expression that matches it and nothing else. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A loopback port nothing holds at the moment it is returned. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port was bound");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

/** A checkout of its own for one case, with the path its environment file has. */
function makeRoot(): { root: string; file: string } {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "platform-start-")));
  roots.push(root);
  return { root, file: path.join(root, ".env") };
}

/** Writes a generated environment file, without the variables named in `drop`. */
function writeEnvironment(
  file: string,
  drop: readonly string[] = [],
  ports: { postgres: number; redis: number } = { postgres: 55432, redis: 56379 }
): string {
  const entries = core
    .generateEnvironment({
      randomBytes,
      postgresHostPort: ports.postgres,
      redisHostPort: ports.redis,
    })
    .filter(([key]) => !drop.includes(key));
  const text = core.renderEnvironmentFile(entries);
  writeFileSync(file, text);
  return text;
}

/**
 * A socket on a free loopback port that records what it is sent. Connection by connection it
 * answers the next of `replies`, and the last one from then on; `null` is a peer that says nothing.
 */
async function listen(...replies: Array<string | null>): Promise<Listener> {
  const received: Buffer[] = [];
  let connections = 0;
  const server = createServer((socket) => {
    const reply = replies[Math.min(connections, replies.length - 1)] ?? null;
    connections += 1;
    socket.on("data", (chunk) => {
      received.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      if (reply !== null) socket.end(reply);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port was bound");
  return { port: address.port, received };
}

/**
 * A checkout whose `PATH` holds only the Docker stand-in, and a listener for each service: one
 * that answers as the service does, unless the case brings its own.
 */
async function stage(services: { postgres?: Listener; redis?: Listener } = {}): Promise<Stage> {
  const { root, file } = makeRoot();
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "docker"), DOCKER_DOUBLE, { mode: 0o755 });
  writeFileSync(path.join(bin, "pnpm"), PNPM_DOUBLE, { mode: 0o755 });
  writeFileSync(path.join(bin, "api-double.mjs"), API_DOUBLE);
  writeFileSync(path.join(bin, "api-parent.sh"), API_PARENT);
  writeFileSync(path.join(bin, "workers-double.mjs"), WORKERS_DOUBLE);
  writeFileSync(path.join(bin, "workers-parent.sh"), WORKERS_PARENT);
  writeFileSync(path.join(bin, "admin-double.mjs"), ADMIN_DOUBLE);
  writeFileSync(path.join(bin, "admin-parent.sh"), ADMIN_PARENT);
  const log = path.join(root, "docker.log");
  const pnpmLog = path.join(root, "pnpm.log");
  const postgres = services.postgres ?? (await listen("N"));
  const redis = services.redis ?? (await listen("+PONG\r\n"));
  const apiPort = await freePort();
  // Two ports asked for one after the other can be the same one, since the first is free again.
  let workersPort = await freePort();
  while (workersPort === apiPort) workersPort = await freePort();
  let adminPort = await freePort();
  while (adminPort === apiPort || adminPort === workersPort) adminPort = await freePort();
  writeAdminManifest(root, `next dev -p ${adminPort}`);
  return {
    root,
    file,
    log,
    pnpmLog,
    postgres,
    redis,
    env: {
      PATH: bin,
      FAKE_DOCKER_LOG: log,
      FAKE_PNPM_LOG: pnpmLog,
      FAKE_NODE: process.execPath,
      FAKE_API_SCRIPT: path.join(bin, "api-double.mjs"),
      FAKE_API_PARENT: path.join(bin, "api-parent.sh"),
      FAKE_API_PORT: String(apiPort),
      FAKE_WORKERS_SCRIPT: path.join(bin, "workers-double.mjs"),
      FAKE_WORKERS_PARENT: path.join(bin, "workers-parent.sh"),
      FAKE_WORKERS_PORT: String(workersPort),
      METRICS_PORT: String(workersPort),
      FAKE_ADMIN_SCRIPT: path.join(bin, "admin-double.mjs"),
      FAKE_ADMIN_PARENT: path.join(bin, "admin-parent.sh"),
      FAKE_ADMIN_PORT: String(adminPort),
    },
    ports: {
      POSTGRES_HOST_PORT: String(postgres.port),
      REDIS_HOST_PORT: String(redis.port),
      PORT: String(apiPort),
    },
    apiPort,
    workersPort,
    adminPort,
  };
}

/** Writes the checkout's `apps/admin/package.json` with the `dev` script a case gives it. */
function writeAdminManifest(root: string, dev: string): void {
  mkdirSync(path.join(root, "apps", "admin"), { recursive: true });
  writeFileSync(
    path.join(root, "apps", "admin", "package.json"),
    `${JSON.stringify({ name: "@apps/admin", scripts: { dev } }, null, 2)}\n`
  );
}

/** The calls a stand-in logged, one line each; none when it was never run. */
function loggedCalls(log: string): string[] {
  try {
    return readFileSync(log, "utf8").trim().split("\n");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return [];
  }
}

/** The stand-in's calls so far, one line each; none when it was never run. */
function dockerCalls(staged: Stage): string[] {
  return loggedCalls(staged.log);
}

/** The environment the stand-in was given on its last `up` or its last `exec`. */
function dockerEnvironment(staged: Stage, call: "up" | "exec"): Record<string, string> {
  return savedEnvironment(`${staged.log}.${call}`);
}

/** The environment a stand-in saved to a file, one `NAME=value` line per variable. */
function savedEnvironment(file: string): Record<string, string> {
  const lines = readFileSync(file, "utf8").split("\n");
  return Object.fromEntries(
    lines
      .map((line) => [line, line.indexOf("=")] as const)
      .filter(([, at]) => at > 0)
      .map(([line, at]) => [line.slice(0, at), line.slice(at + 1)])
  );
}

const execFileAsync = promisify(execFile);

/** Runs the command with exactly the environment a case gives it. */
async function start(
  args: readonly string[],
  env: Record<string, string> = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [COMMAND, ...args], { env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: failure.code ?? -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

/** A socket that holds a port and says nothing, as another program on it would. */
async function occupy(port: number): Promise<void> {
  // Resumed, so the server sees a client that leaves and its own close can finish.
  const server = createServer((socket) => socket.resume());
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
}

/** What a case's calling shell holds: the stand-ins, every port a run takes, and what it adds. */
const asked = (staged: Stage, more: Record<string, string> = {}) => ({
  ...staged.env,
  ...staged.ports,
  ...more,
});

describe("the generated environment", () => {
  it("holds every variable Compose and the API require, in values the API's schema accepts", () => {
    const values = Object.fromEntries(core.generateEnvironment({ randomBytes }));

    const parsed = parseApiEnv(values);

    expect(parsed.DATABASE_URL).toBe(values.DATABASE_URL);
    expect(parsed.NODE_ENV).toBe("development");
    expect(core.missingKeys(values)).toEqual([]);
    expect(COMPOSE_REQUIRED).toHaveLength(7);
    expect(COMPOSE_REQUIRED.filter((key) => !values[key])).toEqual([]);
  });

  it("draws each secret separately from the random source", () => {
    const first = Object.fromEntries(core.generateEnvironment({ randomBytes }));
    const second = Object.fromEntries(core.generateEnvironment({ randomBytes }));
    const fixed = (size: number): Buffer => Buffer.alloc(size, 7);

    expect(SECRETS.filter((key) => first[key] === second[key])).toEqual([]);
    expect(new Set(SECRETS.map((key) => first[key])).size).toBe(SECRETS.length);
    expect(core.generateEnvironment({ randomBytes: fixed })).toEqual(
      core.generateEnvironment({ randomBytes: fixed })
    );
  });

  it("gives the platform encryption key exactly 32 bytes, written in base64", () => {
    const values = Object.fromEntries(core.generateEnvironment({ randomBytes }));
    const key = Buffer.from(values.PLATFORM_ENCRYPTION_KEY ?? "", "base64");

    expect(key).toHaveLength(32);
    expect(key.toString("base64")).toBe(values.PLATFORM_ENCRYPTION_KEY);
  });

  it("names one user, one password and one database to Compose and in the URLs", () => {
    const values = Object.fromEntries(core.generateEnvironment({ randomBytes }));
    const database = new URL(values.DATABASE_URL ?? "");
    const shadow = new URL(values.SHADOW_DATABASE_URL ?? "");

    expect([database.protocol, database.host]).toEqual(["postgresql:", "127.0.0.1:5432"]);
    expect([database.username, database.password, database.pathname]).toEqual([
      values.POSTGRES_USER,
      values.POSTGRES_PASSWORD,
      `/${values.POSTGRES_DB}`,
    ]);
    expect(shadow.href).toBe(`${database.href}_shadow`);
    expect(values.REDIS_URL).toBe("redis://127.0.0.1:6379");
    expect(Object.keys(values).filter((key) => key.endsWith("_HOST_PORT"))).toEqual([]);
  });

  it("carries the chosen host ports to Compose and to the URLs", () => {
    const values = Object.fromEntries(
      core.generateEnvironment({ randomBytes, postgresHostPort: 55432, redisHostPort: 56379 })
    );

    expect([values.POSTGRES_HOST_PORT, values.REDIS_HOST_PORT]).toEqual(["55432", "56379"]);
    expect(new URL(values.DATABASE_URL ?? "").port).toBe("55432");
    expect(new URL(values.SHADOW_DATABASE_URL ?? "").port).toBe("55432");
    expect(values.REDIS_URL).toBe("redis://127.0.0.1:56379");
  });

  it("reads the same through Node's loader and through a shell that sources it", () => {
    const entries = core.generateEnvironment({ randomBytes });
    const text = core.renderEnvironmentFile(entries);

    // The shell sources the text from its standard input, so no path reaches its command line.
    // `<(cat)` and not `/dev/stdin`: Node hands a child a socket, which cannot be opened by name.
    const sourced = execFileSync(
      "bash",
      [
        "--norc",
        "-c",
        'set -a; . <(cat); for key in "$@"; do printf "%s=%s\\n" "$key" "${!key}"; done',
        "bash",
        ...entries.map(([key]) => key),
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH ?? "" }, input: text }
    );

    expect(core.readEnvironment(text)).toEqual(Object.fromEntries(entries));
    expect(sourced).toBe(entries.map(([key, value]) => `${key}=${value}\n`).join(""));
  });
});

describe("the start sequence", () => {
  it("writes the environment a checkout lacks, for its owner only, and shows no secret", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], { ...staged.env, ...staged.ports });

    const values = core.readEnvironment(readFileSync(staged.file, "utf8"));
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(statSync(staged.file).mode & 0o777).toBe(0o600);
    expect(core.missingKeys(values)).toEqual([]);
    expect(new URL(values.DATABASE_URL ?? "").port).toBe(staged.ports.POSTGRES_HOST_PORT);
    expect(result.stdout).toContain(`wrote ${staged.file} with 21 variables`);
    expect(SECRETS.filter((key) => result.stdout.includes(values[key] ?? "unset"))).toEqual([]);
  });

  it("leaves a complete environment file untouched and reports the ports it names", async () => {
    const staged = await stage();
    const listening = { postgres: staged.postgres.port, redis: staged.redis.port };
    const before = writeEnvironment(staged.file, [], listening);

    const result = await start(["--root", staged.root], { ...staged.env, PORT: staged.ports.PORT });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(readFileSync(staged.file, "utf8")).toBe(before);
    expect(result.stdout).toContain(`${staged.file} holds every required variable`);
    expect(result.stdout).toContain(
      `Postgres on 127.0.0.1:${listening.postgres} and Redis on 127.0.0.1:${listening.redis}`
    );
  });

  it("fails naming each variable an existing file lacks, and leaves the file as it was", async () => {
    const { root, file } = makeRoot();
    const dropped = ["JWT_ACCESS_SECRET", "MINIO_ROOT_PASSWORD", "COOKIE_SECRET"];
    const before = `${writeEnvironment(file, dropped)}COOKIE_SECRET=\n`;
    writeFileSync(file, before);

    const result = await start(["--root", root]);

    expect(result.code).toBe(1);
    expect(result.stderr.trim().split("\n")).toEqual([
      `platform-start: ${file} lacks MINIO_ROOT_PASSWORD`,
      `platform-start: ${file} lacks JWT_ACCESS_SECRET`,
      `platform-start: ${file} lacks COOKIE_SECRET`,
    ]);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("refuses a host port that is not a port before it writes anything", async () => {
    const { root, file } = makeRoot();

    const result = await start(["--root", root], { REDIS_HOST_PORT: "70000" });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("platform-start: REDIS_HOST_PORT=70000 is not a port\n");
    expect(existsSync(file)).toBe(false);
  });

  it("refuses, naming each one, the host ports that disagree with those an existing file publishes", async () => {
    const { root, file } = makeRoot();
    const before = writeEnvironment(file);

    const result = await start(["--root", root], {
      POSTGRES_HOST_PORT: "5432",
      REDIS_HOST_PORT: "6379",
    });

    expect(result.code).toBe(1);
    expect(result.stderr.trim().split("\n")).toEqual([
      `platform-start: ${file} publishes Postgres on 55432, and POSTGRES_HOST_PORT=5432 would not change it: edit the file or unset the variable`,
      `platform-start: ${file} publishes Redis on 56379, and REDIS_HOST_PORT=6379 would not change it: edit the file or unset the variable`,
    ]);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("refuses to publish both services on one host port, and writes nothing", async () => {
    const { root, file } = makeRoot();

    const result = await start(["--root", root], {
      POSTGRES_HOST_PORT: "5555",
      REDIS_HOST_PORT: "5555",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "platform-start: Postgres and Redis are both published on host port 5555: give each its own\n"
    );
    expect(existsSync(file)).toBe(false);
  });

  it("fails in one line when the root is missing or is a file, not a directory", async () => {
    const { root, file } = makeRoot();
    const missing = path.join(root, "nowhere");
    const regularFile = path.join(root, "a-file");
    writeFileSync(regularFile, "");

    const results = [await start(["--root", missing]), await start(["--root", regularFile])];

    expect(results).toEqual([
      { code: 1, stdout: "", stderr: `platform-start: ${missing} does not exist\n` },
      { code: 1, stdout: "", stderr: `platform-start: ${regularFile} is not a directory\n` },
    ]);
    expect(existsSync(file)).toBe(false);
  });

  it("writes nothing through a link that leads nowhere", async () => {
    const { root, file } = makeRoot();
    const target = path.join(root, "elsewhere");
    symlinkSync(target, file);

    const result = await start(["--root", root]);

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: `platform-start: ${file} exists but reads as absent (a link that leads nowhere?): nothing was written\n`,
    });
    expect(existsSync(target)).toBe(false);
  });

  it("starts both services from the compose file, the file its only source, and returns once each answers", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], { ...staged.env, ...staged.ports });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(dockerCalls(staged)).toEqual([
      `compose version|${staged.root}`,
      `${COMPOSE} up -d postgres redis|${staged.root}`,
      `${COMPOSE} exec -T -e PGUSER -e PGPASSWORD -e PGDATABASE postgres sh -c ${SAME_READING}; PGCONNECT_TIMEOUT=3 psql -h "$(hostname -i)" -tAc "SELECT ${WHICH_DATABASE} || ' ' || ${INITIAL_DATABASE}"|${staged.root}`,
    ]);
    expect(Buffer.concat(staged.postgres.received).toString("hex")).toBe("0000000804d2162f");
    expect(Buffer.concat(staged.redis.received).toString()).toBe("PING\r\n");
    expect(result.stdout).toContain(
      `Postgres on 127.0.0.1:${staged.postgres.port} and Redis on 127.0.0.1:${staged.redis.port} accept connections`
    );
  });

  it("names Docker when it is not on PATH", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], { ...staged.ports, PATH: makeRoot().root });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "platform-start: docker is not on PATH: install Docker Engine with its Compose plugin\n"
    );
    expect(staged.redis.received).toEqual([]);
  });

  it("names the Compose plugin when Docker has none, and starts nothing", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], {
      ...staged.env,
      ...staged.ports,
      FAKE_COMPOSE_VERSION_EXIT: "1",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "platform-start: `docker compose version` failed: install the Docker Compose plugin\n"
    );
    expect(dockerCalls(staged)).toEqual([`compose version|${staged.root}`]);
  });

  it("names Docker when it is on PATH but cannot be run", async () => {
    const staged = await stage();
    chmodSync(path.join(staged.root, "bin", "docker"), 0o644);

    const result = await start(["--root", staged.root], { ...staged.env, ...staged.ports });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("platform-start: docker could not be run (EACCES)\n");
    expect(staged.postgres.received).toEqual([]);
  });

  it("fails with Compose's exit code in the message when the services do not start", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], {
      ...staged.env,
      ...staged.ports,
      FAKE_UP_EXIT: "17",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("platform-start: `docker compose up -d postgres redis` exited 17\n");
    expect(staged.postgres.received).toEqual([]);
  });

  it("fails naming Redis and its port when it never answers PING", async () => {
    const staged = await stage();
    const silent = await listen("-ERR not ready\r\n");

    const result = await start(["--root", staged.root, "--wait-seconds", "1"], {
      ...staged.env,
      ...staged.ports,
      REDIS_HOST_PORT: String(silent.port),
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `platform-start: Redis did not answer PING on 127.0.0.1:${silent.port} within 1 s (\`docker compose logs redis\`)\n`
    );
    expect(Buffer.concat(silent.received).toString()).toMatch(/^(PING\r\n)+$/);
  });

  it("fails at once, naming the credentials, when Postgres refuses the file's password", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], {
      ...staged.env,
      ...staged.ports,
      FAKE_PSQL_STDERR: 'psql: error: FATAL:  password authentication failed for user "omnipost"',
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `platform-start: Postgres refused the credentials of ${staged.file}: its data volume was initialised with others (\`docker compose down --volumes\` removes it)\n`
    );
    expect(dockerCalls(staged)).toHaveLength(3);
    expect(staged.redis.received).toEqual([]);
  });

  it("fails naming Postgres and its port when it answers but never runs the query", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root, "--wait-seconds", "1"], {
      ...staged.env,
      ...staged.ports,
      FAKE_PSQL_STDERR: "psql: error: FATAL:  the database system is starting up",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `platform-start: Postgres on 127.0.0.1:${staged.postgres.port} did not answer a query within 1 s (\`docker compose logs postgres\`)\n`
    );
    expect(staged.redis.received).toEqual([]);
  });

  it("fails naming Postgres when nothing answers the protocol on its port, and runs no query", async () => {
    const staged = await stage({ postgres: await listen(null) });

    const result = await start(["--root", staged.root, "--wait-seconds", "1"], {
      ...staged.env,
      ...staged.ports,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `platform-start: Postgres on 127.0.0.1:${staged.postgres.port} did not answer a query within 1 s (\`docker compose logs postgres\`)\n`
    );
    expect(dockerCalls(staged)).toHaveLength(2);
    expect(staged.redis.received).toEqual([]);
  });

  it("stops a query that outlives the wait, and fails naming Postgres", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root, "--wait-seconds", "1"], {
      ...staged.env,
      ...staged.ports,
      FAKE_QUERY_SECONDS: "4",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `platform-start: Postgres on 127.0.0.1:${staged.postgres.port} did not answer a query within 1 s (\`docker compose logs postgres\`)\n`
    );
    expect(staged.redis.received).toEqual([]);
  });

  it("takes a Postgres that offers TLS as one that answers the protocol", async () => {
    const staged = await stage({ postgres: await listen("S") });

    const result = await start(["--root", staged.root], { ...staged.env, ...staged.ports });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(dockerCalls(staged)).toHaveLength(3);
  });

  it("keeps asking a service that is not ready until it answers", async () => {
    const loading = "-LOADING Redis is loading the dataset in memory\r\n";
    const staged = await stage({ redis: await listen(loading, loading, "+PONG\r\n") });

    const result = await start(["--root", staged.root, "--wait-seconds", "5"], {
      ...staged.env,
      ...staged.ports,
    });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(Buffer.concat(staged.redis.received).toString()).toBe("PING\r\nPING\r\nPING\r\n");
  });

  it("hands Compose no variable the file owns, whatever the calling shell holds", async () => {
    const staged = await stage();
    const owned = [...core.REQUIRED_KEYS, "POSTGRES_HOST_PORT", "REDIS_HOST_PORT"];
    const fromTheShell = Object.fromEntries(
      core.REQUIRED_KEYS.map((key) => [key, "from-the-shell"])
    );

    const result = await start(["--root", staged.root], {
      ...fromTheShell,
      ...staged.env,
      ...staged.ports,
      KEPT_BY_THE_SHELL: "yes",
    });

    const up = dockerEnvironment(staged, "up");
    const query = dockerEnvironment(staged, "exec");
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(owned.filter((key) => key in up || key in query)).toEqual([]);
    expect([up.KEPT_BY_THE_SHELL, query.KEPT_BY_THE_SHELL]).toEqual(["yes", "yes"]);
  });

  it("queries Postgres as the user, with the password and for the database of the file", async () => {
    const staged = await stage();
    const listening = { postgres: staged.postgres.port, redis: staged.redis.port };
    const values = core.readEnvironment(writeEnvironment(staged.file, [], listening));

    const result = await start(["--root", staged.root], {
      ...staged.env,
      PORT: staged.ports.PORT,
      PGUSER: "from-the-shell",
      PGPASSWORD: "from-the-shell",
      PGDATABASE: "from-the-shell",
    });

    const query = dockerEnvironment(staged, "exec");
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect([query.PGUSER, query.PGPASSWORD, query.PGDATABASE]).toEqual([
      values.POSTGRES_USER,
      values.POSTGRES_PASSWORD,
      values.POSTGRES_DB,
    ]);
  });

  it("fails in one line when the environment file cannot be read", async () => {
    const { root, file } = makeRoot();
    mkdirSync(file);

    const result = await start(["--root", root]);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.startsWith(`platform-start: cannot use ${file}: EISDIR`)).toBe(true);
    expect(result.stderr.trimEnd().split("\n")).toHaveLength(1);
  });

  it("says which signal ended Compose when one stopped it", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], {
      ...staged.env,
      ...staged.ports,
      FAKE_UP_SIGNAL: "TERM",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "platform-start: `docker compose up -d postgres redis` was ended by SIGTERM\n"
    );
  });

  it("migrates the database with the repository's own script, in the checkout, once both services answer", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], { ...staged.env, ...staged.ports });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(loggedCalls(staged.pnpmLog)).toEqual([
      `--filter @infra/prisma exec prisma db execute --stdin|${staged.root}`,
      `--filter @infra/prisma run migrate|${staged.root}`,
    ]);
    expect(result.stdout).toMatch(/accept connections\nplatform-start: the database is migrated\n/);
  });

  it("has the migration's connection prove, before it migrates, that it reached the database the container named", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], {
      ...staged.env,
      ...staged.ports,
      FAKE_IDENTITY: "7000000000000000001 24601 on",
    });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(readFileSync(`${staged.pnpmLog}.proof.sql`, "utf8")).toBe(
      `DO $$ BEGIN IF (${WHICH_DATABASE}) IS DISTINCT FROM '7000000000000000001 24601' THEN RAISE EXCEPTION 'this connection is not the database this run started'; END IF; END $$;\n`
    );
  });

  it("migrates nothing when the migration's connection does not prove to be that database, and shows what the proof printed", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], {
      ...staged.env,
      ...staged.ports,
      FAKE_PROOF_SAYS: "this connection is not the database this run started",
      FAKE_PROOF_EXIT: "1",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "out: this connection is not the database this run started\n" +
        "err: this connection is not the database this run started\n" +
        `platform-start: MIGRATE_DATABASE_URL of ${staged.file}, or else its DATABASE_URL, does not reach the database this run started, or could not be asked (\`pnpm --filter @infra/prisma exec prisma db execute --stdin\` exited 1): nothing was migrated, because a migration cannot be taken back\n`
    );
    expect(loggedCalls(staged.pnpmLog)).toEqual([
      `--filter @infra/prisma exec prisma db execute --stdin|${staged.root}`,
    ]);
    expect(result.stdout).not.toContain("the database is migrated");
  });

  it("says which signal ended the proof when one stopped it, and migrates nothing", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], {
      ...staged.env,
      ...staged.ports,
      FAKE_PROOF_SIGNAL: "TERM",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "(`pnpm --filter @infra/prisma exec prisma db execute --stdin` was ended by SIGTERM): nothing was migrated"
    );
    expect(loggedCalls(staged.pnpmLog)).toHaveLength(1);
  });

  it("says nothing of a proof that passes", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], {
      ...staged.env,
      ...staged.ports,
      FAKE_PROOF_SAYS: "Script executed successfully.",
    });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).not.toContain("Script executed successfully.");
  });

  it("fails at once, naming each variable, when the container was created with another value than the command read", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], {
      ...staged.env,
      ...staged.ports,
      FAKE_PSQL_STDERR: "read differently: POSTGRES_USER POSTGRES_DB",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `platform-start: POSTGRES_USER, POSTGRES_DB of ${staged.file}: Docker Compose read another value than this command did, so the Postgres container was not created with what the file's URLs name (between single quotes both read a value alike)\n`
    );
    expect(dockerCalls(staged)).toHaveLength(3);
    expect(loggedCalls(staged.pnpmLog)).toEqual([]);
  });

  it("takes the verdict from the comparison's own line among what else the container printed", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], {
      ...staged.env,
      ...staged.ports,
      FAKE_PSQL_STDERR: "psql: NOTICE: something the server said\nread differently: POSTGRES_DB",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `platform-start: POSTGRES_DB of ${staged.file}: Docker Compose read another value than this command did, so the Postgres container was not created with what the file's URLs name (between single quotes both read a value alike)\n`
    );
    expect(loggedCalls(staged.pnpmLog)).toEqual([]);
  });

  it.each<[string, string, string]>([
    [
      "a server message that quotes the verdict, with the exit code of a query that failed",
      "psql: error: read differently: POSTGRES_USER",
      "2",
    ],
    [
      "the verdict's own text, with the exit code of a query that failed",
      "read differently: POSTGRES_DB",
      "2",
    ],
    [
      "a line that names something else than the three variables",
      "read differently: POSTGRES_USER and more",
      "3",
    ],
    [
      "a line that names a variable the table does not hold",
      "read differently: SOMETHING_ELSE",
      "3",
    ],
    ["a line that names nothing", "read differently:", "3"],
  ])(
    "does not take %s for the container's verdict, and keeps asking until the wait runs out",
    async (_what, said, exit) => {
      const staged = await stage();

      const result = await start(["--root", staged.root, "--wait-seconds", "1"], {
        ...staged.env,
        ...staged.ports,
        FAKE_PSQL_STDERR: said,
        FAKE_PSQL_EXIT: exit,
      });

      expect(result.code).toBe(1);
      expect(result.stderr).toBe(
        `platform-start: Postgres on 127.0.0.1:${staged.postgres.port} did not answer a query within 1 s (\`docker compose logs postgres\`)\n`
      );
      expect(loggedCalls(staged.pnpmLog)).toEqual([]);
    }
  );

  describe("the shell line the container runs", () => {
    /** Runs the line the command sent the container, locally, with stand-ins for `psql` and `hostname`. */
    async function runTheLine(
      env: Record<string, string>
    ): Promise<{ status: number | null; stdout: string; stderr: string; psqlCalls: string[] }> {
      const staged = await stage();
      await start(["--root", staged.root], { ...staged.env, ...staged.ports });
      const line = readFileSync(`${staged.log}.exec.sh`, "utf8");
      const bin = path.join(staged.root, "container-bin");
      const psqlLog = path.join(staged.root, "psql.log");
      mkdirSync(bin);
      writeFileSync(
        path.join(bin, "psql"),
        `#!/bin/sh\nprintf '%s\\n' "$*" >> "$FAKE_PSQL_LOG"\nprintf '%s\\n' "$FAKE_PSQL_SAYS"\n`,
        { mode: 0o755 }
      );
      writeFileSync(path.join(bin, "hostname"), "#!/bin/sh\nprintf '172.18.0.2\\n'\n", {
        mode: 0o755,
      });
      const ran = spawnSync("/bin/sh", ["-c", line], {
        encoding: "utf8",
        env: { PATH: bin, FAKE_PSQL_LOG: psqlLog, FAKE_PSQL_SAYS: STARTED, ...env },
      });
      return {
        status: ran.status,
        stdout: ran.stdout,
        stderr: ran.stderr,
        psqlCalls: loggedCalls(psqlLog),
      };
    }

    const handedIn = { PGUSER: "omni", PGPASSWORD: "s3cret", PGDATABASE: "omnidb" };
    const created = { POSTGRES_USER: "omni", POSTGRES_PASSWORD: "s3cret", POSTGRES_DB: "omnidb" };

    it("asks the database through its own network address once the container's values equal the command's", async () => {
      const ran = await runTheLine({ ...handedIn, ...created });

      expect(ran).toMatchObject({ status: 0, stdout: `${STARTED}\n`, stderr: "" });
      expect(ran.psqlCalls).toEqual([
        `-h 172.18.0.2 -tAc SELECT ${WHICH_DATABASE} || ' ' || ${INITIAL_DATABASE}`,
      ]);
    });

    it.each<[string, Record<string, string>, string]>([
      ["one", { POSTGRES_PASSWORD: "another" }, "POSTGRES_PASSWORD"],
      ["two", { POSTGRES_USER: "other", POSTGRES_DB: "elsewhere" }, "POSTGRES_USER POSTGRES_DB"],
    ])(
      "ends with exit 3 before it asks anything when %s of the values differ, and prints their names only",
      async (_count, differing, names) => {
        const ran = await runTheLine({ ...handedIn, ...created, ...differing });

        expect(ran).toMatchObject({
          status: 3,
          stdout: "",
          stderr: `read differently: ${names}\n`,
        });
        expect(ran.psqlCalls).toEqual([]);
      }
    );
  });

  it("stops the proof when it outlives the wait, and migrates nothing", async () => {
    const staged = await stage();
    const began = Date.now();

    const result = await start(["--root", staged.root, "--wait-seconds", "1"], {
      ...staged.env,
      ...staged.ports,
      FAKE_PROOF_SECONDS: "20",
    });

    expect(Date.now() - began).toBeLessThan(10_000);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "platform-start: `pnpm --filter @infra/prisma exec prisma db execute --stdin` did not answer within 1 s and was stopped: nothing was migrated\n"
    );
    expect(loggedCalls(staged.pnpmLog)).toEqual([
      `--filter @infra/prisma exec prisma db execute --stdin|${staged.root}`,
    ]);
    expect(result.stdout).not.toContain("the database is migrated");
  });

  it("lets the migration run past the wait, because a migration stopped half-way is not repaired by a later run", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root, "--wait-seconds", "1"], {
      ...staged.env,
      ...staged.ports,
      FAKE_MIGRATE_SECONDS: "2",
    });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toMatch(/platform-start: the database is migrated\n/);
    expect(loggedCalls(staged.pnpmLog)).toHaveLength(2);
  });

  it("asks for no proof and migrates nothing when the database is not the one its data volume was initialised for", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], {
      ...staged.env,
      ...staged.ports,
      FAKE_IDENTITY: "7707325603935821862 5 off",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `platform-start: POSTGRES_DB of ${staged.file} names a database without the mark the Postgres image leaves on the one its data volume is initialised for: the volume was initialised for another database, or before that mark existed; nothing was migrated (\`docker compose down --volumes\` removes the volume and its data, and the next run initialises a new one; \`pnpm db:migrate\` migrates the database the file names, keeping its data, outside this command's guard)\n`
    );
    expect(result.stdout).toContain("accept connections");
    expect(loggedCalls(staged.pnpmLog)).toEqual([]);
  });

  it.each<[string, string]>([
    ["nothing", ""],
    ["one number", "7707325603935821862 on"],
    ["two numbers and no word about the mark", "7707325603935821862 16384"],
    ["a word about the mark that is neither on nor off", "7707325603935821862 16384 maybe"],
    ["text after the answer", "7707325603935821862 16384 on'; DROP TABLE x; --"],
    ["text before the answer", "x'; SELECT 1; -- 7707325603935821862 16384 on"],
  ])(
    "asks for no proof and migrates nothing when Postgres answers %s for its identity",
    async (_what, answer) => {
      const staged = await stage();

      const result = await start(["--root", staged.root], {
        ...staged.env,
        ...staged.ports,
        FAKE_IDENTITY: answer,
      });

      expect(result.code).toBe(1);
      expect(result.stderr).toBe(
        "platform-start: Postgres did not say which database it is (a cluster identifier, a database oid and whether it is the initial one were expected): nothing was migrated\n"
      );
      expect(loggedCalls(staged.pnpmLog)).toEqual([]);
    }
  );

  it("hands the proof and the migration no variable the file owns and no migration URL of the calling shell", async () => {
    const staged = await stage();
    const refused = [
      ...core.REQUIRED_KEYS,
      "POSTGRES_HOST_PORT",
      "REDIS_HOST_PORT",
      "MIGRATE_DATABASE_URL",
    ];
    const fromTheShell = Object.fromEntries(
      [...core.REQUIRED_KEYS, "MIGRATE_DATABASE_URL"].map((key) => [key, "from-the-shell"])
    );

    const result = await start(["--root", staged.root], {
      ...fromTheShell,
      ...staged.env,
      ...staged.ports,
      KEPT_BY_THE_SHELL: "yes",
    });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    for (const saved of [`${staged.pnpmLog}.proof.env`, `${staged.pnpmLog}.env`]) {
      const given = savedEnvironment(saved);
      expect(refused.filter((key) => key in given)).toEqual([]);
      expect(given.KEPT_BY_THE_SHELL).toBe("yes");
    }
  });

  it("names pnpm when it is not on PATH, after the services answered", async () => {
    const staged = await stage();
    rmSync(path.join(staged.root, "bin", "pnpm"));

    const result = await start(["--root", staged.root], { ...staged.env, ...staged.ports });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "platform-start: pnpm is not on PATH: the migration runs through it\n"
    );
    expect(result.stdout).toContain("accept connections");
  });

  it("fails with the migration's exit code in the message, and does not call the database migrated", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], {
      ...staged.env,
      ...staged.ports,
      FAKE_MIGRATE_EXIT: "3",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "platform-start: `pnpm --filter @infra/prisma run migrate` exited 3\n"
    );
    expect(result.stdout).not.toContain("the database is migrated");
  });

  it("says which signal ended the migration when one stopped it", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], {
      ...staged.env,
      ...staged.ports,
      FAKE_MIGRATE_SIGNAL: "TERM",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "platform-start: `pnpm --filter @infra/prisma run migrate` was ended by SIGTERM\n"
    );
  });

  it("runs no migration when the services did not start", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], {
      ...staged.env,
      ...staged.ports,
      FAKE_UP_EXIT: "17",
    });

    expect(result.code).toBe(1);
    expect(loggedCalls(staged.pnpmLog)).toEqual([]);
  });

  it("shows what the migration tool prints, on the stream it printed it on", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], {
      ...staged.env,
      ...staged.ports,
      FAKE_MIGRATE_SAYS: "83 migrations found",
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("err: 83 migrations found\n");
    expect(result.stdout).toMatch(
      /accept connections\nout: 83 migrations found\nplatform-start: the database is migrated\n/
    );
  });

  it("refuses a wait that is not a whole number of seconds, with its usage", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root, "--wait-seconds", "0"], staged.env);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("[--wait-seconds <n>]");
    expect(existsSync(staged.file)).toBe(false);
    expect(dockerCalls(staged)).toEqual([]);
  });

  it("prints its usage and writes nothing when asked for help", async () => {
    const { root, file } = makeRoot();

    const result = await start(["--root", root, "--help"]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toContain("usage: node scripts/start/platform-start.mjs");
    expect(result.stdout).toContain("POSTGRES_HOST_PORT and\nREDIS_HOST_PORT");
    expect(existsSync(file)).toBe(false);
  });

  it("refuses an argument it does not know, with its usage", async () => {
    const { root, file } = makeRoot();

    const result = await start(["--root", root, "--seed"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("usage: node scripts/start/platform-start.mjs");
    expect(existsSync(file)).toBe(false);
  });
});

describe("the API's port", () => {
  it("is the calling shell's PORT, else the file's, else 3000", () => {
    expect(core.apiPort("4000", "5000")).toBe(4000);
    expect(core.apiPort(undefined, "5000")).toBe(5000);
    expect(core.apiPort(undefined, undefined)).toBe(3000);
  });

  it("reads an empty PORT as the API does: as absent, so the default, and the file is not consulted behind an empty one in the shell", () => {
    expect(core.apiPort("", "5000")).toBe(3000);
    expect(core.apiPort(undefined, "")).toBe(3000);
    expect(core.apiPort("", undefined)).toBe(3000);
  });

  it("is null when the value that wins is not a port", () => {
    expect(core.apiPort("70000", "5000")).toBeNull();
    expect(core.apiPort(undefined, "abc")).toBeNull();
  });
});

describe("the proof and the container's verdict, held further", () => {
  it("takes the proof's limit in seconds: a proof that takes one second passes with three allowed", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root, "--wait-seconds", "3"], {
      ...staged.env,
      ...staged.ports,
      FAKE_PROOF_SECONDS: "1",
    });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(loggedCalls(staged.pnpmLog)).toHaveLength(2);
  });

  it("does not take a server message that precedes the verdict's text for the verdict, even with the comparison's exit code", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root, "--wait-seconds", "1"], {
      ...staged.env,
      ...staged.ports,
      FAKE_PSQL_STDERR: "psql: error: read differently: POSTGRES_USER",
      FAKE_PSQL_EXIT: "3",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `platform-start: Postgres on 127.0.0.1:${staged.postgres.port} did not answer a query within 1 s (\`docker compose logs postgres\`)\n`
    );
    expect(loggedCalls(staged.pnpmLog)).toEqual([]);
  });

  it("says in the usage what --wait-seconds bounds", async () => {
    const { root } = makeRoot();

    const result = await start(["--root", root, "--help"]);

    expect(result.stdout).toContain(
      "  --wait-seconds <n>   how long each service may take to accept a connection, Prisma's proof\n" +
        "                       of the database to answer and the API to answer /health (default: 60)\n"
    );
    expect(result.stdout).toContain(
      "its port is PORT,\nof the calling shell or else of the file, else 3000"
    );
    expect(result.stdout).toContain(
      "An empty PORT in the calling shell counts as set and gives 3000, as it does for\nthe API.\n"
    );
  });
});

describe("the API stage", () => {
  const apiLog = (staged: Stage) => path.join(staged.root, ".tmp", "api.log");

  /** The process id the command recorded for its API; a case that needs it fails without one. */
  function apiOf(staged: Stage): number {
    const pid = recordedApi(staged.root);
    if (pid === null) throw new Error("the command recorded no API");
    return pid;
  }

  const pidFile = (staged: Stage) => path.join(staged.root, ".tmp", "api.pid");

  /**
   * The line the run prints for the operator, word for word: the signal depends on the API
   * attending it, how to see whether the API still runs (the port, or the recorded pnpm, which can
   * end while the API lives on), and that the processes of its session are then ended by hand.
   */
  const stopLine = (staged: Stage, pid: number) =>
    `platform-start: stop it with \`kill -s TERM -- -${pid}\`: a normal termination signal, sent to the process group of pnpm (process ${pid}, which runs the API and leads the session that holds it), which passes it on; it ends the API only if the API attends it, and one that ignores it keeps running. To see whether the API still runs, check whether 127.0.0.1:${staged.apiPort} accepts connections, or whether the pnpm process ${pid}, recorded in ${pidFile(staged)}, still exists (it can end while the API lives on, so only the port settles it); if the API still runs, end the processes of the session by hand (\`ps -s ${pid}\` lists them). pnpm writes a failed-command line in the log when the API ends, which is expected\n`;

  /** The line that says where the API answers, for a run that started it or found it started. */
  const answersLine = (staged: Stage, pid: number, earlier: boolean) =>
    `platform-start: the API ${earlier ? "this command started earlier already " : ""}answers /health with 200 on 127.0.0.1:${staged.apiPort} (run by the pnpm process ${pid}, log ${apiLog(staged)})${earlier ? ": no second API was started" : ""}\n`;

  /** What a run says of a recorded process that still exists and starts nothing for. */
  const recordedLine = (staged: Stage, pid: number) =>
    `platform-start: the process recorded in ${pidFile(staged)} (${pid}) still exists and may be the pnpm of an API an earlier run started, which is still starting or failed to start: nothing was started and nothing was stopped (\`ps -s ${pid}\` lists its session, ${apiLog(staged)} its output)\n`;

  /** How the sweep names the pnpm stand-in, once it runs as `API_PARENT`, and the API stand-in. */
  const parentCommand = (staged: Stage) => literal(`/bin/bash ${staged.env.FAKE_API_PARENT}`);
  const apiCommand = (staged: Stage) =>
    literal(`${process.execPath} ${staged.env.FAKE_API_SCRIPT}`);

  /** The status `/health` answers with on a port, or `null` when nothing answers. */
  async function healthStatus(port: number): Promise<number | null> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.status;
    } catch {
      return null;
    }
  }

  it("starts the API from source, detached, returns once /health answers 200, and leaves it running", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], asked(staged));

    const pid = apiOf(staged);
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(alive(pid)).toBe(true);
    expect(await healthStatus(staged.apiPort)).toBe(200);
    expect(loggedCalls(`${staged.pnpmLog}.api`)).toEqual([`--filter @apps/api dev|${staged.root}`]);
    expect(readFileSync(apiLog(staged), "utf8")).toBe("api double starting in mode ok\n");
    expect(result.stdout).toMatch(/platform-start: the database is migrated\n/);
    expect(result.stdout).toContain(answersLine(staged, pid, false) + stopLine(staged, pid));
  });

  it("stops with the signal the command prints: the API drains and ends", async () => {
    const staged = await stage();
    await start(["--root", staged.root], asked(staged));
    const pid = apiOf(staged);

    expect(signal(-pid, "SIGTERM")).toBe(true);

    await until(() => !alive(pid), { description: "the API to end after SIGTERM" });
    expect(readFileSync(apiLog(staged), "utf8")).toContain("drained\n");
    expect(await healthStatus(staged.apiPort)).toBeNull();
  });

  it("hands the API the calling shell's environment, without the variables the file owns", async () => {
    const staged = await stage();
    const refused = [...core.REQUIRED_KEYS, "POSTGRES_HOST_PORT", "REDIS_HOST_PORT"];
    const fromTheShell = Object.fromEntries(
      core.REQUIRED_KEYS.map((key) => [key, "from-the-shell"])
    );

    const result = await start(["--root", staged.root], {
      ...fromTheShell,
      ...asked(staged, { KEPT_BY_THE_SHELL: "yes" }),
    });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    const given = savedEnvironment(`${staged.pnpmLog}.api.env`);
    expect(refused.filter((key) => key in given)).toEqual([]);
    expect(given).toMatchObject({ KEPT_BY_THE_SHELL: "yes", PORT: String(staged.apiPort) });
  });

  it("is reported by the run: the calling shell's PORT first, then the file's, then 3000", async () => {
    const staged = await stage();
    const listening = { postgres: staged.postgres.port, redis: staged.redis.port };

    const generated = await start(["--root", staged.root], {
      ...staged.env,
      ...staged.ports,
      PORT: "4321",
    });
    expect(generated.stdout).toContain("platform-start: the API takes port 4321\n");
    expect(readFileSync(staged.file, "utf8")).not.toContain("PORT=4321");

    const text = writeEnvironment(staged.file, [], listening);
    appendFileSync(staged.file, "PORT=5432\n");
    const fromFile = await start(["--root", staged.root], staged.env);
    expect(fromFile.stdout).toContain("platform-start: the API takes port 5432\n");

    const overridden = await start(["--root", staged.root], { ...staged.env, PORT: "4321" });
    expect(overridden.stdout).toContain("platform-start: the API takes port 4321\n");

    writeFileSync(staged.file, text);
    const byDefault = await start(["--root", staged.root], staged.env);
    expect(byDefault.stdout).toContain("platform-start: the API takes port 3000\n");
  });

  it("starts the API on the calling shell's PORT, and on the file's when the shell has none", async () => {
    const staged = await stage();
    writeEnvironment(staged.file, [], {
      postgres: staged.postgres.port,
      redis: staged.redis.port,
    });
    appendFileSync(staged.file, "PORT=1\n");

    const overShell = await start(["--root", staged.root], asked(staged));

    expect(overShell).toMatchObject({ code: 0, stderr: "" });
    expect(overShell.stdout).toContain(`on 127.0.0.1:${staged.apiPort} (run by the pnpm process`);
    expect(await healthStatus(staged.apiPort)).toBe(200);
    const first = apiOf(staged);
    expect(signal(-first, "SIGTERM")).toBe(true);
    await until(() => !alive(first), { description: "the first API to end after SIGTERM" });
    writeEnvironment(staged.file, [], {
      postgres: staged.postgres.port,
      redis: staged.redis.port,
    });
    appendFileSync(staged.file, `PORT=${staged.apiPort}\n`);
    const { PORT: _shellPort, ...hostPorts } = staged.ports;

    const overFile = await start(["--root", staged.root], { ...staged.env, ...hostPorts });

    expect(overFile).toMatchObject({ code: 0, stderr: "" });
    expect(overFile.stdout).toContain(`on 127.0.0.1:${staged.apiPort} (run by the pnpm process`);
    expect(await healthStatus(staged.apiPort)).toBe(200);
  });

  it("is refused when it is not a port, before anything is written or started", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], { ...staged.env, PORT: "70000" });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("platform-start: PORT=70000 is not a port\n");
    expect(existsSync(staged.file)).toBe(false);
    expect(dockerCalls(staged)).toEqual([]);
  });

  it("is refused, with the file's own value, when the file holds one that is not a port", async () => {
    const staged = await stage();
    writeEnvironment(staged.file, [], { postgres: staged.postgres.port, redis: staged.redis.port });
    appendFileSync(staged.file, "PORT=abc\n");

    const result = await start(["--root", staged.root], staged.env);

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("platform-start: PORT=abc is not a port\n");
    expect(dockerCalls(staged)).toEqual([]);
  });

  it("starts no service and no API when the file's PORT is not a port", async () => {
    const staged = await stage();
    writeEnvironment(staged.file, [], { postgres: staged.postgres.port, redis: staged.redis.port });
    appendFileSync(staged.file, "PORT=abc\n");

    const result = await start(["--root", staged.root], {
      ...staged.env,
      POSTGRES_HOST_PORT: staged.ports.POSTGRES_HOST_PORT,
      REDIS_HOST_PORT: staged.ports.REDIS_HOST_PORT,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("platform-start: PORT=abc is not a port\n");
    expect(dockerCalls(staged)).toEqual([]);
    expect(loggedCalls(`${staged.pnpmLog}.api`)).toEqual([]);
  });

  it("refuses a port that something else holds, names it, and starts no API", async () => {
    const staged = await stage();
    await occupy(staged.apiPort);

    const result = await start(["--root", staged.root], asked(staged));

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `platform-start: 127.0.0.1:${staged.apiPort} is already in use, and this command holds no record of a running API it started: the port may be held by anything; no API was started\n`
    );
    expect(loggedCalls(`${staged.pnpmLog}.api`)).toEqual([]);
    expect(recordedApi(staged.root)).toBeNull();
    expect(result.stdout).toContain("the database is migrated");
  });

  it("never signals a process it recorded in an earlier run: it only looks at it", async () => {
    const staged = await stage();
    const earlier = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
    earlier.unref();
    const pid = Number(earlier.pid);
    strays.push(pid);
    mkdirSync(path.join(staged.root, ".tmp"));
    writeFileSync(path.join(staged.root, ".tmp", "api.pid"), `${pid}\n`);
    await occupy(staged.apiPort);

    const result = await start(["--root", staged.root], asked(staged));

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `platform-start: 127.0.0.1:${staged.apiPort} is already in use, and /health does not answer 200 there\n` +
        recordedLine(staged, pid)
    );
    expect(alive(pid)).toBe(true);
    expect(recordedApi(staged.root)).toBe(pid);
    expect(loggedCalls(`${staged.pnpmLog}.api`)).toEqual([]);
  });

  it("reads a record holding 1 as no record: init is not an API it started, so it starts the API as it does with none", async () => {
    const staged = await stage();
    mkdirSync(path.join(staged.root, ".tmp"));
    writeFileSync(pidFile(staged), "1\n");

    const result = await start(["--root", staged.root, "--wait-seconds", "2"], asked(staged));

    expect(result).toMatchObject({ code: 0, stderr: "" });
    const pid = apiOf(staged);
    expect(pid).not.toBe(1);
    expect(loggedCalls(`${staged.pnpmLog}.api`)).toEqual([`--filter @apps/api dev|${staged.root}`]);
    expect(result.stdout).toContain(answersLine(staged, pid, false) + stopLine(staged, pid));
    expect(await healthStatus(staged.apiPort)).toBe(200);
  });

  it("goes on as a second run when the API it started earlier still answers: it starts no other", async () => {
    const staged = await stage();
    await start(["--root", staged.root], asked(staged));
    const pid = apiOf(staged);

    const second = await start(["--root", staged.root], asked(staged));

    expect(second).toMatchObject({ code: 0, stderr: "" });
    expect(second.stdout).toContain(answersLine(staged, pid, true) + stopLine(staged, pid));
    expect(apiOf(staged)).toBe(pid);
    expect(alive(pid)).toBe(true);
    expect(loggedCalls(`${staged.pnpmLog}.api`)).toHaveLength(1);
  });

  it("fails at once, with the last lines of the log, when the API exits while the run waits, and a second run goes on from there", async () => {
    const staged = await stage();
    const began = Date.now();

    const failed = await start(
      ["--root", staged.root, "--wait-seconds", "30"],
      asked(staged, { FAKE_API_MODE: "exit" })
    );

    expect(Date.now() - began).toBeLessThan(15_000);
    expect(failed.code).toBe(1);
    expect(failed.stderr).toMatch(
      new RegExp(
        `^platform-start: the pnpm process this run started to run the API \\(process (\\d+)\\) exited 1 before /health answered 200\\n` +
          `platform-start: the session of process \\1 was swept: no process was found in it, and ${literal(pidFile(staged))} was removed\\n` +
          `platform-start: the last lines of ${literal(apiLog(staged))}:\\n` +
          `platform-start:   api double starting in mode exit\\n` +
          `platform-start:   Error starting server: the port is taken\\n$`
      )
    );
    expect(recordedApi(staged.root)).toBeNull();
    const environment = readFileSync(staged.file, "utf8");

    const again = await start(["--root", staged.root], asked(staged));

    expect(again).toMatchObject({ code: 0, stderr: "" });
    expect(readFileSync(staged.file, "utf8")).toBe(environment);
    expect(dockerCalls(staged).filter((call) => call.includes(" up "))).toHaveLength(2);
    expect(await healthStatus(staged.apiPort)).toBe(200);
  });

  it.each(["silent", "503"])(
    "stops every process of the session it started when /health does not answer 200 within the wait (%s), names each, and removes the record once none is left",
    async (mode) => {
      const staged = await stage();

      const result = await start(
        ["--root", staged.root, "--wait-seconds", "1"],
        asked(staged, { FAKE_API_MODE: mode })
      );

      const said = new RegExp(
        `^platform-start: /health on 127\\.0\\.0\\.1:${staged.apiPort} did not answer 200 within 1 s\\n` +
          `platform-start: the pnpm process this run started to run the API \\(process (\\d+)\\) was still running when the wait ended\\n` +
          `platform-start: the session of process \\1 was swept: SIGTERM was sent to \\1 \\(${parentCommand(staged)}\\), \\d+ \\(${apiCommand(staged)}\\); then no process was found in it, and ${literal(pidFile(staged))} was removed\\n` +
          `platform-start: the last lines of ${literal(apiLog(staged))}:\\n` +
          `platform-start:   api double starting in mode ${mode}\\n` +
          `platform-start:   drained\\n$`
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(said);
      const pid = Number(said.exec(result.stderr)?.[1]);
      expect(sessionMembers(pid)).toEqual([]);
      expect(recordedApi(staged.root)).toBeNull();
      expect(await healthStatus(staged.apiPort)).toBeNull();
    }
  );

  it(
    "ends with SIGKILL the processes of its session still running 10 s after SIGTERM when the wait runs out, and removes the record once none is left",
    { timeout: 30_000 },
    async () => {
      const staged = await stage();

      const result = await start(
        ["--root", staged.root, "--wait-seconds", "1"],
        asked(staged, { FAKE_API_MODE: "stubborn" })
      );

      const swept = new RegExp(
        `^platform-start: the session of process (\\d+) was swept: SIGTERM was sent to \\1 \\(${parentCommand(staged)}\\), (\\d+) \\(${apiCommand(staged)}\\), and SIGKILL to \\1 \\(${parentCommand(staged)}\\), \\2 \\(${apiCommand(staged)}\\), still running 10 s later; then no process was found in it, and ${literal(pidFile(staged))} was removed$`,
        "m"
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(swept);
      const pid = Number(swept.exec(result.stderr)?.[1]);
      expect(readFileSync(apiLog(staged), "utf8")).toContain("received SIGTERM and ignored it\n");
      expect(sessionMembers(pid)).toEqual([]);
      expect(recordedApi(staged.root)).toBeNull();
      expect(await healthStatus(staged.apiPort)).toBeNull();
    }
  );

  it("goes on after a failed wait as a run that starts the API again: the failed run left no process and no record", async () => {
    const staged = await stage();
    const failed = await start(
      ["--root", staged.root, "--wait-seconds", "1"],
      asked(staged, { FAKE_API_MODE: "503" })
    );
    expect(failed.code).toBe(1);
    expect(recordedApi(staged.root)).toBeNull();

    const second = await start(["--root", staged.root], asked(staged));

    expect(second).toMatchObject({ code: 0, stderr: "" });
    const pid = apiOf(staged);
    expect(second.stdout).toContain(answersLine(staged, pid, false) + stopLine(staged, pid));
    expect(loggedCalls(`${staged.pnpmLog}.api`)).toHaveLength(2);
    expect(await healthStatus(staged.apiPort)).toBe(200);
  });

  it("sweeps the session of a pnpm that ended first: it stops what pnpm left running, names it, and removes the record once none is left", async () => {
    const staged = await stage();

    const result = await start(
      ["--root", staged.root, "--wait-seconds", "30"],
      asked(staged, { FAKE_API_MODE: "silent", FAKE_API_ORPHAN: "1" })
    );

    const said = new RegExp(
      `^platform-start: the pnpm process this run started to run the API \\(process (\\d+)\\) exited 1 before /health answered 200\\n` +
        `platform-start: the session of process \\1 was swept: SIGTERM was sent to \\d+ \\(${apiCommand(staged)}\\); then no process was found in it, and ${literal(pidFile(staged))} was removed\\n`
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(said);
    const pid = Number(said.exec(result.stderr)?.[1]);
    expect(sessionMembers(pid)).toEqual([]);
    expect(recordedApi(staged.root)).toBeNull();
    expect(await healthStatus(staged.apiPort)).toBeNull();
  });

  describe("a rerun while the API of an earlier run has not bound its port yet", () => {
    /**
     * An API that binds late, whose first run was ended while it waited, as an operator who stops
     * the command would end it: the run that started the API is gone, its record and the API stay.
     */
    async function firstRunInterrupted(bindDelayMs: number) {
      const staged = await stage();
      const late = { FAKE_API_BIND_DELAY_MS: String(bindDelayMs) };
      const first = spawn(
        process.execPath,
        [COMMAND, "--root", staged.root, "--wait-seconds", "60"],
        { env: asked(staged, late), stdio: "ignore" }
      );
      const ended = new Promise((resolve) => first.once("exit", resolve));
      // The API's first line comes before the case's, as it does when a run is ended while it waits.
      await until(() => existsSync(apiLog(staged)) && readFileSync(apiLog(staged), "utf8") !== "", {
        description: "the first run's API to write its first line",
      });
      expect(signal(Number(first.pid), "SIGKILL")).toBe(true);
      await ended;
      const pid = apiOf(staged);
      appendFileSync(apiLog(staged), "kept by the case\n");
      return { staged, late, pid };
    }

    it("starts no second API after a first run interrupted before its API bound its port, leaves the record and the log alone, and goes on as a second run when /health arrives", async () => {
      const { staged, late, pid } = await firstRunInterrupted(3000);
      expect(await healthStatus(staged.apiPort)).toBeNull();

      const second = await start(
        ["--root", staged.root, "--wait-seconds", "30"],
        asked(staged, late)
      );

      expect(second.code).toBe(0);
      expect(second.stderr).toBe("");
      expect(second.stdout).toContain(
        `platform-start: the process recorded in ${pidFile(staged)} (${pid}) still exists and nothing accepts connections on 127.0.0.1:${staged.apiPort} yet: no second API is started, and /health is awaited for up to 30 s\n` +
          answersLine(staged, pid, true) +
          stopLine(staged, pid)
      );
      expect(loggedCalls(`${staged.pnpmLog}.api`)).toHaveLength(1);
      expect(apiOf(staged)).toBe(pid);
      expect(readFileSync(apiLog(staged), "utf8")).toBe(
        "api double starting in mode ok\nkept by the case\n"
      );
      expect(await healthStatus(staged.apiPort)).toBe(200);
    });

    it("starts no second API after a first run interrupted before its API bound its port, and says what it knows and no more when its own wait runs out", async () => {
      const { staged, late, pid } = await firstRunInterrupted(60_000);

      const second = await start(
        ["--root", staged.root, "--wait-seconds", "1"],
        asked(staged, late)
      );

      expect(second.code).toBe(1);
      expect(second.stderr).toBe(
        `platform-start: /health on 127.0.0.1:${staged.apiPort} did not answer 200 within 1 s\n` +
          recordedLine(staged, pid)
      );
      expect(loggedCalls(`${staged.pnpmLog}.api`)).toHaveLength(1);
      expect(apiOf(staged)).toBe(pid);
      expect(readFileSync(apiLog(staged), "utf8")).toBe(
        "api double starting in mode ok\nkept by the case\n"
      );
      expect(alive(pid)).toBe(true);
    });

    // Its own time limit outlasts the run's whole wait, so a run that misses the end fails here on
    // what it prints, not on the limit.
    it("fails as soon as the recorded process ends during the wait, says that it ended, and leaves the record as it is", async () => {
      const staged = await stage();
      const earlier = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
      earlier.unref();
      const pid = Number(earlier.pid);
      strays.push(pid);
      mkdirSync(path.join(staged.root, ".tmp"));
      writeFileSync(pidFile(staged), `${pid}\n`);
      const waiting = `platform-start: the process recorded in ${pidFile(staged)} (${pid}) still exists and nothing accepts connections on 127.0.0.1:${staged.apiPort} yet: no second API is started, and /health is awaited for up to 10 s\n`;
      const run = spawn(
        process.execPath,
        [COMMAND, "--root", staged.root, "--wait-seconds", "10"],
        { env: asked(staged) }
      );
      strays.push(Number(run.pid));
      let stdout = "";
      let stderr = "";
      run.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      run.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      let closed = false;
      const code = new Promise<number | null>((resolve) =>
        run.once("close", (exitCode) => {
          closed = true;
          resolve(exitCode);
        })
      );
      await until(() => closed || stdout.includes(waiting), {
        description: "the run to wait on the recorded process",
        timeoutMs: 15_000,
      });
      expect(stdout).toContain(waiting);

      expect(signal(pid, "SIGTERM")).toBe(true);
      const signalledAt = Date.now();

      expect(await code).toBe(1);
      expect(stderr).toBe(
        `platform-start: the process recorded in ${pidFile(staged)} (${pid}) ended during the wait without /health on 127.0.0.1:${staged.apiPort} answering 200, and no API was started\n`
      );
      expect(Date.now() - signalledAt).toBeLessThan(5_000);
      expect(alive(pid)).toBe(false);
      expect(readFileSync(pidFile(staged), "utf8")).toBe(`${pid}\n`);
      expect(loggedCalls(`${staged.pnpmLog}.api`)).toEqual([]);
    }, 30_000);
  });
});

describe("the workers stage", () => {
  const workersLog = (staged: Stage) => path.join(staged.root, ".tmp", "workers.log");
  const workersPidFile = (staged: Stage) => path.join(staged.root, ".tmp", "workers.pid");
  const listening = (staged: Stage) => ({
    postgres: staged.postgres.port,
    redis: staged.redis.port,
  });

  /** The process id the command recorded for its workers; a case that needs it fails without one. */
  function workersOf(staged: Stage): number {
    const pid = recordedWorkers(staged.root);
    if (pid === null) throw new Error("the command recorded no workers");
    return pid;
  }

  /** The line that says where the workers answer, for a run that started them or found them started. */
  const answersLine = (staged: Stage, pid: number, earlier: boolean) =>
    `platform-start: the workers ${earlier ? "this command started earlier already " : ""}answer /health/ready with 200 on 127.0.0.1:${staged.workersPort} (run by the pnpm process ${pid}, log ${workersLog(staged)})${earlier ? ": no second workers were started" : ""}\n`;

  /** The stop line the run prints for the workers, word for word: their own pnpm, not the API's. */
  const stopLine = (staged: Stage, pid: number) =>
    `platform-start: stop them with \`kill -s TERM -- -${pid}\`: a normal termination signal, sent to the process group of pnpm (process ${pid}, which runs the workers and leads the session that holds them), which passes it on; it ends the workers only if the workers attend it, and ones that ignore it keep running. To see whether the workers still run, check whether 127.0.0.1:${staged.workersPort} accepts connections, or whether the pnpm process ${pid}, recorded in ${workersPidFile(staged)}, still exists (it can end while the workers live on, so only the port settles it); if the workers still run, end the processes of the session by hand (\`ps -s ${pid}\` lists them). pnpm writes a failed-command line in the log when the workers end, which is expected\n`;

  /** How the sweep names the pnpm stand-in, once it runs as `WORKERS_PARENT`, and the workers'. */
  const parentCommand = (staged: Stage) => literal(`/bin/bash ${staged.env.FAKE_WORKERS_PARENT}`);
  const workersCommand = (staged: Stage) =>
    literal(`${process.execPath} ${staged.env.FAKE_WORKERS_SCRIPT}`);

  /** The status a path answers with on a port, or `null` when nothing answers. */
  async function statusOf(port: number, probe: string): Promise<number | null> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${probe}`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.status;
    } catch {
      return null;
    }
  }

  /** A calling shell without `METRICS_PORT`, for a case that asks the file or the default. */
  function withoutMetricsPort(env: Record<string, string>): Record<string, string> {
    const { METRICS_PORT: _workersPort, ...rest } = env;
    return rest;
  }

  it("starts the workers from source once the API answers, detached, returns once /health/ready answers 200, and leaves them running", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], asked(staged));

    const pid = workersOf(staged);
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(alive(pid)).toBe(true);
    expect(pid).not.toBe(recordedApi(staged.root));
    expect(await statusOf(staged.workersPort, "/health/ready")).toBe(200);
    expect(loggedCalls(`${staged.pnpmLog}.workers`)).toEqual([
      `--filter @apps/workers dev|${staged.root}`,
    ]);
    expect(readFileSync(workersLog(staged), "utf8")).toBe("workers double starting in mode ok\n");
    expect(
      result.stdout.indexOf("platform-start: the API answers /health with 200 on ")
    ).toBeGreaterThan(0);
    expect(result.stdout).toContain(
      `${answersLine(staged, pid, false)}${stopLine(staged, pid)}platform-start: the administration portal answers `
    );
  });

  it("stops with the signal the command prints for them: the workers shut down and end, and the API keeps answering", async () => {
    const staged = await stage();
    await start(["--root", staged.root], asked(staged));
    const pid = workersOf(staged);

    expect(signal(-pid, "SIGTERM")).toBe(true);

    await until(() => !alive(pid), { description: "the workers to end after SIGTERM" });
    expect(readFileSync(workersLog(staged), "utf8")).toContain("Worker shutdown complete\n");
    expect(await statusOf(staged.workersPort, "/health/ready")).toBeNull();
    expect(alive(Number(recordedApi(staged.root)))).toBe(true);
    expect(await statusOf(staged.apiPort, "/health")).toBe(200);
  });

  it("hands the workers the calling shell's environment, without the variables the file owns", async () => {
    const staged = await stage();
    const refused = [...core.REQUIRED_KEYS, "POSTGRES_HOST_PORT", "REDIS_HOST_PORT"];
    const fromTheShell = Object.fromEntries(
      core.REQUIRED_KEYS.map((key) => [key, "from-the-shell"])
    );

    const result = await start(["--root", staged.root], {
      ...fromTheShell,
      ...asked(staged, { KEPT_BY_THE_SHELL: "yes" }),
    });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    const given = savedEnvironment(`${staged.pnpmLog}.workers.env`);
    expect(refused.filter((key) => key in given)).toEqual([]);
    expect(given).toMatchObject({
      KEPT_BY_THE_SHELL: "yes",
      METRICS_PORT: String(staged.workersPort),
    });
  });

  it("hands the workers no NODE_ENV, so a calling shell's NODE_ENV=test leaves them on the checkout's .env, and still hands it to the API", async () => {
    const staged = await stage();
    writeEnvironment(staged.file, [], listening(staged));
    appendFileSync(staged.file, `METRICS_PORT=${staged.workersPort}\n`);

    const result = await start(["--root", staged.root], {
      ...withoutMetricsPort(asked(staged)),
      NODE_ENV: "test",
    });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(savedEnvironment(`${staged.pnpmLog}.workers.env`)).not.toHaveProperty("NODE_ENV");
    expect(savedEnvironment(`${staged.pnpmLog}.api.env`)).toMatchObject({ NODE_ENV: "test" });
    expect(await statusOf(staged.workersPort, "/health/ready")).toBe(200);
  });

  it("is reported by the run after the API's port: the calling shell's METRICS_PORT first, then the file's, then 3300", async () => {
    const staged = await stage();
    const shell = withoutMetricsPort(asked(staged));
    const takes = (port: number | string) =>
      `platform-start: the API takes port ${staged.apiPort}\nplatform-start: the workers take port ${port}\n`;

    const generated = await start(["--root", staged.root], { ...shell, METRICS_PORT: "4321" });
    expect(generated.stdout).toContain(takes(4321));
    expect(readFileSync(staged.file, "utf8")).not.toContain("METRICS_PORT");

    const text = writeEnvironment(staged.file, [], listening(staged));
    appendFileSync(staged.file, "METRICS_PORT=5433\n");
    const fromFile = await start(["--root", staged.root], shell);
    expect(fromFile.stdout).toContain(takes(5433));

    const overridden = await start(["--root", staged.root], { ...shell, METRICS_PORT: "4321" });
    expect(overridden.stdout).toContain(takes(4321));

    writeFileSync(staged.file, text);
    const byDefault = await start(["--root", staged.root], shell);
    expect(byDefault.stdout).toContain(takes(3300));
  });

  it("reads an empty METRICS_PORT as the workers do: as absent, so 3300, and the file is not consulted behind an empty one in the shell", async () => {
    const staged = await stage();
    writeEnvironment(staged.file, [], listening(staged));
    appendFileSync(staged.file, "METRICS_PORT=5433\n");

    const emptyInTheShell = await start(["--root", staged.root], {
      ...asked(staged),
      METRICS_PORT: "",
    });
    expect(emptyInTheShell.stdout).toContain("platform-start: the workers take port 3300\n");

    writeEnvironment(staged.file, [], listening(staged));
    appendFileSync(staged.file, "METRICS_PORT=\n");
    const emptyInTheFile = await start(["--root", staged.root], withoutMetricsPort(asked(staged)));
    expect(emptyInTheFile.stdout).toContain("platform-start: the workers take port 3300\n");
  });

  it("starts the workers on the file's METRICS_PORT when the calling shell sets none", async () => {
    const staged = await stage();
    writeEnvironment(staged.file, [], listening(staged));
    appendFileSync(staged.file, `METRICS_PORT=${staged.workersPort}\n`);

    const result = await start(["--root", staged.root], withoutMetricsPort(asked(staged)));

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toContain(answersLine(staged, workersOf(staged), false));
    expect(await statusOf(staged.workersPort, "/health/ready")).toBe(200);
  });

  it("is refused when METRICS_PORT is not a port, in the calling shell or in the file, with the other problems and before anything is written or started", async () => {
    const staged = await stage();

    const fromShell = await start(["--root", staged.root], {
      ...staged.env,
      METRICS_PORT: "70000",
    });
    expect(fromShell.code).toBe(1);
    expect(fromShell.stderr).toBe("platform-start: METRICS_PORT=70000 is not a port\n");

    const withPort = await start(["--root", staged.root], {
      ...staged.env,
      PORT: "0",
      METRICS_PORT: "x",
    });
    expect(withPort.code).toBe(1);
    expect(withPort.stderr).toBe(
      "platform-start: PORT=0 is not a port\nplatform-start: METRICS_PORT=x is not a port\n"
    );
    // Read through the directory listing, not a check of the path the case writes next.
    expect(readdirSync(staged.root)).not.toContain(path.basename(staged.file));

    writeEnvironment(staged.file, [], listening(staged));
    appendFileSync(staged.file, "METRICS_PORT=abc\n");
    const fromFile = await start(["--root", staged.root], withoutMetricsPort(staged.env));
    expect(fromFile.code).toBe(1);
    expect(fromFile.stderr).toBe("platform-start: METRICS_PORT=abc is not a port\n");
    expect(dockerCalls(staged)).toEqual([]);
    expect(loggedCalls(`${staged.pnpmLog}.workers`)).toEqual([]);
  });

  it("is refused when it is the API's port, whether set or the default, before anything is written or started", async () => {
    const staged = await stage();

    const set = await start(["--root", staged.root], {
      ...staged.env,
      PORT: "4321",
      METRICS_PORT: "4321",
    });
    expect(set.code).toBe(1);
    expect(set.stderr).toBe(
      "platform-start: the API and the workers would both take port 4321 (PORT and METRICS_PORT): give each its own\n"
    );

    const byDefault = await start(["--root", staged.root], {
      ...withoutMetricsPort(staged.env),
      PORT: "3300",
    });
    expect(byDefault.code).toBe(1);
    expect(byDefault.stderr).toBe(
      "platform-start: the API and the workers would both take port 3300 (PORT and METRICS_PORT): give each its own\n"
    );
    expect(existsSync(staged.file)).toBe(false);
    expect(dockerCalls(staged)).toEqual([]);
  });

  it("goes on as a second run when the workers it started earlier still answer: it starts no others", async () => {
    const staged = await stage();
    await start(["--root", staged.root], asked(staged));
    const pid = workersOf(staged);

    const second = await start(["--root", staged.root], asked(staged));

    expect(second).toMatchObject({ code: 0, stderr: "" });
    expect(second.stdout).toContain(
      `${answersLine(staged, pid, true)}${stopLine(staged, pid)}platform-start: the administration portal this command started earlier already answers `
    );
    expect(workersOf(staged)).toBe(pid);
    expect(alive(pid)).toBe(true);
    expect(loggedCalls(`${staged.pnpmLog}.workers`)).toHaveLength(1);
  });

  it("refuses a port that something else holds, names it, starts no workers and leaves the API it started running", async () => {
    const staged = await stage();
    await occupy(staged.workersPort);

    const result = await start(["--root", staged.root], asked(staged));

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `platform-start: 127.0.0.1:${staged.workersPort} is already in use, and this command holds no record of running workers it started: the port may be held by anything; no workers were started\n`
    );
    expect(loggedCalls(`${staged.pnpmLog}.workers`)).toEqual([]);
    expect(recordedWorkers(staged.root)).toBeNull();
    expect(result.stdout).toContain("platform-start: the API answers /health with 200 on ");
    expect(await statusOf(staged.apiPort, "/health")).toBe(200);
  });

  it("sweeps the session of a pnpm that ended first: it stops what pnpm left running, names it, removes the record once none is left, and leaves the API running", async () => {
    const staged = await stage();

    const result = await start(
      ["--root", staged.root, "--wait-seconds", "30"],
      asked(staged, { FAKE_WORKERS_MODE: "silent", FAKE_WORKERS_ORPHAN: "1" })
    );

    const said = new RegExp(
      `^platform-start: the pnpm process this run started to run the workers \\(process (\\d+)\\) exited 1 before /health/ready answered 200\\n` +
        `platform-start: the session of process \\1 was swept: SIGTERM was sent to \\d+ \\(${workersCommand(staged)}\\); then no process was found in it, and ${literal(workersPidFile(staged))} was removed\\n`
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(said);
    const pid = Number(said.exec(result.stderr)?.[1]);
    expect(sessionMembers(pid)).toEqual([]);
    expect(recordedWorkers(staged.root)).toBeNull();
    expect(await statusOf(staged.workersPort, "/health/ready")).toBeNull();
    expect(await statusOf(staged.apiPort, "/health")).toBe(200);
  });

  it("stops every process of the session it started when /health/ready does not answer 200 within the wait, names each, removes the record once none is left, and leaves the API running", async () => {
    const staged = await stage();

    const result = await start(
      ["--root", staged.root, "--wait-seconds", "2"],
      asked(staged, { FAKE_WORKERS_MODE: "503" })
    );

    const said = new RegExp(
      `^platform-start: /health/ready on 127\\.0\\.0\\.1:${staged.workersPort} did not answer 200 within 2 s\\n` +
        `platform-start: the pnpm process this run started to run the workers \\(process (\\d+)\\) was still running when the wait ended\\n` +
        `platform-start: the session of process \\1 was swept: SIGTERM was sent to \\1 \\(${parentCommand(staged)}\\), \\d+ \\(${workersCommand(staged)}\\); then no process was found in it, and ${literal(workersPidFile(staged))} was removed\\n` +
        `platform-start: the last lines of ${literal(workersLog(staged))}:\\n` +
        `platform-start:   workers double starting in mode 503\\n` +
        `platform-start:   Worker shutdown complete\\n$`
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(said);
    const pid = Number(said.exec(result.stderr)?.[1]);
    expect(sessionMembers(pid)).toEqual([]);
    expect(recordedWorkers(staged.root)).toBeNull();
    expect(await statusOf(staged.workersPort, "/health/ready")).toBeNull();
    expect(await statusOf(staged.apiPort, "/health")).toBe(200);
  });

  it("starts no workers when the API's start fails: the run ends at the API, as it did before the workers had a stage", async () => {
    const staged = await stage();

    const result = await start(
      ["--root", staged.root, "--wait-seconds", "30"],
      asked(staged, { FAKE_API_MODE: "exit" })
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      /^platform-start: the pnpm process this run started to run the API \(process \d+\) exited 1 before \/health answered 200\n/
    );
    expect(result.stdout).not.toContain("the workers answer");
    expect(loggedCalls(`${staged.pnpmLog}.workers`)).toEqual([]);
    expect(recordedWorkers(staged.root)).toBeNull();
  });

  it("says in the usage that the workers start after the API, on METRICS_PORT, without NODE_ENV, and that their stop line ends their session alone", async () => {
    const { root } = makeRoot();

    const result = await start(["--root", root, "--help"]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toContain(
      "to an API running from source that answers /health with 200 and then to\nworkers running from source that answer /health/ready with 200.\n"
    );
    expect(result.stdout).toContain(
      "with\n`pnpm --filter @apps/workers dev`, and left running; --wait-seconds bounds their answer on\n/health/ready too."
    );
    expect(result.stdout).toContain(
      "Their port is METRICS_PORT, of the calling shell or else of the file, else 3300\n(an empty METRICS_PORT gives 3300)"
    );
    expect(result.stdout).toContain("They receive the API's environment without NODE_ENV");
    expect(result.stdout).toContain(
      "each stop line ends one app's session, so stopping the API leaves the workers\nrunning."
    );
  });
});

describe("the administration portal stage", () => {
  const adminLog = (staged: Stage) => path.join(staged.root, ".tmp", "admin.log");
  const adminPidFile = (staged: Stage) => path.join(staged.root, ".tmp", "admin.pid");
  const manifest = (staged: Stage) => path.join(staged.root, "apps", "admin", "package.json");
  const at = (staged: Stage) => `127.0.0.1:${staged.adminPort}`;

  /** The process id the command recorded for its portal; a case that needs it fails without one. */
  function adminOf(staged: Stage): number {
    const pid = recordedIn(staged.root, "admin.pid");
    if (pid === null) throw new Error("the command recorded no administration portal");
    return pid;
  }

  /** The line that says where the portal answers, for a run that started it or found it started. */
  const answersLine = (staged: Stage, pid: number, earlier: boolean) =>
    `platform-start: the administration portal ${earlier ? "this command started earlier already " : ""}answers /api/health, /en/login and /api/backend/health with 200 on ${at(staged)} (run by the pnpm process ${pid}, log ${adminLog(staged)})${earlier ? ": no second administration portal was started" : ""}\n`;

  /** The stop line the run prints for the portal, word for word: its own pnpm, its own session. */
  const stopLine = (staged: Stage, pid: number) =>
    `platform-start: stop it with \`kill -s TERM -- -${pid}\`: a normal termination signal, sent to the process group of pnpm (process ${pid}, which runs the administration portal and leads the session that holds it), which passes it on; it ends the administration portal only if the administration portal attends it, and one that ignores it keeps running. To see whether the administration portal still runs, check whether ${at(staged)} accepts connections, or whether the pnpm process ${pid}, recorded in ${adminPidFile(staged)}, still exists (it can end while the administration portal lives on, so only the port settles it); if the administration portal still runs, end the processes of the session by hand (\`ps -s ${pid}\` lists them). pnpm writes a failed-command line in the log when the administration portal ends, which is expected\n`;

  /** How the sweep names the pnpm stand-in, once it runs as `ADMIN_PARENT`, and the portal's. */
  const parentCommand = (staged: Stage) => literal(`/bin/bash ${staged.env.FAKE_ADMIN_PARENT}`);
  const adminCommand = (staged: Stage) =>
    literal(`${process.execPath} ${staged.env.FAKE_ADMIN_SCRIPT}`);

  /** The status a path answers with on a port, or `null` when nothing answers. */
  async function statusOf(port: number, probe: string): Promise<number | null> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${probe}`, {
        signal: AbortSignal.timeout(2000),
        redirect: "manual",
      });
      return response.status;
    } catch {
      return null;
    }
  }

  /** Whether the API and the workers a run started still answer, as a failed portal leaves them. */
  async function apiAndWorkersAnswer(staged: Stage): Promise<boolean> {
    return (
      (await statusOf(staged.apiPort, "/health")) === 200 &&
      (await statusOf(staged.workersPort, "/health/ready")) === 200
    );
  }

  /**
   * The lines of a start of the portal whose wait ran out with the portal still running: the cause
   * a case names, then the sweep of the portal's session and the last lines of its log.
   */
  const ranOutLines = (staged: Stage, cause: string, mode: string) =>
    new RegExp(
      `^platform-start: ${cause}\\n` +
        `platform-start: the pnpm process this run started to run the administration portal \\(process (\\d+)\\) was still running when the wait ended\\n` +
        `platform-start: the session of process \\1 was swept: SIGTERM was sent to \\1 \\(${parentCommand(staged)}\\), \\d+ \\(${adminCommand(staged)}\\); then no process was found in it, and ${literal(adminPidFile(staged))} was removed\\n` +
        `platform-start: the last lines of ${literal(adminLog(staged))}:\\n` +
        `platform-start:   admin double starting in mode ${mode}\\n` +
        `platform-start:   portal stopped\\n$`
    );

  it("starts the portal from source once the workers answer, detached, returns once /api/health, /en/login and /api/backend/health answer 200, and leaves it running", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], asked(staged));

    const pid = adminOf(staged);
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(alive(pid)).toBe(true);
    expect([recordedApi(staged.root), recordedWorkers(staged.root)]).not.toContain(pid);
    expect(loggedCalls(`${staged.pnpmLog}.admin`)).toEqual([
      `--filter @apps/admin dev|${staged.root}`,
    ]);
    expect(readFileSync(adminLog(staged), "utf8")).toBe("admin double starting in mode ok\n");
    for (const probe of ["/api/health", "/en/login", "/api/backend/health"]) {
      expect(await statusOf(staged.adminPort, probe)).toBe(200);
    }
    expect(
      result.stdout.indexOf("platform-start: the workers answer /health/ready with 200 on ")
    ).toBeLessThan(result.stdout.indexOf("platform-start: the administration portal answers "));
    expect(result.stdout.endsWith(answersLine(staged, pid, false) + stopLine(staged, pid))).toBe(
      true
    );
  });

  it("stops with the signal the command prints for it: the portal stops and ends, and the API and the workers keep answering", async () => {
    const staged = await stage();
    await start(["--root", staged.root], asked(staged));
    const pid = adminOf(staged);

    expect(signal(-pid, "SIGTERM")).toBe(true);

    await until(() => !alive(pid), { description: "the portal to end after SIGTERM" });
    expect(readFileSync(adminLog(staged), "utf8")).toContain("portal stopped\n");
    expect(await statusOf(staged.adminPort, "/api/health")).toBeNull();
    expect(await apiAndWorkersAnswer(staged)).toBe(true);
  });

  it("points the portal at the API this run started: it hands it API_URL with the API's port, and /api/backend/health reaches that API through the portal", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], asked(staged));

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(savedEnvironment(`${staged.pnpmLog}.admin.env`)).toMatchObject({
      API_URL: `http://127.0.0.1:${staged.apiPort}`,
    });
    expect(await statusOf(staged.adminPort, "/api/backend/health")).toBe(200);
    expect(signal(-Number(recordedApi(staged.root)), "SIGTERM")).toBe(true);
    await until(async () => (await statusOf(staged.apiPort, "/health")) === null, {
      description: "the API to end after SIGTERM",
    });
    expect(await statusOf(staged.adminPort, "/api/backend/health")).toBe(503);
  });

  it("hands the portal the calling shell's API_URL when the shell sets one, as a shell's PORT wins, and holds the run to the API it names", async () => {
    const staged = await stage();
    const elsewhere = `http://127.0.0.1:${await freePort()}`;

    const result = await start(
      ["--root", staged.root, "--wait-seconds", "2"],
      asked(staged, { API_URL: elsewhere })
    );

    expect(savedEnvironment(`${staged.pnpmLog}.admin.env`)).toMatchObject({ API_URL: elsewhere });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      ranOutLines(
        staged,
        `/api/health on ${literal(at(staged))} answered 200, but /api/backend/health there did not answer 200 within 2 s \\(the last answer it gave was 503\\)`,
        "ok"
      )
    );
    expect(await apiAndWorkersAnswer(staged)).toBe(true);
  });

  it("reads an empty API_URL in the calling shell as unset, as an empty PORT reads for the API: the portal is pointed at the API this run started, and the run passes", async () => {
    const staged = await stage();

    const result = await start(
      ["--root", staged.root, "--wait-seconds", "2"],
      asked(staged, { API_URL: "" })
    );

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(savedEnvironment(`${staged.pnpmLog}.admin.env`)).toMatchObject({
      API_URL: `http://127.0.0.1:${staged.apiPort}`,
    });
    expect(await statusOf(staged.adminPort, "/api/backend/health")).toBe(200);
  });

  it("hands the portal no NODE_ENV, so a calling shell's NODE_ENV=test does not choose its environment files, and still hands it to the API", async () => {
    const staged = await stage();

    const result = await start(["--root", staged.root], asked(staged, { NODE_ENV: "test" }));

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(savedEnvironment(`${staged.pnpmLog}.admin.env`)).not.toHaveProperty("NODE_ENV");
    expect(savedEnvironment(`${staged.pnpmLog}.api.env`)).toMatchObject({ NODE_ENV: "test" });
  });

  it("hands the portal the calling shell's environment, without the variables the file owns: no required secret reaches it", async () => {
    const staged = await stage();
    const refused = [...core.REQUIRED_KEYS, "POSTGRES_HOST_PORT", "REDIS_HOST_PORT"];
    const fromTheShell = Object.fromEntries(
      core.REQUIRED_KEYS.map((key) => [key, "from-the-shell"])
    );

    const result = await start(["--root", staged.root], {
      ...fromTheShell,
      ...asked(staged, { KEPT_BY_THE_SHELL: "yes" }),
    });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    const given = savedEnvironment(`${staged.pnpmLog}.admin.env`);
    expect(refused.filter((key) => key in given)).toEqual([]);
    expect(Object.values(given)).not.toContain("from-the-shell");
    expect(given).toMatchObject({ KEPT_BY_THE_SHELL: "yes" });
  });

  it("holds the run to /en/login answering exactly 200: a portal whose page fails (DEF-85) fails the run, names the page and the port, sweeps its session alone and leaves the API and the workers running", async () => {
    const staged = await stage();

    const result = await start(
      ["--root", staged.root, "--wait-seconds", "2"],
      asked(staged, { FAKE_ADMIN_MODE: "page500" })
    );

    expect(result.code).toBe(1);
    const said = ranOutLines(
      staged,
      `/api/health on ${literal(at(staged))} answered 200, but /en/login there did not answer 200 within 2 s \\(the last answer it gave was 500\\)`,
      "page500"
    );
    expect(result.stderr).toMatch(said);
    expect(sessionMembers(Number(said.exec(result.stderr)?.[1]))).toEqual([]);
    expect(recordedIn(staged.root, "admin.pid")).toBeNull();
    expect(await statusOf(staged.adminPort, "/api/health")).toBeNull();
    expect(await apiAndWorkersAnswer(staged)).toBe(true);
  });

  it("keeps the last answer the page gave when the wait's last attempt at it gets none: a page that answered 500 and then stays silent is named with the 500, never as unanswered", async () => {
    const staged = await stage();

    const result = await start(
      ["--root", staged.root, "--wait-seconds", "2"],
      asked(staged, { FAKE_ADMIN_MODE: "page500ThenSilent" })
    );

    expect(result.code).toBe(1);
    const said = ranOutLines(
      staged,
      `/api/health on ${literal(at(staged))} answered 200, but /en/login there did not answer 200 within 2 s \\(the last answer it gave was 500\\)`,
      "page500ThenSilent"
    );
    expect(result.stderr).toMatch(said);
    expect(sessionMembers(Number(said.exec(result.stderr)?.[1]))).toEqual([]);
    expect(recordedIn(staged.root, "admin.pid")).toBeNull();
    expect(await apiAndWorkersAnswer(staged)).toBe(true);
  });

  it("holds the run to /en/login answering exactly 200, never a redirect: a page that answers 307 to a path that answers 200 fails the run, named with the 307, and only the portal's session is swept", async () => {
    const staged = await stage();

    const result = await start(
      ["--root", staged.root, "--wait-seconds", "2"],
      asked(staged, { FAKE_ADMIN_MODE: "redirect307" })
    );

    expect(result.code).toBe(1);
    const said = ranOutLines(
      staged,
      `/api/health on ${literal(at(staged))} answered 200, but /en/login there did not answer 200 within 2 s \\(the last answer it gave was 307\\)`,
      "redirect307"
    );
    expect(result.stderr).toMatch(said);
    expect(sessionMembers(Number(said.exec(result.stderr)?.[1]))).toEqual([]);
    expect(recordedIn(staged.root, "admin.pid")).toBeNull();
    expect(await apiAndWorkersAnswer(staged)).toBe(true);
  });

  it("holds the run to /api/backend/health answering 200 through the portal: a portal that cannot reach the API fails the run and names that path and the port", async () => {
    const staged = await stage();

    const result = await start(
      ["--root", staged.root, "--wait-seconds", "2"],
      asked(staged, { FAKE_ADMIN_MODE: "backend503" })
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      ranOutLines(
        staged,
        `/api/health on ${literal(at(staged))} answered 200, but /api/backend/health there did not answer 200 within 2 s \\(the last answer it gave was 503\\)`,
        "backend503"
      )
    );
    expect(recordedIn(staged.root, "admin.pid")).toBeNull();
    expect(await apiAndWorkersAnswer(staged)).toBe(true);
  });

  it("names the probe when the portal never answers it within the wait, and sweeps the portal's session alone", async () => {
    const staged = await stage();

    const result = await start(
      ["--root", staged.root, "--wait-seconds", "2"],
      asked(staged, { FAKE_ADMIN_MODE: "silent" })
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      ranOutLines(
        staged,
        `/api/health on ${literal(at(staged))} did not answer 200 within 2 s`,
        "silent"
      )
    );
    expect(recordedIn(staged.root, "admin.pid")).toBeNull();
    expect(await apiAndWorkersAnswer(staged)).toBe(true);
  });

  it("fails at once when pnpm ends first, as it does when the portal's predev build fails, sweeps its session and leaves the API and the workers running", async () => {
    const staged = await stage();
    const began = Date.now();

    const result = await start(
      ["--root", staged.root, "--wait-seconds", "30"],
      asked(staged, { FAKE_ADMIN_MODE: "exit" })
    );

    expect(Date.now() - began).toBeLessThan(15_000);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      new RegExp(
        `^platform-start: the pnpm process this run started to run the administration portal \\(process (\\d+)\\) exited 1 before /api/health, /en/login and /api/backend/health answered 200\\n` +
          `platform-start: the session of process \\1 was swept: no process was found in it, and ${literal(adminPidFile(staged))} was removed\\n` +
          `platform-start: the last lines of ${literal(adminLog(staged))}:\\n` +
          `platform-start:   admin double starting in mode exit\\n` +
          `platform-start:   Error: the portal could not start on ${staged.adminPort}\\n$`
      )
    );
    expect(recordedIn(staged.root, "admin.pid")).toBeNull();
    expect(await apiAndWorkersAnswer(staged)).toBe(true);
  });

  it("goes on as a second run when the portal it started earlier still answers on every path: it starts no other", async () => {
    const staged = await stage();
    await start(["--root", staged.root], asked(staged));
    const pid = adminOf(staged);

    const second = await start(["--root", staged.root], asked(staged));

    expect(second).toMatchObject({ code: 0, stderr: "" });
    expect(second.stdout.endsWith(answersLine(staged, pid, true) + stopLine(staged, pid))).toBe(
      true
    );
    expect(adminOf(staged)).toBe(pid);
    expect(alive(pid)).toBe(true);
    expect(loggedCalls(`${staged.pnpmLog}.admin`)).toHaveLength(1);
  });

  it("holds a second run to the pages too: a recorded portal that answers /api/health but not /en/login is named, and nothing is started or stopped", async () => {
    const staged = await stage();
    mkdirSync(path.join(staged.root, ".tmp"));
    const script = staged.env.FAKE_ADMIN_SCRIPT;
    if (script === undefined) throw new Error("stage() sets FAKE_ADMIN_SCRIPT");
    const earlier = spawn(process.execPath, [script], {
      cwd: staged.root,
      env: { FAKE_ADMIN_MODE: "page500", FAKE_ADMIN_PORT: String(staged.adminPort) },
      detached: true,
      stdio: "ignore",
    });
    const pid = Number(earlier.pid);
    strays.push(pid);
    writeFileSync(adminPidFile(staged), `${pid}\n`);
    await until(async () => (await statusOf(staged.adminPort, "/api/health")) === 200, {
      description: "the earlier portal to answer /api/health",
    });

    const result = await start(["--root", staged.root], asked(staged));

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `platform-start: ${at(staged)} is already in use, and /api/health answers 200 there but /en/login does not (it answered 500)\n` +
        `platform-start: the process recorded in ${adminPidFile(staged)} (${pid}) still exists and may be the pnpm of an administration portal an earlier run started, which is still starting or failed to start: nothing was started and nothing was stopped (\`ps -s ${pid}\` lists its session, ${adminLog(staged)} its output)\n`
    );
    expect(alive(pid)).toBe(true);
    expect(loggedCalls(`${staged.pnpmLog}.admin`)).toEqual([]);
    expect(await apiAndWorkersAnswer(staged)).toBe(true);
  });

  it("waits on a recorded process before the portal binds its port, names every path it awaits, and says only what it knows when the wait runs out", async () => {
    const staged = await stage();
    mkdirSync(path.join(staged.root, ".tmp"));
    const sleeper = spawn("/bin/sleep", ["30"], { detached: true, stdio: "ignore" });
    const pid = Number(sleeper.pid);
    strays.push(pid);
    writeFileSync(adminPidFile(staged), `${pid}\n`);

    const result = await start(["--root", staged.root, "--wait-seconds", "2"], asked(staged));

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      `platform-start: the process recorded in ${adminPidFile(staged)} (${pid}) still exists and nothing accepts connections on ${at(staged)} yet: no second administration portal is started, and /api/health, /en/login and /api/backend/health are awaited for up to 2 s\n`
    );
    expect(result.stderr).toBe(
      `platform-start: /api/health on ${at(staged)} did not answer 200 within 2 s\n` +
        `platform-start: the process recorded in ${adminPidFile(staged)} (${pid}) still exists and may be the pnpm of an administration portal an earlier run started, which is still starting or failed to start: nothing was started and nothing was stopped (\`ps -s ${pid}\` lists its session, ${adminLog(staged)} its output)\n`
    );
    expect(alive(pid)).toBe(true);
    expect(loggedCalls(`${staged.pnpmLog}.admin`)).toEqual([]);
  });

  it("refuses a port that something else holds, names it, starts no portal and leaves the API and the workers running", async () => {
    const staged = await stage();
    await occupy(staged.adminPort);

    const result = await start(["--root", staged.root], asked(staged));

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `platform-start: ${at(staged)} is already in use, and this command holds no record of a running administration portal it started: the port may be held by anything; no administration portal was started\n`
    );
    expect(loggedCalls(`${staged.pnpmLog}.admin`)).toEqual([]);
    expect(recordedIn(staged.root, "admin.pid")).toBeNull();
    expect(await apiAndWorkersAnswer(staged)).toBe(true);
  });

  it("starts no portal when the workers' start fails: the run ends at the workers", async () => {
    const staged = await stage();

    const result = await start(
      ["--root", staged.root, "--wait-seconds", "2"],
      asked(staged, { FAKE_WORKERS_MODE: "503" })
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      new RegExp(
        `^platform-start: /health/ready on 127\\.0\\.0\\.1:${staged.workersPort} did not answer 200 within 2 s\\n`
      )
    );
    expect(result.stderr).not.toContain("administration portal");
    expect(loggedCalls(`${staged.pnpmLog}.admin`)).toEqual([]);
    expect(recordedIn(staged.root, "admin.pid")).toBeNull();
  });

  it("refuses, before anything is written or started, a port the portal's package fixes that the API or the workers would take, each pair on its own line", async () => {
    const staged = await stage();
    const port = String(staged.adminPort);
    const fixedBy = "the dev script of apps/admin/package.json";

    const result = await start(["--root", staged.root], {
      ...staged.env,
      PORT: port,
      METRICS_PORT: port,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `platform-start: the API and the workers would both take port ${port} (PORT and METRICS_PORT): give each its own\n` +
        `platform-start: the API and the administration portal would both take port ${port} (PORT and ${fixedBy}): give each its own\n` +
        `platform-start: the workers and the administration portal would both take port ${port} (METRICS_PORT and ${fixedBy}): give each its own\n`
    );
    const workersOnly = await start(["--root", staged.root], asked(staged, { METRICS_PORT: port }));
    expect(workersOnly.stderr).toBe(
      `platform-start: the workers and the administration portal would both take port ${port} (METRICS_PORT and ${fixedBy}): give each its own\n`
    );
    expect(existsSync(staged.file)).toBe(false);
    expect(dockerCalls(staged)).toEqual([]);
  });

  it("refuses a portal package that fixes no port, or one that is not a port, with the other problems and before anything is written or started", async () => {
    const staged = await stage();

    writeAdminManifest(staged.root, "next dev");
    const none = await start(["--root", staged.root], { ...asked(staged), PORT: "x" });
    expect(none.code).toBe(1);
    expect(none.stderr).toBe(
      `platform-start: PORT=x is not a port\nplatform-start: ${manifest(staged)} fixes no port on its dev script (-p <port>)\n`
    );

    writeAdminManifest(staged.root, "next dev -p 70000");
    const notAPort = await start(["--root", staged.root], asked(staged));
    expect(notAPort.code).toBe(1);
    expect(notAPort.stderr).toBe(
      `platform-start: ${manifest(staged)} starts its app on 70000, which is not a port\n`
    );
    expect(existsSync(staged.file)).toBe(false);
    expect(dockerCalls(staged)).toEqual([]);
  });

  it("fails at the portal's stage, naming the file, in a checkout with no apps/admin/package.json, after the API and the workers answered", async () => {
    const staged = await stage();
    rmSync(path.join(staged.root, "apps"), { recursive: true });

    const result = await start(["--root", staged.root], asked(staged));

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `platform-start: ${manifest(staged)} does not exist: no administration portal was started\n`
    );
    expect(loggedCalls(`${staged.pnpmLog}.admin`)).toEqual([]);
    expect(await apiAndWorkersAnswer(staged)).toBe(true);
  });

  it("says in the usage that the portal starts after the workers, on the port its package fixes, with API_URL and without NODE_ENV, held to three paths", async () => {
    const { root } = makeRoot();

    const result = await start(["--root", root, "--help"]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toContain(
      "The administration portal is started last, once the workers answer, the same way, with\n`pnpm --filter @apps/admin dev`, and left running, on the port its dev script fixes in\napps/admin/package.json (next dev -p 3100)."
    );
    expect(result.stdout).toContain(
      "It must answer /api/health with 200, then /en/login\nwith exactly 200 and /api/backend/health, which it forwards to the API, with 200; --wait-seconds\nbounds that too."
    );
    expect(result.stdout).toContain(
      "It receives API_URL=http://127.0.0.1:<the API's port>, unless the calling shell\nsets an API_URL that is not empty (an empty one counts as unset), and no NODE_ENV."
    );
    expect(result.stdout).toContain(
      "A run whose start of the portal fails ends its session alone; the API and\nthe workers stay up."
    );
    expect(result.stdout).toContain(
      "The API, the workers and the portal each take a port of their own, and the\nrun refuses two of them on one port.\n"
    );
  });
});

describe("the suite's teardown", () => {
  it("sends no signal for a record that names no process of its own: 1, 0, an empty text, -1 or text", () => {
    const { root } = makeRoot();
    const record = path.join(root, ".tmp", "api.pid");
    mkdirSync(path.dirname(record));
    const sent: Record<string, unknown[][]> = {};
    // A spy that sends nothing, so even a teardown that would signal -1 or 0 reaches no process.
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      for (const text of ["1", "0", "", "-1", "abc"]) {
        writeFileSync(record, `${text}\n`);
        endRecordedApi(root);
        sent[text] = [...kill.mock.calls];
        kill.mockClear();
      }
    } finally {
      kill.mockRestore();
      rmSync(record, { force: true });
    }

    expect(sent).toEqual({ "1": [], "0": [], "": [], "-1": [], abc: [] });
  });

  it("sends no signal for a workers record that names no process of its own: 1, 0, an empty text, -1 or text", () => {
    const { root } = makeRoot();
    const record = path.join(root, ".tmp", "workers.pid");
    mkdirSync(path.dirname(record));
    const sent: Record<string, unknown[][]> = {};
    // A spy that sends nothing, so even a teardown that would signal -1 or 0 reaches no process.
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      for (const text of ["1", "0", "", "-1", "abc"]) {
        writeFileSync(record, `${text}\n`);
        endRecordedWorkers(root);
        sent[text] = [...kill.mock.calls];
        kill.mockClear();
      }
    } finally {
      kill.mockRestore();
      rmSync(record, { force: true });
    }

    expect(sent).toEqual({ "1": [], "0": [], "": [], "-1": [], abc: [] });
  });

  it("sends no signal for a portal record that names no process of its own, and ends the session of one that does", async () => {
    const { root } = makeRoot();
    const record = path.join(root, ".tmp", "admin.pid");
    mkdirSync(path.dirname(record));
    const sent: Record<string, unknown[][]> = {};
    // A spy that sends nothing, so even a teardown that would signal -1 or 0 reaches no process.
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      for (const text of ["1", "0", "", "-1", "abc"]) {
        writeFileSync(record, `${text}\n`);
        endRecorded(root, "admin.pid");
        sent[text] = [...kill.mock.calls];
        kill.mockClear();
      }
    } finally {
      kill.mockRestore();
    }
    const leader = spawn("/bin/sleep", ["30"], { detached: true, stdio: "ignore" });
    const pid = Number(leader.pid);
    strays.push(pid);
    writeFileSync(record, `${pid}\n`);

    endRecorded(root, "admin.pid");

    expect(sent).toEqual({ "1": [], "0": [], "": [], "-1": [], abc: [] });
    await until(() => !alive(pid), { description: "the recorded portal session to end" });
  });
});

describe("the stop of a failed start, driven in this process", () => {
  /** Timings short enough for a case: SIGTERM, and then SIGKILL, each wait a tenth of a second. */
  const FAST = { graceMs: 100, killWaitMs: 100 };

  /** What the stop returns for a session it neither lists nor signals. */
  const UNTOUCHED = { found: [], termed: [], killed: [], left: [] };

  /** A process of a session of its own, the leader: `sleep`, ended by the teardown. */
  async function sleeper(): Promise<number> {
    const child = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
    child.unref();
    await new Promise((resolve) => child.once("spawn", resolve));
    const pid = Number(child.pid);
    strays.push(pid);
    return pid;
  }

  /** A record of the stop's, in a checkout of its own, naming a process. */
  function recordOf(pid: number): string {
    const { root } = makeRoot();
    const record = path.join(root, ".tmp", "api.pid");
    mkdirSync(path.dirname(record));
    writeFileSync(record, `${pid}\n`);
    return record;
  }

  /**
   * Has every read the command's stop makes of `/proc/<pid>/stat` fail with the code given, until
   * the returned function restores the real read.
   */
  function failStatReads(pid: number, code: string): () => void {
    const real = command.proc.read;
    const read = vi.spyOn(command.proc, "read").mockImplementation((file: string) => {
      if (file === `/proc/${pid}/stat`) {
        throw Object.assign(new Error(`${code}: reading /proc/${pid}/stat`), { code });
      }
      return real(file);
    });
    return () => read.mockRestore();
  }

  /**
   * Has every read and every listing the command's stop makes of `/proc` fail with ENOENT, as on a
   * host that has no `/proc`, until the returned function restores the real ones.
   */
  function hideProc(): () => void {
    const gone = (file: string) =>
      Object.assign(new Error(`ENOENT: no such file or directory, open '${file}'`), {
        code: "ENOENT",
      });
    const read = vi.spyOn(command.proc, "read").mockImplementation((file: string) => {
      throw gone(file);
    });
    const list = vi.spyOn(command.proc, "list").mockImplementation(() => {
      throw gone("/proc");
    });
    return () => {
      read.mockRestore();
      list.mockRestore();
    };
  }

  /** A leader of a session of its own running `/bin/bash -c <script>`, ended by the teardown. */
  async function bashLeader(script: string): Promise<number> {
    const leader = spawn("/bin/bash", ["-c", script], { detached: true, stdio: "ignore" });
    await new Promise((resolve) => leader.once("spawn", resolve));
    const pid = Number(leader.pid);
    strays.push(pid);
    return pid;
  }

  /** The command line of a process, its arguments joined by spaces, or `null` once it is gone. */
  function commandLine(pid: number): string | null {
    try {
      return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean).join(" ");
    } catch {
      return null;
    }
  }

  /** The processes of a session that have ended and wait to be reaped. */
  function zombies(session: number): number[] {
    const found: number[] = [];
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      let stat: string;
      try {
        stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      } catch {
        continue;
      }
      const [state, , , sid] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (Number(sid) === session && state === "Z") found.push(Number(entry));
    }
    return found;
  }

  it("sends no signal, and lists no session, for a target that names no separate process: 0, 1, -1, a fraction, its own process, group or session", async () => {
    const separate = await sleeper();
    // The command reads its own group and session from /proc/self/stat. They are stubbed, so the
    // case does not depend on how its runner was started: a runner that leads its own session
    // gives a session equal to its pid or its group, and only the own-session clause of the guard
    // would then go untested. These two ids are apart from this process and from the sleeper.
    const own = {
      group: Math.max(process.pid, separate) + 1,
      session: Math.max(process.pid, separate) + 2,
    };
    const real = command.proc.read;
    const read = vi
      .spyOn(command.proc, "read")
      .mockImplementation((file: string) =>
        file === "/proc/self/stat"
          ? `${process.pid} (node) S 1 ${own.group} ${own.session} 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0`
          : real(file)
      );
    const refused = [
      0,
      1,
      -1,
      2.5,
      process.pid,
      -process.pid,
      own.group,
      -own.group,
      own.session,
      -own.session,
    ];
    // A spy that sends nothing, so even a guard that let -1 or the suite's own session through
    // would reach no process.
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    let observed;
    try {
      const sent = refused.map((target) => command.signal(target, "SIGKILL"));
      const swept: Swept[] = [];
      for (const session of [0, 1, process.pid, own.group, own.session]) {
        swept.push(await command.endSession(session, FAST));
      }
      const refusedCalls = [...kill.mock.calls];
      const control = command.signal(separate, "SIGTERM");
      observed = {
        sent,
        swept,
        refusedCalls,
        control,
        calls: [...kill.mock.calls],
        readOwnIds: read.mock.calls.some(([file]) => file === "/proc/self/stat"),
      };
    } finally {
      kill.mockRestore();
      read.mockRestore();
    }

    expect(observed).toEqual({
      sent: refused.map(() => false),
      swept: [UNTOUCHED, UNTOUCHED, UNTOUCHED, UNTOUCHED, UNTOUCHED],
      refusedCalls: [],
      control: true,
      calls: [[separate, "SIGTERM"]],
      readOwnIds: true,
    });
  });

  it("counts a process whose /proc entry reads ESRCH while the session is swept as one that ended: the stop says its own line, removes the record and names no survivor", async () => {
    // A leader that passes SIGTERM on to its child, in another group of its session, and ends with it.
    const script =
      'set -m; /bin/sleep 60 & child=$!; trap \'kill -s TERM "$child"\' TERM; while kill -0 "$child" 2>/dev/null; do wait "$child"; done';
    const leader = spawn("/bin/bash", ["-c", script], { detached: true, stdio: "ignore" });
    await new Promise((resolve) => leader.once("spawn", resolve));
    const pid = Number(leader.pid);
    strays.push(pid);
    const hidden = await untilValue(
      () => sessionMembers(pid).find((member) => member !== pid && alive(member)) ?? null,
      { description: "the session's second process to start" }
    );
    const record = recordOf(pid);

    const restore = failStatReads(hidden, "ESRCH");
    let line;
    try {
      line = await command.sweepSession(pid, record, FAST);
    } finally {
      restore();
    }

    expect(line).toBe(
      `the session of process ${pid} was swept: SIGTERM was sent to ${pid} (/bin/bash -c ${script}); then no process was found in it, and ${record} was removed`
    );
    expect(existsSync(record)).toBe(false);
    expect(sessionMembers(pid)).toEqual([]);
  });

  it("names, with its command, each process still running after SIGKILL, and keeps the record", async () => {
    const pid = await sleeper();
    const record = recordOf(pid);
    // A spy that sends nothing, so the process outlives both signals.
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    let observed;
    try {
      const line = await command.sweepSession(pid, record, FAST);
      observed = { line, calls: [...kill.mock.calls] };
    } finally {
      kill.mockRestore();
    }

    expect(observed).toEqual({
      line: `the session of process ${pid} was swept: SIGTERM was sent to ${pid} (/bin/sleep 60), and SIGKILL to ${pid} (/bin/sleep 60), still running 0.1 s later; still running: ${pid} (/bin/sleep 60), so ${record} is kept: \`ps -s ${pid}\` lists what is left, to end by hand`,
      calls: [
        [pid, "SIGTERM"],
        [pid, "SIGKILL"],
      ],
    });
    expect(existsSync(record)).toBe(true);
    expect(alive(pid)).toBe(true);
  });

  it("says the session could not be swept to the end, and keeps the record, when a read of /proc fails otherwise", async () => {
    const pid = await sleeper();
    const record = recordOf(pid);

    const restore = failStatReads(pid, "EACCES");
    let line;
    try {
      line = await command.sweepSession(pid, record, FAST);
    } finally {
      restore();
    }

    expect(line).toBe(
      `the session of process ${pid} could not be swept to the end (EACCES): ${record} is kept, and \`ps -s ${pid}\` lists any process still running`
    );
    expect(existsSync(record)).toBe(true);
    expect(alive(pid)).toBe(true);
  });

  it("does not call the session empty, and keeps the record, on a host where /proc cannot be read", async () => {
    const pid = await sleeper();
    const record = recordOf(pid);
    // A spy that sends nothing, so a stop that took the session for empty could reach no process.
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const restore = hideProc();
    let observed;
    try {
      const line = await command.sweepSession(pid, record, FAST);
      observed = { line, calls: [...kill.mock.calls] };
    } finally {
      restore();
      kill.mockRestore();
    }

    expect(observed).toEqual({
      line: `the session of process ${pid} could not be swept to the end (ENOENT): ${record} is kept, and \`ps -s ${pid}\` lists any process still running`,
      calls: [],
    });
    expect(existsSync(record)).toBe(true);
    expect(alive(pid)).toBe(true);
  });

  it("does not call a session whose id the guard refuses empty, and keeps the record", async () => {
    const record = recordOf(1);
    // A spy that sends nothing: the guard is the subject, and init is not a process to signal.
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    let observed;
    try {
      const line = await command.sweepSession(1, record, FAST);
      observed = { line, calls: [...kill.mock.calls] };
    } finally {
      kill.mockRestore();
    }

    expect(observed).toEqual({
      line: `the session of process 1 could not be swept to the end (the guard refuses its id): ${record} is kept, and \`ps -s 1\` lists any process still running`,
      calls: [],
    });
    expect(existsSync(record)).toBe(true);
  });

  it("names among those it sent SIGTERM and SIGKILL only the processes the signal reached: one it finds gone (ESRCH) is not named", async () => {
    const script = "/bin/sleep 60 & wait";
    const pid = await bashLeader(script);
    const child = await untilValue(
      () =>
        sessionMembers(pid).find(
          (member) => member !== pid && commandLine(member) === "/bin/sleep 60"
        ) ?? null,
      { description: "the session's sleep to start" }
    );
    const record = recordOf(pid);
    // A spy that sends nothing, and answers ESRCH for the SIGTERM to the sleep and the SIGKILL to
    // the leader, as a process that ended between the listing and the signal does.
    const kill = vi
      .spyOn(process, "kill")
      .mockImplementation((target: number, name?: string | number) => {
        if ((target === child && name === "SIGTERM") || (target === pid && name === "SIGKILL")) {
          throw Object.assign(new Error(`kill ESRCH`), { code: "ESRCH" });
        }
        return true;
      });
    let line;
    try {
      line = await command.sweepSession(pid, record, FAST);
    } finally {
      kill.mockRestore();
    }

    const leaderName = `${pid} (/bin/bash -c ${script})`;
    const childName = `${child} (/bin/sleep 60)`;
    const both = pid < child ? `${leaderName}, ${childName}` : `${childName}, ${leaderName}`;
    expect(line).toBe(
      `the session of process ${pid} was swept: SIGTERM was sent to ${leaderName}, and SIGKILL to ${childName}, still running 0.1 s later; still running: ${both}, so ${record} is kept: \`ps -s ${pid}\` lists what is left, to end by hand`
    );
  });

  it("does not count a process of the session that has ended and waits to be reaped", async () => {
    // The leader becomes a sleep that never reaps its child, so the child stays a zombie.
    const script = "/bin/sleep 0.3 & exec /bin/sleep 60";
    const pid = await bashLeader(script);
    const zombie = await untilValue(() => zombies(pid)[0] ?? null, {
      description: "the leader's child to end unreaped",
    });
    const record = recordOf(pid);
    // A spy that sends nothing, so the leader, and its zombie, outlive both signals.
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    let observed;
    try {
      const line = await command.sweepSession(pid, record, FAST);
      observed = { line, calls: [...kill.mock.calls], zombie: zombies(pid) };
    } finally {
      kill.mockRestore();
    }

    expect(observed).toEqual({
      line: `the session of process ${pid} was swept: SIGTERM was sent to ${pid} (/bin/sleep 60), and SIGKILL to ${pid} (/bin/sleep 60), still running 0.1 s later; still running: ${pid} (/bin/sleep 60), so ${record} is kept: \`ps -s ${pid}\` lists what is left, to end by hand`,
      calls: [
        [pid, "SIGTERM"],
        [pid, "SIGKILL"],
      ],
      zombie: [zombie],
    });
  });

  it("sends SIGKILL no sooner than the grace it states after SIGTERM", async () => {
    const pid = await sleeper();
    const record = recordOf(pid);
    const timing = { graceMs: 1000, killWaitMs: 100 };
    const sent: Array<{ name: string | number | undefined; at: number }> = [];
    // A spy that sends nothing and notes when each signal would have gone, so the process outlives
    // SIGTERM and the stop has to wait out its grace.
    const kill = vi
      .spyOn(process, "kill")
      .mockImplementation((_target: number, name?: string | number) => {
        sent.push({ name, at: Date.now() });
        return true;
      });
    let line;
    try {
      line = await command.sweepSession(pid, record, timing);
    } finally {
      kill.mockRestore();
    }

    expect(sent.map(({ name }) => name)).toEqual(["SIGTERM", "SIGKILL"]);
    expect(Number(sent[1]?.at) - Number(sent[0]?.at)).toBeGreaterThanOrEqual(timing.graceMs);
    expect(line).toContain(`SIGKILL to ${pid} (/bin/sleep 60), still running 1 s later`);
  });
});
