/**
 * @file sagaAccountIdBackfill.integration.test.ts
 * @description Integration contract for the `SagaInstance.accountId` backfill
 *   migration (`infra/prisma/migrations/20260731000000_backfill_saga_instance_account_id`).
 *
 *   The saga engine historically persisted the acting `CustomerUser.id` into a
 *   column the tenant guard reads as an `Account.id`, so historical rows are
 *   keyed on a value that is not a tenant. The migration repairs them. Because a
 *   data migration cannot be re-run through Prisma once applied, this suite
 *   reads the shipped `migration.sql` from disk and executes its statements
 *   inside ONE interactive transaction — the same all-or-nothing envelope Prisma
 *   wraps the file in — so the four disposition classes are exercised against
 *   real rows in a real Postgres.
 *
 *   Scenario transactions are deliberately ROLLED BACK: the seeded fixtures and
 *   the repair they trigger must not mutate the database whose committed state
 *   the deploy-criterion block below asserts.
 *
 *   Guarded properties:
 *     - METADATA-FIRST: a row whose `context.metadata.accountId` names a live
 *       account is repaired from it, whether the column holds a `CustomerUser.id`
 *       or NULL (a falsy `userId` persisted no value at all);
 *     - JOIN: a row still holding a live `CustomerUser.id` and carrying no usable
 *       metadata is repaired through that user's owning account;
 *     - TERMINAL SENTINEL: an unmappable row in a terminal state is set to the
 *       documented NULL sentinel and counted — never deleted, never left holding
 *       a user id, never given a fabricated account-looking value;
 *     - NON-TERMINAL HALT: an unmappable row that is still live aborts the
 *       migration, names the offending ids, and commits NOTHING — a partial
 *       backfill would leave a live saga silently mis-scoped;
 *     - IDEMPOTENCY: a second run writes nothing at all (proven by unchanged
 *       `updatedAt` values), so the cutover runbook's manual re-run is safe;
 *     - ROW COUNT: the repair never adds or removes a row.
 *
 *   Requires Postgres up (`pnpm db:up`); raw SQL is used deliberately — the
 *   subject under test IS SQL.
 *
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";

/** Directory name of the migration, which is also its `_prisma_migrations` key. */
const MIGRATION_NAME = "20260731000000_backfill_saga_instance_account_id";

const MIGRATION_SQL_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../infra/prisma/migrations",
  MIGRATION_NAME,
  "migration.sql"
);

const TAG = `saga-backfill-${Date.now()}`;

/** Terminal states the migration treats as safe to sentinel. */
const TERMINAL_STATES = ["COMPLETED", "FAILED", "COMPENSATED"] as const;

/**
 * The transaction client Prisma hands an interactive transaction: the full
 * client minus the operations that cannot nest inside one.
 */
type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/** Marker used to unwind a scenario transaction once its assertions are done. */
class RollbackSignal extends Error {
  constructor() {
    super("scenario complete — rolling back");
    this.name = "RollbackSignal";
  }
}

interface Fixture {
  accountId: string;
  customerUserId: string;
  /** Column holds the user id; metadata names the account (metadata wins). */
  metadataCorruptedId: string;
  /** Column is NULL; metadata names the account (the falsy-userId row class). */
  metadataNullId: string;
  /** Column holds the user id; no usable metadata (repaired by the join). */
  joinMappableId: string;
  /** Terminal row whose value maps to nothing (repaired to the NULL sentinel). */
  terminalUnmappableId: string;
  /** Value that is neither an account nor a user — unmappable by construction. */
  orphanValue: string;
}

