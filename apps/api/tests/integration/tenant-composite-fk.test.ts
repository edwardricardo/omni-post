/**
 * @file tenant-composite-fk.test.ts
 * @description Real-database proof that the `Post` / `PostContent` / `PostMedia`
 *   tenant key is enforced by PostgreSQL itself — not by the application, not by
 *   the Prisma tenant guard, and not by row security.
 *
 *   ## What this suite is for
 *
 *   The guard and the RLS policy are both CONFIGURATION: a model missing from
 *   the guard's model set, or a role that bypasses row security, silently
 *   removes them. A composite foreign key is STRUCTURE — the engine refuses the
 *   write regardless of who is connected or what middleware is loaded. This
 *   suite measures that difference directly, which is why it deliberately runs
 *   its writes on the OWNER channel: a role that bypasses row security is the
 *   adversarial case for the claim "this holds independently of RLS".
 *
 *   ## Why raw SQL
 *
 *   Every write goes through raw SQL and the fixture helpers, so the file
 *   compiles both before the tenant column exists and after it becomes
 *   required. See `helpers/postTrioFixtures.ts` for the full reasoning.
 *
 *   ## Reading a failure
 *
 *   Assertions name the SQLSTATE they expect. Before the migration lands the
 *   engine answers `42703 undefined_column` (there is no `accountId` to
 *   diverge) instead of `23503 foreign_key_violation`; the assertion messages
 *   print the observed code and message verbatim so the distance between "the
 *   constraint refused this" and "the column does not exist" is visible in the
 *   run output rather than inferred.
 *
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@infra/prisma";
import { assertSeedChannelConfigured, createSeedPrismaClient } from "./helpers/seedPrismaClient.js";
import {
  countRows,
  deleteAccountsCascade,
  describeError,
  insertAccount,
  insertPost,
  insertPostContent,
  insertPostMedia,
  insertProject,
  readTrioTenantColumns,
  sqlStateOf,
  type TrioTenantColumns,
} from "./helpers/postTrioFixtures.js";

// Fail FAST, at module scope, when the harness env is missing. Run by hand without
// the root env sourced, the seed-channel error used to surface from inside `before`
// and node:test cancelled all children — a misconfiguration that read as 18 tests
// that "did not finish". Resolving here means no test is registered to cancel.
assertSeedChannelConfigured();

const TAG = `tif-fk-${Date.now()}`;

/** PostgreSQL SQLSTATEs this suite distinguishes between. */
const FOREIGN_KEY_VIOLATION = "23503";
const NOT_NULL_VIOLATION = "23502";
const UNIQUE_VIOLATION = "23505";

/**
 * Captures the error a write raises, or `undefined` when it unexpectedly
 * succeeded. Returning rather than asserting lets each test phrase its own
 * failure message with the observed code included.
 */
async function captureError(write: () => Promise<unknown>): Promise<unknown> {
  try {
    await write();
    return undefined;
  } catch (error) {
    return error;
  }
}

/**
 * Asserts a write was refused by PostgreSQL with the expected SQLSTATE, and
 * names what actually happened when it was not.
 */
function assertRefusedWith(error: unknown, expected: string, what: string): void {
  assert.ok(
    error !== undefined,
    `${what}: expected PostgreSQL to refuse the write with SQLSTATE ${expected}, but it SUCCEEDED`
  );
  const observed = sqlStateOf(error);
  assert.strictEqual(
    observed,
    expected,
    `${what}: expected SQLSTATE ${expected}, observed ${describeError(error)}`
  );
}

