/**
 * @file PrismaAdminMfaUserRepository.test.ts
 * @description Unit specs for the AdminUser-backed MfaUserRepositoryPort adapter.
 *              Drives the adapter against a stateful fake PrismaClient (no real DB):
 *              findById maps an AdminUser row to an MfaUserRecord (normalizing the
 *              used-map), the mutating methods write the right columns, the used-map
 *              merges rather than overwrites, and a missing row surfaces the typed
 *              NOT_FOUND error instead of throwing.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { PrismaClient } from "@infra/prisma";
import { PrismaAdminMfaUserRepository } from "../../../../src/infrastructure/adapters/PrismaAdminMfaUserRepository.js";

// ---------------------------------------------------------------------------
// Fake PrismaClient — a single stateful `adminUser` delegate with just the
// `findUnique` + `update` surface the adapter touches. `update` throws a
// Prisma-style P2025 for a missing row so the NOT_FOUND mapping is exercised.
// ---------------------------------------------------------------------------

interface FakeAdminUserRow {
  id: string;
  email: string;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  mfaBackupCodes: string[];
  mfaBackupUsedAt: unknown;
  mfaLastUsedTotpStep: number | null;
}

/** Evaluate the conditional-claim `OR` predicate against a stored step. */
function claimPredicateMatches(
  storedStep: number | null,
  or: Array<Record<string, unknown>> | undefined
): boolean {
  if (!or) return true;
  return or.some((clause) => {
    const cond = clause.mfaLastUsedTotpStep;
    if (cond === null) return storedStep === null;
    if (typeof cond === "object" && cond !== null && "lt" in cond) {
      const lt = (cond as { lt: number }).lt;
      return storedStep !== null && storedStep < lt;
    }
    return false;
  });
}

class PrismaP2025Error extends Error {
  readonly code = "P2025";
  constructor() {
    super(
      "An operation failed because it depends on one or more records that were required but not found."
    );
  }
}

function makeFakePrisma(seed: FakeAdminUserRow[]): {
  prisma: PrismaClient;
  rows: Map<string, FakeAdminUserRow>;
} {
  const rows = new Map<string, FakeAdminUserRow>(seed.map((r) => [r.id, { ...r }]));
  const adminUser = {
    findUnique: async ({ where }: { where: { id: string } }): Promise<FakeAdminUserRow | null> => {
      return rows.get(where.id) ?? null;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<FakeAdminUserRow> => {
      const existing = rows.get(where.id);
      if (!existing) throw new PrismaP2025Error();
      const updated = { ...existing, ...data } as FakeAdminUserRow;
      rows.set(where.id, updated);
      return updated;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; OR?: Array<Record<string, unknown>> };
      data: Record<string, unknown>;
    }): Promise<{ count: number }> => {
      const existing = rows.get(where.id);
      if (!existing) return { count: 0 };
      if (!claimPredicateMatches(existing.mfaLastUsedTotpStep, where.OR)) return { count: 0 };
      rows.set(where.id, { ...existing, ...data } as FakeAdminUserRow);
      return { count: 1 };
    },
  };
  return { prisma: { adminUser } as unknown as PrismaClient, rows };
}

const makeRow = (overrides: Partial<FakeAdminUserRow> = {}): FakeAdminUserRow => ({
  id: "admin-1",
  email: "admin@example.com",
  mfaEnabled: false,
  mfaSecret: null,
  mfaBackupCodes: [],
  mfaBackupUsedAt: {},
  mfaLastUsedTotpStep: null,
  ...overrides,
});

