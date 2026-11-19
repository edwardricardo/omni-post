/**
 * @file firstAdministratorCommand.integration.test.ts
 * @description The first-administrator command against a database of its own, created on the
 *              owner channel and migrated from empty with the script CI and the start command
 *              run. The first seven cases call the command's function in this process, with the
 *              composition root built on a client of that database and a standard output that
 *              says it is a terminal; each case starts from the three tables the command writes
 *              (`Role`, `RolePermission`, `AdminUser`) emptied.
 *
 *              The two cases of runs at once do not leave the interleaving to chance: a third
 *              connection holds what both runs need (an uncommitted `Role` row on the empty
 *              database, the `Role` row's lock where the role exists), waits until both runs are
 *              blocked on it, observed in `pg_stat_activity` and not guessed with a sleep, and
 *              only then lets them go.
 *
 *              The last case runs the command as a process, its standard output a pseudo-terminal
 *              that util-linux `script` opens, and requires that the terminal shows the block and
 *              nothing else (no line any imported module writes) and that the process ends by
 *              itself.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { until } from "@packages/vitest-shared/determinism";
import { createTestPrismaClient, type Prisma, type PrismaClient } from "@infra/prisma";
import { SUPER_ADMIN_ROLE } from "@infra/prisma/adminSystemRoles.js";
import { assertSeedChannelConfigured, resolveSeedDatabaseUrl } from "./helpers/seedPrismaClient.js";
import { runFirstAdministratorCommand } from "../../src/cli/firstAdministratorCommand.js";
import { composeCreateFirstAdministrator } from "../../src/infrastructure/container/firstAdministratorComposition.js";
import { Argon2PasswordHasher } from "../../src/infrastructure/adapters/Argon2PasswordHasher.js";

assertSeedChannelConfigured();

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const API_DIR = fileURLToPath(new URL("../../", import.meta.url));

/** Long enough for every migration on a loaded runner; a hung migration still ends the suite. */
const MIGRATION_TIMEOUT_MS = 120_000;

/**
 * Budget for every test and hook in this file, passed to each call: the runner's `--test-timeout`
 * binds every test and every hook. The migration in `before` blocks for up to its own limit.
 */
const TIMING = { timeout: 180_000 } as const;

/** How long the process of the last case may run before the runner ends it. */
const PROCESS_LIMIT_MS = 60_000;

const execFileAsync = promisify(execFile);

/** The use case's refusals, as the operator reads them on standard error. */
const REFUSALS = {
  administratorExists:
    "Refused: An administrator already exists: the first administrator is created only on a database that has none\n",
  roleIdHeld:
    "Refused: Another run of this command wrote the administration role first: check whether an administrator exists\n",
  roleNameHeld:
    "Refused: A role with the administration role's name exists under another id, so every run of this command is refused until that role is renamed or removed\n",
} as const;

/** The `Role` row the command writes, with the column it leaves to its default. */
const SUPER_ADMIN_ROW = {
  id: SUPER_ADMIN_ROLE.id,
  name: SUPER_ADMIN_ROLE.name,
  description: SUPER_ADMIN_ROLE.description,
  level: SUPER_ADMIN_ROLE.level,
  isSystem: SUPER_ADMIN_ROLE.isSystem,
  isActive: true,
  permissions: [...SUPER_ADMIN_ROLE.permissions].sort(),
} as const;

interface CommandRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The connection string of another database on the same server, with the same credentials. */
function urlOfDatabase(ownerUrl: string, database: string): string {
  const url = new URL(ownerUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/** The block the command writes on success. */
function successBlock(email: string, password: string): string {
  return [
    "The first administrator was created.",
    "",
    `  E-mail:              ${email}`,
    `  Single-use password: ${password}`,
    "",
    "The password is shown this once and is stored nowhere: only its hash is kept.",
    "Sign in with it now and change it at once.",
    "",
  ].join("\n");
}

/** The single-use password the success block shows, or a failed assertion. */
function printedPassword(stdout: string): string {
  const match = /^ {2}Single-use password: (\S+)$/m.exec(stdout);
  assert.ok(match?.[1], `the output shows a single-use password:\n${stdout}`);
  return match[1];
}

/** Counts the occurrences of `needle` in `text`. */
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Every `Role` row with its permissions sorted, and every `AdminUser` row, ordered. */
async function readState(client: PrismaClient) {
  const roles = await client.role.findMany({
    orderBy: { id: "asc" },
    include: { permissions: { select: { permission: true } } },
  });
  const administrators = await client.adminUser.findMany({ orderBy: { email: "asc" } });
  return {
    roles: roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      level: role.level,
      isSystem: role.isSystem,
      isActive: role.isActive,
      permissions: role.permissions.map((row) => row.permission).sort(),
    })),
    administrators,
    permissionRows: await client.rolePermission.count(),
  };
}

