/**
 * @file seedProductionRefusal.test.ts
 * @description Runs the development seed as a process, the way `pnpm db:seed` runs it
 *   (`tsx --conditions development seed.ts` in `infra/prisma`, as an ES module), and pins every
 *   effect it has under a production environment, wherever `NODE_ENV=production` comes from: it ends
 *   with exit code 1, writes the guard's reason to stderr and nothing to stdout, and never opens a
 *   connection to the database it was given.
 *
 *   The first case sets `NODE_ENV=production` in the process environment and runs the seed where it
 *   lives. The second sets it only in the env file, the accident of a production host that keeps it
 *   there and runs the seed with no `NODE_ENV` in the process. The seed loads `.env` from two levels
 *   above itself, so that case runs a copy of the seed in a fixture of its own under the system
 *   temporary directory: the real `package.json`, `node_modules`, `generated` and `src` of
 *   `infra/prisma` are linked beside the copy, so it runs as the same ES module, and an env file at
 *   the fixture's root holds only `NODE_ENV=production`. The fixture is removed when the case ends,
 *   whatever its result, and the repository's own env files are never written.
 *
 *   The seed loads its env file before its guard runs. In the first case an env file at the
 *   repository root, when the machine has one, is therefore loaded, but it cannot override a
 *   variable the process already sets, and the production rule, which reads only `NODE_ENV`, ends
 *   the run before anything else is read, so the outcome is the same with no file and with a
 *   well-formed one. A file Node cannot parse ends the seed with the loader's own error before the
 *   guard runs.
 *
 *   The seed also takes no default administrator password. Under a development environment with no
 *   `ADMIN_PASSWORD` it ends with exit code 1, writes the password rule's reason to stderr and
 *   nothing to stdout, and opens no connection. That case runs in a fixture whose env file sets no
 *   password, so an env file at the repository root cannot change its result. A last case sets
 *   `ADMIN_PASSWORD` only in the fixture's env file: the seed is not refused, goes on and opens a
 *   connection, which shows it reads the variable after its env file is loaded. The two cases under
 *   production set no password and still end with the production reason: the production rule runs
 *   first.
 *
 *   The database is a loopback socket this suite opens: it counts the connections it receives and
 *   closes each one at once, so no server ever answers and a seed that did try to connect fails fast
 *   instead of waiting. Each run has a time limit below its case's own: past it the runner ends the
 *   seed with SIGTERM, which tsx passes on to the script it runs (SIGKILL would end tsx alone and
 *   leave the script running), and the case fails showing that the run was killed. Otherwise each
 *   case ends on the process's exit, never on a fixed time.
 * @layer infrastructure
 */

import { execFile } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, describe, it } from "vitest";

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const PRISMA_DIR = path.join(REPO_ROOT, "infra", "prisma");
const TSX_CLI = createRequire(path.join(PRISMA_DIR, "package.json")).resolve("tsx/cli");

/**
 * The entries of `infra/prisma` linked into a fixture as they are: the manifest, whose
 * `"type": "module"` makes the copy an ES module, and the directories the seed imports from.
 */
const LINKED_PRISMA_ENTRIES = ["package.json", "node_modules", "generated", "src"] as const;

/** The reason the seed's guard gives under a production environment. */
const PRODUCTION_REASON =
  "The development seed does not run under a production environment: NODE_ENV is production.";

/** The outcome every production run must have, the sensor's count included. */
const REFUSED_RUN = {
  code: 1,
  killed: false,
  stdout: "",
  stderr: `${PRODUCTION_REASON}\n`,
  connections: 0,
} as const;

/** The reason the seed's password rule gives when `ADMIN_PASSWORD` is absent or blank. */
const ADMIN_PASSWORD_REASON =
  "The development seed creates an administrator and takes no default password: set ADMIN_PASSWORD in the environment or in the env file at the repository root.";

/** The outcome every run with no administrator password must have, the sensor's count included. */
const REFUSED_WITHOUT_ADMIN_PASSWORD_RUN = {
  code: 1,
  killed: false,
  stdout: "",
  stderr: `${ADMIN_PASSWORD_REASON}\n`,
  connections: 0,
} as const;

/** An env file that sets no variable, so it gives the seed no administrator password. */
const ENV_FILE_WITHOUT_ADMIN_PASSWORD = "";

/** How long one run of the seed may take before the runner ends it; below the case's own limit. */
const SEED_RUN_LIMIT_MS = 45_000;

/** How long a case may take: one run's limit and the suite's own work around it. */
const SEED_CASE_TIMEOUT_MS = 60_000;

const execFileAsync = promisify(execFile);