/**
 * Splits a Postgres script into executable statements. A naive split on `;`
 * would tear the migration's `DO $$ ... $$` blocks apart, so the scanner tracks
 * dollar-quoted bodies, single-quoted literals, and line comments.
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let buffer = "";
  let inDollarBlock = false;
  let inSingleQuote = false;
  let inLineComment = false;

  for (let index = 0; index < sql.length; index++) {
    const char = sql[index] as string;
    const pair = sql.slice(index, index + 2);

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        buffer += "\n";
      }
      continue;
    }

    if (!inSingleQuote && !inDollarBlock && pair === "--") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (!inSingleQuote && pair === "$$") {
      inDollarBlock = !inDollarBlock;
      buffer += pair;
      index += 1;
      continue;
    }

    if (!inDollarBlock && char === "'") {
      inSingleQuote = !inSingleQuote;
      buffer += char;
      continue;
    }

    if (char === ";" && !inSingleQuote && !inDollarBlock) {
      const statement = buffer.trim();
      if (statement.length > 0) {
        statements.push(statement);
      }
      buffer = "";
      continue;
    }

    buffer += char;
  }

  const tail = buffer.trim();
  if (tail.length > 0) {
    statements.push(tail);
  }

  return statements;
}

/** Builds the persisted saga context shape, optionally carrying the tenant. */
function buildContext(userId: string, metadataAccountId?: string): Record<string, unknown> {
  return {
    sagaId: `ctx-${randomUUID()}`,
    correlationId: `corr-${randomUUID()}`,
    userId,
    stepData: {},
    metadata: {
      source: "customer-api",
      ...(metadataAccountId !== undefined && { accountId: metadataAccountId }),
    },
  };
}

