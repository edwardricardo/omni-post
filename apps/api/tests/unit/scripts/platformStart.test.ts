/**
 * @file platformStart.test.ts
 * @description Pins `scripts/start/platform-start.mjs`, the start sequence of a clean checkout, and
 *   its pure core `scripts/start/lib/start-environment.mjs`: the environment a checkout with no
 *   environment file receives, and what the command does with a file that is already there.
 *
 *   The generated environment is held to the API's own schema through `parseApiEnv` and to the
 *   variables `docker-compose.yml` refuses to start without, so a variable either of them starts to
 *   require goes red here until the generator learns it. The command is driven as a process against a
 *   root of its own (`--root`), never the repository's, because it reads and writes the root
 *   environment file.
 * @layer infrastructure
 */
import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

/** The variables `docker-compose.yml` interpolates with `${NAME:?}`: Compose starts nothing without them. */
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

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A checkout of its own for one case, with the path its environment file has. */
function makeRoot(): { root: string; file: string } {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "platform-start-")));
  roots.push(root);
  return { root, file: path.join(root, ".env") };
}

/** Writes a generated environment file, without the variables named in `drop`. */
function writeEnvironment(file: string, drop: readonly string[] = []): string {
  const entries = core
    .generateEnvironment({ randomBytes, postgresHostPort: 55432, redisHostPort: 56379 })
    .filter(([key]) => !drop.includes(key));
  const text = core.renderEnvironmentFile(entries);
  writeFileSync(file, text);
  return text;
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
    const { root, file } = makeRoot();

    const result = await start(["--root", root], {
      POSTGRES_HOST_PORT: "55432",
      REDIS_HOST_PORT: "56379",
    });

    const values = core.readEnvironment(readFileSync(file, "utf8"));
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(core.missingKeys(values)).toEqual([]);
    expect(new URL(values.DATABASE_URL ?? "").port).toBe("55432");
    expect(result.stdout).toContain(`wrote ${file} with 21 variables`);
    expect(result.stdout).toContain("Postgres on 127.0.0.1:55432 and Redis on 127.0.0.1:56379");
    expect(SECRETS.filter((key) => result.stdout.includes(values[key] ?? "unset"))).toEqual([]);
  });

  it("leaves a complete environment file untouched and reports the ports it names", async () => {
    const { root, file } = makeRoot();
    const before = writeEnvironment(file);

    const result = await start(["--root", root]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(result.stdout).toContain(`${file} holds every required variable`);
    expect(result.stdout).toContain("Postgres on 127.0.0.1:55432 and Redis on 127.0.0.1:56379");
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
      { code: 1, stdout: "", stderr: `platform-start: ${missing} is not a directory\n` },
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
