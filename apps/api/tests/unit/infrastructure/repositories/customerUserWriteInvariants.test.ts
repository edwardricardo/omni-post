/**
 * @file customerUserWriteInvariants.test.ts
 * @description The authority criterion for the customer-user write API, made
 *   executable. Every command on the port claims a set of columns by its name;
 *   this suite runs the REAL `PrismaCustomerUserRepository` over the stateful
 *   Prisma-client fake, diffs the stored row before and after each command, and
 *   asserts the changed-column set EQUALS the declared set.
 *
 *   Three properties are pinned, and each one failed silently under a write that
 *   projected a whole in-memory entity:
 *
 *   1. **Completeness** — the write carries every column its intent requires, so
 *      a caller cannot leave a credential behind and still succeed.
 *   2. **Exclusivity** — a column reached by more than one command has its exact
 *      writer list named here. Adding a writer without naming it turns this suite
 *      red, which is the whole point: two ways to write one column with neither
 *      authoritative is the defect this API replaces.
 *   3. **No side channel** — no optional parameter widens the projection, and no
 *      value carried by the entity reaches a column the command did not name.
 *
 *   The diff is taken against the STORED row, never against the arguments handed
 *   to the client. An argument-capturing double records what a flow asked for and
 *   stays green when a later write in the same flow undoes it; a stored row can be
 *   asked what it actually holds.
 * @layer infrastructure
 */

import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { CustomerUser, type CustomerUserProps } from "@core/domain/entities/CustomerUser.js";
import { PrismaCustomerUserRepository } from "../../../../src/infrastructure/repositories/PrismaCustomerUserRepository.js";
import { withSystemContext } from "../../../../src/security/tenantContext.js";
import {
  createStatefulCustomerUserPrismaFake,
  FAKE_MANAGED_COLUMNS,
  type FakeCustomerUserRow,
  type StatefulCustomerUserPrismaFake,
} from "../../helpers/statefulCustomerUserPrismaFake.js";

/** Stands in for the declared seam a route binds before any of these run. */
const SEAM_REASON = "system:customer-write-invariants";

const ACCOUNT_ID = "acct-write-invariants";
const USER_ID = "user-write-invariants";
const OTHER_USER_ID = "user-write-invariants-other";

const STORED_HASH = "$argon2id$v=19$stored-hash";
const CLAIMED_HASH = "$argon2id$v=19$claimed-hash";
const UPGRADED_HASH = "$argon2id$v=19$upgraded-hash";
const CREATED_HASH = "$argon2id$v=19$created-hash";

const SEEDED_EMAIL = "write-invariants@example.test";
const SEEDED_ROLE_ID = "role-owner";
const NEW_ROLE_ID = "role-manager";

const LIVE_TOKEN = "write-invariants-live-token";
const ISSUED_TOKEN = "write-invariants-issued-token";

const LOGIN_AT = new Date("2026-03-04T05:06:07.000Z");
const TOKEN_EXPIRY = new Date("2026-03-04T06:06:07.000Z");

/**
 * The columns the MFA repository owns under compare-and-set discipline. They
 * live on the same row, which is exactly why a write from this side has to be
 * asked, explicitly, to stay off them.
 */
const MFA_COLUMNS: readonly string[] = [
  "mfaEnabled",
  "mfaSecret",
  "mfaBackupCodes",
  "mfaBackupUsedAt",
  "mfaLastUsedTotpStep",
];

/**
 * The creation projection. `create` is the genesis intent, so it names the
 * columns a new row starts life with — and nothing else. Absent on purpose:
 * the MFA columns (owned elsewhere), `deletedAt` (no credential write touches
 * it), the reset-token pair (owned by issue/claim), the e-mail verification
 * pair (no writer in this API), and the login timestamp (owned by recordLogin).
 */
const CREATION_COLUMNS: readonly string[] = [
  "id",
  "accountId",
  "email",
  "passwordHash",
  "firstName",
  "lastName",
  "roleId",
  "isActive",
  "isEmailVerified",
  "invitedBy",
  "inviteToken",
  "inviteTokenExpiry",
  "joinedAt",
];

