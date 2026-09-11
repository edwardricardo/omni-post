/**
 * @file RemoveTeamMemberUseCase.test.ts
 * @description Unit tests for RemoveTeamMemberUseCase. Pins the failure classes
 *   the use case distinguished before its migration off the snapshot writer —
 *   VALIDATION_FAILED, NOT_FOUND, FORBIDDEN and INTERNAL_ERROR — and pins the
 *   write itself: deactivation names one row and one flag, so removing a member
 *   can no longer replay whatever else the loaded entity was carrying.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { RemoveTeamMemberUseCase } from "../../src/RemoveTeamMemberUseCase.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { CustomerUser, type CustomerUserProps } from "@core/domain/entities/CustomerUser.js";
import { DomainError } from "@core/domain/errors/index.js";

const ACCOUNT_ID = "acc-0000-0000-0000-remove";
const MEMBER_ID = "member-0001";
const CHANGER_ID = "changer-0001";

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
    deactivateFails?: WriteFailure;
  } = {}
): CustomerUserRepository {
  const { member = makeMember(), deactivateFails } = opts;
  return {
    findById: vi.fn(async () =>
      member ? ok(member) : err(new DomainError("not found", "NOT_FOUND"))
    ),
    deactivate: vi.fn(async () => (deactivateFails ? err(deactivateFails) : ok(undefined))),
  } as unknown as CustomerUserRepository;
}

const BASE_INPUT = { memberId: MEMBER_ID, changerMemberId: CHANGER_ID };

describe("RemoveTeamMemberUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deactivates through the deactivation command, naming only the member", async () => {
    const userRepo = makeUserRepo();
    const uc = new RemoveTeamMemberUseCase(userRepo, passthroughUow);

    const r = await uc.execute(BASE_INPUT);

    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    assert.deepStrictEqual(
      vi.mocked(userRepo.deactivate).mock.calls,
      [[MEMBER_ID]],
      "removal must write the active flag on one row — the entity supplies the invariant, never the write's contents"
    );
  });

  it("returns VALIDATION_FAILED when the member id is blank", async () => {
    const uc = new RemoveTeamMemberUseCase(makeUserRepo(), passthroughUow);

    const r = await uc.execute({ ...BASE_INPUT, memberId: "   " });

    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns NOT_FOUND when the member does not exist", async () => {
    const uc = new RemoveTeamMemberUseCase(makeUserRepo({ member: null }), passthroughUow);

    const r = await uc.execute(BASE_INPUT);

    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.NOT_FOUND);
  });

  it("returns FORBIDDEN when the target is the account owner", async () => {
    const userRepo = makeUserRepo({
      member: makeMember({ roleName: "OWNER", roleLevel: 100 }),
    });
    const uc = new RemoveTeamMemberUseCase(userRepo, passthroughUow);

    const r = await uc.execute(BASE_INPUT);

    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.FORBIDDEN);
    assert.strictEqual(
      vi.mocked(userRepo.deactivate).mock.calls.length,
      0,
      "an invariant the domain refused must never reach the database"
    );
  });

  it("returns INTERNAL_ERROR when the deactivation write fails", async () => {
    const uc = new RemoveTeamMemberUseCase(
      makeUserRepo({ deactivateFails: "INTERNAL_ERROR" }),
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
    const uc = new RemoveTeamMemberUseCase(
      makeUserRepo({ deactivateFails: "USER_NOT_FOUND" }),
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
