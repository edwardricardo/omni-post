/**
 * @file UpdateTeamMemberRoleUseCase.test.ts
 * @description Unit tests for UpdateTeamMemberRoleUseCase. Pins the four failure
 *   classes the use case distinguished before its migration off the snapshot
 *   writer — VALIDATION_FAILED, NOT_FOUND, FORBIDDEN and INTERNAL_ERROR — plus
 *   the write itself: exactly one role-change command, carrying the role the
 *   domain accepted and nothing else the loaded entity happens to hold.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { UpdateTeamMemberRoleUseCase } from "../../src/UpdateTeamMemberRoleUseCase.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type {
  CustomerRoleRepository,
  CustomerRoleSnapshot,
} from "@core/domain/repositories/CustomerRoleRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { CustomerUser, type CustomerUserProps } from "@core/domain/entities/CustomerUser.js";
import { DomainError } from "@core/domain/errors/index.js";

const ACCOUNT_ID = "acc-0000-0000-0000-role";
const MEMBER_ID = "member-0001";
const CHANGER_ID = "changer-0001";
const NEW_ROLE_ID = "role-manager";

const NEW_ROLE: CustomerRoleSnapshot = {
  roleId: NEW_ROLE_ID,
  roleName: "MANAGER",
  roleLevel: 50,
  permissions: new Set(["posts:read", "posts:write"]),
};

const passthroughUow: UnitOfWork = {
  executeInTransaction: async (fn) => fn(),
};

/** The typed failures every count-gated command answers, as the port declares them. */
type WriteFailure = "USER_NOT_FOUND" | "INTERNAL_ERROR";

function makeMember(overrides: Partial<CustomerUserProps> = {}): CustomerUser {
  const moment = new Date("2026-01-01T00:00:00.000Z");
  const props: CustomerUserProps = {
    id: MEMBER_ID,
    accountId: ACCOUNT_ID,
    email: "member@example.com",
    passwordHash: "$argon2id$v=19$member-hash",
    firstName: "Mem",
    lastName: "Ber",
    roleId: "role-member",
    roleName: "MEMBER",
    roleLevel: 10,
    permissions: new Set<string>(),
    isActive: true,
    isEmailVerified: true,
    mfaEnabled: false,
    joinedAt: moment,
    createdAt: moment,
    updatedAt: moment,
    ...overrides,
  };
  return CustomerUser.reconstitute(props);
}

function makeUserRepo(
  opts: {
    member?: CustomerUser | null;
    changer?: CustomerUser | null;
    changeRoleFails?: WriteFailure;
  } = {}
): CustomerUserRepository {
  const {
    member = makeMember(),
    changer = makeMember({ id: CHANGER_ID, roleName: "OWNER", roleLevel: 100 }),
    changeRoleFails,
  } = opts;

  return {
    findById: vi.fn(async (id: string) => {
      if (id === MEMBER_ID) {
        return member ? ok(member) : err(new DomainError("not found", "NOT_FOUND"));
      }
      return changer ? ok(changer) : err(new DomainError("not found", "NOT_FOUND"));
    }),
    changeRole: vi.fn(async () => (changeRoleFails ? err(changeRoleFails) : ok(undefined))),
  } as unknown as CustomerUserRepository;
}

function makeRoleRepo(roleFound = true): CustomerRoleRepository {
  return {
    getSnapshotByName: vi.fn(async () =>
      roleFound ? ok(NEW_ROLE) : err(new DomainError("Role not found", "NOT_FOUND"))
    ),
    getSnapshotById: vi.fn(async () => ok(NEW_ROLE)),
    listAll: vi.fn(async () => []),
  } as unknown as CustomerRoleRepository;
}

const BASE_INPUT = {
  memberId: MEMBER_ID,
  newRoleName: "MANAGER",
  changerMemberId: CHANGER_ID,
};

describe("UpdateTeamMemberRoleUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the accepted role through the role-change command and nothing else", async () => {
    const userRepo = makeUserRepo();
    const uc = new UpdateTeamMemberRoleUseCase(userRepo, makeRoleRepo(), passthroughUow);

    const r = await uc.execute(BASE_INPUT);

    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    const changeRole = vi.mocked(userRepo.changeRole);
    assert.deepStrictEqual(
      changeRole.mock.calls,
      [[MEMBER_ID, NEW_ROLE_ID]],
      "the role change must be one command naming the member and the role the domain accepted — an entity-shaped write would carry the credential and the soft-delete state along with it"
    );
  });

  it("returns VALIDATION_FAILED when the member id is blank", async () => {
    const uc = new UpdateTeamMemberRoleUseCase(makeUserRepo(), makeRoleRepo(), passthroughUow);

    const r = await uc.execute({ ...BASE_INPUT, memberId: "   " });

    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns NOT_FOUND when the member does not exist", async () => {
    const uc = new UpdateTeamMemberRoleUseCase(
      makeUserRepo({ member: null }),
      makeRoleRepo(),
      passthroughUow
    );

    const r = await uc.execute(BASE_INPUT);

    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.NOT_FOUND);
  });

  it("returns VALIDATION_FAILED when the requested role does not exist", async () => {
    const uc = new UpdateTeamMemberRoleUseCase(makeUserRepo(), makeRoleRepo(false), passthroughUow);

    const r = await uc.execute(BASE_INPUT);

    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns FORBIDDEN when the changer does not outrank the target", async () => {
    const uc = new UpdateTeamMemberRoleUseCase(
      makeUserRepo({ changer: makeMember({ id: CHANGER_ID, roleName: "MEMBER", roleLevel: 10 }) }),
      makeRoleRepo(),
      passthroughUow
    );

    const r = await uc.execute(BASE_INPUT);

    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.FORBIDDEN);
  });

  it("returns INTERNAL_ERROR when the role-change write fails", async () => {
    const uc = new UpdateTeamMemberRoleUseCase(
      makeUserRepo({ changeRoleFails: "INTERNAL_ERROR" }),
      makeRoleRepo(),
      passthroughUow
    );

    const r = await uc.execute(BASE_INPUT);

    assert.ok(!r.ok);
    assert.strictEqual(
      r.error.code,
      USE_CASE_ERRORS.INTERNAL_ERROR,
      "a failed write is an internal failure, and must stay separable from NOT_FOUND and FORBIDDEN"
    );
  });

  it("returns INTERNAL_ERROR when no live row matched at the instant of the write", async () => {
    const uc = new UpdateTeamMemberRoleUseCase(
      makeUserRepo({ changeRoleFails: "USER_NOT_FOUND" }),
      makeRoleRepo(),
      passthroughUow
    );

    const r = await uc.execute(BASE_INPUT);

    assert.ok(!r.ok);
    assert.strictEqual(
      r.error.code,
      USE_CASE_ERRORS.INTERNAL_ERROR,
      "the row vanishing between the read and the write is the same class the snapshot writer reported, and widening it here would change what the route answers for a race"
    );
  });
});
