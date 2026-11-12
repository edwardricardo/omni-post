/**
 * @file platformStart.test.ts
 * @description Pins `scripts/start/platform-start.mjs`, the start sequence of a clean checkout, and
 *   its pure core `scripts/start/lib/start-environment.mjs`: the environment a checkout with no
 *   environment file receives, what the command does with a file that is already there, and the
 *   start of Postgres and Redis from the repository's compose file.
 *
 *   The generated environment is held to the API's own schema through `parseApiEnv` and to the
 *   variables `docker-compose.yml` refuses to start without, so a variable either of them starts to
 *   require goes red here until the generator learns it. The command is driven as a process against a
 *   root of its own (`--root`), never the repository's, because it reads and writes the root
 *   environment file. Docker is a stand-in script on `PATH` that records how it was called, and the
 *   two services are sockets this suite opens, so no container starts here: the run against real
 *   containers is the sequence's own proof.
 * @layer infrastructure
 */
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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
import { afterEach, describe, expect, it } from "vitest";
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
 */
const PNPM_DOUBLE = `#!/bin/sh
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
  /** The listeners' ports, as the variables a first run takes them from. */
  readonly ports: { readonly POSTGRES_HOST_PORT: string; readonly REDIS_HOST_PORT: string };
}

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))
  );
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

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
  const log = path.join(root, "docker.log");
  const pnpmLog = path.join(root, "pnpm.log");
  const postgres = services.postgres ?? (await listen("N"));
  const redis = services.redis ?? (await listen("+PONG\r\n"));
  return {
    root,
    file,
    log,
    pnpmLog,
    postgres,
    redis,
    env: { PATH: bin, FAKE_DOCKER_LOG: log, FAKE_PNPM_LOG: pnpmLog },
    ports: { POSTGRES_HOST_PORT: String(postgres.port), REDIS_HOST_PORT: String(redis.port) },
  };
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

    const result = await start(["--root", staged.root], staged.env);

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
    expect(result.stdout).toMatch(
      /accept connections\nplatform-start: the database is migrated\n$/
    );
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
    expect(result.stdout).toMatch(/platform-start: the database is migrated\n$/);
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
      /accept connections\nout: 83 migrations found\nplatform-start: the database is migrated\n$/
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
    expect(core.apiPort("", "5000")).toBe(5000);
    expect(core.apiPort(undefined, undefined)).toBe(3000);
  });

  it("is null when the value that wins is not a port", () => {
    expect(core.apiPort("70000", "5000")).toBeNull();
    expect(core.apiPort(undefined, "abc")).toBeNull();
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
      "  --wait-seconds <n>   how long each service may take to accept a connection, and Prisma's proof\n" +
        "                       of the database to answer (default: 60)\n"
    );
  });
});
