/**
 * @file firstAdministratorCommand.integration.test.ts
 * @description The first-administrator command against a database of its own, created on the
 *              owner channel and migrated from empty with the script CI and the start command
 *              run. Most cases call the command's function in this process, with the composition
 *              root built on a client of that database and a standard output that says it is a
 *              terminal; each case starts from the tables the command writes (`Role`,
 *              `RolePermission`, `AdminUser`, `AdminSession`, `AuditLog`) emptied. The cases of
 *              `--reissue` create the administrator with the command first.
 *
 *              The cases of runs at once do not leave the interleaving to chance: a third
 *              connection holds what both runs need (an uncommitted `Role` row on the empty
 *              database, the `Role` row's lock where the role exists, the `AdminUser` row's lock
 *              for two re-issues), waits until both runs are blocked on it, observed in
 *              `pg_stat_activity` and not guessed with a sleep, and only then lets them go.
 *
 *              The two process cases run the command, once creating and once re-issuing, with its
 *              standard output a pseudo-terminal that util-linux `script` opens, and require that
 *              the terminal shows the block and nothing else (no line any imported module writes)
 *              and that the process ends by itself.
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
import {
  composeCreateFirstAdministrator,
  composeReissueAdministratorPassword,
} from "../../src/infrastructure/container/firstAdministratorComposition.js";
import { Argon2PasswordHasher } from "../../src/infrastructure/adapters/Argon2PasswordHasher.js";
import { PasswordService } from "../../src/admin/auth/PasswordService.js";

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
  notFound:
    "Refused: No administrator has this e-mail: there is no single-use password to re-issue\n",
  hasSignedIn:
    "Refused: This administrator has signed in, so its password is no longer a single-use password nobody saw: it is not re-issued\n",
  notMarked:
    "Refused: This administrator is not marked to change its password, so its password is its own and not a single-use password: it is not re-issued\n",
  changedSinceRead:
    "Refused: The administrator changed between the read and the write (another re-issue, a password change or a sign-in), so nothing was replaced: run the re-issue again to see what is true now\n",
} as const;

/** The arguments that switch the command to re-issuing the single-use password. */
const REISSUE = ["--reissue"] as const;

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

