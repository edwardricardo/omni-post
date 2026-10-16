/**
 * @file PrismaCustomerUserRepository.test.ts
 * @description Tests the read of PrismaCustomerUserRepository that sees soft-deleted users on
 *   purpose: it must look only at deleted rows, by the normalized address, across accounts, and
 *   answer nothing but whether one exists. The write paths have their own suites over a
 *   stateful fake of the client (`repositories/customerUserWriteInvariants.test.ts`).
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterEach, vi, expect } from "vitest";
import { PrismaUnitOfWork } from "@adapters/db-prisma";
import { PrismaCustomerUserRepository } from "../../../src/infrastructure/repositories/PrismaCustomerUserRepository.js";

/**
 * @param count - What the double's `customerUser.count` resolves to.
 * @returns A client double exposing only the count the read uses.
 */
function makeClient(count: number) {
  return { customerUser: { count: vi.fn(async () => count) } };
}

describe("PrismaCustomerUserRepository.existsDeletedByEmailAcrossAccounts", () => {
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    client = makeClient(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("counts only soft-deleted users, by the normalized address, in every account", async () => {
    const repo = new PrismaCustomerUserRepository(client as never);

    const result = await repo.existsDeletedByEmailAcrossAccounts("  Former@Example.com ");

    expect(result).toBe(true);
    expect(client.customerUser.count).toHaveBeenCalledWith({
      where: { email: "former@example.com", NOT: { deletedAt: null } },
    });
  });

  it("returns false when no soft-deleted user carries the address", async () => {
    client = makeClient(0);
    const repo = new PrismaCustomerUserRepository(client as never);

    expect(await repo.existsDeletedByEmailAcrossAccounts("former@example.com")).toBe(false);
  });

  it("reads through the open Unit of Work transaction when one is active", async () => {
    const tx = makeClient(1);
    vi.spyOn(PrismaUnitOfWork, "getTransactionClient").mockReturnValue(tx as never);
    const repo = new PrismaCustomerUserRepository(client as never);

    await repo.existsDeletedByEmailAcrossAccounts("former@example.com");

    expect(tx.customerUser.count).toHaveBeenCalledTimes(1);
    expect(client.customerUser.count).not.toHaveBeenCalled();
  });
});
