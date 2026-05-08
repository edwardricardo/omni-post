/**
 * @file GetSecretRotationStatusQuery.test.ts
 * @description Tests for the read-side query that builds rotation status DTOs.
 *              Uses an in-memory stub repository.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  GetSecretRotationStatusQuery,
  type SecretRotationLogReadRepository,
} from "../../../../src/application/security/GetSecretRotationStatusQuery.js";
import { SECRETS_CATALOG } from "../../../../src/domain/security/secretCatalog.js";

const FIXED_NOW = new Date("2026-05-06T00:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function stubRepo(
  data: Record<string, { rotatedAt: Date; rotatedBy: string | null }>
): SecretRotationLogReadRepository {
  return {
    async findLatestBySecretNames(names) {
      const result = new Map<string, { rotatedAt: Date; rotatedBy: string | null }>();
      for (const name of names) {
        if (data[name]) result.set(name, data[name]);
      }
      return result;
    },
  };
}

describe("GetSecretRotationStatusQuery", () => {
  it("returns one DTO per cataloged secret", async () => {
    const query = new GetSecretRotationStatusQuery(stubRepo({}), () => FIXED_NOW);
    const result = await query.execute();
    assert.ok(result.ok);
    assert.equal(result.value.length, SECRETS_CATALOG.length);
  });

  it("returns DTOs in catalog order", async () => {
    const query = new GetSecretRotationStatusQuery(stubRepo({}), () => FIXED_NOW);
    const result = await query.execute();
    assert.ok(result.ok);
    const dtoNames = result.value.map((d) => d.secretName);
    const catalogNames = SECRETS_CATALOG.map((e) => e.name);
    assert.deepEqual(dtoNames, catalogNames);
  });

  it("marks unknown when no rotation event exists", async () => {
    const query = new GetSecretRotationStatusQuery(stubRepo({}), () => FIXED_NOW);
    const result = await query.execute();
    assert.ok(result.ok);
    const jwt = result.value.find((d) => d.secretName === "JWT_ACCESS_SECRET");
    assert.ok(jwt);
    assert.equal(jwt.status, "UNKNOWN");
    assert.equal(jwt.lastRotatedAt, null);
    assert.equal(jwt.nextRotationAt, null);
    assert.equal(jwt.daysUntilDue, null);
  });

  it("computes OK status when rotation is recent", async () => {
    const recent = new Date(FIXED_NOW.getTime() - 30 * MS_PER_DAY);
    const repo = stubRepo({
      JWT_ACCESS_SECRET: { rotatedAt: recent, rotatedBy: null },
    });
    const query = new GetSecretRotationStatusQuery(repo, () => FIXED_NOW);
    const result = await query.execute();
    assert.ok(result.ok);
    const jwt = result.value.find((d) => d.secretName === "JWT_ACCESS_SECRET");
    assert.ok(jwt);
    assert.equal(jwt.status, "OK");
    assert.equal(jwt.lastRotatedAt, recent.toISOString());
    assert.ok(jwt.daysUntilDue !== null && jwt.daysUntilDue > 0);
  });

  it("computes OVERDUE when rotation older than cadence", async () => {
    const old = new Date(FIXED_NOW.getTime() - 400 * MS_PER_DAY);
    const repo = stubRepo({
      PLATFORM_ENCRYPTION_KEY: { rotatedAt: old, rotatedBy: "admin-1" },
    });
    const query = new GetSecretRotationStatusQuery(repo, () => FIXED_NOW);
    const result = await query.execute();
    assert.ok(result.ok);
    const kek = result.value.find((d) => d.secretName === "PLATFORM_ENCRYPTION_KEY");
    assert.ok(kek);
    assert.equal(kek.status, "OVERDUE");
    assert.equal(kek.lastRotatedBy, "admin-1");
    assert.ok(kek.daysUntilDue !== null && kek.daysUntilDue < 0);
  });

  it("emits ISO 8601 strings for timestamps (no Date leakage)", async () => {
    const date = new Date("2026-04-21T00:00:00.000Z");
    const repo = stubRepo({ COOKIE_SECRET: { rotatedAt: date, rotatedBy: null } });
    const query = new GetSecretRotationStatusQuery(repo, () => FIXED_NOW);
    const result = await query.execute();
    assert.ok(result.ok);
    const cookie = result.value.find((d) => d.secretName === "COOKIE_SECRET");
    assert.ok(cookie);
    assert.equal(typeof cookie.lastRotatedAt, "string");
    assert.equal(cookie.lastRotatedAt, date.toISOString());
    assert.equal(typeof cookie.nextRotationAt, "string");
  });

  it("includes cadenceDays from category rules", async () => {
    const repo = stubRepo({});
    const query = new GetSecretRotationStatusQuery(repo, () => FIXED_NOW);
    const result = await query.execute();
    assert.ok(result.ok);
    const jwt = result.value.find((d) => d.secretName === "JWT_ACCESS_SECRET");
    const kek = result.value.find((d) => d.secretName === "PLATFORM_ENCRYPTION_KEY");
    assert.ok(jwt && kek);
    assert.equal(jwt.cadenceDays, 90);
    assert.equal(kek.cadenceDays, 365);
  });
});