/**
 * Every column reachable by MORE THAN ONE command, with its exact writer list.
 * This is the exclusivity criterion written down: multiplicity is allowed when
 * each writer is sanctioned by name, and forbidden when it is not.
 */
const SANCTIONED_WRITERS: Readonly<Record<string, readonly string[]>> = {
  passwordHash: ["claimPasswordReset", "create", "upgradePasswordHash"],
  resetToken: ["claimPasswordReset", "issueResetToken"],
  resetTokenExpiry: ["claimPasswordReset", "issueResetToken"],
  roleId: ["changeRole", "create"],
  isActive: ["create", "deactivate"],
};

interface CommandOutcome {
  readonly ok: boolean;
  readonly error?: unknown;
}

interface UpdateCommandCase {
  /** The port method under test. */
  readonly command: string;
  /** The columns the command's name claims. */
  readonly declared: readonly string[];
  /** Run it against the seeded row. */
  readonly invoke: (repo: PrismaCustomerUserRepository) => Promise<CommandOutcome>;
  /** The value each declared column must hold afterwards. */
  readonly expected: Readonly<Record<string, unknown>>;
  /** The typed failure the command answers when no live row matches. */
  readonly missingRowError: string;
}

const UPDATE_COMMANDS: readonly UpdateCommandCase[] = [
  {
    command: "claimPasswordReset",
    declared: ["passwordHash", "resetToken", "resetTokenExpiry"],
    invoke: (repo) => repo.claimPasswordReset(LIVE_TOKEN, CLAIMED_HASH),
    expected: { passwordHash: CLAIMED_HASH, resetToken: null, resetTokenExpiry: null },
    missingRowError: "INVALID_TOKEN",
  },
  {
    command: "issueResetToken",
    declared: ["resetToken", "resetTokenExpiry"],
    invoke: (repo) => repo.issueResetToken(USER_ID, ISSUED_TOKEN, TOKEN_EXPIRY),
    expected: { resetToken: ISSUED_TOKEN, resetTokenExpiry: TOKEN_EXPIRY },
    missingRowError: "USER_NOT_FOUND",
  },
  {
    command: "upgradePasswordHash",
    declared: ["passwordHash"],
    invoke: (repo) => repo.upgradePasswordHash(USER_ID, UPGRADED_HASH),
    expected: { passwordHash: UPGRADED_HASH },
    missingRowError: "USER_NOT_FOUND",
  },
  {
    command: "recordLogin",
    declared: ["lastLoginAt"],
    invoke: (repo) => repo.recordLogin(USER_ID, LOGIN_AT),
    expected: { lastLoginAt: LOGIN_AT },
    missingRowError: "USER_NOT_FOUND",
  },
  {
    command: "changeRole",
    declared: ["roleId"],
    invoke: (repo) => repo.changeRole(USER_ID, NEW_ROLE_ID),
    expected: { roleId: NEW_ROLE_ID },
    missingRowError: "USER_NOT_FOUND",
  },
  {
    command: "deactivate",
    declared: ["isActive"],
    invoke: (repo) => repo.deactivate(USER_ID),
    expected: { isActive: false },
    missingRowError: "USER_NOT_FOUND",
  },
];

function sameValue(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }
  return left === right;
}

/**
 * The columns whose stored value moved, excluding the ones Prisma maintains on
 * the row's behalf. Those move on every write without any intent naming them,
 * so counting them would make every declared set wrong in the same way.
 */
function changedColumns(before: FakeCustomerUserRow, after: FakeCustomerUserRow): string[] {
  const changed: string[] = [];
  for (const column of Object.keys(before)) {
    if (FAKE_MANAGED_COLUMNS.has(column)) continue;
    const left = (before as unknown as Record<string, unknown>)[column];
    const right = (after as unknown as Record<string, unknown>)[column];
    if (!sameValue(left, right)) changed.push(column);
  }
  return changed.sort();
}

