/**
 * @file seedRoleWrites.integration.test.ts
 * @description The development seed writes each role whole or not at all, against a database of
 *              its own migrated from empty. Each of the first three cases installs a trigger that
 *              fails one permission row of one role, partway through that role's list, so the seed
 *              dies while it writes that role. The role then holds what it held before the run: no
 *              row on a first run, and on a rerun the rows and the description it held, a stale
 *              permission row and a changed description the case wrote before the rerun included.
 *              The fourth case is their control: with the same stale row and changed description
 *              and no trigger, a rerun that completes removes the row and restores the description.
 *              The trigger counts each time it fires on a sequence, which a rollback does not undo,
 *              so a case also shows that the run died on that row and not before it. Each case
 *              asserts how the run ended first, with the seed's output as the message, and then the
 *              rows, with no message, so a failure shows the rows that differed.
 *
 *              The seed runs as `pnpm db:seed` runs it (`tsx --conditions development seed.ts` in
 *              `infra/prisma`), under `NODE_ENV=test`, with a fake administrator password and a
 *              key of zeros, on the owner channel's connection to the scratch database. The cases
 *              run in order and build on each other's rows: the first two find their role
 *              unwritten, and the third and the fourth write everything before they rerun.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { SUPER_ADMIN_ROLE } from "../../../../infra/prisma/src/adminSystemRoles.js";
import { assertSeedChannelConfigured } from "./helpers/seedPrismaClient.js";
import {
  createMigratedScratchDatabase,
  type MigratedScratchDatabase,
} from "./helpers/migratedScratchDatabase.js";

assertSeedChannelConfigured();

/** Budget for each hook in this file: the migration in `before` blocks for minutes. */
const HOOK_TIMING = { timeout: 240_000 } as const;

const PRISMA_DIR = fileURLToPath(new URL("../../../../infra/prisma/", import.meta.url));
const TSX_CLI = createRequire(path.join(PRISMA_DIR, "package.json")).resolve("tsx/cli");

/** How long one run of the seed may take before the runner ends it with SIGTERM. */
const SEED_RUN_LIMIT_MS = 180_000;

/** What a case takes besides its seed runs: the trigger, the reads and the cleanup. */
const CASE_MARGIN_MS = 60_000;

/**
 * The budget of a case that runs the seed `seedRuns` times: every run's limit plus the margin, so a
 * run that hangs is ended by its own limit, with `killed` set, before the case's timeout cancels it.
 */
function caseTiming(seedRuns: number): { readonly timeout: number } {
  return { timeout: seedRuns * SEED_RUN_LIMIT_MS + CASE_MARGIN_MS };
}

/** The trigger, its function and the sequence that counts its firings. */
const FAILURE = {
  trigger: "seed_role_write_failure",
  function: "seed_role_write_failure",
  sequence: "seed_role_write_failures",
} as const;

/** The two tables of permission rows, one per kind of role. */
type PermissionTable = "RolePermission" | "CustomerRolePermission";

/** A permission no definition holds, which a completed run deletes from the role. */
const STALE_PERMISSION = "probe:stale";

/** A description no definition holds, which a completed run overwrites with the definition's. */
const CHANGED_DESCRIPTION = "A description the case wrote before the rerun";

const execFileAsync = promisify(execFile);

interface SeedRun {
  readonly code: number;
  /** True when the runner ended the seed because its time limit passed. */
  readonly killed: boolean;
  /** Its stdout and stderr together, carried by an assertion's message. */
  readonly output: string;
}

/** Runs the seed against `databaseUrl` with exactly the variables it needs, and resolves on exit. */
async function runSeed(databaseUrl: string): Promise<SeedRun> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [TSX_CLI, "--conditions", "development", "seed.ts"],
      {
        cwd: PRISMA_DIR,
        env: {
          NODE_ENV: "test",
          DATABASE_URL: databaseUrl,
          ADMIN_PASSWORD: "fake-seed-admin-password",
          PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
        },
        timeout: SEED_RUN_LIMIT_MS,
        killSignal: "SIGTERM",
      }
    );
    return { code: 0, killed: false, output: `${stdout}${stderr}` };
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
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

