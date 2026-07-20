/**
 * @file PrismaCustomerUserRepository.save.test.ts
 * @description Unit specs for the argument shaping of `PrismaCustomerUserRepository.save`.
 *              Drives the adapter against a fake PrismaClient that captures the
 *              `upsert` args (no real DB). Guards two correctness invariants the
 *              real customer-login save path depends on (and which only a real
 *              HTTP login previously exercised): the write NEVER passes a scalar
 *              `role` argument (there is no such column — it is an Unknown
 *              argument that throws), and a role-less user's empty `roleId` is
 *              written as NULL, never "" (which would violate the optional FK to
 *              CustomerRole).
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@infra/prisma";
import { CustomerUser, type CustomerUserProps } from "@core/domain/entities/CustomerUser.js";
import { PrismaCustomerUserRepository } from "../../../../src/infrastructure/repositories/PrismaCustomerUserRepository.js";

interface CapturedUpsert {
  where: { id: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

function makeFakePrisma(): { prisma: PrismaClient; calls: CapturedUpsert[] } {
  const calls: CapturedUpsert[] = [];
  const customerUser = {
    upsert: async (args: CapturedUpsert): Promise<Record<string, unknown>> => {
      calls.push(args);
      return { id: args.where.id };
    },
  };
  return { prisma: { customerUser } as unknown as PrismaClient, calls };
}

function makeUser(overrides: Partial<CustomerUserProps> = {}): CustomerUser {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const props: CustomerUserProps = {
    id: "customer-1",
    accountId: "account-1",
    email: "customer@example.com",
    passwordHash: "$argon2id$hash",
    firstName: "Ada",
    lastName: "Lovelace",
    roleId: "role-1",
    roleName: "OWNER",
    roleLevel: 3,
    permissions: new Set<string>(),
    isActive: true,
    isEmailVerified: false,
    mfaEnabled: false,
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  return CustomerUser.reconstitute(props);
}

describe("PrismaCustomerUserRepository.save — argument shaping", () => {
  it("never passes a scalar `role` argument (no such column)", async () => {
    const { prisma, calls } = makeFakePrisma();
    const repo = new PrismaCustomerUserRepository(prisma);

    const result = await repo.save(makeUser());

    expect(result.ok).toBe(true);
    expect(calls.length).toBe(1);
    expect("role" in (calls[0]?.create ?? {})).toBe(false);
    expect("role" in (calls[0]?.update ?? {})).toBe(false);
  });

  it("preserves a valid roleId FK", async () => {
    const { prisma, calls } = makeFakePrisma();
    const repo = new PrismaCustomerUserRepository(prisma);

    await repo.save(makeUser({ roleId: "role-42" }));

    expect(calls[0]?.update.roleId).toBe("role-42");
    expect(calls[0]?.create.roleId).toBe("role-42");
  });

  it('writes an empty roleId (role-less snapshot) as NULL, never ""', async () => {
    const { prisma, calls } = makeFakePrisma();
    const repo = new PrismaCustomerUserRepository(prisma);

    await repo.save(makeUser({ roleId: "", roleName: "VIEWER", roleLevel: 0 }));

    expect(calls[0]?.update.roleId).toBeNull();
    expect(calls[0]?.create.roleId).toBeNull();
  });
});
