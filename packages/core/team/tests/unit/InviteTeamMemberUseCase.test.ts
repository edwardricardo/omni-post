/**
 * @file InviteTeamMemberUseCase.test.ts
 * @description Unit tests for InviteTeamMemberUseCase — happy path, duplicate
 *   member conflict (both the pre-flight lookup and the database's own unique
 *   constraint), role not-found, and the write-failure branch. The repository
 *   double offers only the intention-named commands the port actually exposes,
 *   so an invitation that still reached for a whole-entity snapshot writer would
 *   fail here rather than pass silently.
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

/** The typed failures `create` can answer, as the port declares them. */
type CreateFailure = "EMAIL_EXISTS" | "INTERNAL_ERROR";

function makeMockUserRepo(
  opts: {
    existingMember?: boolean;
    createFails?: CreateFailure;
  } = {}
): CustomerUserRepository {
  const { existingMember = false, createFails } = opts;
  return {
    findByEmail: vi.fn(async () =>
      existingMember
        ? ok({ id: "existing-user-id" })
        : err(new DomainError("not found", "NOT_FOUND"))
    ),
    create: vi.fn(async () => (createFails ? err(createFails) : ok(undefined))),
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

  it("creates the stub through the creation command, never a snapshot write", async () => {
    const userRepo = makeMockUserRepo();
    const roleRepo = makeMockRoleRepo();
    const uc = new InviteTeamMemberUseCase(userRepo, roleRepo, passthroughUow);

    const r = await uc.execute(BASE_INPUT);

    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    const create = vi.mocked(userRepo.create);
    assert.strictEqual(create.mock.calls.length, 1, "the invitation must issue exactly one write");
    const [entity, passwordHash] = create.mock.calls[0]!;
    assert.strictEqual(
      entity.id,
      r.value,
      "the row created must be the one whose id the caller is handed"
    );
    assert.strictEqual(
      passwordHash,
      "",
      "the invitee has no credential yet, and the stub must be passed explicitly rather than read off the entity"
    );
    assert.ok(
      entity.inviteToken !== undefined && entity.inviteToken.length > 0,
      "the stub must carry the invitation token that lets the invitee complete it"
    );
  });

  it("returns CONFLICT when a member with that email already exists in the account", async () => {
    const userRepo = makeMockUserRepo({ existingMember: true });
    const roleRepo = makeMockRoleRepo();
    const uc = new InviteTeamMemberUseCase(userRepo, roleRepo, passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.CONFLICT);
  });

  it("returns CONFLICT when the write itself reports the address already taken", async () => {
    const userRepo = makeMockUserRepo({ createFails: "EMAIL_EXISTS" });
    const roleRepo = makeMockRoleRepo();
    const uc = new InviteTeamMemberUseCase(userRepo, roleRepo, passthroughUow);

    const r = await uc.execute(BASE_INPUT);

    assert.ok(!r.ok);
    assert.strictEqual(
      r.error.code,
      USE_CASE_ERRORS.CONFLICT,
      "a duplicate the pre-flight lookup missed is still a duplicate, not an internal fault — the pre-flight narrows the race, the unique constraint closes it"
    );
  });

  it("returns INTERNAL_ERROR when the write fails for any other reason", async () => {
    const userRepo = makeMockUserRepo({ createFails: "INTERNAL_ERROR" });
    const roleRepo = makeMockRoleRepo();
    const uc = new InviteTeamMemberUseCase(userRepo, roleRepo, passthroughUow);

    const r = await uc.execute(BASE_INPUT);

    assert.ok(!r.ok);
    assert.strictEqual(
      r.error.code,
      USE_CASE_ERRORS.INTERNAL_ERROR,
      "the conflict branch must not swallow every write failure — the two classes stay distinguishable"
    );
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
