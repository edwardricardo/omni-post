/**
 * @file audit.ts
 * @description Free-function composition helpers for services that no longer
 *   inherit from `BaseService` / `AuditableService`. Two utilities:
 *
 *   1. `emitAudit(repo, input)` — replaces `AuditableService.log*Action`. Emits
 *      an audit log entry through the injected repository, swallowing any
 *      persistence error so audit failures cannot break the main operation
 *      (mirrors the compliance-critical contract of
 *      `AuditableService.writeAuditLog`).
 *
 *   2. `logServiceError(operation, error, extra?)` — replaces the
 *      `BaseService.createServiceError(...) + logError(...)` pair previously
 *      used in catch blocks. Structured error log via the module-level logger.
 *
 *   Composition over inheritance: callers receive an `AuditLogRepository`
 *   (port) via constructor and call the helpers directly. No class hierarchy,
 *   no `extends`.
 * @layer infrastructure
 */
import {
  normalizeAuditActorInput,
  type AuditActorType,
  type AuditLogRepository,
} from "@core/domain/repositories/AuditLogRepository.js";
import { logger } from "../lib/logger.js";

/**
 * Default severity by category, matching the conventions used by
 * `AuditableService.logUserAction/logAccountAction/logResourceAction`.
 */
const DEFAULT_SEVERITY: Record<string, string> = {
  USER: "INFO",
  ACCOUNT: "MEDIUM",
  RESOURCE: "LOW",
  SYSTEM: "MEDIUM",
  SECURITY: "MEDIUM",
  COMPLIANCE: "CRITICAL",
};

export interface AuditInput {
  action: string;
  category: string;
  severity?: string;
  userId?: string;
  /** CUSTOMER actor FK; exclusive with `userId` (DB CHECK). */
  customerUserId?: string;
  /** Actor discriminator; when absent it is derived from the FKs (backfill rule). */
  actorType?: AuditActorType;
  accountId?: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  /** Overall success flag; defaults to `true`. Set false for batch failures. */
  success?: boolean;
  /** Failure detail when `success` is false. */
  error?: string;
}

/**
 * @function emitAudit
 * @description Emits an audit log entry through the injected repository,
 *   swallowing any persistence error so audit failures cannot break the main
 *   operation. Mirrors the contract previously provided by
 *   `AuditableService.writeAuditLog`.
 * @param repo - AuditLogRepository port (typically injected via constructor).
 * @param input - Audit data; missing severity falls back to category default.
 */
export async function emitAudit(repo: AuditLogRepository, input: AuditInput): Promise<void> {
  const severity = input.severity ?? DEFAULT_SEVERITY[input.category] ?? "MEDIUM";
  const actor = normalizeAuditActorInput(input);
  if (actor.droppedFk !== undefined) {
    logger.warn(
      { userId: input.userId, customerUserId: input.customerUserId, action: input.action },
      "Audit actor received both userId and customerUserId; kept userId (ADMIN) and dropped customerUserId — caller bug"
    );
  }
  try {
    await repo.create({
      action: input.action,
      actorType: actor.actorType,
      details: { category: input.category, severity, ...input.details },
      success: input.success ?? true,
      ...(actor.userId !== undefined && { userId: actor.userId }),
      ...(actor.customerUserId !== undefined && { customerUserId: actor.customerUserId }),
      ...(input.accountId !== undefined && { accountId: input.accountId }),
      ...(input.resourceType !== undefined && { resource: input.resourceType }),
      ...(input.resourceId !== undefined && { resourceId: input.resourceId }),
      ...(input.ipAddress !== undefined && { ipAddress: input.ipAddress }),
      ...(input.userAgent !== undefined && { userAgent: input.userAgent }),
      ...(input.error !== undefined && { error: input.error }),
    });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error : new Error(String(error)), input },
      "Failed to emit audit log"
    );
    // swallow — audit failures must not break the main operation
  }
}

/**
 * @function logServiceError
 * @description Structured error log for service catch blocks that previously
 *   used `BaseService.createServiceError(...) + logError(...)`. Writes through
 *   the module-level logger; the caller decides what to return (typically
 *   `err("CODE")` from the `Result` pattern).
 * @param operation - Logical operation name (e.g. "startTrial").
 * @param error - The caught error (typed as `unknown`).
 * @param extra - Optional structured fields to include (accountId, userId, …).
 */
export function logServiceError(
  operation: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  logger.error(
    {
      err: error instanceof Error ? error : new Error(String(error)),
      operation,
      ...(extra ?? {}),
    },
    `Service operation failed: ${operation}`
  );
}
