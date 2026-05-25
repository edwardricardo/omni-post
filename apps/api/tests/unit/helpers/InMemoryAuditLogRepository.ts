/**
 * @file InMemoryAuditLogRepository.ts
 * @description In-memory implementation of AuditLogRepository for unit tests.
 *              Lets tests exercise AuditableService subclasses (and the audit
 *              port contract) without a real database. Stores rows in insert
 *              order and honours newest-first reads, action filtering, and
 *              pagination, mirroring the Prisma adapter's observable semantics.
 * @layer infrastructure
 */

import type {
  AuditLogRepository,
  AuditLogCreateInput,
  AuditLogQueryOptions,
  AuditLogRecordDto,
} from "@core/domain/repositories/AuditLogRepository.js";

export class InMemoryAuditLogRepository implements AuditLogRepository {
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
      error: input.error ?? null,
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
