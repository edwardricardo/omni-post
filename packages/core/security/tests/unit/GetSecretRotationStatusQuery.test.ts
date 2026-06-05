/**
 * @file GetSecretRotationStatusQuery.test.ts
 * @description Unit tests for GetSecretRotationStatusQuery.
 *   Tier 3 — mocks SecretRotationLogReadRepository; verifies status DTO contract.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { GetSecretRotationStatusQuery } from "../../src/GetSecretRotationStatusQuery.js";
import type { SecretRotationLogReadRepository } from "../../src/GetSecretRotationStatusQuery.js";
import { SECRETS_CATALOG } from "@core/domain/security/secretCatalog.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRepo(
  entries: Array<{ name: string; rotatedAt: Date; rotatedBy: string | null }> = []
): SecretRotationLogReadRepository {
  return {
    findLatestBySecretNames: vi.fn(async (_names) => {
      const map = new Map<string, { rotatedAt: Date; rotatedBy: string | null }>();
      for (const entry of entries) {
        map.set(entry.name, { rotatedAt: entry.rotatedAt, rotatedBy: entry.rotatedBy });
      }
      return map;
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GetSecretRotationStatusQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("all secrets unknown — no rotation records", () => {
    it("returns ok with UNKNOWN status for all catalog entries when no records exist", async () => {
      const repo = makeRepo([]);
      const query = new GetSecretRotationStatusQuery(repo);

      const result = await query.execute();

      assert.ok(result.ok, `Expected ok, got: ${!result.ok ? result.error.message : ""}`);
      assert.strictEqual(result.value.length, SECRETS_CATALOG.length);
      for (const dto of result.value) {
        assert.strictEqual(dto.status, "UNKNOWN");
        assert.strictEqual(dto.lastRotatedAt, null);
      }
    });
  });

  describe("all-current — recently rotated", () => {
    it("returns OK status for a secret rotated within its cadence window", async () => {
      const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      const firstSecret = SECRETS_CATALOG[0]!;
      const repo = makeRepo([
        { name: firstSecret.name, rotatedAt: recentDate, rotatedBy: "admin" },
      ]);
      const fixedClock = () => new Date();
      const query = new GetSecretRotationStatusQuery(repo, fixedClock);

      const result = await query.execute();

      assert.ok(result.ok);
      const dto = result.value.find((d) => d.secretName === firstSecret.name);
      assert.ok(dto !== undefined, "Should find the DTO for the rotated secret");
      assert.strictEqual(dto.status, "OK");
      assert.ok(dto.lastRotatedAt !== null);
    });
  });

  describe("overdue secret", () => {
    it("returns OVERDUE status for a secret that exceeds its cadence by far", async () => {
      const firstSecret = SECRETS_CATALOG[0]!;
      // Rotated 400 days ago — well past the KEK 365-day cadence
      const oldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
      const repo = makeRepo([{ name: firstSecret.name, rotatedAt: oldDate, rotatedBy: "admin" }]);
      const fixedClock = () => new Date();
      const query = new GetSecretRotationStatusQuery(repo, fixedClock);

      const result = await query.execute();

      assert.ok(result.ok);
      const dto = result.value.find((d) => d.secretName === firstSecret.name);
      assert.ok(dto !== undefined);
      assert.strictEqual(dto.status, "OVERDUE");
    });
  });

  describe("repository failure", () => {
    it("returns an error result when the repository throws", async () => {
      const failingRepo: SecretRotationLogReadRepository = {
        findLatestBySecretNames: vi.fn(async () => {
          throw new Error("DB error");
        }),
      };
      const query = new GetSecretRotationStatusQuery(failingRepo);

      const result = await query.execute();

      assert.ok(!result.ok);
    });
  });
});
