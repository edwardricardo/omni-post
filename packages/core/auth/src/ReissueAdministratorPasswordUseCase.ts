/**
 * @file ReissueAdministratorPasswordUseCase.ts
 * @description Issues a new single-use password to an administrator whose single-use password
 *   nobody saw: one that exists, has never signed in, must still change the password and is
 *   active. Every other administrator is refused and nothing is written. In one transaction the
 *   new hash replaces the one that was read and a pending password reset is cleared, every
 *   session of the administrator ends with the re-issue as its reason, and a system audit record
 *   of the re-issue is written. The mark to change the password, the sign-in date and the
 *   password history are left as they are, so the new password must be changed at the first
 *   sign-in as the old one had to be. The single-use password leaves the use case once, in its
 *   output.
 * @layer application
 */

import { AUTH_ERRORS, type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError } from "@core/application/UseCase.js";
import {
  ADMIN_SESSION_REVOKE_REASONS,
  type AdminSessionRepository,
} from "@core/domain/repositories/AdminSessionRepository.js";
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
 * @description Re-issues the single-use password of an administrator who has never signed in,
 *   must still change the password and is active. The administrator is read before the
 *   transaction; what decides the outcome is the write, which lands only while the row is still
 *   what was read, so of two re-issues at once, or of a re-issue and the administrator's own
 *   change of the password, exactly one wins and the other writes nothing, and a re-issue whose
 *   administrator was deactivated after the read writes nothing either. The Unit of Work is
 *   required: the sessions and the audit record are written only with the password they go with.
 *   The use case takes no logger, and the single-use password appears in no error and no message.
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
   *   exists, has never signed in, must still change the password and is active; draws and
   *   hashes the new password outside the transaction, then in one transaction replaces the hash
   *   only where the row is still what was read, ends every session of the administrator with the
   *   re-issue as the reason and writes the system audit record of the re-issue.
   * @param input - The e-mail of the administrator
   * @returns The administrator's id and stored e-mail with the new single-use password on success;
   *   ADMINISTRATOR_NOT_FOUND, of the not-found category, when no administrator has the e-mail;
   *   PASSWORD_REISSUE_REFUSED_SIGNED_IN, PASSWORD_REISSUE_REFUSED_NOT_MARKED,
   *   PASSWORD_REISSUE_REFUSED_DEACTIVATED or PASSWORD_REISSUE_REFUSED_CHANGED_SINCE_READ, of the
   *   conflict category, when the administrator has signed in, is not marked to change the
   *   password, is deactivated, or changed between the read and the write; an error of the
   *   internal category carrying the original error when the read, the generator, the hasher, a
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
      (cause) => UseCaseError.of(AUTH_ERRORS.PASSWORD_REISSUE_OUTCOME_UNKNOWN, { cause })
    );
  }

  /**
   * Reads the administrator and refuses, with one code per reason, unless it exists, has never
   * signed in, must still change the password and is active. The deactivation is checked last:
   * its message tells the operator to reactivate the administrator first, which is true only of an
   * administrator the re-issue would otherwise serve.
   */
  private async readEligibleAdministrator(
    email: string
  ): Promise<Result<AdminUserCredentialsDto, UseCaseError>> {
    let found: Result<AdminUserCredentialsDto, "NOT_FOUND">;
    try {
      found = await this.administrators.findCredentialsByEmail(email);
    } catch (error: unknown) {
      return err(UseCaseError.of(AUTH_ERRORS.ADMINISTRATOR_READ_FAILED, { cause: asCause(error) }));
    }
    if (!found.ok) {
      return err(UseCaseError.of(AUTH_ERRORS.ADMINISTRATOR_NOT_FOUND));
    }
    if (found.value.lastLoginAt !== null) {
      return err(UseCaseError.of(AUTH_ERRORS.PASSWORD_REISSUE_REFUSED_SIGNED_IN));
    }
    if (!found.value.mustChangePassword) {
      return err(UseCaseError.of(AUTH_ERRORS.PASSWORD_REISSUE_REFUSED_NOT_MARKED));
    }
    if (!found.value.isActive) {
      return err(UseCaseError.of(AUTH_ERRORS.PASSWORD_REISSUE_REFUSED_DEACTIVATED));
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
        UseCaseError.of(AUTH_ERRORS.SINGLE_USE_PASSWORD_REPLACE_FAILED, { cause: replaced.error })
      );
    }
    if (!replaced.value) {
      return err(UseCaseError.of(AUTH_ERRORS.PASSWORD_REISSUE_REFUSED_CHANGED_SINCE_READ));
    }

    // A session can exist while the sign-in date is still empty, and it must not outlive the
    // password it was opened with.
    try {
      await this.sessions.revokeAllForUser(
        administrator.id,
        ADMIN_SESSION_REVOKE_REASONS.PASSWORD_REISSUED
      );
    } catch (error: unknown) {
      return err(
        UseCaseError.of(AUTH_ERRORS.ADMINISTRATOR_SESSIONS_REVOKE_FAILED, { cause: asCause(error) })
      );
    }

    const audited = await recordSystemAction(
      this.auditLog,
      { ...AUDIT, administratorId: administrator.id },
      (cause) => UseCaseError.of(AUTH_ERRORS.PASSWORD_REISSUE_AUDIT_WRITE_FAILED, { cause })
    );
    if (!audited.ok) {
      return err(audited.error);
    }
    return ok({ id: administrator.id, email: administrator.email, password: credential.password });
  }
}
