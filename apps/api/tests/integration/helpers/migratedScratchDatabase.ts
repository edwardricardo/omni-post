/**
 * @file migratedScratchDatabase.ts
 * @description A database of a suite's own, created empty on the server of the owner channel and
 *              migrated with the script CI and the start command run, and the wait that observes
 *              backends of that database blocked on a lock. A suite that must start from a
 *              migrated empty database, or force two writers to overlap, uses these instead of
 *              sharing the integration database.
 * @layer infrastructure
 */

import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { until } from "@packages/vitest-shared/determinism";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { resolveSeedDatabaseUrl } from "./seedPrismaClient.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

/** Long enough for every migration on a loaded runner; a hung migration still ends the suite. */
const MIGRATION_TIMEOUT_MS = 120_000;

/** A migrated database of a suite's own, with the owner connection that created it. */
export interface MigratedScratchDatabase {
  /** The database's name on the server. */
  readonly name: string;
  /** The connection string of the database, with the owner channel's credentials. */
  readonly url: string;
  /** The owner channel's client, connected to the database the owner URL names. */
  readonly owner: PrismaClient;
  /**
   * Asserts the migration exited 0, carrying its own output in the message. A suite calls it in
   * each case rather than in `before`, because node:test reports a failing hook by cancelling
   * every case instead of failing one with the reason.
   */
  assertMigrated(): void;
  /** Drops the database, closing its open connections, and disconnects the owner client. */
  drop(): Promise<void>;
}

/** The connection string of another database on the same server, with the same credentials. */
function urlOfDatabase(ownerUrl: string, database: string): string {
  const url = new URL(ownerUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * @function createMigratedScratchDatabase
 * @description Creates an empty database named after `prefix` and a random suffix on the owner
 *   channel's server, and applies every migration to it. The migration's failure is not thrown:
 *   `assertMigrated` reports it.
 * @param prefix - The start of the database's name, which names the suite that owns it
 * @returns The database, its URL, the owner client and the migration's verdict
 */
export async function createMigratedScratchDatabase(
  prefix: string
): Promise<MigratedScratchDatabase> {
  const ownerUrl = resolveSeedDatabaseUrl();
  const owner = createTestPrismaClient(ownerUrl);
  const name = `${prefix}_${randomBytes(6).toString("hex")}`;
  await owner.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  const url = urlOfDatabase(ownerUrl, name);
  const migration: SpawnSyncReturns<string> = spawnSync(
    "pnpm",
    ["--filter", "@infra/prisma", "run", "migrate"],
    {
      cwd: REPOSITORY_ROOT,
      env: {
        ...process.env,
        MIGRATE_DATABASE_URL: url,
        // Prisma refuses an empty shadow URL, and one that names the database it migrates,
        // although applying migrations never opens the shadow database.
        SHADOW_DATABASE_URL:
          process.env.SHADOW_DATABASE_URL || urlOfDatabase(ownerUrl, `${name}_shadow`),
      },
      encoding: "utf8",
      timeout: MIGRATION_TIMEOUT_MS,
    }
  );

  return {
    name,
    url,
    owner,
    assertMigrated() {
      const outcome = [
        `status ${String(migration.status)}`,
        ...(migration.signal ? [`signal ${migration.signal}`] : []),
        ...(migration.error ? [migration.error.message] : []),
      ].join(", ");
      const output = [migration.stdout, migration.stderr].filter(Boolean).join("\n");
      assert.equal(
        migration.status,
        0,
        `the migration of ${name} ended with ${outcome}:\n${output}`
      );
    },
    async drop() {
      await owner.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await owner.$disconnect();
    },
  };
}

/** How long `waitUntilBackendsBlocked` waits for the blocked backends before it rejects. */
export const BLOCKED_BACKENDS_TIMEOUT_MS = 20_000;

/**
 * @function waitUntilBackendsBlocked
 * @description Resolves once at least `count` backends of `database` wait on a lock while running
 *   a statement that matches `statementLike`, observed in `pg_stat_activity` rather than guessed
 *   with a sleep. A backend waiting on a lock in any other statement does not count.
 * @param owner - A client of the same server that can read `pg_stat_activity`
 * @param database - The database whose backends are counted
 * @param count - How many blocked backends to wait for
 * @param statementLike - A SQL `LIKE` pattern the blocked backend's current statement must match
 * @param description - Why the wait matters, carried by the error when it times out
 * @returns The current statements of the matching blocked backends; rejects when fewer than
 *   `count` are blocked within `BLOCKED_BACKENDS_TIMEOUT_MS`
 */
export async function waitUntilBackendsBlocked(
  owner: PrismaClient,
  database: string,
  count: number,
  statementLike: string,
  description: string
): Promise<string[]> {
  let statements: string[] = [];
  await until(
    async () => {
      const rows = await owner.$queryRaw<{ query: string }[]>`
        SELECT query
        FROM pg_stat_activity
        WHERE datname = ${database}
          AND cardinality(pg_blocking_pids(pid)) > 0
          AND query LIKE ${statementLike}
      `;
      statements = rows.map((row) => row.query);
      return statements.length >= count;
    },
    { description, timeoutMs: BLOCKED_BACKENDS_TIMEOUT_MS, intervalMs: 25 }
  );
  return statements;
}
