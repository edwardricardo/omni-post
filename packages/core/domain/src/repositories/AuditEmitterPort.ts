/**
 * @file AuditEmitterPort.ts
 * @description Port that abstracts emitting an audit-trail entry. Defined in
 *   `@core/domain` so application-layer services can depend on it without
 *   coupling to `AuditLogRepository.create()` directly (and, transitively, to
 *   the apps/api logger that the swallow-on-error path uses).
 *
 *   The contract is fire-and-forget: implementations MUST swallow persistence
 *   failures so audit-emission errors cannot break the main operation. This
 *   mirrors the compliance-critical guarantee previously provided by
 *   `AuditableService.writeAuditLog`.
 *
 *   The concrete adapter lives in apps/api (`AuditEmitterAdapter`) and wraps
 *   `AuditLogRepository` + `logger.error` on failure.
 * @layer domain
 */

/**
 * Structured audit input. Mirrors `AuditableService.log*Action` field shape.
 */
export interface AuditEmitterInput {
  /** Action verb, e.g. "SUBSCRIPTION_SUSPEND", "TRIAL_START". */
  action: string;
  /** Logical category: USER | ACCOUNT | RESOURCE | SYSTEM | SECURITY | COMPLIANCE | BILLING. */
  category: string;
  /** Optional override; the adapter falls back to a per-category default. */
  severity?: string;
  /** Acting user (admin or customer), if any. System actions omit this. */
  userId?: string;
  /** Account affected by the action, if applicable. */
  accountId?: string;
  /** Resource type touched, when the action is resource-scoped. */
  resourceType?: string;
  /** Resource id touched, when the action is resource-scoped. */
  resourceId?: string;
  /** Free-form context attached to the entry. */
  details?: Record<string, unknown>;
  /** Caller IP if available from the request context. */
  ipAddress?: string;
  /** Caller user-agent if available from the request context. */
  userAgent?: string;
  /**
   * Overall success flag. Defaults to `true` (emit-after-success is the common
   * case). Set explicitly for batch operations that may have partial failures.
   */
  success?: boolean;
  /** Failure detail recorded when `success` is `false`. */
  error?: string;
}

export interface AuditEmitterPort {
  /**
   * Persist a single audit-trail entry. Implementations MUST swallow errors
   * so audit failures do not break the main operation.
   */
  emit(input: AuditEmitterInput): Promise<void>;
}