/**
 * Installs a trigger that fails the insert of the row of `permission` of `roleId` in `table`, and
 * counts each firing on a sequence before it raises. The values are this file's own constants.
 */
async function failPermissionRow(
  client: PrismaClient,
  table: PermissionTable,
  roleId: string,
  permission: string
): Promise<void> {
  await client.$executeRawUnsafe(`CREATE SEQUENCE "${FAILURE.sequence}"`);
  await client.$executeRawUnsafe(
    `CREATE FUNCTION "${FAILURE.function}"() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       IF NEW."roleId" = TG_ARGV[0] AND NEW."permission" = TG_ARGV[1] THEN
         PERFORM nextval('"${FAILURE.sequence}"');
         RAISE EXCEPTION 'the case fails the permission % of %', NEW."permission", NEW."roleId";
       END IF;
       RETURN NEW;
     END $$`
  );
  await client.$executeRawUnsafe(
    `CREATE TRIGGER "${FAILURE.trigger}" BEFORE INSERT ON "${table}" FOR EACH ROW
     EXECUTE FUNCTION "${FAILURE.function}"('${roleId}', '${permission}')`
  );
}

/** How many times the trigger fired, rollbacks included. */
async function failuresFired(client: PrismaClient): Promise<number> {
  const [row] = await client.$queryRawUnsafe<Array<{ fired: bigint }>>(
    `SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS fired FROM "${FAILURE.sequence}"`
  );
  return Number(row?.fired ?? -1);
}

