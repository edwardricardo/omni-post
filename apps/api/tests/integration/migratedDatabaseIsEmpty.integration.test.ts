/**
 * @file migratedDatabaseIsEmpty.integration.test.ts
 * @description A database migrated from empty holds no row of the application. The suite
 *              creates a database of its own on the owner channel, applies every migration
 *              with the script CI and the start command run, and requires that the only
 *              table holding a row is Prisma's own record of the migrations it applied, so
 *              a migration that inserts a row fails here. Its second case runs the
 *              statement of the migration that removed the rotation log's baseline rows
 *              and requires that it removes those rows and no other.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { assertSeedChannelConfigured, resolveSeedDatabaseUrl } from "./helpers/seedPrismaClient.js";

assertSeedChannelConfigured();

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const BASELINE_REMOVAL = path.join(
  REPOSITORY_ROOT,
  "infra/prisma/migrations/20261112000000_remove_secret_rotation_baseline/migration.sql"
);

/** Prisma's own record of the migrations it applied: not data of the application. */
const MIGRATION_RECORD = "public._prisma_migrations";

/** Long enough for every migration on a loaded runner; a hung migration still ends the suite. */
const MIGRATION_TIMEOUT_MS = 120_000;

/** The three values that together name a row of the rotation log's removed baseline. */
const BASELINE = {
  rotatedAt: new Date("2026-04-21T00:00:00Z"),
  rotatedBy: null,
  notes: "T0A initial baseline",
} as const;

interface RotationRow {
  id: string;
  secretCategory: string;
  secretName: string;
  rotatedAt: Date;
  rotatedBy: string | null;
  notes: string | null;
}

/**
 * Builds one rotation log row. It is a baseline row unless an override changes one of the
 * three values that name the baseline.
 */
const makeRotation = (id: string, overrides: Partial<RotationRow> = {}): RotationRow => ({
  id,
  secretCategory: "JWT",
  secretName: "JWT_ACCESS_SECRET",
  ...BASELINE,
  ...overrides,
});

/** The connection string of another database on the same server, with the same credentials. */
function urlOfDatabase(ownerUrl: string, database: string): string {
  const url = new URL(ownerUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Every table outside the server's own catalogs that holds at least one row, as `schema.table`. */
async function tablesHoldingRows(client: PrismaClient): Promise<string[]> {
  const tables = await client.$queryRawUnsafe<Array<{ name: string; quoted: string }>>(
    `SELECT schemaname || '.' || tablename AS name,
            format('%I.%I', schemaname, tablename) AS quoted
       FROM pg_tables
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY 1`
  );
  const holding: string[] = [];
  for (const { name, quoted } of tables) {
    const [row] = await client.$queryRawUnsafe<Array<{ holds: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM ${quoted}) AS holds`
    );
    if (row?.holds === true) holding.push(name);
  }
  return holding;
}

describe("A database migrated from empty", { concurrency: 1 }, () => {
  const database = `omnipost_empty_${randomBytes(6).toString("hex")}`;
  let owner: PrismaClient | undefined;
  let scratch: PrismaClient | undefined;
  let migration: SpawnSyncReturns<string> | undefined;

  /**
   * The migrated database, or a failed assertion that carries the migration's own output. The
   * verdict is asserted here and not in `before`, because node:test reports a failing hook by
   * cancelling every case instead of failing one with the reason.
   */
  function migratedDatabase(): PrismaClient {
    assert.ok(migration, `the migration of ${database} ran`);
    assert.equal(
      migration.status,
      0,
      `the migration of ${database} ended with status ${String(migration.status)}:\n${migration.stdout}\n${migration.stderr}`
    );
    assert.ok(scratch, `a client of ${database} was built`);
    return scratch;
  }

  before(async () => {
    const ownerUrl = resolveSeedDatabaseUrl();
    owner = createTestPrismaClient(ownerUrl);
    await owner.$executeRawUnsafe(`CREATE DATABASE "${database}"`);

    const scratchUrl = urlOfDatabase(ownerUrl, database);
    migration = spawnSync("pnpm", ["--filter", "@infra/prisma", "run", "migrate"], {
      cwd: REPOSITORY_ROOT,
      env: { ...process.env, MIGRATE_DATABASE_URL: scratchUrl },
      encoding: "utf8",
      timeout: MIGRATION_TIMEOUT_MS,
    });
    scratch = createTestPrismaClient(scratchUrl);
  });

  after(async () => {
    await scratch?.$disconnect();
    if (owner) {
      await owner.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await owner.$disconnect();
    }
  });

  it("holds no row but Prisma's own record of the migrations it applied", async () => {
    const client = migratedDatabase();
    const [session] = await client.$queryRawUnsafe<Array<{ sees_every_row: boolean }>>(
      `SELECT (rolsuper OR rolbypassrls) AS sees_every_row
         FROM pg_roles
        WHERE rolname = current_user`
    );
    assert.equal(
      session?.sees_every_row,
      true,
      "the owner channel bypasses row security; without that a table holding rows reads as empty"
    );

    const holding = await tablesHoldingRows(client);

    assert.deepEqual(holding, [MIGRATION_RECORD]);
  });

  it("loses the rotation log's baseline rows and keeps every row recorded after them", async () => {
    const client = migratedDatabase();
    await client.secretRotationLog.createMany({
      data: [
        makeRotation("baseline-jwt"),
        makeRotation("baseline-kek", {
          secretCategory: "KEK",
          secretName: "PLATFORM_ENCRYPTION_KEY",
        }),
        makeRotation("later-author", { rotatedBy: "administrator-1" }),
        makeRotation("later-instant", { rotatedAt: new Date("2026-04-21T00:00:01Z") }),
        makeRotation("later-note", { notes: "Rotated after an incident" }),
        makeRotation("later-without-note", { notes: null }),
      ],
    });

    try {
      await client.$executeRawUnsafe(readFileSync(BASELINE_REMOVAL, "utf8"));
      const kept = await client.secretRotationLog.findMany({
        select: { id: true },
        orderBy: { id: "asc" },
      });

      assert.deepEqual(
        kept.map((row) => row.id),
        ["later-author", "later-instant", "later-note", "later-without-note"]
      );
    } finally {
      await client.secretRotationLog.deleteMany({});
    }
  });
});
