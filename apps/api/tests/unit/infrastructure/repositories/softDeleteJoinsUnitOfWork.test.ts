/**
 * @file softDeleteJoinsUnitOfWork.test.ts
 * @description Pins the PROPERTY the container comments claim for the soft deletes:
 *              that the existence probe and the `deletedAt` update both run on the
 *              Unit of Work's transaction client. Wiring tests (does the container pass
 *              a UoW?) cannot see this — a repository can receive a UoW-wrapped call and
 *              still issue every statement on the base client, outside the transaction
 *              and outside the `app.account_id` GUC bound at tx start.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@infra/prisma";
import { PrismaUnitOfWork } from "../../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js";
import { PrismaProjectRepository } from "../../../../src/infrastructure/repositories/PrismaProjectRepository.js";
import { PrismaAccountRepository } from "../../../../src/infrastructure/repositories/PrismaAccountRepository.js";
import { ProjectId, AccountId } from "@core/domain/index.js";

const PROJECT_ID = "b0000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "a0000000-0000-4000-8000-000000000001";

/**
 * Two distinct spy clients: the base client the repository is constructed with,
 * and the transaction client the Unit of Work hands to its callback. Every
 * assertion below is about WHICH of the two received the statement, so they are
 * never the same object.
 */
function makeClients() {
  const spyClient = () => ({
    project: {
      count: vi.fn(async () => 1),
      update: vi.fn(async () => ({ id: PROJECT_ID })),
    },
    account: {
      count: vi.fn(async () => 1),
      update: vi.fn(async () => ({ id: ACCOUNT_ID })),
    },
    $queryRaw: vi.fn(async () => []),
  });

  const tx = spyClient();
  const base = Object.assign(spyClient(), {
    $transaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(tx)),
  });

  return { base, tx };
}

type Clients = ReturnType<typeof makeClients>;

function asPrisma(client: Clients["base"] | Clients["tx"]): PrismaClient {
  return client as unknown as PrismaClient;
}

describe("soft delete joins the ambient Unit of Work transaction", () => {
  let clients: Clients;

  beforeEach(() => {
    vi.clearAllMocks();
    clients = makeClients();
  });

  describe("PrismaProjectRepository.delete", () => {
    it("issues the existence probe and the update on the transaction client, not the base client", async () => {
      const uow = new PrismaUnitOfWork(asPrisma(clients.base));
      const repo = new PrismaProjectRepository(asPrisma(clients.base));

      let deleted: Awaited<ReturnType<typeof repo.delete>> | undefined;
      await uow.executeInTransaction(async () => {
        deleted = await repo.delete(ProjectId.fromStringUnsafe(PROJECT_ID));
      });

      expect(deleted?.ok).toBe(true);
      expect(clients.tx.project.update).toHaveBeenCalledTimes(1);
      expect(clients.base.project.update).not.toHaveBeenCalled();
      expect(clients.tx.project.count).toHaveBeenCalledTimes(1);
      expect(clients.base.project.count).not.toHaveBeenCalled();
    });

    it("writes deletedAt through the transaction client", async () => {
      const uow = new PrismaUnitOfWork(asPrisma(clients.base));
      const repo = new PrismaProjectRepository(asPrisma(clients.base));

      await uow.executeInTransaction(async () => {
        await repo.delete(ProjectId.fromStringUnsafe(PROJECT_ID));
      });

      const call = clients.tx.project.update.mock.calls[0]?.[0] as
        { where: { id: string }; data: { deletedAt: unknown } } | undefined;
      expect(call?.where.id).toBe(PROJECT_ID);
      expect(call?.data.deletedAt).toBeInstanceOf(Date);
    });

    it("falls back to the base client when no Unit of Work is active", async () => {
      const repo = new PrismaProjectRepository(asPrisma(clients.base));

      const deleted = await repo.delete(ProjectId.fromStringUnsafe(PROJECT_ID));

      expect(deleted.ok).toBe(true);
      expect(clients.base.project.update).toHaveBeenCalledTimes(1);
      expect(clients.tx.project.update).not.toHaveBeenCalled();
    });
  });

  describe("PrismaAccountRepository.delete", () => {
    it("issues the existence probe and the update on the transaction client, not the base client", async () => {
      const uow = new PrismaUnitOfWork(asPrisma(clients.base));
      const repo = new PrismaAccountRepository(asPrisma(clients.base));

      let deleted: Awaited<ReturnType<typeof repo.delete>> | undefined;
      await uow.executeInTransaction(async () => {
        deleted = await repo.delete(AccountId.fromStringUnsafe(ACCOUNT_ID));
      });

      expect(deleted?.ok).toBe(true);
      expect(clients.tx.account.update).toHaveBeenCalledTimes(1);
      expect(clients.base.account.update).not.toHaveBeenCalled();
      expect(clients.tx.account.count).toHaveBeenCalledTimes(1);
      expect(clients.base.account.count).not.toHaveBeenCalled();
    });

    it("writes deletedAt through the transaction client", async () => {
      const uow = new PrismaUnitOfWork(asPrisma(clients.base));
      const repo = new PrismaAccountRepository(asPrisma(clients.base));

      await uow.executeInTransaction(async () => {
        await repo.delete(AccountId.fromStringUnsafe(ACCOUNT_ID));
      });

      const call = clients.tx.account.update.mock.calls[0]?.[0] as
        { where: { id: string }; data: { deletedAt: unknown } } | undefined;
      expect(call?.where.id).toBe(ACCOUNT_ID);
      expect(call?.data.deletedAt).toBeInstanceOf(Date);
    });

    it("falls back to the base client when no Unit of Work is active", async () => {
      const repo = new PrismaAccountRepository(asPrisma(clients.base));

      const deleted = await repo.delete(AccountId.fromStringUnsafe(ACCOUNT_ID));

      expect(deleted.ok).toBe(true);
      expect(clients.base.account.update).toHaveBeenCalledTimes(1);
      expect(clients.tx.account.update).not.toHaveBeenCalled();
    });
  });

  describe("a missing row is still reported through the transaction client", () => {
    it("returns EntityNotFoundError without issuing an update when the probe finds nothing", async () => {
      clients.tx.project.count.mockResolvedValueOnce(0);
      const uow = new PrismaUnitOfWork(asPrisma(clients.base));
      const repo = new PrismaProjectRepository(asPrisma(clients.base));

      let deleted: Awaited<ReturnType<typeof repo.delete>> | undefined;
      await uow.executeInTransaction(async () => {
        deleted = await repo.delete(ProjectId.fromStringUnsafe(PROJECT_ID));
      });

      expect(deleted?.ok).toBe(false);
      expect(clients.tx.project.update).not.toHaveBeenCalled();
      expect(clients.base.project.update).not.toHaveBeenCalled();
    });
  });
});
