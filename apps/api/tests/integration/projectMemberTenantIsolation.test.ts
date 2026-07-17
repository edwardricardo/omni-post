/**
 * @file projectMemberTenantIsolation.test.ts
 * @description MERGE-BLOCKING two-tenant integration test for the `ProjectMember`
 *   tenant-guard enrollment. `ProjectMember` has NO live HTTP route (its single
 *   reader `findByProjectId` is a dead adapter method), so isolation is proven at
 *   the repository / guarded-client layer rather than over HTTP: a guarded client
 *   built exactly like production (`base.$extends(tenantGuardExtension(...))`) plus
 *   the real ALS provider and the real `PrismaCustomerUserRepository`.
 *
 *   Proves, against a REAL database with two tenants (A, B):
 *   - A reading B's members via a FOREIGN projectId resolves to `[]` (B's project
 *     HAS a member, so the empty result is non-vacuous — it is the guard filtering,
 *     not an empty table);
 *   - A reading its OWN projectId returns only A's members;
 *   - a read with NO bound tenant context is refused with `TenantContextMissingError`
 *     (never silent unscoped rows);
 *   - a guarded create WITHOUT an explicit `accountId` persists a row consistent
 *     across BOTH accountId-bearing parents (`accountId == Project.accountId ==
 *     CustomerUser.accountId`);
 *   - a guarded create with an explicit FOREIGN `accountId` is rejected with
 *     `TenantContextMismatchError` and persists nothing.
 *
 *   The deploy-time double-parent RAISE assertion in the backfill migration is the
 *   enforcement point for pre-existing corrupt membership; it is not replayed here.
 *
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import {
  tenantGuardExtension,
  TenantContextMissingError,
  TenantContextMismatchError,
} from "@infra/prisma/extensions/tenantGuard.js";
import {
  getTenantContext,
  getSystemContext,
  withTenantContext,
} from "../../src/security/tenantContext.js";
import { PrismaCustomerUserRepository } from "../../src/infrastructure/repositories/PrismaCustomerUserRepository.js";

const TAG = `projmember-iso-${Date.now()}`;

interface Seeded {
  accountId: string;
  projectId: string;
  /** CustomerUser already wired into the seeded ProjectMember row. */
  memberUserId: string;
  /** CustomerUser NOT yet a member — used to exercise the guarded create path. */
  extraUserId: string;
}

