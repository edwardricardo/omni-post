/**
 * @file AuditLogRepository.ts
 * @description Repository port for audit-trail persistence — defines the contract for writing audit entries and querying them by user or resource, independent of storage technology.
 * @layer domain
 */

/**
 * Actor-type discriminator for an audit entry, modeled as a const-object union
 * (single source of truth; fitness #3 — no raw string union, no `any`). The
 * literal values are assignable to the generated Prisma `$Enums.AuditActorType`.
 *
 * - `SYSTEM`  — no actor FK (scheduled jobs, background processors)
 * - `ADMIN`   — attributed via `userId` → `AdminUser`
 * - `CUSTOMER`— attributed via `customerUserId` → `CustomerUser`
 */
export const AUDIT_ACTOR_TYPE = {
  SYSTEM: "SYSTEM",
  ADMIN: "ADMIN",
  CUSTOMER: "CUSTOMER",
} as const;

/** Union of the three audit actor-type values. */
export type AuditActorType = (typeof AUDIT_ACTOR_TYPE)[keyof typeof AUDIT_ACTOR_TYPE];

/**
 * Derive the actor discriminator from the actor FKs, ALWAYS winning over an
 * explicit `actorType` when an FK is present: `userId` → `ADMIN`,
 * `customerUserId` → `CUSTOMER`. An explicit `actorType` is honored ONLY when
 * neither FK is set (e.g. an explicit `SYSTEM` on a system row — redundant
 * but harmless). Derivation-wins makes a mislabeled row (an explicit
 * `SYSTEM` passed alongside a set FK) structurally impossible instead of
 * merely detectable by a reconciliation query — the same philosophy as the
 * database exclusive-arc CHECK. Technology-free pure function: the single
 * source of truth for every direct writer that bypasses the compiler-forced
 * `actorType` on `AuditLogCreateInput` — via an `as Parameters<>` cast
 * (`AuditService.log`, `AuditLogger.log`) or a raw create payload (`emitAudit`).
 *
 * @method deriveActorType
 * @param fields - Candidate actor FK(s) and/or an explicit `actorType`
 * @returns The resolved `AuditActorType` per the FK-wins rule
 */
export function deriveActorType(fields: {
  userId?: string;
  customerUserId?: string;
  actorType?: AuditActorType;
}): AuditActorType {
  if (fields.userId) return AUDIT_ACTOR_TYPE.ADMIN;
  if (fields.customerUserId) return AUDIT_ACTOR_TYPE.CUSTOMER;
  if (fields.actorType) return fields.actorType;
  return AUDIT_ACTOR_TYPE.SYSTEM;
}

/**
 * Normalize a direct writer's actor input into a single, arc-safe shape that can
 * never carry both FKs at once. This is the write-side complement to the database
 * exclusive-arc CHECK (`num_nonnulls(userId, customerUserId) <= 1`): rather than
 * let a caller that mistakenly forwards both FKs reach the constraint — where each
 * writer's non-rethrowing catch would silently DROP the audit row — the invalid
 * dual-FK state is made unrepresentable in the value returned here, so the row
 * always persists.
 *
 * `actorType` is resolved by {@link deriveActorType} (reused, never duplicated).
 * When BOTH FKs are present the derived type is `ADMIN` (userId wins), so the
 * customer FK is dropped and `droppedFk` is set to `"customerUserId"`, giving the
 * caller a signal to warn about its own bug. Otherwise whichever single FK is
 * present passes through untouched. The result never contains both FKs.
 *
 * A pure, technology-free function: no logging, no I/O — the warning is the
 * caller's responsibility so the domain stays free of infrastructure concerns.
 * FK presence follows the same truthiness rule as {@link deriveActorType}, so a
 * `null` or empty-string FK is treated as absent.
 *
 * @method normalizeAuditActorInput
 * @param input - Candidate actor FK(s) (possibly `null`) and/or an explicit `actorType`
 * @returns The resolved `actorType`, at most one FK, and `droppedFk` when a
 *   conflicting customer FK was discarded in favor of the admin FK
 */