/** The block the command writes when it re-issues the password. */
function reissuedBlock(email: string, password: string): string {
  return [
    "A new single-use password was issued.",
    "",
    `  E-mail:              ${email}`,
    `  Single-use password: ${password}`,
    "",
    "The password is shown this once and is stored nowhere: only its hash is kept.",
    "The previous single-use password no longer works, and every session of this administrator was ended.",
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

/**
 * Every `Role` row with its permissions sorted, every `AdminUser` row, every `AdminSession` row
 * and every `AuditLog` row, ordered.
 */
async function readState(client: PrismaClient) {
  const roles = await client.role.findMany({
    orderBy: { id: "asc" },
    include: { permissions: { select: { permission: true } } },
  });
  const administrators = await client.adminUser.findMany({ orderBy: { email: "asc" } });
  return {
    sessions: await client.adminSession.findMany({ orderBy: { id: "asc" } }),
    auditRecords: await client.auditLog.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
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
    await scratch.auditLog.deleteMany({});
    await scratch.adminSession.deleteMany({});
    await scratch.adminUser.deleteMany({});
    await scratch.role.deleteMany({});
    return scratch;
  }

  /**
   * Runs the command in this process with `--email <email>` and any `extra` arguments, composed
   * on `client`.
   */
  async function runCommand(
    client: PrismaClient,
    email: string,
    extra: readonly string[] = []
  ): Promise<CommandRun> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runFirstAdministratorCommand(
      [...extra, "--email", email],
      {
        stdout: { isTTY: true, write: (text: string) => stdout.push(text) },
        stderr: { write: (text: string) => stderr.push(text) },
      },
      async () => ({
        createFirstAdministrator: composeCreateFirstAdministrator(client),
        reissueAdministratorPassword: composeReissueAdministratorPassword(client),
        close: async () => undefined,
      })
    );
    return { code, stdout: stdout.join(""), stderr: stderr.join("") };
  }

  /** Runs the command with a client of its own, released when the run ends. */
  async function runWithOwnClient(
    email: string,
    extra: readonly string[] = []
  ): Promise<CommandRun> {
    const client = createTestPrismaClient(scratchUrl);
    try {
      return await runCommand(client, email, extra);
    } finally {
      await client.$disconnect();
    }
  }

  /** Creates the first administrator with the command and returns it with its password. */
  async function createWithCommand(client: PrismaClient, email: string) {
    const run = await runCommand(client, email);
    assert.equal(run.code, 0, `the creation succeeded:\n${run.stderr}`);
    const administrator = await client.adminUser.findUniqueOrThrow({ where: { email } });
    return { administrator, password: printedPassword(run.stdout) };
  }

  /** Opens an active session of the administrator, as a sign-in would. */
  async function openSession(client: PrismaClient, userId: string): Promise<void> {
    await client.adminSession.create({
      data: {
        userId,
        refreshTokenHash: randomBytes(32).toString("hex"),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
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
    emails: readonly [string, string],
    extra: readonly string[] = []
  ): Promise<CommandRun[]> {
    return runWhileHeld(
      client,
      hold,
      release,
      emails.map((email) => () => runWithOwnClient(email, extra))
    );
  }

  /**
   * Starts `runs` one after another while a third connection holds what they need, each once the
   * runs before it are blocked on that connection, so they queue for it in the order given:
   * `hold` takes it inside a transaction, which waits until every run is blocked and then commits
   * or, when `release` is `rollback`, rolls back.
   */
  async function runWhileHeld<T>(
    client: PrismaClient,
    hold: (tx: Prisma.TransactionClient) => Promise<unknown>,
    release: "commit" | "rollback",
    runs: ReadonlyArray<() => Promise<T>>
  ): Promise<T[]> {
    const rollback = new Error("the holding connection rolls back");
    let held!: () => void;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    let queued!: () => void;
    const allQueued = new Promise<void>((resolve) => {
      queued = resolve;
    });
    const holder = client
      .$transaction(
        async (tx) => {
          await hold(tx);
          held();
          await allQueued;
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
    const started: Array<Promise<T>> = [];
    try {
      for (const run of runs) {
        started.push(run());
        await waitUntilBlocked(started.length);
      }
    } catch (error: unknown) {
      queued();
      await Promise.allSettled([...started, holder]);
      throw error;
    }
    queued();
    const [outcomes] = await Promise.all([Promise.all(started), holder]);
    return outcomes;
  }

  /**
   * Runs `work` while every insert into `AuditLog` of the test's database is refused by a
   * trigger, so the real audit adapter raises inside the real transaction. Whatever step fails,
   * it then removes what it created, the trigger before its function; an error of `work` is
   * never replaced by an error of that clean-up, and when both fail both are raised together.
   */
  async function withAuditWritesRefused<T>(client: PrismaClient, work: () => Promise<T>) {
    const removals: string[] = [];
    let outcome:
      { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };
    try {
      await client.$executeRawUnsafe(
        `CREATE FUNCTION refuse_audit_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit writes are refused'; END $$`
      );
      removals.unshift(`DROP FUNCTION IF EXISTS refuse_audit_write()`);
      await client.$executeRawUnsafe(
        `CREATE TRIGGER refuse_audit_write BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION refuse_audit_write()`
      );
      removals.unshift(`DROP TRIGGER IF EXISTS refuse_audit_write ON "AuditLog"`);
      outcome = { ok: true, value: await work() };
    } catch (error: unknown) {
      outcome = { ok: false, error };
    }
    const cleanUpErrors: unknown[] = [];
    for (const removal of removals) {
      try {
        await client.$executeRawUnsafe(removal);
      } catch (error: unknown) {
        cleanUpErrors.push(error);
      }
    }
    if (!outcome.ok) {
      if (cleanUpErrors.length === 0) throw outcome.error;
      throw new AggregateError(
        [outcome.error, ...cleanUpErrors],
        "the work failed, and removing the trigger that refuses audit writes failed too"
      );
    }
    if (cleanUpErrors.length > 0) {
      throw new AggregateError(
        cleanUpErrors,
        "removing the trigger that refuses audit writes failed"
      );
    }
    return outcome.value;
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

  it(
    "re-issues a different password that replaces the old one, ends every session and leaves one system audit record per run",
    TIMING,
    async () => {
      const client = await emptyDatabase();
      const email = "first.admin@example.com";
      const created = await createWithCommand(client, email);
      await openSession(client, created.administrator.id);
      await openSession(client, created.administrator.id);
      // A reset link requested before the re-issue must not set the password after it.
      await client.adminUser.update({
        where: { id: created.administrator.id },
        data: {
          passwordResetToken: "fixture-hash-of-a-pending-reset-token",
          passwordResetExpires: new Date(Date.now() + 3_600_000),
        },
      });

      const run = await runCommand(client, email, REISSUE);

      const password = printedPassword(run.stdout);
      assert.deepEqual(run, { code: 0, stdout: reissuedBlock(email, password), stderr: "" });
      assert.equal(occurrences(run.stdout, password), 1);
      assert.notEqual(password, created.password);
      const state = await readState(client);
      assert.equal(state.administrators.length, 1);
      const [administrator] = state.administrators;
      assert.ok(administrator);
      assert.equal(await hasher.verify(administrator.passwordHash, password), true);
      assert.equal(await hasher.verify(administrator.passwordHash, created.password), false);
      assert.deepEqual(
        {
          mustChangePassword: administrator.mustChangePassword,
          lastLoginAt: administrator.lastLoginAt,
          passwordHistory: administrator.passwordHistory,
          passwordHashAlgo: administrator.passwordHashAlgo,
          passwordResetToken: administrator.passwordResetToken,
          passwordResetExpires: administrator.passwordResetExpires,
          passwordChangedAtMoved:
            administrator.passwordChangedAt > created.administrator.passwordChangedAt,
        },
        {
          mustChangePassword: true,
          lastLoginAt: null,
          passwordHistory: [],
          passwordHashAlgo: "argon2id",
          passwordResetToken: null,
          passwordResetExpires: null,
          passwordChangedAtMoved: true,
        }
      );
      assert.equal(state.sessions.length, 2);
      assert.deepEqual(
        state.sessions.map((session) => session.isActive),
        [false, false]
      );
      assert.deepEqual(
        state.auditRecords.map((record) => ({
          action: record.action,
          actorType: record.actorType,
          userId: record.userId,
          customerUserId: record.customerUserId,
          accountId: record.accountId,
          resource: record.resource,
          resourceId: record.resourceId,
          details: record.details,
          success: record.success,
          error: record.error,
          ipAddress: record.ipAddress,
          userAgent: record.userAgent,
        })),
        [
          {
            action: "FIRST_ADMINISTRATOR_CREATED",
            actorType: "SYSTEM",
            userId: null,
            customerUserId: null,
            accountId: null,
            resource: "AdminUser",
            resourceId: created.administrator.id,
            details: { task: "create-first-admin" },
            success: true,
            error: null,
            ipAddress: null,
            userAgent: null,
          },
          {
            action: "ADMINISTRATOR_PASSWORD_REISSUED",
            actorType: "SYSTEM",
            userId: null,
            customerUserId: null,
            accountId: null,
            resource: "AdminUser",
            resourceId: created.administrator.id,
            details: { task: "create-first-admin --reissue" },
            success: true,
            error: null,
            ipAddress: null,
            userAgent: null,
          },
        ]
      );
      const recorded = JSON.stringify(state.auditRecords);
      for (const secret of [email, password, created.password, administrator.passwordHash]) {
        assert.equal(recorded.includes(secret), false);
      }
    }
  );

  it(
    "refuses a re-issue and changes nothing, when no administrator has the e-mail",
    TIMING,
    async () => {
      const client = await emptyDatabase();
      await createWithCommand(client, "first.admin@example.com");
      const initial = await readState(client);

      const run = await runCommand(client, "someone.else@example.com", REISSUE);

      assert.deepEqual(run, { code: 1, stdout: "", stderr: REFUSALS.notFound });
      assert.deepEqual(await readState(client), initial);
    }
  );

  it(
    "refuses a re-issue and changes nothing, when the administrator has signed in",
    TIMING,
    async () => {
      const client = await emptyDatabase();
      const email = "first.admin@example.com";
      const created = await createWithCommand(client, email);
      await client.adminUser.update({
        where: { id: created.administrator.id },
        data: { lastLoginAt: new Date() },
      });
      await openSession(client, created.administrator.id);
      const initial = await readState(client);

      const run = await runCommand(client, email, REISSUE);

      assert.deepEqual(run, { code: 1, stdout: "", stderr: REFUSALS.hasSignedIn });
      assert.deepEqual(await readState(client), initial);
    }
  );

  it(
    "refuses a re-issue and changes nothing, when the administrator is no longer marked to change the password",
    TIMING,
    async () => {
      const client = await emptyDatabase();
      const email = "first.admin@example.com";
      const created = await createWithCommand(client, email);
      await client.adminUser.update({
        where: { id: created.administrator.id },
        data: { mustChangePassword: false },
      });
      const initial = await readState(client);

      const run = await runCommand(client, email, REISSUE);

      assert.deepEqual(run, { code: 1, stdout: "", stderr: REFUSALS.notMarked });
      assert.deepEqual(await readState(client), initial);
    }
  );

  it(
    "re-issues exactly once when two re-issues start at once, and the stored hash is the printed password's",
    TIMING,
    async () => {
      const client = await emptyDatabase();
      const email = "first.admin@example.com";
      const created = await createWithCommand(client, email);

      // The administrator's row lock, held: both runs read the row, hash their password and then
      // wait on the lock in their guarded write; the second to get it finds the hash it read gone.
      const runs = await runTwoWhileHeld(
        client,
        (tx) =>
          tx.$executeRaw`SELECT id FROM "AdminUser" WHERE id = ${created.administrator.id} FOR UPDATE`,
        "commit",
        [email, email],
        REISSUE
      );

      const reissued = runs.filter((run) => run.code === 0);
      assert.equal(reissued.length, 1);
      assert.deepEqual(
        runs.filter((run) => run.code !== 0),
        [{ code: 1, stdout: "", stderr: REFUSALS.changedSinceRead }]
      );
      const [winner] = reissued;
      assert.ok(winner);
      const password = printedPassword(winner.stdout);
      assert.equal(winner.stdout, reissuedBlock(email, password));
      const state = await readState(client);
      const [administrator] = state.administrators;
      assert.ok(administrator);
      assert.equal(await hasher.verify(administrator.passwordHash, password), true);
      assert.equal(await hasher.verify(administrator.passwordHash, created.password), false);
      assert.deepEqual(
        state.auditRecords.map((record) => record.action),
        ["FIRST_ADMINISTRATOR_CREATED", "ADMINISTRATOR_PASSWORD_REISSUED"]
      );
    }
  );

  it(
    "re-issues as a process in a pseudo-terminal, shows only the block and ends by itself",
    TIMING,
    async () => {
      const client = await emptyDatabase();
      const email = "first.admin@example.com";
      const created = await createWithCommand(client, email);
      const command = [
        process.execPath,
        "--conditions",
        "development",
        "--import",
        "tsx",
        "src/cli/createFirstAdministrator.ts",
        "--reissue",
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
        { code: 0, killed: false, terminal: reissuedBlock(email, password), stderr: "" }
      );
      const [administrator] = (await readState(client)).administrators;
      assert.ok(administrator);
      assert.equal(await hasher.verify(administrator.passwordHash, password), true);
      assert.equal(await hasher.verify(administrator.passwordHash, created.password), false);
    }
  );

  it(
    "leaves no role and no administrator when the audit write of the creation fails inside its transaction",
    TIMING,
    async () => {
      const client = await emptyDatabase();
      const email = "first.admin@example.com";

      const run = await withAuditWritesRefused(client, () => runCommand(client, email));

      assert.equal(run.code, 1);
      assert.equal(run.stdout, "");
      assert.ok(
        run.stderr.startsWith("Failed: Writing the audit record of the creation failed\n"),
        run.stderr
      );
      assert.equal(run.stderr.includes(email), false);
      const state = await readState(client);
      assert.deepEqual(
        {
          roles: state.roles,
          permissionRows: state.permissionRows,
          administrators: state.administrators,
          auditRecords: state.auditRecords,
        },
        { roles: [], permissionRows: 0, administrators: [], auditRecords: [] }
      );
    }
  );

  it(
    "leaves the stored hash, the mark and the sessions as they were when the audit write of a re-issue fails inside its transaction",
    TIMING,
    async () => {
      const client = await emptyDatabase();
      const email = "first.admin@example.com";
      const created = await createWithCommand(client, email);
      await openSession(client, created.administrator.id);
      const initial = await readState(client);

      const run = await withAuditWritesRefused(client, () => runCommand(client, email, REISSUE));

      assert.equal(run.code, 1);
      assert.equal(run.stdout, "");
      assert.ok(
        run.stderr.startsWith("Failed: Writing the audit record of the re-issue failed\n"),
        run.stderr
      );
      assert.equal(run.stderr.includes(email), false);
      assert.deepEqual(await readState(client), initial);
      const [administrator] = initial.administrators;
      assert.ok(administrator);
      assert.equal(await hasher.verify(administrator.passwordHash, created.password), true);
    }
  );

  it(
    "lets exactly one of a re-issue and the administrator's own required change win when both wait on the administrator's row",
    TIMING,
    async () => {
      const client = await emptyDatabase();
      const email = "first.admin@example.com";
      const created = await createWithCommand(client, email);
      const requiredChange = "fixture-Required-Change-9q4W";

      // The administrator's row lock, held: the re-issue waits in its guarded write and the required
      // change in its own; the second to get the lock finds the hash it read already replaced.
      const [reissue, change] = await runWhileHeld(
        client,
        (tx) =>
          tx.$executeRaw`SELECT id FROM "AdminUser" WHERE id = ${created.administrator.id} FOR UPDATE`,
        "commit",
        [
          async () => {
            const run = await runWithOwnClient(email, REISSUE);
            return {
              won: run.code === 0,
              password: run.code === 0 ? printedPassword(run.stdout) : "",
              refusal: run.stderr,
            };
          },
          async () => {
            const other = createTestPrismaClient(scratchUrl);
            try {
              const result = await new PasswordService(other).replaceRequiredPassword(
                created.administrator,
                requiredChange
              );
              return {
                won: result.ok,
                password: requiredChange,
                refusal: result.ok ? "" : result.error,
              };
            } finally {
              await other.$disconnect();
            }
          },
        ]
      );

      assert.ok(reissue && change);
      assert.equal([reissue, change].filter((outcome) => outcome.won).length, 1);
      const [administrator] = (await readState(client)).administrators;
      assert.ok(administrator);
      assert.equal(await hasher.verify(administrator.passwordHash, created.password), false);
      if (reissue.won) {
        assert.equal(change.refusal, "CONCURRENT_MODIFICATION");
        assert.equal(await hasher.verify(administrator.passwordHash, reissue.password), true);
        assert.equal(await hasher.verify(administrator.passwordHash, requiredChange), false);
        assert.equal(administrator.mustChangePassword, true);
      } else {
        assert.equal(reissue.refusal, REFUSALS.changedSinceRead);
        assert.equal(await hasher.verify(administrator.passwordHash, requiredChange), true);
        assert.equal(administrator.mustChangePassword, false);
      }
    }
  );

  it(
    "lets the required change win and refuses the re-issue as changed since its read, when the required change queues for the administrator's row first",
    TIMING,
    async () => {
      const client = await emptyDatabase();
      const email = "first.admin@example.com";
      const created = await createWithCommand(client, email);
      const requiredChange = "fixture-Required-Change-7m3P";

      // The required change waits on the held row first; the re-issue reads the row as it was,
      // then waits behind it, and finds the hash and the mark it read gone once the change commits.
      const [change, reissue] = await runWhileHeld(
        client,
        (tx) =>
          tx.$executeRaw`SELECT id FROM "AdminUser" WHERE id = ${created.administrator.id} FOR UPDATE`,
        "commit",
        [
          async () => {
            const other = createTestPrismaClient(scratchUrl);
            try {
              const result = await new PasswordService(other).replaceRequiredPassword(
                created.administrator,
                requiredChange
              );
              return { won: result.ok, refusal: result.ok ? "" : result.error, stdout: "" };
            } finally {
              await other.$disconnect();
            }
          },
          async () => {
            const run = await runWithOwnClient(email, REISSUE);
            return { won: run.code === 0, refusal: run.stderr, stdout: run.stdout };
          },
        ]
      );

      assert.deepEqual(change, { won: true, refusal: "", stdout: "" });
      assert.deepEqual(reissue, { won: false, refusal: REFUSALS.changedSinceRead, stdout: "" });
      const [administrator] = (await readState(client)).administrators;
      assert.ok(administrator);
      assert.equal(await hasher.verify(administrator.passwordHash, requiredChange), true);
      assert.equal(await hasher.verify(administrator.passwordHash, created.password), false);
      assert.equal(administrator.mustChangePassword, false);
    }
  );
});