describe("PrismaAdminMfaUserRepository", () => {
  let rows: Map<string, FakeAdminUserRow>;
  let repo: PrismaAdminMfaUserRepository;

  beforeEach(() => {
    const fake = makeFakePrisma([
      makeRow({
        mfaEnabled: true,
        mfaSecret: "SECRET123",
        mfaBackupCodes: ["$argon2id$hashA", "$argon2id$hashB"],
        mfaBackupUsedAt: { "0": "2026-01-01T00:00:00.000Z" },
      }),
    ]);
    rows = fake.rows;
    repo = new PrismaAdminMfaUserRepository(fake.prisma);
  });

  describe("findById", () => {
    it("maps an AdminUser row to an MfaUserRecord", async () => {
      const result = await repo.findById("admin-1");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe("admin-1");
      expect(result.value.email).toBe("admin@example.com");
      expect(result.value.mfaEnabled).toBe(true);
      expect(result.value.mfaSecret).toBe("SECRET123");
      expect(result.value.mfaBackupCodes).toEqual(["$argon2id$hashA", "$argon2id$hashB"]);
      expect(result.value.mfaBackupUsedAt).toEqual({ "0": "2026-01-01T00:00:00.000Z" });
    });

    it("returns NOT_FOUND when the user does not exist", async () => {
      const result = await repo.findById("ghost");

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toBe("NOT_FOUND");
    });

    it("normalizes a null used-map to an empty object", async () => {
      const fake = makeFakePrisma([makeRow({ mfaBackupUsedAt: null })]);
      const localRepo = new PrismaAdminMfaUserRepository(fake.prisma);

      const result = await localRepo.findById("admin-1");

      expect(result.ok).toBe(true);
      expect(result.ok && result.value.mfaBackupUsedAt).toEqual({});
    });

    it("drops non-string entries from a malformed used-map", async () => {
      const fake = makeFakePrisma([
        makeRow({ mfaBackupUsedAt: { "0": "2026-01-01T00:00:00.000Z", "1": 42 } }),
      ]);
      const localRepo = new PrismaAdminMfaUserRepository(fake.prisma);

      const result = await localRepo.findById("admin-1");

      expect(result.ok && result.value.mfaBackupUsedAt).toEqual({
        "0": "2026-01-01T00:00:00.000Z",
      });
    });

    it("surfaces mfaLastUsedTotpStep on the record", async () => {
      const fake = makeFakePrisma([makeRow({ mfaLastUsedTotpStep: 42 })]);
      const localRepo = new PrismaAdminMfaUserRepository(fake.prisma);

      const result = await localRepo.findById("admin-1");

      expect(result.ok && result.value.mfaLastUsedTotpStep).toBe(42);
    });

    it("surfaces a null mfaLastUsedTotpStep when no TOTP has been consumed", async () => {
      const result = await repo.findById("admin-1");

      expect(result.ok).toBe(true);
      expect(result.ok && result.value.mfaLastUsedTotpStep).toBeNull();
    });
  });

  describe("claimTotpStep", () => {
    it("claims a fresh step over a null stored value (updateMany count 1 → CLAIMED)", async () => {
      const result = await repo.claimTotpStep("admin-1", 100);

      expect(result.ok).toBe(true);
      expect(result.ok && result.value).toBe("CLAIMED");
      expect(rows.get("admin-1")?.mfaLastUsedTotpStep).toBe(100);
    });

    it("claims a strictly-greater step over an existing one", async () => {
      const fake = makeFakePrisma([makeRow({ mfaLastUsedTotpStep: 100 })]);
      const localRepo = new PrismaAdminMfaUserRepository(fake.prisma);

      const result = await localRepo.claimTotpStep("admin-1", 101);

      expect(result.ok && result.value).toBe("CLAIMED");
      expect(fake.rows.get("admin-1")?.mfaLastUsedTotpStep).toBe(101);
    });

    it("rejects a replayed step (count 0, row present → ALREADY_USED) without advancing", async () => {
      const fake = makeFakePrisma([makeRow({ mfaLastUsedTotpStep: 100 })]);
      const localRepo = new PrismaAdminMfaUserRepository(fake.prisma);

      const result = await localRepo.claimTotpStep("admin-1", 100);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toBe("ALREADY_USED");
      expect(fake.rows.get("admin-1")?.mfaLastUsedTotpStep).toBe(100);
    });

    it("rejects an older-window step (count 0, row present → ALREADY_USED)", async () => {
      const fake = makeFakePrisma([makeRow({ mfaLastUsedTotpStep: 100 })]);
      const localRepo = new PrismaAdminMfaUserRepository(fake.prisma);

      const result = await localRepo.claimTotpStep("admin-1", 99);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toBe("ALREADY_USED");
    });

    it("returns NOT_FOUND when the user is gone (count 0, row missing)", async () => {
      const result = await repo.claimTotpStep("ghost", 100);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toBe("NOT_FOUND");
    });
  });

  describe("saveEnrollment", () => {
    it("writes the TOTP secret and hashed backup codes", async () => {
      const result = await repo.saveEnrollment("admin-1", {
        mfaSecret: "NEWSECRET",
        mfaBackupCodes: ["$argon2id$new1", "$argon2id$new2"],
      });

      expect(result.ok).toBe(true);
      const stored = rows.get("admin-1");
      expect(stored?.mfaSecret).toBe("NEWSECRET");
      expect(stored?.mfaBackupCodes).toEqual(["$argon2id$new1", "$argon2id$new2"]);
    });

    it("returns NOT_FOUND when the user is gone (P2025)", async () => {
      const result = await repo.saveEnrollment("ghost", {
        mfaSecret: "x",
        mfaBackupCodes: [],
      });

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toBe("NOT_FOUND");
    });
  });

  describe("setMfaEnabled", () => {
    it("flips the mfaEnabled flag", async () => {
      const result = await repo.setMfaEnabled("admin-1", false);

      expect(result.ok).toBe(true);
      expect(rows.get("admin-1")?.mfaEnabled).toBe(false);
    });
  });

  describe("markBackupCodeUsed", () => {
    it("merges the new index into the existing used-map", async () => {
      const usedAt = new Date("2026-02-02T12:00:00.000Z");

      const result = await repo.markBackupCodeUsed("admin-1", 1, usedAt);

      expect(result.ok).toBe(true);
      expect(rows.get("admin-1")?.mfaBackupUsedAt).toEqual({
        "0": "2026-01-01T00:00:00.000Z",
        "1": "2026-02-02T12:00:00.000Z",
      });
    });

    it("returns NOT_FOUND when the user does not exist", async () => {
      const result = await repo.markBackupCodeUsed("ghost", 0, new Date());

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toBe("NOT_FOUND");
    });
  });

  describe("replaceBackupCodes", () => {
    it("replaces the codes and resets the used-map", async () => {
      const result = await repo.replaceBackupCodes("admin-1", ["$argon2id$fresh"]);

      expect(result.ok).toBe(true);
      const stored = rows.get("admin-1");
      expect(stored?.mfaBackupCodes).toEqual(["$argon2id$fresh"]);
      expect(stored?.mfaBackupUsedAt).toEqual({});
    });
  });

  describe("clearMfa", () => {
    it("wipes every MFA field", async () => {
      const result = await repo.clearMfa("admin-1");

      expect(result.ok).toBe(true);
      const stored = rows.get("admin-1");
      expect(stored?.mfaEnabled).toBe(false);
      expect(stored?.mfaSecret).toBeNull();
      expect(stored?.mfaBackupCodes).toEqual([]);
      expect(stored?.mfaBackupUsedAt).toEqual({});
    });

    it("returns NOT_FOUND when the user is gone", async () => {
      const result = await repo.clearMfa("ghost");

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toBe("NOT_FOUND");
    });
  });
});