export function normalizeAuditActorInput(input: {
  userId?: string | null;
  customerUserId?: string | null;
  actorType?: AuditActorType;
}): {
  actorType: AuditActorType;
  userId?: string;
  customerUserId?: string;
  droppedFk?: "customerUserId";
} {
  const userId = input.userId ? input.userId : undefined;
  const customerUserId = input.customerUserId ? input.customerUserId : undefined;
  const actorType = deriveActorType({
    ...(userId !== undefined && { userId }),
    ...(customerUserId !== undefined && { customerUserId }),
    ...(input.actorType !== undefined && { actorType: input.actorType }),
  });

  if (userId !== undefined && customerUserId !== undefined) {
    // userId wins (ADMIN); the customer FK is discarded so the exclusive arc
    // holds by construction and the caller can be warned about its bug.
    return { actorType, userId, droppedFk: "customerUserId" };
  }

  return {
    actorType,
    ...(userId !== undefined && { userId }),
    ...(customerUserId !== undefined && { customerUserId }),
  };
}

/**
 * Fields required to persist a single audit-trail entry.
 *
 * Optional keys are omitted (never set to `undefined`) so the adapter can
 * conditionally include only the columns that carry a value.
 */
export interface AuditLogCreateInput {
  action: string;
  /**
   * Actor discriminator — REQUIRED so every port write explicitly claims its
   * actor. Compiler-forces callers to declare SYSTEM / ADMIN / CUSTOMER rather
   * than relying on the DB default, so a customer write can never silently
   * degrade to a SYSTEM-labeled row.
   */
  actorType: AuditActorType;
  resource?: string;
  resourceId?: string;
  userId?: string;
  /** CUSTOMER actor FK → `CustomerUser`; exclusive with `userId` (DB CHECK). */
  customerUserId?: string;
  /**
   * Account scope for searchability — does NOT enforce isolation.
   *
   * AuditLog is kept in the tenant-guard denylist so admin compliance flows
   * can read cross-account without `withSystemContext` wrapping (immutable
   * evidence canon). Customer-facing queries scope per account via the
   * explicit filter in `findByAccount`.
   */
  accountId?: string;
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
  customerUserId: string | null;
  actorType: AuditActorType;
  accountId: string | null;
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
   * Return audit entries scoped to an account, newest first.
   *
   * Customer-facing query — the caller (route handler / use case) is
   * responsible for binding the `accountId` from the authenticated
   * `TenantContext`, never from a client-supplied parameter. AuditLog
   * is NOT in `TENANT_SCOPED_MODELS` by canon (immutable evidence outside
   * RLS); this method provides the explicit account-scoping that the
   * customer flow needs.
   *
   * @param accountId - The account whose audit trail to fetch
   * @param options - Filtering and pagination (defaults: limit 50, offset 0)
   */
  findByAccount(accountId: string, options?: AuditLogQueryOptions): Promise<AuditLogRecordDto[]>;

  /**
   * Detach a user from their audit entries by nulling the userId, preserving
   * the entries for compliance after the user is deleted.
   *
   * @param userId - Acting user's ID to anonymize
   * @returns Count of audit entries updated
   */
  anonymizeUser(userId: string): Promise<number>;

  /**
   * Detach a customer from their audit entries by nulling the customerUserId,
   * preserving the entries (and their `actorType = CUSTOMER` attribution) for
   * compliance after a DSAR erasure. Mirrors `anonymizeUser` for the CUSTOMER
   * actor dimension — one explicit method per actor FK, matching the port's
   * one-method-per-dimension style (`findByUser` / `findByResource` /
   * `findByAccount`).
   *
   * @param customerUserId - Acting customer's ID to anonymize
   * @returns Count of audit entries updated
   */
  anonymizeCustomerUser(customerUserId: string): Promise<number>;
}