describe("SagaInstance accountId backfill migration", { concurrency: 1 }, () => {
  let base: PrismaClient;
  let statements: string[];

  before(() => {
    base = createTestPrismaClient();
    statements = splitSqlStatements(readFileSync(MIGRATION_SQL_PATH, "utf8"));
  });

  after(async () => {
    await base.$disconnect();
  });

  /** Runs the shipped statements in order, exactly as the migration commits them. */
  async function runBackfill(tx: TxClient): Promise<void> {
    for (const statement of statements) {
      await tx.$executeRawUnsafe(statement);
    }
  }

  /** Seeds one account, one of its users, and the four disposition classes. */
  async function seedFixture(tx: TxClient, suffix: string): Promise<Fixture> {
    const account = await tx.account.create({
      data: {
        name: `${TAG}-${suffix}`,
        email: `${TAG}-${suffix}-${randomUUID()}@test.local`,
        slug: `${TAG}-${suffix}-${randomUUID()}`,
      },
    });
    const customerUser = await tx.customerUser.create({
      data: {
        accountId: account.id,
        email: `${TAG}-${suffix}-user-${randomUUID()}@test.local`,
        passwordHash: "ignored-for-test",
        firstName: "Backfill",
        lastName: "Fixture",
      },
    });

    const orphanValue = `orphan-${randomUUID()}`;
    const ids = {
      metadataCorruptedId: `${TAG}-${suffix}-meta-corrupted-${randomUUID()}`,
      metadataNullId: `${TAG}-${suffix}-meta-null-${randomUUID()}`,
      joinMappableId: `${TAG}-${suffix}-join-${randomUUID()}`,
      terminalUnmappableId: `${TAG}-${suffix}-terminal-orphan-${randomUUID()}`,
    };

    await tx.sagaInstance.create({
      data: {
        id: ids.metadataCorruptedId,
        definitionId: "post-publishing-saga",
        status: "RUNNING",
        accountId: customerUser.id,
        context: buildContext(customerUser.id, account.id),
      },
    });
    await tx.sagaInstance.create({
      data: {
        id: ids.metadataNullId,
        definitionId: "post-publishing-saga",
        status: "RUNNING",
        accountId: null,
        context: buildContext("", account.id),
      },
    });
    await tx.sagaInstance.create({
      data: {
        id: ids.joinMappableId,
        definitionId: "post-publishing-saga",
        status: "PENDING",
        accountId: customerUser.id,
        context: buildContext(customerUser.id),
      },
    });
    await tx.sagaInstance.create({
      data: {
        id: ids.terminalUnmappableId,
        definitionId: "post-publishing-saga",
        status: "COMPLETED",
        accountId: orphanValue,
        context: buildContext(orphanValue),
      },
    });

    return {
      accountId: account.id,
      customerUserId: customerUser.id,
      orphanValue,
      ...ids,
    };
  }

  /**
   * Runs `body` inside a transaction that is always rolled back, so a scenario
   * observes the migration's real effect without committing it.
   */
  async function inRolledBackTransaction(body: (tx: TxClient) => Promise<void>): Promise<void> {
    try {
      await base.$transaction(
        async (tx) => {
          await body(tx);
          throw new RollbackSignal();
        },
        { timeout: 120_000, maxWait: 30_000 }
      );
    } catch (error) {
      if (!(error instanceof RollbackSignal)) {
        throw error;
      }
    }
  }

  async function readAccountId(tx: TxClient, id: string): Promise<string | null> {
    const row = await tx.sagaInstance.findUniqueOrThrow({ where: { id } });
    return row.accountId;
  }

  describe("the shipped SQL file", () => {
    it("parses into the four ordered disposition statements", () => {
      assert.strictEqual(
        statements.length,
        4,
        `expected metadata repair, join repair, terminal sentinel and non-terminal halt, got ${statements.length}`
      );
      assert.match(statements[0] ?? "", /context.*metadata.*accountId/s);
      assert.match(statements[1] ?? "", /FROM "CustomerUser"/);
      assert.match(statements[2] ?? "", /RAISE NOTICE/);
      assert.match(statements[3] ?? "", /RAISE EXCEPTION/);
    });
  });

  describe("disposition of every row class", () => {
    it("repairs a userId-corrupted row from its context metadata", async () => {
      await inRolledBackTransaction(async (tx) => {
        const fixture = await seedFixture(tx, "meta");
        assert.strictEqual(
          await readAccountId(tx, fixture.metadataCorruptedId),
          fixture.customerUserId,
          "the seeded row starts out keyed on the acting user"
        );

        await runBackfill(tx);

        assert.strictEqual(
          await readAccountId(tx, fixture.metadataCorruptedId),
          fixture.accountId,
          "metadata is authoritative, so the row lands on the owning account"
        );
      });
    });

    it("repairs a row whose column was never written from its context metadata", async () => {
      await inRolledBackTransaction(async (tx) => {
        const fixture = await seedFixture(tx, "null");
        assert.strictEqual(
          await readAccountId(tx, fixture.metadataNullId),
          null,
          "a falsy userId persisted no tenant value at all"
        );

        await runBackfill(tx);

        assert.strictEqual(
          await readAccountId(tx, fixture.metadataNullId),
          fixture.accountId,
          "the NULL row class is repaired by the same metadata step"
        );
      });
    });

    it("repairs a metadata-less row through the owning user's account", async () => {
      await inRolledBackTransaction(async (tx) => {
        const fixture = await seedFixture(tx, "join");

        await runBackfill(tx);

        assert.strictEqual(
          await readAccountId(tx, fixture.joinMappableId),
          fixture.accountId,
          "the join resolves CustomerUser.id to CustomerUser.accountId"
        );
      });
    });

    it("sentinels an unmappable terminal row instead of deleting it or keeping the bad value", async () => {
      await inRolledBackTransaction(async (tx) => {
        const fixture = await seedFixture(tx, "terminal");

        const sentinelCandidates = await tx.sagaInstance.count({
          where: {
            accountId: fixture.orphanValue,
            status: { in: [...TERMINAL_STATES] },
          },
        });
        assert.strictEqual(sentinelCandidates, 1, "exactly one row enters the sentinel class");

        await runBackfill(tx);

        assert.strictEqual(
          await readAccountId(tx, fixture.terminalUnmappableId),
          null,
          "the documented sentinel is NULL, never a fabricated account-looking value"
        );
        const survivors = await tx.sagaInstance.count({
          where: { id: fixture.terminalUnmappableId },
        });
        assert.strictEqual(survivors, 1, "an unmappable terminal row is never deleted");
        const stillOrphaned = await tx.sagaInstance.count({
          where: { accountId: fixture.orphanValue },
        });
        assert.strictEqual(stillOrphaned, 0, "no row keeps the unmappable value");
      });
    });

    it("leaves the table with no non-tenant value and the same number of rows", async () => {
      await inRolledBackTransaction(async (tx) => {
        await seedFixture(tx, "sweep");

        const before = await tx.sagaInstance.count();
        await runBackfill(tx);
        const after = await tx.sagaInstance.count();

        assert.strictEqual(after, before, "the repair neither adds nor removes a row");

        const [totals] = await tx.$queryRaw<
          { user_valued: bigint; not_an_account: bigint }[]
        >`SELECT
            count(*) FILTER (WHERE "accountId" IN (SELECT id FROM "CustomerUser")) AS user_valued,
            count(*) FILTER (
              WHERE "accountId" IS NOT NULL AND "accountId" NOT IN (SELECT id FROM "Account")
            ) AS not_an_account
          FROM "SagaInstance"`;

        assert.strictEqual(
          Number(totals?.user_valued),
          0,
          "no row may still be keyed on a CustomerUser.id"
        );
        assert.strictEqual(
          Number(totals?.not_an_account),
          0,
          "every surviving non-null value names a real Account"
        );
      });
    });
  });

  describe("re-running the migration", () => {
    it("writes nothing on a second pass over already-repaired rows", async () => {
      await inRolledBackTransaction(async (tx) => {
        const fixture = await seedFixture(tx, "idem");

        await runBackfill(tx);

        const ids = [
          fixture.metadataCorruptedId,
          fixture.metadataNullId,
          fixture.joinMappableId,
          fixture.terminalUnmappableId,
        ];
        const afterFirst = await tx.sagaInstance.findMany({
          where: { id: { in: ids } },
          orderBy: { id: "asc" },
          select: { id: true, accountId: true, status: true, updatedAt: true },
        });
        assert.strictEqual(afterFirst.length, 4, "all four classes survive the first pass");

        await runBackfill(tx);

        const afterSecond = await tx.sagaInstance.findMany({
          where: { id: { in: ids } },
          orderBy: { id: "asc" },
          select: { id: true, accountId: true, status: true, updatedAt: true },
        });

        assert.deepStrictEqual(
          afterSecond,
          afterFirst,
          "an idempotent re-run touches no row — unchanged updatedAt proves no write occurred"
        );
      });
    });
  });

  describe("an unmappable row that is still live", () => {
    it("halts the migration, names the offending ids, and commits nothing", async () => {
      // Seeded OUTSIDE the scenario transaction: proving "no partial backfill
      // committed" requires rows that survive the aborted transaction so their
      // untouched values can be read back afterwards.
      const suffix = "halt";
      const account = await base.account.create({
        data: {
          name: `${TAG}-${suffix}`,
          email: `${TAG}-${suffix}-${randomUUID()}@test.local`,
          slug: `${TAG}-${suffix}-${randomUUID()}`,
        },
      });
      const customerUser = await base.customerUser.create({
        data: {
          accountId: account.id,
          email: `${TAG}-${suffix}-user-${randomUUID()}@test.local`,
          passwordHash: "ignored-for-test",
          firstName: "Backfill",
          lastName: "Halt",
        },
      });

      const mappableId = `${TAG}-${suffix}-mappable-${randomUUID()}`;
      const liveOrphanIdA = `${TAG}-${suffix}-live-orphan-a-${randomUUID()}`;
      const liveOrphanIdB = `${TAG}-${suffix}-live-orphan-b-${randomUUID()}`;
      const seededIds = [mappableId, liveOrphanIdA, liveOrphanIdB];

      try {
        await base.sagaInstance.create({
          data: {
            id: mappableId,
            definitionId: "post-publishing-saga",
            status: "RUNNING",
            accountId: customerUser.id,
            context: buildContext(customerUser.id, account.id),
          },
        });
        await base.sagaInstance.create({
          data: {
            id: liveOrphanIdA,
            definitionId: "post-publishing-saga",
            status: "RUNNING",
            accountId: `orphan-${randomUUID()}`,
            context: buildContext("gone"),
          },
        });
        await base.sagaInstance.create({
          data: {
            id: liveOrphanIdB,
            definitionId: "post-publishing-saga",
            status: "PENDING",
            accountId: null,
            context: buildContext(""),
          },
        });

        await assert.rejects(
          () =>
            base.$transaction(
              async (tx) => {
                await runBackfill(tx);
              },
              { timeout: 120_000, maxWait: 30_000 }
            ),
          (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            assert.match(
              message,
              /non-terminal row\(s\) with no mappable tenant/,
              "the abort explains why a live saga cannot be guessed"
            );
            assert.ok(
              message.includes(liveOrphanIdA),
              "the abort names the first offending saga id for the operator"
            );
            assert.ok(
              message.includes(liveOrphanIdB),
              "the abort names every offending saga id, not just the first"
            );
            return true;
          }
        );

        const mappable = await base.sagaInstance.findUniqueOrThrow({ where: { id: mappableId } });
        assert.strictEqual(
          mappable.accountId,
          customerUser.id,
          "the mappable row keeps its pre-migration value — no partial backfill was committed"
        );
      } finally {
        await base.sagaInstance.deleteMany({ where: { id: { in: seededIds } } });
        await base.customerUser.deleteMany({ where: { id: customerUser.id } });
        await base.account.deleteMany({ where: { id: account.id } });
      }
    });
  });

  describe("the deploy criterion on this database", () => {
    it("records the backfill as an applied, non-rolled-back migration", async () => {
      const rows = await base.$queryRaw<
        { finished_at: Date | null; rolled_back_at: Date | null; applied_steps_count: number }[]
      >`SELECT finished_at, rolled_back_at, applied_steps_count
          FROM "_prisma_migrations"
         WHERE migration_name = ${MIGRATION_NAME}`;

      assert.strictEqual(rows.length, 1, "the backfill must appear once in the applied history");
      assert.notStrictEqual(rows[0]?.finished_at, null, "the migration must have finished");
      assert.strictEqual(rows[0]?.rolled_back_at, null, "the migration must not be rolled back");
      assert.ok(
        Number(rows[0]?.applied_steps_count) > 0,
        "the applied history must record the executed steps"
      );
    });

    it("leaves every row it repaired either on a real Account or on the NULL sentinel", async () => {
      // Scoped to the rows the migration is accountable for: those it could
      // see when it ran. `updatedAt` is set by the Prisma client, never by raw
      // SQL (verified against the schema — the column has no default and no
      // trigger), so every row the migration touched or deliberately skipped
      // still carries a timestamp older than its `finished_at`. Anything newer
      // was written by application code afterwards — the cutover-gap class the
      // migration header documents, whose remedy is a manual idempotent re-run,
      // not a migration defect. While the migration is unapplied `finished_at`
      // is absent and the window collapses to "now", so every row counts.
      const [totals] = await base.$queryRaw<
        { total: bigint; user_valued: bigint; not_an_account: bigint; sentinel: bigint }[]
      >`SELECT
          count(*) AS total,
          count(*) FILTER (WHERE "accountId" IN (SELECT id FROM "CustomerUser")) AS user_valued,
          count(*) FILTER (
            WHERE "accountId" IS NOT NULL AND "accountId" NOT IN (SELECT id FROM "Account")
          ) AS not_an_account,
          count(*) FILTER (WHERE "accountId" IS NULL) AS sentinel
        FROM "SagaInstance"
        WHERE "updatedAt" < COALESCE(
          (SELECT finished_at FROM "_prisma_migrations" WHERE migration_name = ${MIGRATION_NAME}),
          now()
        )`;

      assert.strictEqual(
        Number(totals?.user_valued),
        0,
        "zero repaired rows may hold a CustomerUser.id"
      );
      assert.strictEqual(
        Number(totals?.not_an_account),
        0,
        "zero repaired rows may hold a value that is not an Account"
      );

      const [mapped] = await base.$queryRaw<
        { mapped: bigint }[]
      >`SELECT count(*) FILTER (WHERE "accountId" IN (SELECT id FROM "Account")) AS mapped
          FROM "SagaInstance"
         WHERE "updatedAt" < COALESCE(
           (SELECT finished_at FROM "_prisma_migrations" WHERE migration_name = ${MIGRATION_NAME}),
           now()
         )`;

      assert.strictEqual(
        Number(mapped?.mapped) + Number(totals?.sentinel),
        Number(totals?.total),
        "every repaired row is dispositioned: a real Account or the documented NULL sentinel"
      );
    });
  });
});
