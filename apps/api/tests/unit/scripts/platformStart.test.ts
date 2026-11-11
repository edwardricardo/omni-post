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
import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
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

/**
 * The stand-in for the Docker CLI. It logs one line per call (its arguments and its working
 * directory), saves the environment it was given on `up` and on `exec`, and gives the exit code,
 * the `psql` answer or the slow query a case asks for.
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
    if [ -n "$FAKE_QUERY_SECONDS" ]; then exec /bin/sleep "$FAKE_QUERY_SECONDS"; fi
    if [ -n "$FAKE_PSQL_STDERR" ]; then printf '%s\\n' "$FAKE_PSQL_STDERR" >&2; exit 2; fi ;;
esac
exit 0
`;

/**
 * The stand-in for pnpm: it logs its call and its working directory, saves the environment it was
 * given, and ends with the exit code or by the signal a case asks for.
 */
const PNPM_DOUBLE = `#!/bin/sh
printf '%s|%s\\n' "$*" "$PWD" >> "$FAKE_PNPM_LOG"
/usr/bin/env > "$FAKE_PNPM_LOG.env"
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
      `${COMPOSE} exec -T -e PGUSER -e PGPASSWORD -e PGDATABASE postgres sh -c PGCONNECT_TIMEOUT=3 psql -h "$(hostname -i)" -tAc "SELECT 1"|${staged.root}`,
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
      `--filter @infra/prisma run migrate|${staged.root}`,
    ]);
    expect(result.stdout).toMatch(
      /accept connections\nplatform-start: the database is migrated\n$/
    );
  });

  it("hands the migration no variable the file owns and no migration URL of the calling shell", async () => {
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

    const given = savedEnvironment(`${staged.pnpmLog}.env`);
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(refused.filter((key) => key in given)).toEqual([]);
    expect(given.KEPT_BY_THE_SHELL).toBe("yes");
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
