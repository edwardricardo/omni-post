/**
 * @file ReissueAdministratorPasswordUseCase.ts
 * @description Issues a new single-use password to an administrator whose single-use password
 *   nobody saw: one that exists, has never signed in and must still change the password. Every
 *   other administrator is refused and nothing is written. In one transaction the new hash
 *   replaces the one that was read and a pending password reset is cleared, every session of the
 *   administrator ends, and a system audit record of the re-issue is written. The mark to change
 *   the password, the sign-in date and the password history are left as they are, so the new
 *   password must be changed at the first sign-in as the old one had to be. The single-use
 *   password leaves the use case once, in its output.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { AdminSessionRepository } from "@core/domain/repositories/AdminSessionRepository.js";
import type { AdminUserRepositoryPort } from "@core/domain/repositories/AdminUserRepository.js";
import type { AdminUserCredentialsDto } from "@core/domain/repositories/ReadModelDtos.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { normalizeEmail } from "@core/domain/value-objects/EmailAddress.js";
import type { SingleUsePasswordGenerator } from "@ports/core";
import {
  asCause,
  issueSingleUseCredential,
  recordSystemAction,
  runInTransaction,
  type SingleUseCredential,
  type SingleUsePasswordHasher,
  type SystemAuditLog,
} from "./singleUsePassword.js";

const MESSAGES = {
  notFound: "No administrator has this e-mail: there is no single-use password to re-issue",
  hasSignedIn:
    "This administrator has signed in, so its password is no longer a single-use password nobody saw: it is not re-issued",
  notMarked:
    "This administrator is not marked to change its password, so its password is its own and not a single-use password: it is not re-issued",
  readFailed: "Reading the administrator failed",
  replaceFailed: "Replacing the single-use password failed",
  changedSinceRead:
    "The administrator changed between the read and the write (another re-issue, a password change, a requested password reset or a sign-in), so nothing was replaced: run the re-issue again to see what is true now",
  revokeFailed: "Ending the administrator's sessions failed",
  auditFailed: "Writing the audit record of the re-issue failed",
  transactionFailed:
    "The transaction that re-issues the single-use password failed and its outcome is unknown: the password may have been replaced without the new one being shown, so run the re-issue again",
} as const;

/** The audit record of a re-issue: what was done and the task that did it. */
const AUDIT = {
  action: "ADMINISTRATOR_PASSWORD_REISSUED",
  task: "create-first-admin --reissue",
} as const;

/** The e-mail of the administrator whose single-use password is re-issued. */
export interface ReissueAdministratorPasswordInput {
  readonly email: string;
}

/** The administrator whose password was re-issued, with the new single-use password. */
export interface ReissueAdministratorPasswordOutput {
  readonly id: string;
  /** The address as stored. */
  readonly email: string;
  /**
   * The new single-use password in plain text, returned this once; the store holds only its
   * hash. The result of this use case must not be logged: the loggers mask a `password` key only
   * at the top level of a logged object and one level below it.
   */
  readonly password: string;
}

/** The two operations of the administrators' repository this use case calls. */
export type ReissueAdministratorRepository = Pick<
  AdminUserRepositoryPort,
  "findCredentialsByEmail" | "replaceSingleUsePassword"
>;

/** The one operation of the administrators' session repository this use case calls. */
export type ReissueSessionRepository = Pick<AdminSessionRepository, "revokeAllForUser">;

/**
 * @class ReissueAdministratorPasswordUseCase
 * @description Re-issues the single-use password of an administrator who has never signed in and
 *   must still change the password. The administrator is read before the transaction; what
 *   decides the outcome is the write, which lands only while the row is still what was read, so
 *   of two re-issues at once, or of a re-issue and the administrator's own change of the
 *   password, exactly one wins and the other writes nothing. The Unit of Work is required: the
 *   sessions and the audit record are written only with the password they go with. The use case
 *   takes no logger, and the single-use password appears in no error and no message.
 */
export class ReissueAdministratorPasswordUseCase implements UseCase<
  ReissueAdministratorPasswordInput,
  ReissueAdministratorPasswordOutput,
  UseCaseError
