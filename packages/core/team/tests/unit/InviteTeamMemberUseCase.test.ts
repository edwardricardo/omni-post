/**
 * @file InviteTeamMemberUseCase.test.ts
 * @description Unit tests for InviteTeamMemberUseCase — happy path, duplicate
 *   member conflict, and role not-found against mocked CustomerUserRepository and
 *   CustomerRoleRepository.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { InviteTeamMemberUseCase } from "../../src/InviteTeamMemberUseCase.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { CustomerRoleRepository } from "@core/domain/repositories/CustomerRoleRepository.js";
import type { CustomerRoleSnapshot } from "@core/domain/repositories/CustomerRoleRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { DomainError } from "@core/domain/errors/index.js";

const ACCOUNT_ID = "acc-0000-0000-0000-team";
const ROLE_SNAPSHOT: CustomerRoleSnapshot = {
  roleId: "role-0001",
  roleName: "MEMBER",
  roleLevel: 10,
  permissions: new Set(["posts:read", "posts:write"]),
};

const passthroughUow: UnitOfWork = {
  executeInTransaction: async (fn) => fn(),
};

function makeMockUserRepo(
  opts: {
    existingMember?: boolean;
    saveFails?: boolean;
  } = {}
): CustomerUserRepository {
  const { existingMember = false, saveFails = false } = opts;
  return {
    findByEmail: vi.fn(async () =>
      existingMember
        ? ok({ id: "existing-user-id" })
        : err(new DomainError("not found", "NOT_FOUND"))
    ),
    save: vi.fn(async () =>
      saveFails ? err(new DomainError("DB error", "INTERNAL_ERROR")) : ok(undefined)
    ),
    findById: vi.fn(async () => err(new DomainError("not found", "NOT_FOUND"))),
    findByEmailAcrossAccounts: vi.fn(async () => []),
    listByAccount: vi.fn(async () => ok([])),
    delete: vi.fn(async () => ok(undefined)),
  } as unknown as CustomerUserRepository;
}

function makeMockRoleRepo(roleFound = true): CustomerRoleRepository {
  return {
    getSnapshotByName: vi.fn(async () =>
      roleFound ? ok(ROLE_SNAPSHOT) : err(new DomainError("Role not found", "NOT_FOUND"))
    ),
    getSnapshotById: vi.fn(async () => ok(ROLE_SNAPSHOT)),
    listAll: vi.fn(async () => []),
  } as unknown as CustomerRoleRepository;
}

const BASE_INPUT = {
  accountId: ACCOUNT_ID,
  email: "newmember@example.com",
  name: "Alice Smith",
  role: "MEMBER",
};

describe("InviteTeamMemberUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the new member id when the invitation is created successfully", async () => {
    const userRepo = makeMockUserRepo();
    const roleRepo = makeMockRoleRepo();
    const uc = new InviteTeamMemberUseCase(userRepo, roleRepo, passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    assert.ok(r.value.length > 0);
  });

  it("returns CONFLICT when a member with that email already exists in the account", async () => {
    const userRepo = makeMockUserRepo({ existingMember: true });
    const roleRepo = makeMockRoleRepo();
    const uc = new InviteTeamMemberUseCase(userRepo, roleRepo, passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.CONFLICT);
  });

  it("returns VALIDATION_FAILED when the requested role does not exist", async () => {
    const userRepo = makeMockUserRepo();
    const roleRepo = makeMockRoleRepo(false);
    const uc = new InviteTeamMemberUseCase(userRepo, roleRepo, passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, role: "NONEXISTENT_ROLE" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });
});