describe("ProjectMember — two-tenant isolation (MERGE-BLOCKING)", () => {
  let base: PrismaClient;
  let guarded: PrismaClient;
  let repo: PrismaCustomerUserRepository;

  let tenantA: Seeded;
  let tenantB: Seeded;

  async function seedTenant(name: string): Promise<Seeded> {
    const account = await base.account.create({
      data: {
        name: `${TAG}-${name}`,
        email: `${TAG}-${name}-${randomUUID()}@test.local`,
        slug: `${TAG}-${name}-${randomUUID()}`,
      },
    });
    const project = await base.project.create({
      data: { accountId: account.id, name: `${TAG}-${name}-project` },
    });
    const memberUser = await base.customerUser.create({
      data: {
        accountId: account.id,
        email: `${TAG}-${name}-member-${randomUUID()}@test.local`,
        passwordHash: "placeholder",
        firstName: "Member",
        lastName: name,
      },
    });
    const extraUser = await base.customerUser.create({
      data: {
        accountId: account.id,
        email: `${TAG}-${name}-extra-${randomUUID()}@test.local`,
        passwordHash: "placeholder",
        firstName: "Extra",
        lastName: name,
      },
    });
    // ONE membership per tenant so B's project HAS a member — this makes the
    // cross-tenant foreign-read assertion ([]) non-vacuous.
    await base.projectMember.create({
      data: { accountId: account.id, projectId: project.id, memberId: memberUser.id },
    });
    return {
      accountId: account.id,
      projectId: project.id,
      memberUserId: memberUser.id,
      extraUserId: extraUser.id,
    };
  }

  before(async () => {
    base = createTestPrismaClient();

    tenantA = await seedTenant("A");
    tenantB = await seedTenant("B");

    // Guarded client — EXACTLY as production wires it (base + tenant guard),
    // driven by the real ALS provider.
    guarded = base.$extends(
      tenantGuardExtension({ getTenantContext, getSystemContext })
    ) as unknown as PrismaClient;

    repo = new PrismaCustomerUserRepository(guarded);
  });

  after(async () => {
    const accountIds = [tenantA.accountId, tenantB.accountId];
    const projectIds = [tenantA.projectId, tenantB.projectId];
    // FK order: projectMember → customerUser + project → account.
    await base.projectMember
      .deleteMany({ where: { projectId: { in: projectIds } } })
      .catch(() => undefined);
    await base.customerUser
      .deleteMany({ where: { accountId: { in: accountIds } } })
      .catch(() => undefined);
    await base.project
      .deleteMany({ where: { accountId: { in: accountIds } } })
      .catch(() => undefined);
    await base.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => undefined);
    await base.$disconnect();
  });

  describe("cross-tenant reads are closed (A attacks B)", () => {
    it("A listing B's project members via a foreign projectId returns []", async () => {
      const result = await withTenantContext({ accountId: tenantA.accountId }, () =>
        repo.findByProjectId(tenantB.projectId)
      );
      assert.strictEqual(result.length, 0, "A must resolve ZERO of B's members");
    });

    it("a read with no bound tenant context is refused with TenantContextMissingError", async () => {
      await assert.rejects(
        repo.findByProjectId(tenantB.projectId),
        (err: unknown) => err instanceof TenantContextMissingError,
        "no-context read must throw TenantContextMissingError, never return unscoped rows"
      );
    });
  });

  describe("own-tenant read — the owner path still works", () => {
    it("A listing its OWN projectId returns only A's members", async () => {
      const result = await withTenantContext({ accountId: tenantA.accountId }, () =>
        repo.findByProjectId(tenantA.projectId)
      );
      assert.ok(result.length >= 1, "A must see its own seeded member");
      assert.ok(
        result.every((u) => u.accountId === tenantA.accountId),
        "every returned member must belong to A"
      );
      assert.ok(
        result.some((u) => u.id === tenantA.memberUserId),
        "A's seeded member must be present in the result"
      );
    });
  });

  describe("guarded create — double-parent accountId consistency", () => {
    it("a create without accountId persists a row consistent across both parents", async () => {
      // The create MUST be awaited INSIDE the context: a Prisma promise is lazy,
      // so returning it unawaited would trigger the guard after the ALS scope
      // has already exited (unlike the async repository reads, which await
      // internally).
      const created = await withTenantContext({ accountId: tenantA.accountId }, async () => {
        return await guarded.projectMember.create({
          data: { projectId: tenantA.projectId, memberId: tenantA.extraUserId },
        });
      });

      const row = await base.projectMember.findUnique({ where: { id: created.id } });
      const project = await base.project.findUnique({ where: { id: tenantA.projectId } });
      const member = await base.customerUser.findUnique({ where: { id: tenantA.extraUserId } });
      assert.ok(row, "the membership row must persist");
      assert.strictEqual(row?.accountId, tenantA.accountId, "row.accountId == bound context");
      assert.strictEqual(row?.accountId, project?.accountId, "row.accountId == Project.accountId");
      assert.strictEqual(
        row?.accountId,
        member?.accountId,
        "row.accountId == CustomerUser.accountId"
      );

      // Free the (projectId, memberId) unique slot so the mismatch test below is
      // order-independent.
      await base.projectMember.delete({ where: { id: created.id } });
    });

    it("a create with an explicit foreign accountId is rejected and persists nothing", async () => {
      await withTenantContext({ accountId: tenantA.accountId }, async () => {
        await assert.rejects(
          guarded.projectMember.create({
            data: {
              projectId: tenantA.projectId,
              memberId: tenantA.extraUserId,
              accountId: tenantB.accountId,
            },
          }),
          (err: unknown) => err instanceof TenantContextMismatchError,
          "explicit foreign accountId on create must throw TenantContextMismatchError"
        );
      });

      const count = await base.projectMember.count({
        where: { projectId: tenantA.projectId, memberId: tenantA.extraUserId },
      });
      assert.strictEqual(count, 0, "no row may persist when the create is rejected");
    });
  });

  describe("data-layer invariant", () => {
    it("every seeded membership row satisfies accountId === Project.accountId", async () => {
      const rows = await base.projectMember.findMany({
        where: { accountId: { in: [tenantA.accountId, tenantB.accountId] } },
        include: { project: { select: { accountId: true } } },
      });
      assert.ok(rows.length >= 2, "both tenants must own a seeded membership row");
      for (const row of rows) {
        assert.strictEqual(
          row.accountId,
          row.project.accountId,
          `row ${row.id} must be parent-consistent`
        );
      }
    });

    it("no membership row has a NULL accountId (NOT NULL / backfill invariant)", async () => {
      const result = await base.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS count FROM "ProjectMember" WHERE "accountId" IS NULL`
      );
      assert.strictEqual(Number(result[0]?.count ?? 0), 0);
    });
  });
});
