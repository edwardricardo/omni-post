/**
 * @file InMemoryAuditLogRepository.ts
 * @description In-memory implementation of AuditLogRepository for unit tests.
 *              Lets tests exercise AuditableService subclasses (and the audit
 *              port contract) without a real database. Stores rows in insert
 *              order and honours newest-first reads, action filtering, and
 *              pagination, mirroring the Prisma adapter's observable semantics.
 *              `create` also enforces the exclusive-arc invariant the real
 *              database CHECK (`num_nonnulls(userId, customerUserId) <= 1`)
 *              guarantees, throwing on a dual-FK row so a normalization escape
 *              fails loudly in unit tests instead of silently persisting an
 *              invalid actor.
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
    if (input.userId !== undefined && input.customerUserId !== undefined) {
      // Mirror the DB exclusive-arc CHECK so a dual-FK escape is caught here.
      throw new Error(
        'new row for relation "AuditLog" violates check constraint "AuditLog_actor_exclusive_arc_check"'
      );
    }
    this.rows.push({
      id: `log-${++this.seq}`,
      userId: input.userId ?? null,
      customerUserId: input.customerUserId ?? null,
      actorType: input.actorType,
      accountId: input.accountId ?? null,
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

  async findByAccount(
    accountId: string,
    options?: AuditLogQueryOptions
  ): Promise<AuditLogRecordDto[]> {
    return this.paginate(
      this.rows.filter((r) => r.accountId === accountId),
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

  async anonymizeCustomerUser(customerUserId: string): Promise<number> {
    let count = 0;
    for (const row of this.rows) {
      if (row.customerUserId === customerUserId) {
        row.customerUserId = null;
        count += 1;
      }
    }
    return count;
  }
}
