/**
 * @file rls-tenant-isolation.test.ts
 * @description Integration test for the PostgreSQL Row Level Security
 *   policies installed by `20260527000000_add_rls_tenant_isolation`. Verifies
 *   that the `tenant_isolation` policy gates row visibility and mutation by
 *   the `app.account_id` GUC, the `__system__` sentinel bypasses tenant
 *   scope, and that an unset GUC fails-closed (zero rows visible).
 *
 *   ## Why a non-superuser role?
 *
 *   PostgreSQL superusers (and roles with BYPASSRLS) skip RLS entirely. The
 *   docker-compose default `postgres` user is a superuser, so Prisma's
 *   normal connection bypasses RLS. To exercise the actual production code
 *   path, this test creates a `rls_test_role` (NOSUPERUSER NOBYPASSRLS) and
 *   switches to it via `SET LOCAL ROLE` inside a Prisma transaction. The
 *   role switch is tx-scoped — RESET happens automatically on COMMIT/
 *   ROLLBACK, so the role exists only for the test's lifetime.
 *
 *   In production, the application role is non-superuser by design (per
 *   docs/security/MULTI_TENANT_GUARDS.md > migrations); this test is a
 *   forcing function for that property.
 *
 * @layer infrastructure
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@infra/prisma";

const ACCOUNT_A = `rls-test-acc-A-${Date.now()}`;
const ACCOUNT_B = `rls-test-acc-B-${Date.now()}`;
const TEST_TAG = "RLS_INTEGRATION";

describe("Row Level Security — tenant_isolation policy", () => {
  before(async () => {
    // Create a non-superuser role for RLS testing. Idempotent: ignore the
    // "role already exists" error so re-runs work.
    try {
      await prisma.$executeRawUnsafe("CREATE ROLE rls_test_role NOSUPERUSER NOBYPASSRLS NOINHERIT");
    } catch (err) {
      if (!(err as Error).message.includes("already exists")) throw err;
    }
    // Grant SELECT/INSERT/UPDATE/DELETE on the tenant-scoped tables we touch.
    // Just the subset used in this test — we don't need full schema grants.
    await prisma.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON
         "Project", "ApiKey", "MediaAsset", "AIPromptTemplate", "Account"
       TO rls_test_role`
    );

    // Seed: 2 accounts + 2 projects per account + 1 global AIPromptTemplate.
    // Done as superuser → bypasses RLS for seed phase.
    const now = Date.now();
    await prisma.account.createMany({
      data: [
        {
          id: ACCOUNT_A,
          name: `RLS-A-${TEST_TAG}`,
          email: `a-${now}@rls.test`,
          slug: `rls-a-${now}`,
        },
        {
          id: ACCOUNT_B,
          name: `RLS-B-${TEST_TAG}`,
          email: `b-${now}@rls.test`,
          slug: `rls-b-${now}`,
        },
      ],
      skipDuplicates: true,
    });
    await prisma.project.createMany({
      data: [
        { id: `${ACCOUNT_A}-proj-1`, accountId: ACCOUNT_A, name: "A1" },
        { id: `${ACCOUNT_A}-proj-2`, accountId: ACCOUNT_A, name: "A2" },
        { id: `${ACCOUNT_B}-proj-1`, accountId: ACCOUNT_B, name: "B1" },
        { id: `${ACCOUNT_B}-proj-2`, accountId: ACCOUNT_B, name: "B2" },
      ],
      skipDuplicates: true,
    });
    await prisma.aIPromptTemplate.create({
      data: {
        id: `global-tpl-${TEST_TAG}`,
        accountId: null,
        name: `Global RLS Test Template ${TEST_TAG}`,
        prompt: "test",
        category: "GENERAL",
        platforms: [],
        tone: [],
        variables: {},
        isSystem: true,
      },
    });
  });

  after(async () => {
    // Cleanup seed data + revoke role grants. Tear down the role itself last.
    await prisma.aIPromptTemplate
      .delete({ where: { id: `global-tpl-${TEST_TAG}` } })
      .catch(() => undefined);
    await prisma.project
      .deleteMany({ where: { accountId: { in: [ACCOUNT_A, ACCOUNT_B] } } })
      .catch(() => undefined);
    await prisma.account
      .deleteMany({ where: { id: { in: [ACCOUNT_A, ACCOUNT_B] } } })
      .catch(() => undefined);
    await prisma
      .$executeRawUnsafe(
        `REVOKE SELECT, INSERT, UPDATE, DELETE ON
           "Project", "ApiKey", "MediaAsset", "AIPromptTemplate", "Account"
         FROM rls_test_role`
      )
      .catch(() => undefined);
    // Don't DROP ROLE — re-runs are faster if it persists. It has no
    // grants left so it's inert.
    await prisma.$disconnect();
  });

  /**
   * Run a function inside a Prisma transaction with `SET LOCAL ROLE
   * rls_test_role`, optionally setting `app.account_id`. Returns whatever
   * the function returns. The role and the GUC are both tx-local and reset
   * on COMMIT/ROLLBACK.
   */
  async function asNonSuperuser<T>(
    accountIdSetting: string | null,
    fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE rls_test_role");
      if (accountIdSetting !== null) {
        await tx.$queryRaw`SELECT set_config('app.account_id', ${accountIdSetting}, true)`;
      }
      return fn(tx);
    });
  }

  describe("policy installed", () => {
    it("tenant_isolation policy exists on all 51 tenant-scoped tables", async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS count FROM pg_policies WHERE policyname = 'tenant_isolation'`
      );
      assert.strictEqual(Number(rows[0]!.count), 51);
    });

    it("Account (global) does NOT have RLS enabled", async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ rowsecurity: boolean }>>(
        `SELECT rowsecurity FROM pg_tables WHERE tablename = 'Account'`
      );
      assert.strictEqual(rows[0]?.rowsecurity, false);
    });

    it("Post (transitively scoped) does NOT have RLS enabled", async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ rowsecurity: boolean }>>(
        `SELECT rowsecurity FROM pg_tables WHERE tablename = 'Post'`
      );
      assert.strictEqual(rows[0]?.rowsecurity, false);
    });
  });

  describe("under non-superuser role", () => {
    it("returns 0 rows when app.account_id is unset (fail-closed)", async () => {
      const projects = await asNonSuperuser(null, async (tx) => {
        return tx.project.findMany({ where: { accountId: { in: [ACCOUNT_A, ACCOUNT_B] } } });
      });
      assert.strictEqual(projects.length, 0, "no setting → no rows");
    });

    it("returns only matching tenant's rows when app.account_id = accountA", async () => {
      const projects = await asNonSuperuser(ACCOUNT_A, async (tx) => {
        return tx.project.findMany({ where: { accountId: { in: [ACCOUNT_A, ACCOUNT_B] } } });
      });
      assert.strictEqual(projects.length, 2);
      assert.ok(projects.every((p) => p.accountId === ACCOUNT_A));
    });

    it("returns only matching tenant's rows when app.account_id = accountB", async () => {
      const projects = await asNonSuperuser(ACCOUNT_B, async (tx) => {
        return tx.project.findMany({ where: { accountId: { in: [ACCOUNT_A, ACCOUNT_B] } } });
      });
      assert.strictEqual(projects.length, 2);
      assert.ok(projects.every((p) => p.accountId === ACCOUNT_B));
    });

    it("returns all matching rows across tenants when app.account_id = __system__", async () => {
      const projects = await asNonSuperuser("__system__", async (tx) => {
        return tx.project.findMany({ where: { accountId: { in: [ACCOUNT_A, ACCOUNT_B] } } });
      });
      assert.strictEqual(projects.length, 4, "system bypass sees both tenants");
    });

    it("AIPromptTemplate: NULL accountId rows visible to any tenant context", async () => {
      const templates = await asNonSuperuser(ACCOUNT_A, async (tx) => {
        return tx.aIPromptTemplate.findMany({
          where: { id: `global-tpl-${TEST_TAG}` },
        });
      });
      assert.strictEqual(
        templates.length,
        1,
        "global system template (accountId=NULL) must be visible to any tenant"
      );
    });

    it("INSERT with mismatching accountId is rejected", async () => {
      await assert.rejects(
        asNonSuperuser(ACCOUNT_A, async (tx) => {
          return tx.apiKey.create({
            data: {
              id: randomUUID(),
              accountId: ACCOUNT_B, // mismatches the GUC
              name: "rls-test-key",
              keyHash: "x",
              prefix: "x",
            },
          });
        }),
        /row.*security|new row violates/i,
        "INSERT with wrong accountId must violate WITH CHECK"
      );
    });

    it("INSERT with matching accountId succeeds and cleanup removes it", async () => {
      const id = randomUUID();
      await asNonSuperuser(ACCOUNT_A, async (tx) => {
        return tx.apiKey.create({
          data: {
            id,
            accountId: ACCOUNT_A,
            name: "rls-test-key",
            keyHash: `kh-${id}`,
            prefix: `p-${id.slice(0, 6)}`,
          },
        });
      });
      // Verify via superuser then cleanup.
      const found = await prisma.apiKey.findUnique({ where: { id } });
      assert.ok(found, "INSERT with matching accountId should have persisted");
      await prisma.apiKey.delete({ where: { id } });
    });
  });

  describe("UoW propagation (apps/api PrismaUnitOfWork integration)", () => {
    // Note: the UoW itself uses `getTenantContext()` / `getSystemContext()`
    // from AsyncLocalStorage. Those holders are tested in unit tests
    // (apps/api/tests/unit/security/tenantContext.test.ts). Here we verify
    // the SQL-level integration: the `set_config(...)` call this test
    // simulates is what PrismaUnitOfWork emits.
    it("set_config persists for the duration of the tx and resets on COMMIT", async () => {
      const insideTx = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.account_id', 'inside-tx-only', true)`;
        const rows = await tx.$queryRawUnsafe<Array<{ s: string | null }>>(
          `SELECT current_setting('app.account_id', true) AS s`
        );
        return rows[0]?.s;
      });
      assert.strictEqual(insideTx, "inside-tx-only");

      // Outside the tx, the setting is reset.
      const outsideTx = await prisma.$queryRawUnsafe<Array<{ s: string | null }>>(
        `SELECT current_setting('app.account_id', true) AS s`
      );
      assert.notStrictEqual(outsideTx[0]?.s, "inside-tx-only");
    });
  });
});
