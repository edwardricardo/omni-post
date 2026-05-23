/**
 * @file AuditLogRepository.test.ts
 * @description Contract tests for the audit-log port. Exercises an in-memory
 *              reference implementation against the semantics every adapter must
 *              honour: create, user/resource lookup (newest-first, action filter,
 *              pagination), and compliance-preserving user anonymization.
 * @layer infrastructure
 */
import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type {
  AuditLogRepository,
  AuditLogCreateInput,
  AuditLogQueryOptions,
  AuditLogRecordDto,
} from "../../../../src/domain/repositories/AuditLogRepository.js";

class InMemoryAuditLogRepository implements AuditLogRepository {
  readonly rows: AuditLogRecordDto[] = [];
  private seq = 0;

  async create(input: AuditLogCreateInput): Promise<void> {
    this.rows.push({
      id: `log-${++this.seq}`,
      userId: input.userId ?? null,
      action: input.action,
      resource: input.resource ?? null,
      resourceId: input.resourceId ?? null,
      details: input.details,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      success: input.success,
      error: null,
      createdAt: new Date(this.seq), // monotonic insert order
    });
  }

  private paginate(rows: AuditLogRecordDto[], options?: AuditLogQueryOptions): AuditLogRecordDto[] {
    let filtered = rows;
    if (options?.action !== undefined) {
      filtered = filtered.filter((r) => r.action === options.action);
    }
    const newestFirst = filtered.slice().reverse();
    const skip = options?.offset ?? 0;
    const take = options?.limit ?? 50;
    return newestFirst.slice(skip, skip + take);
  }

  async findByUser(userId: string, options?: AuditLogQueryOptions): Promise<AuditLogRecordDto[]> {
    return this.paginate(
      this.rows.filter((r) => r.userId === userId),
      options
    );
  }

  async findByResource(
    resource: string,
    resourceId: string,
    options?: AuditLogQueryOptions
  ): Promise<AuditLogRecordDto[]> {
    return this.paginate(
      this.rows.filter((r) => r.resource === resource && r.resourceId === resourceId),
      options
    );
  }

  async anonymizeUser(userId: string): Promise<number> {
    let count = 0;
    for (const row of this.rows) {
      if (row.userId === userId) {
        row.userId = null;
        count += 1;
      }
    }
    return count;
  }
}

const entry = (overrides?: Partial<AuditLogCreateInput>): AuditLogCreateInput => ({
  action: "USER_LOGIN",
  details: { category: "AUTHENTICATION" },
  success: true,
  ...overrides,
});

describe("AuditLogRepository contract", () => {
  let repo: InMemoryAuditLogRepository;
  beforeEach(() => {
    repo = new InMemoryAuditLogRepository();
  });

  it("returns the entry from findByUser after create", async () => {
    await repo.create(entry({ userId: "u-1" }));
    const rows = await repo.findByUser("u-1");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]?.action, "USER_LOGIN");
    assert.strictEqual(rows[0]?.success, true);
  });

  it("omits userId/resource when not provided (stored as null)", async () => {
    await repo.create(entry());
    const all = repo.rows;
    assert.strictEqual(all[0]?.userId, null);
    assert.strictEqual(all[0]?.resource, null);
  });

  it("filters findByUser by action", async () => {
    await repo.create(entry({ userId: "u-1", action: "USER_LOGIN" }));
    await repo.create(entry({ userId: "u-1", action: "MFA_ENABLED" }));
    const rows = await repo.findByUser("u-1", { action: "MFA_ENABLED" });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]?.action, "MFA_ENABLED");
  });

  it("returns newest first and respects limit/offset", async () => {
    await repo.create(entry({ userId: "u-1", action: "A" }));
    await repo.create(entry({ userId: "u-1", action: "B" }));
    await repo.create(entry({ userId: "u-1", action: "C" }));
    const page = await repo.findByUser("u-1", { limit: 1, offset: 1 });
    assert.strictEqual(page.length, 1);
    assert.strictEqual(page[0]?.action, "B");
  });

  it("scopes findByResource to resource + resourceId", async () => {
    await repo.create(entry({ resource: "Account", resourceId: "a-1" }));
    await repo.create(entry({ resource: "Account", resourceId: "a-2" }));
    const rows = await repo.findByResource("Account", "a-1");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]?.resourceId, "a-1");
  });

  it("anonymizeUser nulls userId, preserves the rows, and returns the count", async () => {
    await repo.create(entry({ userId: "u-1" }));
    await repo.create(entry({ userId: "u-1" }));
    await repo.create(entry({ userId: "u-2" }));
    const count = await repo.anonymizeUser("u-1");
    assert.strictEqual(count, 2);
    assert.strictEqual((await repo.findByUser("u-1")).length, 0);
    assert.strictEqual(repo.rows.length, 3);
    assert.strictEqual((await repo.findByUser("u-2")).length, 1);
  });
});
