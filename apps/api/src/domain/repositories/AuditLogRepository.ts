/**
 * @file AuditLogRepository.ts
 * @description Repository port for audit-trail persistence — defines the contract for writing audit entries and querying them by user or resource, independent of storage technology.
 * @layer domain
 */

/**
 * Fields required to persist a single audit-trail entry.
 *
 * Optional keys are omitted (never set to `undefined`) so the adapter can
 * conditionally include only the columns that carry a value.
 */
export interface AuditLogCreateInput {
  action: string;
  resource?: string;
  resourceId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  details: Record<string, unknown>;
  success: boolean;
  /** Failure detail recorded when `success` is false. */
  error?: string;
}

/**
 * Filtering and pagination options shared by the audit-log read methods.
 */
export interface AuditLogQueryOptions {
  limit?: number;
  offset?: number;
  action?: string;
  startDate?: Date;
  endDate?: Date;
}

/**
 * Flat DTO of a stored audit-log row.
 */
export interface AuditLogRecordDto {
  id: string;
  userId: string | null;
  action: string;
  resource: string | null;
  resourceId: string | null;
  details: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  success: boolean;
  error: string | null;
  createdAt: Date;
}

/**
 * Port interface for audit-trail persistence.
 *
 * Consumers receive this interface via constructor injection — they never
 * import a concrete Prisma implementation directly.
 */
export interface AuditLogRepository {
  /**
   * Persist a single audit-trail entry.
   *
   * @param input - Audit entry fields
   */
  create(input: AuditLogCreateInput): Promise<void>;

  /**
   * Return audit entries performed by a user, newest first.
   *
   * @param userId - Acting user's ID
   * @param options - Filtering and pagination (defaults: limit 50, offset 0)
   */
  findByUser(userId: string, options?: AuditLogQueryOptions): Promise<AuditLogRecordDto[]>;

  /**
   * Return audit entries targeting a given resource, newest first.
   *
   * @param resource - Resource type (e.g. "Account")
   * @param resourceId - Affected resource ID
   * @param options - Filtering and pagination (defaults: limit 50, offset 0)
   */
  findByResource(
    resource: string,
    resourceId: string,
    options?: AuditLogQueryOptions
  ): Promise<AuditLogRecordDto[]>;

  /**
   * Detach a user from their audit entries by nulling the userId, preserving
   * the entries for compliance after the user is deleted.
   *
   * @param userId - Acting user's ID to anonymize
   * @returns Count of audit entries updated
   */
  anonymizeUser(userId: string): Promise<number>;
}