/** Removes the trigger, its function and its sequence, whichever of them exists. */
async function removeFailure(client: PrismaClient, table: PermissionTable): Promise<void> {
  await client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${FAILURE.trigger}" ON "${table}"`);
  await client.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${FAILURE.function}"()`);
  await client.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS "${FAILURE.sequence}"`);
}

/** The permissions an administration role holds, sorted, or null when the role has no row. */
async function adminRolePermissions(
  client: PrismaClient,
  roleId: string
): Promise<string[] | null> {
  const role = await client.role.findUnique({
    where: { id: roleId },
    select: { permissions: { select: { permission: true } } },
  });
  return role === null ? null : role.permissions.map((row) => row.permission).sort();
}

/** The permissions a customer role holds, sorted, or null when the role has no row. */
async function customerRolePermissions(
  client: PrismaClient,
  roleId: string
): Promise<string[] | null> {
  const role = await client.customerRole.findUnique({
    where: { id: roleId },
    select: { permissions: { select: { permission: true } } },
  });
  return role === null ? null : role.permissions.map((row) => row.permission).sort();
}

/** The description of an administration role, or null when the role has no row. */
async function adminRoleDescription(client: PrismaClient, roleId: string): Promise<string | null> {
  const role = await client.role.findUnique({
    where: { id: roleId },
    select: { description: true },
  });
  return role?.description ?? null;
}

describe("The development seed's role writes on a migrated database", { concurrency: 1 }, () => {
  let database: MigratedScratchDatabase | undefined;
  let scratch: PrismaClient | undefined;

  before(async () => {
    database = await createMigratedScratchDatabase("omnipost_seed_roles");
    scratch = createTestPrismaClient(database.url);
  }, HOOK_TIMING);

  after(async () => {
    await scratch?.$disconnect();
    await database?.drop();
  }, HOOK_TIMING);

  /** The scratch database's URL and client, after asserting the migration ran. */
  function migrated(): { url: string; client: PrismaClient } {
    assert.ok(database, "the scratch database was created");
    database.assertMigrated();
    assert.ok(scratch, "a client of the scratch database was built");
    return { url: database.url, client: scratch };
  }

  it(
    "leaves no row of an administration role whose permissions fail partway on a first run",
    caseTiming(1),
    async () => {
      const { url, client } = migrated();
      await failPermissionRow(client, "RolePermission", "role-admin", "audit:read");
      try {
        const run = await runSeed(url);

        assert.deepStrictEqual(
          { code: run.code, killed: run.killed, fired: await failuresFired(client) },
          { code: 1, killed: false, fired: 1 },
          run.output
        );
        assert.deepStrictEqual(
          {
            superAdmin: await adminRolePermissions(client, SUPER_ADMIN_ROLE.id),
            admin: await adminRolePermissions(client, "role-admin"),
          },
          { superAdmin: [...SUPER_ADMIN_ROLE.permissions].sort(), admin: null }
        );
      } finally {
        await removeFailure(client, "RolePermission");
      }
    }
  );

  it(
    "leaves no row of a customer role whose permissions fail partway on a first run",
    caseTiming(1),
    async () => {
      const { url, client } = migrated();
      await failPermissionRow(client, "CustomerRolePermission", "role-manager", "approval:review");
      try {
        const run = await runSeed(url);

        assert.deepStrictEqual(
          { code: run.code, killed: run.killed, fired: await failuresFired(client) },
          { code: 1, killed: false, fired: 1 },
          run.output
        );
        const owner = await customerRolePermissions(client, "role-owner");
        assert.deepStrictEqual(
          {
            ownerHoldsTheFailedPermission: owner?.includes("approval:review") ?? false,
            manager: await customerRolePermissions(client, "role-manager"),
          },
          { ownerHoldsTheFailedPermission: true, manager: null }
        );
      } finally {
        await removeFailure(client, "CustomerRolePermission");
      }
    }
  );

  it(
    "keeps every row and the description a role held when a rerun fails partway through it",
    caseTiming(2),
    async () => {
      const { url, client } = migrated();
      const complete = await runSeed(url);
      assert.deepStrictEqual(
        { code: complete.code, killed: complete.killed },
        { code: 0, killed: false },
        complete.output
      );
      const held = await adminRolePermissions(client, "role-support");
      assert.ok(
        held !== null && held.includes("audit:read"),
        "the role holds the permission the case fails"
      );
      await client.rolePermission.create({
        data: { roleId: "role-support", permission: STALE_PERMISSION },
      });
      await client.role.update({
        where: { id: "role-support" },
        data: { description: CHANGED_DESCRIPTION },
      });
      await failPermissionRow(client, "RolePermission", "role-support", "audit:read");
      try {
        const rerun = await runSeed(url);

        assert.deepStrictEqual(
          { code: rerun.code, killed: rerun.killed, fired: await failuresFired(client) },
          { code: 1, killed: false, fired: 1 },
          rerun.output
        );
        assert.deepStrictEqual(
          {
            permissions: await adminRolePermissions(client, "role-support"),
            description: await adminRoleDescription(client, "role-support"),
          },
          { permissions: [...held, STALE_PERMISSION].sort(), description: CHANGED_DESCRIPTION }
        );
      } finally {
        await removeFailure(client, "RolePermission");
      }
    }
  );

  it(
    "removes a stale permission and restores the description when a rerun completes",
    caseTiming(2),
    async () => {
      const { url, client } = migrated();
      const first = await runSeed(url);
      assert.deepStrictEqual(
        { code: first.code, killed: first.killed },
        { code: 0, killed: false },
        first.output
      );
      const written = {
        permissions: await adminRolePermissions(client, "role-support"),
        description: await adminRoleDescription(client, "role-support"),
      };
      assert.ok(
        written.permissions !== null && written.description !== CHANGED_DESCRIPTION,
        "the first run wrote the role from its definition"
      );
      await client.rolePermission.createMany({
        data: [{ roleId: "role-support", permission: STALE_PERMISSION }],
        skipDuplicates: true,
      });
      await client.role.update({
        where: { id: "role-support" },
        data: { description: CHANGED_DESCRIPTION },
      });

      const rerun = await runSeed(url);

      assert.deepStrictEqual(
        { code: rerun.code, killed: rerun.killed },
        { code: 0, killed: false },
        rerun.output
      );
      assert.deepStrictEqual(
        {
          permissions: await adminRolePermissions(client, "role-support"),
          description: await adminRoleDescription(client, "role-support"),
        },
        {
          permissions: written.permissions.filter((permission) => permission !== STALE_PERMISSION),
          description: written.description,
        }
      );
    }
  );
});