interface SeedRun {
  readonly code: number;
  /** True when the runner ended the seed: its time limit passed or its output overflowed. */
  readonly killed: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

interface DatabaseSensor {
  readonly url: string;
  readonly connections: () => number;
}

const servers: Server[] = [];
const fixtures: string[] = [];

/**
 * A loopback socket standing where the database would be: it records each connection and closes it
 * at once, so it never answers as a database does.
 */
async function openDatabaseSensor(): Promise<DatabaseSensor> {
  let connections = 0;
  const server = createServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port was bound");
  return {
    url: `postgresql://seed-guard:unused@127.0.0.1:${String(address.port)}/seed_guard`,
    connections: () => connections,
  };
}

/** The variables the seed reads before it builds its client, with no `NODE_ENV`. */
function seedEnvironment(databaseUrl: string): Record<string, string> {
  return {
    DATABASE_URL: databaseUrl,
    PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  };
}

/** The same variables under a development `NODE_ENV`, with no `ADMIN_PASSWORD`. */
function developmentSeedEnvironment(databaseUrl: string): Record<string, string> {
  return { ...seedEnvironment(databaseUrl), NODE_ENV: "development" };
}

/** An env file that sets only an obviously fake administrator password. */
function envFileWithFakeAdminPassword(): string {
  return "ADMIN_PASSWORD=fake-seed-admin-password\n";
}

/**
 * A checkout of the seed of its own: a copy of `infra/prisma/seed.ts` at the same depth, the real
 * `package.json`, `node_modules`, `generated` and `src` linked beside it, and an env file at the
 * root that holds `envFileText`, by default only `NODE_ENV=production`. Returns the directory the
 * seed runs from.
 */
function makeEnvFileFixture(envFileText = "NODE_ENV=production\n"): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "seed-env-file-")));
  fixtures.push(root);
  const prismaDir = path.join(root, "infra", "prisma");
  mkdirSync(prismaDir, { recursive: true });
  copyFileSync(path.join(PRISMA_DIR, "seed.ts"), path.join(prismaDir, "seed.ts"));
  for (const entry of LINKED_PRISMA_ENTRIES) {
    symlinkSync(path.join(PRISMA_DIR, entry), path.join(prismaDir, entry));
  }
  writeFileSync(path.join(root, ".env"), envFileText);
  return prismaDir;
}

/**
 * Runs the seed as `pnpm db:seed` does, from `prismaDir`, with exactly the environment given, and
 * resolves on its exit. A run that outlives `SEED_RUN_LIMIT_MS` is ended with SIGTERM, the signal
 * tsx passes on to the script it runs, and comes back with `killed` set.
 */
async function runSeed(
  env: Record<string, string>,
  prismaDir: string = PRISMA_DIR
): Promise<SeedRun> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [TSX_CLI, "--conditions", "development", "seed.ts"],
      { cwd: prismaDir, env, timeout: SEED_RUN_LIMIT_MS, killSignal: "SIGTERM" }
    );
    return { code: 0, killed: false, stdout, stderr };
  } catch (error: unknown) {
    const failure = error as {
      code?: number | string;
      killed?: boolean;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof failure.code === "number" ? failure.code : -1,
      killed: failure.killed === true,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

describe("the development seed under a production environment", () => {
  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
    await Promise.all(
      servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))
    );
  });

  it(
    "refuses to run, with the guard's reason and no connection, when NODE_ENV is production",
    async () => {
      const database = await openDatabaseSensor();

      const run = await runSeed({ ...seedEnvironment(database.url), NODE_ENV: "production" });

      assert.deepStrictEqual({ ...run, connections: database.connections() }, REFUSED_RUN);
    },
    SEED_CASE_TIMEOUT_MS
  );

  it(
    "refuses to run, with the guard's reason and no connection, when only the env file sets NODE_ENV to production",
    async () => {
      const database = await openDatabaseSensor();
      const prismaDir = makeEnvFileFixture();

      const run = await runSeed(seedEnvironment(database.url), prismaDir);

      assert.deepStrictEqual({ ...run, connections: database.connections() }, REFUSED_RUN);
    },
    SEED_CASE_TIMEOUT_MS
  );
});

describe("the development seed without an administrator password", () => {
  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
    await Promise.all(
      servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))
    );
  });

  it(
    "refuses to run, with the password reason and no connection, when ADMIN_PASSWORD is absent under a development environment",
    async () => {
      const database = await openDatabaseSensor();
      const prismaDir = makeEnvFileFixture(ENV_FILE_WITHOUT_ADMIN_PASSWORD);

      const run = await runSeed(developmentSeedEnvironment(database.url), prismaDir);

      assert.deepStrictEqual(
        { ...run, connections: database.connections() },
        REFUSED_WITHOUT_ADMIN_PASSWORD_RUN
      );
    },
    SEED_CASE_TIMEOUT_MS
  );

  it(
    "does not refuse, and opens a connection, when only the env file sets ADMIN_PASSWORD under a development environment",
    async () => {
      const database = await openDatabaseSensor();
      const prismaDir = makeEnvFileFixture(envFileWithFakeAdminPassword());

      const run = await runSeed(developmentSeedEnvironment(database.url), prismaDir);

      // Past both rules the seed goes on to the database: the sensor receives a connection, and the
      // run never ends with the password rule's reason. How the database client then fails against
      // a server that answers nothing, how often it retries and how long it takes are not this
      // case's to pin, so neither the exit code nor the time limit is asserted.
      assert.deepStrictEqual(
        {
          refusedForPassword: run.stderr.includes(ADMIN_PASSWORD_REASON),
          reachedTheDatabase: database.connections() >= 1,
        },
        { refusedForPassword: false, reachedTheDatabase: true }
      );
    },
    SEED_CASE_TIMEOUT_MS
  );
});
