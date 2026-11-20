/**
 * @file singleUsePassword.ts
 * @description What the operator's use cases for an administrator's single-use password share:
 *   drawing and hashing the password, the transaction their writes run in, the system audit
 *   record of what they did to the administrator, and the cause a use-case error keeps of a
 *   value a port raised.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import {
  AUDIT_ACTOR_TYPE,
  type AuditLogRepository,
} from "@core/domain/repositories/AuditLogRepository.js";
import type { PasswordHasher } from "@core/domain/repositories/PasswordHasher.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { SingleUsePasswordGenerator } from "@ports/core";

const MESSAGES = {
  generateFailed: "Generating the single-use password failed",
  hashFailed: "Hashing the single-use password failed",
  stepRaised:
    "A step inside the transaction failed; the transaction was rolled back and nothing was written",
} as const;

/** The resource every audit record of these use cases is about. */
const AUDITED_RESOURCE = "AdminUser";

/** The one operation of the password hasher these use cases call. */
export type SingleUsePasswordHasher = Pick<PasswordHasher, "hash">;

/** The one operation of the audit log these use cases call. */
export type SystemAuditLog = Pick<AuditLogRepository, "create">;

/** A drawn single-use password and the hash the store keeps of it. */
export interface SingleUseCredential {
  readonly password: string;
  readonly passwordHash: string;
}

/** What an operator's use case did to an administrator, as its audit record states it. */
export interface SystemActionRecord {
  /** What was done, in the audit log's upper-case vocabulary. */
  readonly action: string;
  /** The administrator it was done to. */
  readonly administratorId: string;
  /** The task that did it, the only detail the record holds. */
  readonly task: string;
}

/**
 * @function asCause
 * @description The cause a use-case error carries must be an `Error`. A raised value that is not
 *   one is not kept, since it carries no stack and may hold any data; the `Error` that stands for
 *   it names only its type, so the fact that such a value was raised is not lost.
 * @param caught - The value a port raised
 * @returns That value when it is an `Error`, otherwise an `Error` naming its type
 */
export function asCause(caught: unknown): Error {
  return caught instanceof Error
    ? caught
    : new Error(
        `A value that is not an Error was raised, of type ${caught === null ? "null" : typeof caught}`
      );
}

/**
 * @function issueSingleUseCredential
 * @description Draws a single-use password and hashes it. Hashing is slow by design, so the
 *   callers do it before their transaction opens.
 * @param generator - Draws the password
 * @param hasher - Hashes it
 * @returns The password with its hash; INTERNAL_ERROR carrying the original error when the
 *   generator or the hasher fails, with the password in neither
 */
export async function issueSingleUseCredential(
  generator: SingleUsePasswordGenerator,
  hasher: SingleUsePasswordHasher
): Promise<Result<SingleUseCredential, UseCaseError>> {
  let password: string;
  try {
    password = generator.generate();
  } catch (error: unknown) {
    return err(
      new UseCaseError(MESSAGES.generateFailed, USE_CASE_ERRORS.INTERNAL_ERROR, asCause(error))
    );
  }
  try {
    return ok({ password, passwordHash: await hasher.hash(password) });
  } catch (error: unknown) {
    return err(
      new UseCaseError(MESSAGES.hashFailed, USE_CASE_ERRORS.INTERNAL_ERROR, asCause(error))
    );
  }
}

/**
 * @function runInTransaction
 * @description Runs the writes of a use case in one transaction of the Unit of Work, which an
 *   `err` rolls back. A raise inside the work is returned as an `err` too, so the transaction
 *   rolls back and the outcome stays known; only what the Unit of Work itself raises, such as a
 *   failed commit, leaves the outcome unknown, and it is returned with the caller's message.
 * @param unitOfWork - The Unit of Work that opens the transaction
 * @param work - The writes, returning their outcome
 * @param unknownOutcomeMessage - The message of the error returned when the Unit of Work raises
 * @returns The outcome of the work; INTERNAL_ERROR carrying the original error when the work or
 *   the Unit of Work raises
 */
export async function runInTransaction<T>(
  unitOfWork: UnitOfWork,
  work: () => Promise<Result<T, UseCaseError>>,
  unknownOutcomeMessage: string
): Promise<Result<T, UseCaseError>> {
  try {
    return await unitOfWork.executeResultInTransaction(async () => {
      try {
        return await work();
      } catch (error: unknown) {
        return err(
          new UseCaseError(MESSAGES.stepRaised, USE_CASE_ERRORS.INTERNAL_ERROR, asCause(error))
        );
      }
    });
  } catch (error: unknown) {
    return err(
      new UseCaseError(unknownOutcomeMessage, USE_CASE_ERRORS.INTERNAL_ERROR, asCause(error))
    );
  }
}

/**
 * @function recordSystemAction
 * @description Writes the audit record of an action no person took on an administrator: a system
 *   actor with no user, the administrator as the resource, and the task as the only detail, never
 *   the administrator's e-mail, a password or a hash. The callers write it inside the transaction
 *   of the write it records, so a failed audit write rolls that write back.
 * @param auditLog - The audit log to write to
 * @param record - What was done, to whom and by which task
 * @param failureMessage - The message of the error returned when the write fails
 * @returns `ok` once the record is written; INTERNAL_ERROR carrying the original error when the
 *   audit log raises
 */
export async function recordSystemAction(
  auditLog: SystemAuditLog,
  record: SystemActionRecord,
  failureMessage: string
): Promise<Result<void, UseCaseError>> {
  try {
    await auditLog.create({
      action: record.action,
      actorType: AUDIT_ACTOR_TYPE.SYSTEM,
      resource: AUDITED_RESOURCE,
      resourceId: record.administratorId,
      details: { task: record.task },
      success: true,
    });
    return ok(undefined);
  } catch (error: unknown) {
    return err(new UseCaseError(failureMessage, USE_CASE_ERRORS.INTERNAL_ERROR, asCause(error)));
  }
}
