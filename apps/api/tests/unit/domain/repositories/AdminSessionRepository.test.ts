/**
 * @file AdminSessionRepository.test.ts
 * @description Contract tests for the admin-session port. Exercises an in-memory
 *              reference implementation against the semantics every adapter must
 *              honour: create, refresh-token rotation, per-user listing
 *              (newest-first, active-only filter, limit), bulk revoke, and bulk
 *              delete.
 * @layer infrastructure
 */
import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type {
  AdminSessionRepository,
  AdminSessionDto,
  AdminSessionCreateInput,
  AdminSessionFindOptions,
} from "../../../../src/domain/repositories/AdminSessionRepository.js";

class InMemoryAdminSessionRepository implements AdminSessionRepository {
  readonly rows: AdminSessionDto[] = [];
  private seq = 0;

  async create(input: AdminSessionCreateInput): Promise<AdminSessionDto> {
    const now = new Date(++this.seq);
    const row: AdminSessionDto = {
      id: `sess-${this.seq}`,
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      isActive: true,
      expiresAt: input.expiresAt,
      createdAt: now,
      revokedAt: null,
      csrfToken: `csrf-${this.seq}`,
      deviceId: null,
      deviceName: null,
      location: null,
      lastActivityAt: now,
      revokedBy: null,
      revokeReason: null,
    };
    this.rows.push(row);
    return row;
  }

  async updateRefreshTokenHash(id: string, refreshTokenHash: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.refreshTokenHash = refreshTokenHash;
  }

  async findByUserId(
    userId: string,
    options?: AdminSessionFindOptions
  ): Promise<AdminSessionDto[]> {
    let rows = this.rows.filter((r) => r.userId === userId);
    if (options?.activeOnly) rows = rows.filter((r) => r.isActive);
    rows = rows.slice().reverse(); // newest first
    if (options?.limit !== undefined) rows = rows.slice(0, options.limit);
    return rows;
  }

  async revokeAllForUser(userId: string): Promise<number> {
    let count = 0;
    for (const row of this.rows) {
      if (row.userId === userId && row.isActive) {
        row.isActive = false;
        row.revokedAt = new Date();
        count += 1;
      }
    }
    return count;
  }

  async deleteAllForUser(userId: string): Promise<number> {
    const before = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i]?.userId === userId) this.rows.splice(i, 1);
    }
    return before - this.rows.length;
  }
}

const input = (overrides?: Partial<AdminSessionCreateInput>): AdminSessionCreateInput => ({
  userId: "u-1",
  refreshTokenHash: "hash-1",
  expiresAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

describe("AdminSessionRepository contract", () => {
  let repo: InMemoryAdminSessionRepository;
  beforeEach(() => {
    repo = new InMemoryAdminSessionRepository();
  });

  it("creates an active session and returns it with an id", async () => {
    const session = await repo.create(input());
    assert.ok(session.id);
    assert.strictEqual(session.isActive, true);
    assert.strictEqual(session.refreshTokenHash, "hash-1");
  });

  it("stores null ipAddress/userAgent when omitted", async () => {
    const session = await repo.create(input());
    assert.strictEqual(session.ipAddress, null);
    assert.strictEqual(session.userAgent, null);
  });

  it("rotates the refresh-token hash by session id", async () => {
    const session = await repo.create(input());
    await repo.updateRefreshTokenHash(session.id, "hash-2");
    const [refreshed] = await repo.findByUserId("u-1");
    assert.strictEqual(refreshed?.refreshTokenHash, "hash-2");
  });

  it("lists a user's sessions newest first", async () => {
    await repo.create(input({ refreshTokenHash: "h1" }));
    await repo.create(input({ refreshTokenHash: "h2" }));
    const rows = await repo.findByUserId("u-1");
    assert.strictEqual(rows[0]?.refreshTokenHash, "h2");
  });

  it("honours activeOnly and limit", async () => {
    const s1 = await repo.create(input());
    await repo.create(input());
    await repo.updateRefreshTokenHash(s1.id, "x");
    await repo.revokeAllForUser("u-1");
    await repo.create(input({ refreshTokenHash: "active-again" }));
    const active = await repo.findByUserId("u-1", { activeOnly: true, limit: 1 });
    assert.strictEqual(active.length, 1);
    assert.strictEqual(active[0]?.isActive, true);
  });

  it("revokeAllForUser deactivates active sessions and returns the count", async () => {
    await repo.create(input());
    await repo.create(input());
    const count = await repo.revokeAllForUser("u-1");
    assert.strictEqual(count, 2);
    assert.strictEqual((await repo.findByUserId("u-1", { activeOnly: true })).length, 0);
  });

  it("deleteAllForUser removes the rows and returns the count", async () => {
    await repo.create(input());
    await repo.create(input({ userId: "u-2" }));
    const count = await repo.deleteAllForUser("u-1");
    assert.strictEqual(count, 1);
    assert.strictEqual(repo.rows.length, 1);
    assert.strictEqual(repo.rows[0]?.userId, "u-2");
  });
});