function makeEntity(overrides: Partial<CustomerUserProps> = {}): CustomerUser {
  const moment = new Date("2026-01-01T00:00:00.000Z");
  const props: CustomerUserProps = {
    id: USER_ID,
    accountId: ACCOUNT_ID,
    email: SEEDED_EMAIL,
    passwordHash: STORED_HASH,
    firstName: "Write",
    lastName: "Invariants",
    roleId: SEEDED_ROLE_ID,
    roleName: "OWNER",
    roleLevel: 100,
    permissions: new Set<string>(),
    isActive: true,
    isEmailVerified: false,
    mfaEnabled: false,
    joinedAt: moment,
    createdAt: moment,
    updatedAt: moment,
    ...overrides,
  };
  return CustomerUser.reconstitute(props);
}

describe("Customer-user write API — each command writes exactly the columns it names", () => {
  let fake: StatefulCustomerUserPrismaFake;
  let repo: PrismaCustomerUserRepository;

  beforeEach(() => {
    fake = createStatefulCustomerUserPrismaFake();
    repo = new PrismaCustomerUserRepository(fake.client);
  });

  function seedRow(overrides: Partial<FakeCustomerUserRow> = {}): FakeCustomerUserRow {
    return fake.seed({
      id: USER_ID,
      accountId: ACCOUNT_ID,
      email: SEEDED_EMAIL,
      passwordHash: STORED_HASH,
      firstName: "Write",
      lastName: "Invariants",
      roleId: SEEDED_ROLE_ID,
      isActive: true,
      resetToken: LIVE_TOKEN,
      resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
      mfaEnabled: true,
      mfaSecret: "MFA-SECRET-OWNED-ELSEWHERE",
      ...overrides,
    });
  }

  function snapshot(id: string): FakeCustomerUserRow {
    const row = fake.read(id);
    assert.ok(row, `the fixture row "${id}" must exist`);
    return { ...row };
  }

  describe("the declared column set is the whole write", () => {
    for (const testCase of UPDATE_COMMANDS) {
      it(`writes exactly [${testCase.declared.join(", ")}] when ${testCase.command} runs`, async () => {
        seedRow();
        const before = snapshot(USER_ID);

        const result = await withSystemContext(SEAM_REASON, () => testCase.invoke(repo));
        assert.ok(result.ok, `${testCase.command} must succeed against a live row`);

        const after = snapshot(USER_ID);
        assert.deepStrictEqual(
          changedColumns(before, after),
          [...testCase.declared].sort(),
          `${testCase.command} must move exactly the columns its name claims — no column may ride along from an in-memory entity`
        );

        for (const [column, value] of Object.entries(testCase.expected)) {
          assert.ok(
            sameValue((after as unknown as Record<string, unknown>)[column], value),
            `${testCase.command} must store the value it was given for "${column}"`
          );
        }
      });
    }
  });

  describe("soft-delete state survives every command", () => {
    for (const testCase of UPDATE_COMMANDS) {
      it(`leaves a soft-deleted row untouched when ${testCase.command} runs`, async () => {
        const deletedAt = new Date("2026-02-02T02:02:02.000Z");
        seedRow({ deletedAt });
        const before = snapshot(USER_ID);

        const result = await withSystemContext(SEAM_REASON, () => testCase.invoke(repo));
        assert.strictEqual(
          result.ok,
          false,
          `${testCase.command} must refuse a soft-deleted row instead of resurrecting it`
        );
        assert.strictEqual(
          result.error,
          testCase.missingRowError,
          `${testCase.command} must answer its typed no-live-row failure`
        );

        const after = snapshot(USER_ID);
        assert.deepStrictEqual(
          changedColumns(before, after),
          [],
          `${testCase.command} must not move a single column on a soft-deleted row`
        );
        assert.ok(
          sameValue(after.deletedAt, deletedAt),
          `${testCase.command} must leave deletedAt exactly as it found it`
        );
      });
    }

    it("refuses to create over a soft-deleted row's account and e-mail pair", async () => {
      const deletedAt = new Date("2026-02-02T02:02:02.000Z");
      seedRow({ deletedAt });
      const before = snapshot(USER_ID);

      const result = await withSystemContext(SEAM_REASON, () =>
        repo.create(makeEntity({ id: OTHER_USER_ID }), CREATED_HASH)
      );

      assert.strictEqual(result.ok, false, "creation must not silently take over an existing pair");
      assert.strictEqual(result.error, "EMAIL_EXISTS", "the conflict must be typed, not internal");
      assert.deepStrictEqual(
        changedColumns(before, snapshot(USER_ID)),
        [],
        "a refused creation must leave the conflicting row exactly as it was"
      );
    });
  });

  describe("the MFA columns stay with the repository that owns them", () => {
    it("names no MFA column in any declared write set", () => {
      const declaredEverywhere = new Set<string>([
        ...CREATION_COLUMNS,
        ...UPDATE_COMMANDS.flatMap((testCase) => [...testCase.declared]),
      ]);

      assert.ok(declaredEverywhere.size > 0, "the declared sets must not be empty");
      const trespassing = MFA_COLUMNS.filter((column) => declaredEverywhere.has(column));
      assert.deepStrictEqual(
        trespassing,
        [],
        "a command here writing an MFA column defeats the compare-and-set discipline the MFA repository applies to it"
      );
    });

    it("leaves the MFA columns alone when every command runs in turn", async () => {
      seedRow();
      const before = snapshot(USER_ID);

      for (const testCase of UPDATE_COMMANDS) {
        await withSystemContext(SEAM_REASON, () => testCase.invoke(repo));
      }

      const after = snapshot(USER_ID);
      assert.strictEqual(after.mfaEnabled, before.mfaEnabled, "mfaEnabled must be untouched");
      assert.strictEqual(after.mfaSecret, before.mfaSecret, "mfaSecret must be untouched");
    });
  });

  describe("exclusivity — a shared column has a named writer list", () => {
    it("matches the sanctioned writer list for every multi-writer column", () => {
      const writers = new Map<string, string[]>();
      const record = (command: string, columns: readonly string[]): void => {
        for (const column of columns) {
          writers.set(column, [...(writers.get(column) ?? []), command]);
        }
      };
      record("create", CREATION_COLUMNS);
      for (const testCase of UPDATE_COMMANDS) record(testCase.command, testCase.declared);

      const observed: Record<string, string[]> = {};
      for (const [column, commands] of writers) {
        if (commands.length > 1) observed[column] = [...commands].sort();
      }

      const sanctioned: Record<string, string[]> = {};
      for (const [column, commands] of Object.entries(SANCTIONED_WRITERS)) {
        sanctioned[column] = [...commands].sort();
      }

      assert.deepStrictEqual(
        observed,
        sanctioned,
        "every column with more than one writing intent must appear here with its exact writer list — an unnamed second writer is the ambiguity this API exists to remove"
      );
    });
  });

  describe("recording a login cannot carry a stale credential", () => {
    it("keeps the stored hash when the caller's entity holds an older one", async () => {
      seedRow();
      const staleEntity = makeEntity({ passwordHash: "$argon2id$v=19$stale-entity-hash" });
      assert.notStrictEqual(
        staleEntity.passwordHash,
        STORED_HASH,
        "the fixture must actually be stale, otherwise this test proves nothing"
      );
      const before = snapshot(USER_ID);

      const result = await withSystemContext(SEAM_REASON, () =>
        repo.recordLogin(staleEntity.id, LOGIN_AT)
      );
      assert.ok(result.ok, "recording a login against a live row must succeed");

      const after = snapshot(USER_ID);
      assert.strictEqual(
        after.passwordHash,
        before.passwordHash,
        "the stored hash must survive a login recorded from an entity that never saw it"
      );
      assert.deepStrictEqual(
        changedColumns(before, after),
        ["lastLoginAt"],
        "recording a login writes the login timestamp and nothing else"
      );
    });
  });

  describe("creation creates", () => {
    it("stores the creation columns from the entity and the hash it was handed", async () => {
      const joinedAt = new Date("2026-01-05T10:00:00.000Z");
      const inviteExpiry = new Date("2026-01-12T10:00:00.000Z");
      const entity = makeEntity({
        joinedAt,
        isEmailVerified: true,
        invitedBy: "inviter-id",
        inviteToken: "invite-token-value",
        inviteTokenExpiry: inviteExpiry,
      });

      const result = await withSystemContext(SEAM_REASON, () => repo.create(entity, CREATED_HASH));
      assert.ok(result.ok, "creating a row that does not exist must succeed");

      const stored = snapshot(USER_ID);
      assert.strictEqual(stored.accountId, ACCOUNT_ID);
      assert.strictEqual(stored.email, SEEDED_EMAIL);
      assert.strictEqual(
        stored.passwordHash,
        CREATED_HASH,
        "the hash the caller passed is the credential of record, not the one the entity happens to carry"
      );
      assert.strictEqual(stored.firstName, "Write");
      assert.strictEqual(stored.lastName, "Invariants");
      assert.strictEqual(stored.roleId, SEEDED_ROLE_ID);
      assert.strictEqual(stored.isActive, true);
      assert.strictEqual(stored.isEmailVerified, true);
      assert.strictEqual(stored.invitedBy, "inviter-id");
      assert.strictEqual(stored.inviteToken, "invite-token-value");
      assert.ok(sameValue(stored.inviteTokenExpiry, inviteExpiry));
      assert.ok(sameValue(stored.joinedAt, joinedAt));
    });

    it("carries no column the creation set does not name, however loaded the entity is", async () => {
      const entity = makeEntity({
        passwordHash: "$argon2id$v=19$entity-hash-that-must-not-win",
        mfaEnabled: true,
        mfaSecret: "ENTITY-MFA-SECRET",
        resetToken: "entity-reset-token",
        resetTokenExpiry: TOKEN_EXPIRY,
        lastLoginAt: LOGIN_AT,
        deletedAt: new Date("2026-02-02T02:02:02.000Z"),
      });

      const result = await withSystemContext(SEAM_REASON, () => repo.create(entity, CREATED_HASH));
      assert.ok(result.ok, "creating a row that does not exist must succeed");

      const stored = snapshot(USER_ID);
      assert.strictEqual(stored.passwordHash, CREATED_HASH, "the entity's hash must not win");
      assert.strictEqual(stored.mfaEnabled, false, "an entity cannot enable MFA through creation");
      assert.strictEqual(stored.mfaSecret, null, "an entity cannot plant an MFA secret");
      assert.strictEqual(stored.resetToken, null, "creation does not issue a reset token");
      assert.strictEqual(stored.resetTokenExpiry, null, "creation does not issue a token expiry");
      assert.strictEqual(stored.lastLoginAt, null, "creation does not record a login");
      assert.strictEqual(
        stored.deletedAt,
        null,
        "creation cannot produce a row that is already soft-deleted"
      );
    });

    it("answers a typed conflict instead of overwriting an existing account and e-mail pair", async () => {
      seedRow();
      const before = snapshot(USER_ID);

      const result = await withSystemContext(SEAM_REASON, () =>
        repo.create(makeEntity({ id: OTHER_USER_ID }), CREATED_HASH)
      );

      assert.strictEqual(result.ok, false, "a duplicate must not be absorbed as an update");
      assert.strictEqual(result.error, "EMAIL_EXISTS");
      assert.strictEqual(
        snapshot(USER_ID).passwordHash,
        before.passwordHash,
        "the registered user's credential must survive someone else's creation attempt"
      );
      assert.strictEqual(fake.read(OTHER_USER_ID), undefined, "no second row may appear");
    });
  });
});