> {
  constructor(
    private readonly administrators: ReissueAdministratorRepository,
    private readonly sessions: ReissueSessionRepository,
    private readonly auditLog: SystemAuditLog,
    private readonly passwordHasher: SingleUsePasswordHasher,
    private readonly passwordGenerator: SingleUsePasswordGenerator,
    private readonly unitOfWork: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Normalizes the e-mail, reads the administrator with it and refuses unless it
   *   exists, has never signed in and must still change the password; draws and hashes the new
   *   password outside the transaction, then in one transaction replaces the hash only where the
   *   row is still what was read, ends every session of the administrator and writes the system
   *   audit record of the re-issue.
   * @param input - The e-mail of the administrator
   * @returns The administrator's id and stored e-mail with the new single-use password on success;
   *   NOT_FOUND when no administrator has the e-mail; CONFLICT when the administrator has signed
   *   in, is not marked to change the password, or changed between the read and the write;
   *   INTERNAL_ERROR carrying the original error when the read, the generator, the hasher, a
   *   repository, the audit log or the transaction fails
   */
  async execute(
    input: ReissueAdministratorPasswordInput
  ): Promise<Result<ReissueAdministratorPasswordOutput, UseCaseError>> {
    const administrator = await this.readEligibleAdministrator(normalizeEmail(input.email));
    if (!administrator.ok) {
      return administrator;
    }

    const credential = await issueSingleUseCredential(this.passwordGenerator, this.passwordHasher);
    if (!credential.ok) {
      return credential;
    }

    return runInTransaction(
      this.unitOfWork,
      () => this.reissueWithinTransaction(administrator.value, credential.value),
      MESSAGES.transactionFailed
    );
  }

  /**
   * Reads the administrator and refuses, with one message per reason, unless it exists, has never
   * signed in and must still change the password.
   */
  private async readEligibleAdministrator(
    email: string
  ): Promise<Result<AdminUserCredentialsDto, UseCaseError>> {
    let found: Result<AdminUserCredentialsDto, "NOT_FOUND">;
    try {
      found = await this.administrators.findCredentialsByEmail(email);
    } catch (error: unknown) {
      return err(
        new UseCaseError(MESSAGES.readFailed, USE_CASE_ERRORS.INTERNAL_ERROR, asCause(error))
      );
    }
    if (!found.ok) {
      return err(new UseCaseError(MESSAGES.notFound, USE_CASE_ERRORS.NOT_FOUND));
    }
    if (found.value.lastLoginAt !== null) {
      return err(new UseCaseError(MESSAGES.hasSignedIn, USE_CASE_ERRORS.CONFLICT));
    }
    if (!found.value.mustChangePassword) {
      return err(new UseCaseError(MESSAGES.notMarked, USE_CASE_ERRORS.CONFLICT));
    }
    return found;
  }

  /**
   * The writes of one re-issue. The guarded write comes first, so a row that moved since the read
   * leaves no session ended and no record written. Every refusal and failure is returned as an
   * `err`, which rolls the transaction back.
   */
  private async reissueWithinTransaction(
    administrator: AdminUserCredentialsDto,
    credential: SingleUseCredential
  ): Promise<Result<ReissueAdministratorPasswordOutput, UseCaseError>> {
    let replaced: Result<boolean, Error>;
    try {
      replaced = await this.administrators.replaceSingleUsePassword({
        id: administrator.id,
        currentPasswordHash: administrator.passwordHash,
        currentPasswordResetToken: administrator.passwordResetToken,
        passwordHash: credential.passwordHash,
      });
    } catch (error: unknown) {
      replaced = err(asCause(error));
    }
    if (!replaced.ok) {
      return err(
        new UseCaseError(MESSAGES.replaceFailed, USE_CASE_ERRORS.INTERNAL_ERROR, replaced.error)
      );
    }
    if (!replaced.value) {
      return err(new UseCaseError(MESSAGES.changedSinceRead, USE_CASE_ERRORS.CONFLICT));
    }

    // A session can exist while the sign-in date is still empty, and it must not outlive the
    // password it was opened with.
    try {
      await this.sessions.revokeAllForUser(administrator.id);
    } catch (error: unknown) {
      return err(
        new UseCaseError(MESSAGES.revokeFailed, USE_CASE_ERRORS.INTERNAL_ERROR, asCause(error))
      );
    }

    const audited = await recordSystemAction(
      this.auditLog,
      { ...AUDIT, administratorId: administrator.id },
      MESSAGES.auditFailed
    );
    if (!audited.ok) {
      return err(audited.error);
    }
    return ok({ id: administrator.id, email: administrator.email, password: credential.password });
  }
}
