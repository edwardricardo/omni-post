/**
 * @file migratedScratchDatabase.ts
 * @description A database of a suite's own, created empty on the server of the owner channel,
 *              migrated with the script CI and the start command run, and emptied on request back
 *              to the state the migration left, and the wait that observes backends of that
 *              database blocked on a lock. A suite that must start from a migrated empty database,
 *              or force two writers to overlap, uses these instead of sharing the integration
 *              database.
 * @layer infrastructure
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { until } from "@packages/vitest-shared/determinism";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { resolveSeedDatabaseUrl } from "./seedPrismaClient.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

/** Long enough for every migration on a loaded runner; a hung migration still ends the suite. */
const MIGRATION_TIMEOUT_MS = 120_000;

/** How a process run by `runInOwnProcessGroup` ended, and what it wrote. */
export interface ProcessOutcome {
  /** The exit code; `null` when a signal ended the process or it never started. */
  readonly status: number | null;
  /** The signal that ended the process, or `null`. */
  readonly signal: NodeJS.Signals | null;
  /** Why the process did not run to its end: it never started, or it outlived its limit. */
  readonly error?: Error;
  readonly stdout: string;
  readonly stderr: string;
}

/** Where, with what environment and for how long `runInOwnProcessGroup` runs a process. */
export interface ProcessGroupOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}

/**
 * Ends every process of the group `pid` leads, which is named by its leader's negative pid. A
 * group that already ended is not an error. Any other failure is returned, never raised, because
 * the caller runs in a timer, where a raise would end the whole test run.
 * @returns The reason the group could not be signalled, or `undefined`.
 */
function endProcessGroup(pid: number | undefined): Error | undefined {
  // -1 would signal every process this one may, and -0 its own group: a pid not above 1 ends nothing.
  if (pid === undefined || !Number.isInteger(pid) || pid <= 1) return undefined;
  try {
    process.kill(-pid, "SIGKILL");
    return undefined;
  } catch (error: unknown) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ESRCH") return undefined;
    return error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * @function runInOwnProcessGroup
 * @description Runs a command as the leader of a process group of its own, without blocking the
 *   event loop, so the hook or test that waits for it keeps its own timeout. When the command
 *   outlives `timeoutMs`, the whole group ends, the processes it started included, and the outcome
 *   carries an error that names the limit. The outcome is resolved once the process has ended and
 *   every holder of its output has closed it. When the group cannot be signalled, the outcome is
 *   resolved at once, with no status and no signal, and its error names the limit and carries the
 *   refusal as its cause: the process may still be running.
 * @param command - The program to run
 * @param args - Its arguments
 * @param options - The working directory, the environment and the limit in milliseconds
 * @returns How the process ended and what it wrote to its two streams; it never rejects
 */
export function runInOwnProcessGroup(
  command: string,
  args: readonly string[],
  options: ProcessGroupOptions
): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let failure: Error | undefined;
    let settled = false;
    const timer = setTimeout(() => {
      const limit = `${command} outlived its limit of ${String(options.timeoutMs)} ms`;
      const refusal = endProcessGroup(child.pid);
      if (refusal === undefined) {
        failure = new Error(`${limit}, so its process group was ended`);
        return;
      }
      const reason = `${limit}, and its process group could not be ended: ${refusal.message}`;
      failure = new Error(reason, { cause: refusal });
      settle(null, null);
    }, options.timeoutMs);
    const settle = (status: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, signal, ...(failure !== undefined && { error: failure }), stdout, stderr });
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error: Error) => {
      failure = error;
      // A process that never started has no group to wait for.
      if (child.pid === undefined) settle(null, null);
    });
    child.on("close", (status, signal) => settle(status, signal));
  });
}

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
  /**
   * Removes every row of every table of the database but Prisma's record of the migrations it
   * applied, and starts again the sequences those tables' columns own. No migration inserts a
   * row of the application, so the database then holds what the migration left, whatever a case
   * wrote before. It runs on a connection of this database only.
   */
  empty(): Promise<void>;
  /** Drops the database, closing its open connections, and disconnects both clients. */
  drop(): Promise<void>;
}

/** The connection string of another database on the same server, with the same credentials. */
function urlOfDatabase(ownerUrl: string, database: string): string {
  const url = new URL(ownerUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * The one statement that empties `database`: every table of the public schema but
 * `_prisma_migrations`, in one `TRUNCATE`, so the foreign keys among them hold, with the sequences
 * their columns own started again, so a generated number does not depend on what ran before. It raises, and
 * removes nothing, when the database of the connection that runs it is not `database`: a client
 * of the owner channel's own database that ran it would otherwise empty that database.
 */
function emptyingStatement(database: string): string {
  return `DO $$
    DECLARE tables text;
    BEGIN
      IF current_database() <> '${database}' THEN
        RAISE EXCEPTION 'the emptying of ${database} ran on %', current_database();
      END IF;
      SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
        INTO tables
        FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_prisma_migrations';
      EXECUTE 'TRUNCATE TABLE ' || tables || ' RESTART IDENTITY';
    END $$`;
}

/**
 * @function createMigratedScratchDatabase
 * @description Creates an empty database named after `prefix` and a random suffix on the owner
 *   channel's server, and applies every migration to it in a process group of its own, which ends
 *   whole when the migration outlives its limit. The migration's failure is not thrown:
 *   `assertMigrated` reports it. `empty` runs on a client of that database the helper builds
 *   from the URL of the database it created, never on the owner client.
 * @param prefix - The start of the database's name, which names the suite that owns it
 * @returns The database, its URL, the owner client, the migration's verdict and its emptying
 */
export async function createMigratedScratchDatabase(
  prefix: string
): Promise<MigratedScratchDatabase> {
  const ownerUrl = resolveSeedDatabaseUrl();
  const owner = createTestPrismaClient(ownerUrl);
  const name = `${prefix}_${randomBytes(6).toString("hex")}`;
  await owner.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  const url = urlOfDatabase(ownerUrl, name);
  const migration = await runInOwnProcessGroup(
    "pnpm",
    ["--filter", "@infra/prisma", "run", "migrate"],
    {
      cwd: REPOSITORY_ROOT,
      env: {
        ...process.env,
        MIGRATE_DATABASE_URL: url,
        // Prisma refuses an empty shadow URL, and one that names the database it migrates,
        // although applying migrations never opens the shadow database. A caller that exports
        // none gets the name of a database nobody creates.
        SHADOW_DATABASE_URL:
          process.env.SHADOW_DATABASE_URL || urlOfDatabase(ownerUrl, `${name}_shadow`),
      },
      timeoutMs: MIGRATION_TIMEOUT_MS,
    }
  );
  const scratch = createTestPrismaClient(url);

  return {
    name,
    url,
    owner,
    assertMigrated() {
      // A child that never started, or that its limit stopped, has no status: the reason is in its
      // error or its signal, and its output may be missing.
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
    async empty() {
      await scratch.$executeRawUnsafe(emptyingStatement(name));
    },
    async drop() {
      await scratch.$disconnect();
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