describe("Post trio composite foreign key — engine-enforced tenant integrity", () => {
  let prisma: PrismaClient;
  let columns: TrioTenantColumns;

  // Two tenants, each with one project. Tenant A additionally owns a post with
  // one content row and one media row.
  let accountA: string;
  let accountB: string;
  let projectA: string;
  let projectB: string;
  let postA: string;

  // Control counts, read before the fixtures exist and re-read after cleanup.
  const controlBefore: Record<string, number> = {};

  // Every account this suite creates, tracked so teardown owns cleanup outright.
  // A test that fails part-way never reaches its own cleanup line, so cleanup
  // written inside a test body leaks exactly when the suite is red — which is
  // the state this suite is authored in.
  const trackedAccounts: string[] = [];

  /** Inserts an account and records it for teardown. */
  async function trackedAccount(tag: string): Promise<string> {
    const id = await insertAccount(prisma, { tag });
    trackedAccounts.push(id);
    return id;
  }

  before(async () => {
    prisma = createSeedPrismaClient();
    columns = await readTrioTenantColumns(prisma);

    for (const table of ["Account", "Project", "Post", "PostContent", "PostMedia"]) {
      controlBefore[table] = await countRows(prisma, table);
    }

    accountA = await trackedAccount(`${TAG}-a`);
    accountB = await trackedAccount(`${TAG}-b`);
    projectA = await insertProject(prisma, { accountId: accountA, name: `${TAG}-project-a` });
    projectB = await insertProject(prisma, { accountId: accountB, name: `${TAG}-project-b` });
    postA = await insertPost(prisma, columns, { projectId: projectA, accountId: accountA });
    await insertPostContent(prisma, columns, {
      postId: postA,
      accountId: accountA,
      body: `${TAG}-body-a`,
    });
    await insertPostMedia(prisma, columns, {
      postId: postA,
      accountId: accountA,
      url: `https://cdn.test.local/${TAG}-a.png`,
    });
  });

  after(async () => {
    await deleteAccountsCascade(prisma, trackedAccounts);
    for (const table of ["Account", "Project", "Post", "PostContent", "PostMedia"]) {
      const now = await countRows(prisma, table);
      assert.strictEqual(
        now,
        controlBefore[table],
        `${table}: the suite must leave the database as it found it ` +
          `(before=${controlBefore[table]}, after=${now})`
      );
    }
    await prisma.$disconnect();
  });

  describe("the structural preconditions the guarantee rests on", () => {
    it("Post, PostContent and PostMedia each carry a NOT NULL accountId column", async () => {
      const rows = await prisma.$queryRaw<Array<{ table_name: string; is_nullable: string }>>`
        SELECT table_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('Post', 'PostContent', 'PostMedia')
          AND column_name = 'accountId'
        ORDER BY table_name`;
      const shape = rows.map((row) => `${row.table_name}:${row.is_nullable}`).sort();
      assert.deepStrictEqual(
        shape,
        ["Post:NO", "PostContent:NO", "PostMedia:NO"],
        `expected a NOT NULL accountId on all three tables, observed ${JSON.stringify(shape)}. ` +
          `A nullable referencing column would reopen the MATCH SIMPLE escape: PostgreSQL ` +
          `skips a composite FK check whenever any referencing column is NULL.`
      );
    });

    it("Project and Post each carry a TOTAL unique on (id, accountId)", async () => {
      const rows = await prisma.$queryRaw<Array<{ tablename: string; indexdef: string }>>`
        SELECT tablename, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename IN ('Project', 'Post')
          AND indexdef LIKE '%UNIQUE%'
          AND indexdef LIKE '%accountId%'
          AND indexdef LIKE '%(id,%'`;
      const tables = rows.map((row) => row.tablename).sort();
      assert.deepStrictEqual(
        tables,
        ["Post", "Project"],
        `expected a unique on (id, accountId) for both Project and Post, observed ` +
          `${JSON.stringify(tables)}. These are the FK TARGETS, and PostgreSQL requires a ` +
          `NON-PARTIAL unique index to reference — a partial unique cannot serve.`
      );
      for (const row of rows) {
        assert.ok(
          !row.indexdef.includes(" WHERE "),
          `${row.tablename}: the (id, accountId) unique must be TOTAL, not partial — ` +
            `children referencing a soft-deleted parent still need their FK target. ` +
            `Observed: ${row.indexdef}`
        );
      }
    });

    // The referential ACTIONS are read from `pg_constraint`'s own codes rather
    // than matched in the text of `pg_get_constraintdef`. That is not a
    // convenience: PostgreSQL OMITS a clause whose value is the default, so a
    // constraint created `ON UPDATE NO ACTION` renders with no ON UPDATE clause
    // at all, and a substring test for "ON UPDATE NO ACTION" can never pass no
    // matter how correct the constraint is. Measured here: `confupdtype='a'`
    // (no action) with `def` = `... REFERENCES "Project"(id, "accountId") ON
    // DELETE CASCADE`. The codes are the canonical value; the text is a
    // rendering of it, and this arm now asserts the value.
    it("each trio child's FK is composite and pinned to ON UPDATE NO ACTION / ON DELETE CASCADE", async () => {
      const rows = await prisma.$queryRaw<
        Array<{ table: string; def: string; onupdate: string; ondelete: string }>
      >`
        SELECT conrelid::regclass::text AS "table",
               pg_get_constraintdef(oid) AS def,
               confupdtype::text AS onupdate,
               confdeltype::text AS ondelete
        FROM pg_constraint
        WHERE contype = 'f'
          AND conrelid IN ('"Post"'::regclass, '"PostContent"'::regclass, '"PostMedia"'::regclass)
          AND pg_get_constraintdef(oid) LIKE '%accountId%'
        ORDER BY 1`;
      const tables = rows.map((row) => row.table.replaceAll('"', "")).sort();
      assert.deepStrictEqual(
        tables,
        ["Post", "PostContent", "PostMedia"],
        `expected a composite tenant FK on all three tables, observed ${JSON.stringify(tables)}`
      );
      for (const row of rows) {
        // 'a' = NO ACTION, 'c' = CASCADE, 'r' = RESTRICT, 'n' = SET NULL,
        // 'd' = SET DEFAULT (pg_constraint.confupdtype / confdeltype).
        assert.strictEqual(
          row.onupdate,
          "a",
          `${row.table}: ON UPDATE must be NO ACTION ('a'), not the Prisma default CASCADE — ` +
            `under CASCADE, re-pointing a parent's accountId would silently rewrite every ` +
            `child's tenant key. Observed confupdtype='${row.onupdate}', def: ${row.def}`
        );
        assert.strictEqual(
          row.ondelete,
          "c",
          `${row.table}: ON DELETE must be CASCADE ('c') per the owned-child convention. ` +
            `Observed confdeltype='${row.ondelete}', def: ${row.def}`
        );
      }
    });

    it("every composite tenant FK is VALIDATED, so the guarantee covers historical rows", async () => {
      const rows = await prisma.$queryRaw<Array<{ table: string; name: string; valid: boolean }>>`
        SELECT conrelid::regclass::text AS "table", conname AS name, convalidated AS valid
        FROM pg_constraint
        WHERE contype = 'f'
          AND conrelid IN ('"Post"'::regclass, '"PostContent"'::regclass, '"PostMedia"'::regclass)
          AND pg_get_constraintdef(oid) LIKE '%accountId%'
        ORDER BY 1`;
      assert.ok(rows.length > 0, "no composite tenant FK exists to validate");
      const notValidated = rows.filter((row) => !row.valid).map((row) => row.name);
      assert.deepStrictEqual(
        notValidated,
        [],
        `these constraints are still NOT VALID: ${JSON.stringify(notValidated)}. A NOT VALID ` +
          `constraint is live for NEW writes only — the guarantee would be forward-only and ` +
          `must never be reported as covering existing rows.`
      );
    });
  });

  describe("a divergent tenant key is refused by the engine", () => {
    it("refuses a Post whose accountId disagrees with its project's, via the Prisma client", async () => {
      const id = randomUUID();
      const error = await captureError(() =>
        prisma.$executeRawUnsafe(
          `INSERT INTO "Post" (id, "projectId", "accountId", status, "updatedAt")
           VALUES ($1, $2, $3, 'DRAFT', NOW())`,
          id,
          projectA,
          accountB
        )
      );
      assertRefusedWith(
        error,
        FOREIGN_KEY_VIOLATION,
        "Post insert naming tenant B against tenant A's project"
      );
      const survivors = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "Post" WHERE id = $1`,
        id
      );
      assert.strictEqual(survivors.length, 0, "the refused row must not have persisted");
    });

    it("refuses the same divergent Post inside an explicit transaction", async () => {
      const id = randomUUID();
      const error = await captureError(() =>
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `INSERT INTO "Post" (id, "projectId", "accountId", status, "updatedAt")
             VALUES ($1, $2, $3, 'DRAFT', NOW())`,
            id,
            projectA,
            accountB
          );
        })
      );
      assertRefusedWith(
        error,
        FOREIGN_KEY_VIOLATION,
        "Post insert naming tenant B inside an explicit transaction"
      );
      const survivors = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "Post" WHERE id = $1`,
        id
      );
      assert.strictEqual(survivors.length, 0, "the transaction must have rolled back");
    });

    it("refuses a divergent Post written as direct SQL with no client mediation", async () => {
      const id = randomUUID();
      const error = await captureError(() =>
        prisma.$executeRawUnsafe(
          `INSERT INTO "Post" (id, "projectId", "accountId", status, "updatedAt")
           SELECT $1, $2, $3, 'DRAFT', NOW()`,
          id,
          projectB,
          accountA
        )
      );
      assertRefusedWith(
        error,
        FOREIGN_KEY_VIOLATION,
        "direct-SQL Post insert naming tenant A against tenant B's project"
      );
    });

    // Locale 'de', not the fixture's 'en'. The suite seeds one content row for
    // postA at ('en', revision 1), and `PostContent_postId_locale_revision_key`
    // is unique over exactly that triple — so an 'en' row here was refused with
    // 23505 by the UNIQUE index before the foreign key was ever consulted. The
    // arm passed for the wrong constraint's reason, which is no evidence at all
    // about the tenant key. A distinct locale leaves the divergent accountId as
    // the only thing wrong with the row, so 23503 is the only refusal available.
    it("refuses a PostContent whose accountId disagrees with its post's", async () => {
      const id = randomUUID();
      const error = await captureError(() =>
        prisma.$executeRawUnsafe(
          `INSERT INTO "PostContent" (id, "postId", "accountId", locale, body, tags, "updatedAt")
           VALUES ($1, $2, $3, 'de', 'divergent', ARRAY[]::text[], NOW())`,
          id,
          postA,
          accountB
        )
      );
      assertRefusedWith(error, FOREIGN_KEY_VIOLATION, "PostContent insert naming a foreign tenant");
    });

    it("refuses a PostMedia whose accountId disagrees with its post's", async () => {
      const id = randomUUID();
      const error = await captureError(() =>
        prisma.$executeRawUnsafe(
          `INSERT INTO "PostMedia" (id, "postId", "accountId", url, type)
           VALUES ($1, $2, $3, $4, 'image'::"MediaKind")`,
          id,
          postA,
          accountB,
          `https://cdn.test.local/${TAG}-divergent.png`
        )
      );
      assertRefusedWith(error, FOREIGN_KEY_VIOLATION, "PostMedia insert naming a foreign tenant");
    });

    it("accepts a consistent write on every trio table", async () => {
      const postId = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Post" (id, "projectId", "accountId", status, "updatedAt")
         VALUES ($1, $2, $3, 'DRAFT', NOW())`,
        postId,
        projectA,
        accountA
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PostContent" (id, "postId", "accountId", locale, body, tags, "updatedAt")
         VALUES ($1, $2, $3, 'en', 'consistent', ARRAY[]::text[], NOW())`,
        randomUUID(),
        postId,
        accountA
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PostMedia" (id, "postId", "accountId", url, type)
         VALUES ($1, $2, $3, $4, 'image'::"MediaKind")`,
        randomUUID(),
        postId,
        accountA,
        `https://cdn.test.local/${TAG}-consistent.png`
      );
      const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "Post" WHERE id = $1`,
        postId
      );
      assert.strictEqual(rows.length, 1, "a tenant-consistent write must be accepted");
    });
  });

  describe("the MATCH SIMPLE escape stays closed for these tables", () => {
    it("refuses a Post with a NULL accountId on NOT NULL, never silently skipping the FK check", async () => {
      const error = await captureError(() =>
        prisma.$executeRawUnsafe(
          `INSERT INTO "Post" (id, "projectId", "accountId", status, "updatedAt")
           VALUES ($1, $2, NULL, 'DRAFT', NOW())`,
          randomUUID(),
          projectA
        )
      );
      assertRefusedWith(
        error,
        NOT_NULL_VIOLATION,
        "Post insert with a NULL tenant key. PostgreSQL's default MATCH SIMPLE skips a " +
          "composite FK check when ANY referencing column is NULL, so NOT NULL is what " +
          "forecloses it — the FK alone would let this row through unchecked"
      );
    });

    it("refuses a PostContent with a NULL accountId on NOT NULL", async () => {
      const error = await captureError(() =>
        prisma.$executeRawUnsafe(
          `INSERT INTO "PostContent" (id, "postId", "accountId", locale, body, tags, "updatedAt")
           VALUES ($1, $2, NULL, 'en', 'null-tenant', ARRAY[]::text[], NOW())`,
          randomUUID(),
          postA
        )
      );
      assertRefusedWith(error, NOT_NULL_VIOLATION, "PostContent insert with a NULL tenant key");
    });

    it("refuses a PostMedia with a NULL accountId on NOT NULL", async () => {
      const error = await captureError(() =>
        prisma.$executeRawUnsafe(
          `INSERT INTO "PostMedia" (id, "postId", "accountId", url, type)
           VALUES ($1, $2, NULL, $3, 'image'::"MediaKind")`,
          randomUUID(),
          postA,
          `https://cdn.test.local/${TAG}-null.png`
        )
      );
      assertRefusedWith(error, NOT_NULL_VIOLATION, "PostMedia insert with a NULL tenant key");
    });
  });

  describe("the refusal is independent of row security", () => {
    it("holds on a connection whose role bypasses row security", async () => {
      const roles = await prisma.$queryRaw<Array<{ bypass: boolean; superuser: boolean }>>`
        SELECT rolbypassrls AS bypass, rolsuper AS superuser
        FROM pg_roles WHERE rolname = current_user`;
      const role = roles[0];
      assert.ok(role !== undefined, "could not read the connecting role's attributes");
      assert.ok(
        role.bypass || role.superuser,
        "this test is only meaningful on a bypassing connection: it exists to show the FK " +
          "refuses a divergent write even where row security is switched off entirely. The " +
          "harness seeds on the OWNER channel precisely so this arm has that property; if the " +
          "owner channel stops bypassing, re-point this test rather than deleting it."
      );

      const error = await captureError(() =>
        prisma.$executeRawUnsafe(
          `INSERT INTO "Post" (id, "projectId", "accountId", status, "updatedAt")
           VALUES ($1, $2, $3, 'DRAFT', NOW())`,
          randomUUID(),
          projectB,
          accountA
        )
      );
      assertRefusedWith(
        error,
        FOREIGN_KEY_VIOLATION,
        "divergent Post insert on a row-security-bypassing role. This is the claim the whole " +
          "slice rests on: the composite FK is STRUCTURE, so a bypassing role does not weaken it"
      );
    });
  });

  describe("soft delete and the tenant key coexist", () => {
    it("a child survives its parent project being soft-deleted", async () => {
      const accountId = await trackedAccount(`${TAG}-soft`);
      const projectId = await insertProject(prisma, { accountId, name: `${TAG}-soft-project` });
      const postId = await insertPost(prisma, columns, { projectId, accountId });

      await prisma.$executeRawUnsafe(
        `UPDATE "Project" SET "deletedAt" = NOW() WHERE id = $1`,
        projectId
      );

      const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "Post" WHERE id = $1`,
        postId
      );
      assert.strictEqual(
        rows.length,
        1,
        "soft delete is a column update, not a DELETE, so ON DELETE CASCADE must not fire and " +
          "the child's FK target must still exist — which is why the (id, accountId) unique is " +
          "TOTAL rather than filtered on deletedAt"
      );
    });

    it("the partial soft-delete uniques still reject live duplicates and allow reuse after soft delete", async () => {
      const email = `${TAG}-reuse-${randomUUID()}@test.local`;
      const firstId = randomUUID();
      trackedAccounts.push(firstId);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Account" (id, email, name, slug, "updatedAt")
         VALUES ($1, $2, $3, $4, NOW())`,
        firstId,
        email,
        `${TAG}-reuse`,
        `${TAG}-reuse-${firstId}`
      );

      const secondId = randomUUID();
      trackedAccounts.push(secondId);
      const duplicate = await captureError(() =>
        prisma.$executeRawUnsafe(
          `INSERT INTO "Account" (id, email, name, slug, "updatedAt")
           VALUES ($1, $2, $3, $4, NOW())`,
          secondId,
          email,
          `${TAG}-reuse-2`,
          `${TAG}-reuse-${secondId}`
        )
      );
      assertRefusedWith(duplicate, UNIQUE_VIOLATION, "a second LIVE account on the same email");

      await prisma.$executeRawUnsafe(
        `UPDATE "Account" SET "deletedAt" = NOW() WHERE id = $1`,
        firstId
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Account" (id, email, name, slug, "updatedAt")
         VALUES ($1, $2, $3, $4, NOW())`,
        secondId,
        email,
        `${TAG}-reuse-2`,
        `${TAG}-reuse-${secondId}`
      );
    });

    it("the Project(accountId, name) partial unique still rejects live duplicates and allows reuse after soft delete", async () => {
      const accountId = await trackedAccount(`${TAG}-pname`);
      const name = `${TAG}-duplicate-name`;
      const firstId = await insertProject(prisma, { accountId, name });

      const duplicate = await captureError(() =>
        prisma.$executeRawUnsafe(
          `INSERT INTO "Project" (id, "accountId", name, "updatedAt")
           VALUES ($1, $2, $3, NOW())`,
          randomUUID(),
          accountId,
          name
        )
      );
      assertRefusedWith(
        duplicate,
        UNIQUE_VIOLATION,
        "a second LIVE project on the same (accountId, name)"
      );

      await prisma.$executeRawUnsafe(
        `UPDATE "Project" SET "deletedAt" = NOW() WHERE id = $1`,
        firstId
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Project" (id, "accountId", name, "updatedAt")
         VALUES ($1, $2, $3, NOW())`,
        randomUUID(),
        accountId,
        name
      );
    });
  });

  describe("a parent's tenant key cannot be quietly re-pointed", () => {
    it("refuses a project accountId update while posts reference it", async () => {
      const error = await captureError(() =>
        prisma.$executeRawUnsafe(
          `UPDATE "Project" SET "accountId" = $1 WHERE id = $2`,
          accountB,
          projectA
        )
      );
      assertRefusedWith(
        error,
        FOREIGN_KEY_VIOLATION,
        "moving a project to another tenant while its posts reference it. ON UPDATE NO ACTION " +
          "is what makes this loud: under the Prisma default CASCADE the update would succeed " +
          "and silently rewrite every child's tenant key, which is exactly the quiet " +
          "cross-tenant move this pin exists to prevent"
      );

      const rows = await prisma.$queryRawUnsafe<Array<{ accountId: string }>>(
        `SELECT "accountId" FROM "Project" WHERE id = $1`,
        projectA
      );
      assert.strictEqual(
        rows[0]?.accountId,
        accountA,
        "the refused update must have left the project in its original tenant"
      );
    });
  });
});