describe("The first-administrator command on a migrated database", { concurrency: 1 }, () => {
  const database = `omnipost_first_admin_${randomBytes(6).toString("hex")}`;
  const hasher = new Argon2PasswordHasher();
  let owner: PrismaClient | undefined;
  let scratch: PrismaClient | undefined;
  let scratchUrl = "";
  let migration: SpawnSyncReturns<string> | undefined;

  /**
   * The migrated database with the command's three tables emptied, or a failed assertion that
   * carries the migration's own output. The verdict is asserted here and not in `before`,
   * because node:test reports a failing hook by cancelling every case instead of failing one
   * with the reason.
   */
  async function emptyDatabase(): Promise<PrismaClient> {
    assert.ok(migration, `the migration of ${database} ran`);
    const outcome = [
      `status ${String(migration.status)}`,
      ...(migration.signal ? [`signal ${migration.signal}`] : []),
      ...(migration.error ? [migration.error.message] : []),
    ].join(", ");
    const output = [migration.stdout, migration.stderr].filter(Boolean).join("\n");
    assert.equal(
      migration.status,
      0,
      `the migration of ${database} ended with ${outcome}:\n${output}`
    );
    assert.ok(scratch, `a client of ${database} was built`);
    await scratch.adminUser.deleteMany({});
    await scratch.role.deleteMany({});
    return scratch;
  }

  /** Runs the command in this process with `--email <email>`, composed on `client`. */
  async function runCommand(client: PrismaClient, email: string): Promise<CommandRun> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runFirstAdministratorCommand(
      ["--email", email],
      {
        stdout: { isTTY: true, write: (text: string) => stdout.push(text) },
        stderr: { write: (text: string) => stderr.push(text) },
      },
      async () => ({
        createFirstAdministrator: composeCreateFirstAdministrator(client),
        close: async () => undefined,
      })
    );
    return { code, stdout: stdout.join(""), stderr: stderr.join("") };
  }

  /** Runs the command with a client of its own, released when the run ends. */
  async function runWithOwnClient(email: string): Promise<CommandRun> {
    const client = createTestPrismaClient(scratchUrl);
    try {
      return await runCommand(client, email);
    } finally {
      await client.$disconnect();
    }
  }

  /**
   * Runs a shell command under `script`, which gives it a pseudo-terminal as its standard
   * streams, with the database URL of the test's database, and resolves on its exit. A run that
   * outlives `PROCESS_LIMIT_MS` is ended with SIGTERM and comes back with `killed` set.
   */
  async function runInPseudoTerminal(command: string) {
    try {
      const { stdout, stderr } = await execFileAsync(
        "script",
        ["--quiet", "--return", "--flush", "--command", command, "/dev/null"],
        {
          cwd: API_DIR,
          env: { ...process.env, DATABASE_URL: scratchUrl },
          timeout: PROCESS_LIMIT_MS,
          killSignal: "SIGTERM",
        }
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

  /** Resolves once at least `count` backends of the test's database wait on a lock. */
  async function waitUntilBlocked(count: number): Promise<void> {
    assert.ok(owner, "the owner client was built");
    const observer = owner;
    await until(
      async () => {
        const rows = await observer.$queryRaw<{ waiting: bigint }[]>`
          SELECT count(*) AS waiting
          FROM pg_stat_activity
          WHERE datname = ${database} AND cardinality(pg_blocking_pids(pid)) > 0
        `;
        return Number(rows[0]?.waiting ?? 0) >= count;
      },
      {
        description: `${String(count)} runs to block on the holding connection; without that interleaving the case proves nothing`,
        timeoutMs: 20_000,
        intervalMs: 25,
      }
    );
  }

  /**
   * Runs two commands at once while a third connection holds what both need: `hold` takes it
   * inside a transaction, which waits until both runs are blocked on it and then commits or, when
   * `release` is `rollback`, rolls back.
   */
  async function runTwoWhileHeld(
    client: PrismaClient,
    hold: (tx: Prisma.TransactionClient) => Promise<unknown>,
    release: "commit" | "rollback",
    emails: readonly [string, string]
  ): Promise<CommandRun[]> {
    const rollback = new Error("the holding connection rolls back");
    let held!: () => void;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    const holder = client
      .$transaction(
        async (tx) => {
          await hold(tx);
          held();
          await waitUntilBlocked(2);
          if (release === "rollback") throw rollback;
        },
        { timeout: 60_000 }
      )
      .then(
        () => undefined,
        (error: unknown) => {
          if (error !== rollback) throw error;
        }
      );
    await Promise.race([holding, holder]);
    const [runs] = await Promise.all([
      Promise.all(emails.map((email) => runWithOwnClient(email))),
      holder,
    ]);
    return runs;
  }

  before(async () => {
    const ownerUrl = resolveSeedDatabaseUrl();
    owner = createTestPrismaClient(ownerUrl);
    await owner.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    scratchUrl = urlOfDatabase(ownerUrl, database);
    migration = spawnSync("pnpm", ["--filter", "@infra/prisma", "run", "migrate"], {
      cwd: REPOSITORY_ROOT,
      env: {
        ...process.env,
        MIGRATE_DATABASE_URL: scratchUrl,
        // Prisma refuses an empty shadow URL, and one that names the database it migrates,
        // although applying migrations never opens the shadow database.
        SHADOW_DATABASE_URL:
          process.env.SHADOW_DATABASE_URL || urlOfDatabase(ownerUrl, `${database}_shadow`),
      },
      encoding: "utf8",
      timeout: MIGRATION_TIMEOUT_MS,
    });
    scratch = createTestPrismaClient(scratchUrl);
  }, TIMING);

  after(async () => {
    await scratch?.$disconnect();
    if (owner) {
      await owner.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await owner.$disconnect();
    }
  }, TIMING);

  it(
    "creates one administrator with the SUPER_ADMIN role and prints its password once, when the database is empty",
    TIMING,
    async () => {
      const client = await emptyDatabase();

      const run = await runCommand(client, "  First.Admin@Example.COM ");

      const password = printedPassword(run.stdout);
      assert.deepEqual(run, {
        code: 0,
        stdout: successBlock("first.admin@example.com", password),
        stderr: "",
      });
      assert.equal(occurrences(run.stdout, password), 1);
      const state = await readState(client);
      assert.deepEqual(state.roles, [SUPER_ADMIN_ROW]);
      assert.equal(state.permissionRows, SUPER_ADMIN_ROLE.permissions.length);
      assert.equal(state.administrators.length, 1);
      const [administrator] = state.administrators;
      assert.ok(administrator);
      assert.deepEqual(
        {
          email: administrator.email,
          name: administrator.name,
          roleId: administrator.roleId,
          mustChangePassword: administrator.mustChangePassword,
          isActive: administrator.isActive,
        },
        {
          email: "first.admin@example.com",
          name: "first.admin",
          roleId: SUPER_ADMIN_ROLE.id,
          mustChangePassword: true,
          isActive: true,
        }
      );
      assert.equal(await hasher.verify(administrator.passwordHash, password), true);
      assert.equal(administrator.passwordHash.includes(password), false);
    }
  );

  it(
    "refuses a second run with exit code 1 and leaves the first administrator unchanged",
    TIMING,
    async () => {
      const client = await emptyDatabase();
      const first = await runCommand(client, "first.admin@example.com");
      assert.equal(first.code, 0);
      const afterFirst = await readState(client);

      const second = await runCommand(client, "second.admin@example.com");

      assert.deepEqual(second, { code: 1, stdout: "", stderr: REFUSALS.administratorExists });
      assert.deepEqual(await readState(client), afterFirst);
    }
  );

  it(
    "refuses and rolls the role write back when an administrator exists under another role and no SUPER_ADMIN row does",
    TIMING,
    async () => {
      const client = await emptyDatabase();
      await client.role.create({ data: { id: "role-support", name: "SUPPORT", level: 10 } });
      await client.adminUser.create({
        data: {
          email: "support@example.com",
          name: "support",
          roleId: "role-support",
          passwordHash: "fixture-hash-of-a-support-administrator",
        },
      });
      const initial = await readState(client);

      const run = await runCommand(client, "first.admin@example.com");

      assert.deepEqual(run, { code: 1, stdout: "", stderr: REFUSALS.administratorExists });
      const final = await readState(client);
      assert.deepEqual(final, initial);
      assert.equal(
        final.roles.some((role) => role.id === SUPER_ADMIN_ROLE.id),
        false
      );
    }
  );

  it(
    "creates exactly one administrator and refuses the other run as a concurrent one, when two runs start at once on an empty database",
    TIMING,
    async () => {
      const client = await emptyDatabase();

      // An uncommitted row under the role's id: neither run sees it, both insert the role and wait
      // on it; once it is rolled back, the first insert wins and the second collides with it.
      const runs = await runTwoWhileHeld(
        client,
        (tx) => tx.role.create({ data: { id: SUPER_ADMIN_ROLE.id, name: SUPER_ADMIN_ROLE.name } }),
        "rollback",
        ["first.admin@example.com", "rival.admin@example.com"]
      );

      const created = runs.filter((run) => run.code === 0);
      const refused = runs.filter((run) => run.code !== 0);
      assert.equal(created.length, 1);
      assert.deepEqual(refused, [{ code: 1, stdout: "", stderr: REFUSALS.roleIdHeld }]);
      const state = await readState(client);
      assert.deepEqual(state.roles, [SUPER_ADMIN_ROW]);
      assert.equal(state.administrators.length, 1);
      const [winner] = created;
      assert.ok(winner);
      const [administrator] = state.administrators;
      assert.ok(administrator);
      assert.equal(
        await hasher.verify(administrator.passwordHash, printedPassword(winner.stdout)),
        true
      );
    }
  );

  it(
    "makes the SUPER_ADMIN role exactly its definition and creates the administrator, when the role holds other fields and permissions",
    TIMING,
    async () => {
      const client = await emptyDatabase();
      await client.role.create({
        data: {
          id: SUPER_ADMIN_ROLE.id,
          name: SUPER_ADMIN_ROLE.name,
          description: "A description the definition does not hold",
          level: 1,
          isSystem: false,
          permissions: {
            create: [
              { permission: "user:read" },
              { permission: "legacy:permission-no-route-checks" },
            ],
          },
        },
      });

      const run = await runCommand(client, "first.admin@example.com");

      assert.equal(run.code, 0);
      assert.equal(run.stderr, "");
      const state = await readState(client);
      assert.deepEqual(state.roles, [SUPER_ADMIN_ROW]);
      assert.equal(state.permissionRows, SUPER_ADMIN_ROLE.permissions.length);
      assert.deepEqual(
        state.administrators.map(({ email, roleId, mustChangePassword }) => ({
          email,
          roleId,
          mustChangePassword,
        })),
        [
          {
            email: "first.admin@example.com",
            roleId: SUPER_ADMIN_ROLE.id,
            mustChangePassword: true,
          },
        ]
      );
    }
  );

  it(
    "refuses with the message of a lasting refusal and creates nothing, when a role of that name holds another id",
    TIMING,
    async () => {
      const client = await emptyDatabase();
      await client.role.create({
        data: {
          id: "role-renamed-elsewhere",
          name: SUPER_ADMIN_ROLE.name,
          permissions: { create: [{ permission: "user:read" }] },
        },
      });
      const initial = await readState(client);

      const run = await runCommand(client, "first.admin@example.com");

      assert.deepEqual(run, { code: 1, stdout: "", stderr: REFUSALS.roleNameHeld });
      assert.deepEqual(await readState(client), initial);
    }
  );

  it(
    "creates exactly one administrator when two runs start at once on a database where the SUPER_ADMIN role exists and no administrator does",
    TIMING,
    async () => {
      const client = await emptyDatabase();
      await client.role.create({
        data: {
          id: SUPER_ADMIN_ROLE.id,
          name: SUPER_ADMIN_ROLE.name,
          description: SUPER_ADMIN_ROLE.description,
          level: SUPER_ADMIN_ROLE.level,
          isSystem: SUPER_ADMIN_ROLE.isSystem,
          permissions: {
            create: SUPER_ADMIN_ROLE.permissions.map((permission) => ({ permission })),
          },
        },
      });

      // The role row's lock, held: each run reads that no administrator exists only after it has
      // written the role, so the second run to get the lock reads the first one's administrator.
      const runs = await runTwoWhileHeld(
        client,
        (tx) => tx.$executeRaw`SELECT id FROM "Role" WHERE id = ${SUPER_ADMIN_ROLE.id} FOR UPDATE`,
        "commit",
        ["first.admin@example.com", "rival.admin@example.com"]
      );

      assert.equal(runs.filter((run) => run.code === 0).length, 1);
      assert.deepEqual(
        runs.filter((run) => run.code !== 0),
        [{ code: 1, stdout: "", stderr: REFUSALS.administratorExists }]
      );
      const state = await readState(client);
      assert.equal(state.administrators.length, 1);
      assert.deepEqual(state.roles, [SUPER_ADMIN_ROW]);
    }
  );

  it(
    "runs as a process in a pseudo-terminal, shows only the block and ends by itself",
    TIMING,
    async () => {
      const client = await emptyDatabase();
      const email = "first.admin@example.com";
      const command = [
        process.execPath,
        "--conditions",
        "development",
        "--import",
        "tsx",
        "src/cli/createFirstAdministrator.ts",
        "--email",
        email,
      ]
        .map((word) => `'${word}'`)
        .join(" ");

      const run = await runInPseudoTerminal(command);

      // A terminal ends its lines with CR LF; the block is compared with LF endings.
      const terminal = run.stdout.replaceAll("\r\n", "\n");
      const password = /^ {2}Single-use password: (\S+)$/m.exec(terminal)?.[1] ?? "";
      assert.deepEqual(
        { code: run.code, killed: run.killed, terminal, stderr: run.stderr },
        { code: 0, killed: false, terminal: successBlock(email, password), stderr: "" }
      );
      const state = await readState(client);
      assert.equal(state.administrators.length, 1);
      const [administrator] = state.administrators;
      assert.ok(administrator);
      assert.equal(await hasher.verify(administrator.passwordHash, password), true);
    }
  );
});
