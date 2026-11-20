/**
 * @file scratchDatabaseEmptying.integration.test.ts
 * @description The statement a migrated scratch database is emptied with, run on two databases of
 *              the suite's own, created empty on the owner channel's server and never migrated, so
 *              the suite takes seconds. Each case first recreates the same tables there: two joined
 *              by a foreign key, one whose column owns a sequence, and Prisma's record of migrations,
 *              each with rows. The statement removes every row in one command but the record's,
 *              starts the sequence again, and on a connection of any other database raises, names
 *              both databases and removes nothing.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { assertSeedChannelConfigured, resolveSeedDatabaseUrl } from "./helpers/seedPrismaClient.js";
import { emptyingStatement, urlOfDatabase } from "./helpers/migratedScratchDatabase.js";

assertSeedChannelConfigured();

/** Budget for each hook in this file: creating or dropping a database. */
const HOOK_TIMING = { timeout: 60_000 } as const;

/** The tables each case starts from, with their rows, one statement each. */
const FIXTURE = [
  `DROP TABLE IF EXISTS child, parent, numbered, fresh, "_prisma_migrations"`,
  `CREATE TABLE parent (id integer PRIMARY KEY)`,
  `CREATE TABLE child (id integer PRIMARY KEY, "parentId" integer NOT NULL REFERENCES parent (id))`,
  `CREATE TABLE numbered (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, label text)`,
  `CREATE TABLE "_prisma_migrations" (id text PRIMARY KEY)`,
  `INSERT INTO parent (id) VALUES (1)`,
  `INSERT INTO child (id, "parentId") VALUES (1, 1)`,
  `INSERT INTO numbered (label) VALUES ('first'), ('second'), ('third')`,
  `INSERT INTO "_prisma_migrations" (id) VALUES ('applied')`,
] as const;

/** How many rows each table of the fixture holds. */
interface RowCounts {
  readonly parent: number;
  readonly child: number;
  readonly numbered: number;
  readonly migrations: number;
}

/** The rows the fixture writes, which a statement that removes nothing leaves. */
const FIXTURE_ROWS: RowCounts = { parent: 1, child: 1, numbered: 3, migrations: 1 };

/** A database name carrying `prefix` and a random suffix, so no two runs share one. */
function scratchName(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

/** Recreates the fixture's tables and rows on `client`'s database. */
async function writeFixture(client: PrismaClient): Promise<void> {
  for (const statement of FIXTURE) {
    await client.$executeRawUnsafe(statement);
  }
}

/** How many rows each table of the fixture holds on `client`'s database. */
async function rowCounts(client: PrismaClient): Promise<RowCounts> {
  const [row] = await client.$queryRawUnsafe<
    Array<{ parent: bigint; child: bigint; numbered: bigint; migrations: bigint }>
  >(
    `SELECT (SELECT count(*) FROM parent) AS parent,
            (SELECT count(*) FROM child) AS child,
            (SELECT count(*) FROM numbered) AS numbered,
            (SELECT count(*) FROM "_prisma_migrations") AS migrations`
  );
  return {
    parent: Number(row?.parent ?? -1),
    child: Number(row?.child ?? -1),
    numbered: Number(row?.numbered ?? -1),
    migrations: Number(row?.migrations ?? -1),
  };
}

/** The number the identity column of `table` generates for one new row. */
async function nextNumber(client: PrismaClient, table: "numbered" | "fresh"): Promise<number> {
  const [row] = await client.$queryRawUnsafe<Array<{ id: number }>>(
    `INSERT INTO ${table} (label) VALUES ('after') RETURNING id`
  );
  return row?.id ?? -1;
}

describe("The statement that empties a migrated scratch database", { concurrency: 1 }, () => {
  const ownerUrl = resolveSeedDatabaseUrl();
  const owner = createTestPrismaClient(ownerUrl);
  const target = scratchName("omnipost_emptying");
  const other = scratchName("omnipost_emptying_other");
  let targetClient: PrismaClient | undefined;
  let otherClient: PrismaClient | undefined;

  before(async () => {
    await owner.$executeRawUnsafe(`CREATE DATABASE "${target}"`);
    await owner.$executeRawUnsafe(`CREATE DATABASE "${other}"`);
    targetClient = createTestPrismaClient(urlOfDatabase(ownerUrl, target));
    otherClient = createTestPrismaClient(urlOfDatabase(ownerUrl, other));
  }, HOOK_TIMING);

  after(async () => {
    await targetClient?.$disconnect();
    await otherClient?.$disconnect();
    await owner.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`);
    await owner.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${other}" WITH (FORCE)`);
    await owner.$disconnect();
  }, HOOK_TIMING);

  /** The client of `database`'s own name, holding the fixture's tables and rows. */
  async function withFixture(database: "target" | "other"): Promise<PrismaClient> {
    const client = database === "target" ? targetClient : otherClient;
    assert.ok(client, `a client of the ${database} database was built`);
    await writeFixture(client);
    return client;
  }

  it("removes the rows of every table in one statement but the migrations' record", async () => {
    const client = await withFixture("target");

    await client.$executeRawUnsafe(emptyingStatement(target));

    assert.deepStrictEqual(await rowCounts(client), {
      parent: 0,
      child: 0,
      numbered: 0,
      migrations: 1,
    });
  });

  it("starts the sequences again, so a new row is numbered as in a fresh table", async () => {
    const client = await withFixture("target");

    await client.$executeRawUnsafe(emptyingStatement(target));
    const afterEmptying = await nextNumber(client, "numbered");
    await client.$executeRawUnsafe(
      `CREATE TABLE fresh (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, label text)`
    );

    assert.equal(afterEmptying, await nextNumber(client, "fresh"));
  });

  it("raises, naming both databases, and removes nothing on another database", async () => {
    const client = await withFixture("other");

    await assert.rejects(client.$executeRawUnsafe(emptyingStatement(target)), {
      message: new RegExp(`the emptying of ${target} ran on ${other}`),
    });
    assert.deepStrictEqual(await rowCounts(client), FIXTURE_ROWS);
  });
});
