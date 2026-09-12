/**
 * @file mfaUserRepositoryConformance.test.ts
 * @description Port-conformance suite for `MfaUserRepositoryPort.markBackupCodeUsed`:
 *              ONE set of claim assertions runs against all THREE implementations —
 *              both Prisma adapters over a minimal stateful fake of the Prisma
 *              CLIENT (never of the repository, so each adapter builds its own
 *              predicate and its own write) and the in-memory test double. The
 *              double's semantics ARE the contract; binding all three to one suite
 *              is what turns the next divergence between a double and production
 *              into a structural failure instead of a discovery years later. The
 *              first assertion is sequential reuse — a permissive implementation
 *              cannot satisfy it.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@infra/prisma";
import type { MfaUserRepositoryPort } from "@ports/core";
import { PrismaCustomerMfaUserRepository } from "../../../../src/infrastructure/adapters/PrismaCustomerMfaUserRepository.js";
import { PrismaAdminMfaUserRepository } from "../../../../src/infrastructure/adapters/PrismaAdminMfaUserRepository.js";
import { InMemoryMfaUserRepository } from "../../helpers/InMemoryMfaUserRepository.js";

/** Index (as a string key) → ISO consumption timestamp, the persisted used-map shape. */
type UsedMap = Record<string, string>;

/** One implementation under test plus a window onto the state it persisted. */
interface ClaimSubject {
  readonly repo: MfaUserRepositoryPort;
  storedUsedMap(): UsedMap;
}

const USER_ID = "mfa-subject-1";

/**
 * Evaluate the claim's `mfaBackupUsedAt: { equals }` filter against stored state,
 * so the adapter's own predicate — not a hardcoded count — decides the outcome.
 */
function usedMapEqualsFilter(
  stored: UsedMap,
  filter: Record<string, unknown> | undefined
): boolean {
  if (!filter || !("equals" in filter)) return true;
  const equals = filter.equals;
  // A Prisma null sentinel (AnyNull) is a non-plain object. These fakes always
  // store an object map, so a sentinel comparand matches nothing here.
  if (equals === null || typeof equals !== "object") return false;
  return JSON.stringify(stored) === JSON.stringify(equals);
}

/**
 * Minimal stateful Prisma-CLIENT fake: the `findUnique` + `updateMany` surface
 * `markBackupCodeUsed` touches, over one row, for either subject delegate.
 */
function makePrismaClientFake(
  delegateName: "adminUser" | "customerUser",
  seeded: UsedMap
): { client: PrismaClient; storedUsedMap: () => UsedMap } {
  let stored: UsedMap = { ...seeded };
  const delegate = {
    findUnique: async ({
      where,
    }: {
      where: { id: string };
    }): Promise<{ id: string; mfaBackupUsedAt: UsedMap } | null> =>
      where.id === USER_ID ? { id: USER_ID, mfaBackupUsedAt: { ...stored } } : null,
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; mfaBackupUsedAt?: Record<string, unknown> };
      data: { mfaBackupUsedAt: UsedMap };
    }): Promise<{ count: number }> => {
      if (where.id !== USER_ID) return { count: 0 };
      if (!usedMapEqualsFilter(stored, where.mfaBackupUsedAt)) return { count: 0 };
      stored = { ...data.mfaBackupUsedAt };
      return { count: 1 };
    },
  };
  return {
    client: { [delegateName]: delegate } as unknown as PrismaClient,
    storedUsedMap: () => ({ ...stored }),
  };
}

const implementations: Array<[string, (seeded: UsedMap) => ClaimSubject]> = [
  [
    "PrismaCustomerMfaUserRepository",
    (seeded) => {
      const fake = makePrismaClientFake("customerUser", seeded);
      return {
        repo: new PrismaCustomerMfaUserRepository(fake.client),
        storedUsedMap: fake.storedUsedMap,
      };
    },
  ],
  [
    "PrismaAdminMfaUserRepository",
    (seeded) => {
      const fake = makePrismaClientFake("adminUser", seeded);
      return {
        repo: new PrismaAdminMfaUserRepository(fake.client),
        storedUsedMap: fake.storedUsedMap,
      };
    },
  ],
  [
    "InMemoryMfaUserRepository",
    (seeded) => {
      const repo = new InMemoryMfaUserRepository();
      repo.seed({ id: USER_ID, email: "subject@example.com", mfaBackupUsedAt: { ...seeded } });
      return { repo, storedUsedMap: (): UsedMap => repo.raw(USER_ID)?.mfaBackupUsedAt ?? {} };
    },
  ],
];

const FIRST_CLAIM_AT = new Date("2026-05-01T08:00:00.000Z");
const SECOND_CLAIM_AT = new Date("2026-05-02T09:15:00.000Z");

describe.each(implementations)("markBackupCodeUsed claim conformance: %s", (_name, make) => {
  it("refuses a sequential replay of the index it just claimed, keeping the first timestamp", async () => {
    const subject = make({});

    const first = await subject.repo.markBackupCodeUsed(USER_ID, 1, FIRST_CLAIM_AT);
    const replay = await subject.repo.markBackupCodeUsed(USER_ID, 1, SECOND_CLAIM_AT);

    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(false);
    expect(!replay.ok && replay.error).toBe("ALREADY_USED");
    expect(subject.storedUsedMap()).toEqual({ "1": FIRST_CLAIM_AT.toISOString() });
  });

  it("claims an unclaimed index and leaves prior claims intact", async () => {
    const subject = make({ "0": "2026-01-01T00:00:00.000Z" });

    const result = await subject.repo.markBackupCodeUsed(USER_ID, 2, FIRST_CLAIM_AT);

    expect(result.ok).toBe(true);
    expect(subject.storedUsedMap()).toEqual({
      "0": "2026-01-01T00:00:00.000Z",
      "2": FIRST_CLAIM_AT.toISOString(),
    });
  });

  it("refuses an already-claimed index without changing the stored map", async () => {
    const seeded: UsedMap = {
      "0": "2026-01-01T00:00:00.000Z",
      "3": "2026-02-02T00:00:00.000Z",
    };
    const subject = make(seeded);

    const result = await subject.repo.markBackupCodeUsed(USER_ID, 3, SECOND_CLAIM_AT);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe("ALREADY_USED");
    expect(subject.storedUsedMap()).toEqual(seeded);
  });

  it("returns NOT_FOUND when the subject does not exist", async () => {
    const subject = make({});

    const result = await subject.repo.markBackupCodeUsed("ghost", 0, FIRST_CLAIM_AT);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe("NOT_FOUND");
  });
});
