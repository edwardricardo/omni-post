/**
 * @file adminUserRepositoryTransaction.integration.test.ts
 * @description The administrators' and their sessions' Prisma repositories inside a Unit of
 *              Work, against the test database. An administrator, or a session, the open
 *              transaction created and has not committed is found by every read of its repository
 *              made in that transaction, while a connection outside it finds none. The work then
 *              returns an `err`, so the Unit of Work rolls the transaction back and each case
 *              leaves no row behind.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import { PrismaUnitOfWork } from "@adapters/db-prisma";
import { ambientTenantContextProvider } from "../../src/security/tenantContext.js";
import { PrismaAdminUserRepository } from "../../src/infrastructure/repositories/PrismaAdminUserRepository.js";
import { PrismaAdminSessionRepository } from "../../src/infrastructure/repositories/PrismaAdminSessionRepository.js";
import { assertSeedChannelConfigured, createSeedPrismaClient } from "./helpers/seedPrismaClient.js";

assertSeedChannelConfigured();

/** The ids of the administrators a read returned, kept to the one the transaction created. */
function idsOf(found: ReadonlyArray<{ readonly id: string }>, createdId: string): string[] {
  return found.filter((administrator) => administrator.id === createdId).map(({ id }) => id);
}

/** What one run of the work saw inside the transaction and through a connection outside it. */
interface Observed {
  readonly createdId: string;
  readonly reads: Readonly<Record<string, readonly string[]>>;
  readonly outside: string | null;
}

describe("The administrators' repositories inside a Unit of Work", { concurrency: 1 }, () => {
  let client: PrismaClient | undefined;

  before(() => {
    client = createSeedPrismaClient();
  });

  after(async () => {
    await client?.$disconnect();
  });

  it("finds the administrator its transaction created and has not committed through every read, while a connection outside the transaction finds none", async () => {
    assert.ok(client, "a client of the test database was built");
    const base = client;
    const suffix = randomBytes(6).toString("hex");
    const email = `uow.reads.${suffix}@example.test`;
    const roleName = `UOW_READS_${suffix.toUpperCase()}`;
    const repository = new PrismaAdminUserRepository(base);
    const unitOfWork = new PrismaUnitOfWork(base, ambientTenantContextProvider);

    const outcome = await unitOfWork.executeResultInTransaction(async () => {
      const transaction = PrismaUnitOfWork.getTransactionClient();
      assert.ok(transaction, "the work runs inside the Unit of Work's transaction");
      const role = await transaction.role.create({ data: { name: roleName } });
      const created = await repository.create({
        email,
        passwordHash: "fixture-hash-of-an-uncommitted-administrator",
        name: "uow.reads",
        roleId: role.id,
      });
      const single = (found: Result<{ readonly id: string }, unknown>): string[] =>
        found.ok ? idsOf([found.value], created.id) : [];
      const observed: Observed = {
        createdId: created.id,
        reads: {
          findActiveUserById: single(await repository.findActiveUser(created.id)),
          findActiveUserByEmail: single(await repository.findActiveUser(email, "email")),
          findById: single(await repository.findById(created.id)),
          findByEmail: single(await repository.findByEmail(email)),
          findCredentialsById: single(await repository.findCredentialsById(created.id)),
          findCredentialsByEmail: single(await repository.findCredentialsByEmail(email)),
          findManyByIds: idsOf(await repository.findManyByIds([created.id]), created.id),
          findAll: idsOf(await repository.findAll(), created.id),
          findByRoleId: idsOf(await repository.findByRoleId(role.id), created.id),
        },
        outside:
          (await base.adminUser.findUnique({ where: { id: created.id }, select: { id: true } }))
            ?.id ?? null,
      };
      // Returned as an err so the Unit of Work rolls the transaction back and nothing stays.
      return err(observed);
    });

    assert.equal(outcome.ok, false, "the work returned its observations as an err");
    if (outcome.ok) return;
    const { createdId, reads, outside } = outcome.error;
    assert.deepEqual(reads, {
      findActiveUserById: [createdId],
      findActiveUserByEmail: [createdId],
      findById: [createdId],
      findByEmail: [createdId],
      findCredentialsById: [createdId],
      findCredentialsByEmail: [createdId],
      findManyByIds: [createdId],
      findAll: [createdId],
      findByRoleId: [createdId],
    });
    assert.equal(outside, null, "the write was not committed while the reads ran");
    assert.equal(await base.adminUser.findUnique({ where: { email } }), null);
    assert.equal(await base.role.findUnique({ where: { name: roleName } }), null);
  });

  it("finds the session its transaction created and has not committed through the sessions' read, while a connection outside the transaction finds none", async () => {
    assert.ok(client, "a client of the test database was built");
    const base = client;
    const suffix = randomBytes(6).toString("hex");
    const email = `uow.sessions.${suffix}@example.test`;
    const roleName = `UOW_SESSIONS_${suffix.toUpperCase()}`;
    const administrators = new PrismaAdminUserRepository(base);
    const sessions = new PrismaAdminSessionRepository(base);
    const unitOfWork = new PrismaUnitOfWork(base, ambientTenantContextProvider);

    const outcome = await unitOfWork.executeResultInTransaction(async () => {
      const transaction = PrismaUnitOfWork.getTransactionClient();
      assert.ok(transaction, "the work runs inside the Unit of Work's transaction");
      const role = await transaction.role.create({ data: { name: roleName } });
      const administrator = await administrators.create({
        email,
        passwordHash: "fixture-hash-of-an-uncommitted-administrator",
        name: "uow.sessions",
        roleId: role.id,
      });
      const session = await sessions.create({
        userId: administrator.id,
        refreshTokenHash: `fixture-refresh-hash-${suffix}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const observed = {
        sessionId: session.id,
        found: (await sessions.findByUserId(administrator.id)).map(({ id }) => id),
        outside: (await base.adminSession.findMany({ where: { id: session.id } })).map(
          ({ id }) => id
        ),
      };
      // Returned as an err so the Unit of Work rolls the transaction back and nothing stays.
      return err(observed);
    });

    assert.equal(outcome.ok, false, "the work returned its observations as an err");
    if (outcome.ok) return;
    const { sessionId, found, outside } = outcome.error;
    assert.deepEqual(found, [sessionId]);
    assert.deepEqual(outside, [], "the session was not committed while the read ran");
    assert.equal(await base.adminSession.findUnique({ where: { id: sessionId } }), null);
    assert.equal(await base.adminUser.findUnique({ where: { email } }), null);
  });
});
