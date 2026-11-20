/**
 * @file CreateFirstAdministratorUseCase.ts
 * @description Creates the first administrator of a database that has none. In one transaction
 *   it writes the administration role it is given, refuses when any administrator already
 *   exists, and otherwise creates one administrator who holds that role, is named after the
 *   e-mail's local part, signs in with a single-use password and must set a new password at
 *   the first sign-in, and it writes a system audit record of the creation. The single-use
 *   password leaves the use case once, in its output.
 * @layer application
 */

import { AUTH_ERRORS, type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError } from "@core/application/UseCase.js";
import type {
  AdminUserCreateInput,
  AdminUserRepositoryPort,
} from "@core/domain/repositories/AdminUserRepository.js";
import type { AdminUserDto } from "@core/domain/repositories/ReadModelDtos.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import {
  SYSTEM_ROLE_COLLISIONS,
  type SystemRoleCollision,
  type SystemRoleDefinition,
  type SystemRoleRepository,
} from "@core/domain/repositories/SystemRoleRepository.js";
import { normalizeEmail } from "@core/domain/value-objects/EmailAddress.js";
import type { AdministratorSignInAddressRule, SingleUsePasswordGenerator } from "@ports/core";
import {
  asCause,
  issueSingleUseCredential,
  recordSystemAction,
  runInTransaction,
  type SingleUseCredential,
  type SingleUsePasswordHasher,
  type SystemAuditLog,
} from "./singleUsePassword.js";

/** The audit record of a creation: what was done and the task that did it. */
const AUDIT = {
  action: "FIRST_ADMINISTRATOR_CREATED",
  task: "create-first-admin",
} as const;

/**
 * The refusal a collision of the role write is reported with, one per collision. A switch with no
 * default, so a collision the repository adds is a compile error here until it has its refusal.
 */
function roleConflictError(collision: SystemRoleCollision, cause: Error): UseCaseError {
  switch (collision) {
    case SYSTEM_ROLE_COLLISIONS.ID:
      return UseCaseError.of(AUTH_ERRORS.ADMINISTRATION_ROLE_WRITTEN_BY_ANOTHER_RUN, { cause });
    case SYSTEM_ROLE_COLLISIONS.NAME:
      return UseCaseError.of(AUTH_ERRORS.ADMINISTRATION_ROLE_NAME_HELD, { cause });
  }
}

/** The e-mail of the administrator to create, the command's only input. */
export interface CreateFirstAdministratorInput {
  readonly email: string;
}

/** The administrator created, with the single-use password it signs in with once. */
export interface CreateFirstAdministratorOutput {
  readonly id: string;
  /** The address as stored: trimmed and lower-cased. */
  readonly email: string;
  /** The local part of the stored address. */
  readonly name: string;
  /**
   * The single-use password in plain text, returned this once; the store holds only its hash.
   * The loggers built on `REDACT_PATHS` of `@observability/logger` mask a `password` key only at
   * the top level of a logged object and one level below it (`password`, `*.password`), so the
   * password would show in a log that nests this output any deeper, as `{ result }` does at
   * `result.value.password`. The result of this use case must not be logged.
   */
  readonly password: string;
}

/** The two operations of the administrators' repository this use case calls. */
export type FirstAdministratorRepository = Pick<AdminUserRepositoryPort, "existsAny" | "create">;

/**
 * @class CreateFirstAdministratorUseCase
 * @description Creates the first administrator, once. The role is written before the refusal is
 *   decided, so that a concurrent run waits on the role's row or collides on it; when a run then
 *   refuses, only the rollback of its transaction takes that write back. The Unit of Work is
 *   therefore required: a run outside a transaction would leave the role written behind a
 *   refusal. The audit record is written in the same transaction, so a creation is never left
 *   without its record. The use case takes no logger, and the single-use password appears in no
 *   error and no message.
 */
export class CreateFirstAdministratorUseCase implements UseCase<
  CreateFirstAdministratorInput,
  CreateFirstAdministratorOutput,
  UseCaseError
> {
  constructor(
    private readonly administrators: FirstAdministratorRepository,
    private readonly systemRoles: SystemRoleRepository,
    private readonly passwordHasher: SingleUsePasswordHasher,
    private readonly passwordGenerator: SingleUsePasswordGenerator,
    private readonly addressRule: AdministratorSignInAddressRule,
    private readonly role: SystemRoleDefinition,
    private readonly auditLog: SystemAuditLog,
    private readonly unitOfWork: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Normalizes the e-mail and asks the sign-in's address rule about it, draws and
   *   hashes the single-use password outside the transaction (hashing is slow by design, and the
   *   transaction holds only the writes), then in one transaction writes the role, refuses when
   *   an administrator exists, creates the administrator with `mustChangePassword` set and writes
   *   the system audit record of the creation.
   * @param input - The e-mail of the administrator to create
   * @returns The administrator's id, e-mail and name with the single-use password on success;
   *   ADMINISTRATOR_EMAIL_INVALID or ADMINISTRATOR_EMAIL_HAS_NO_LOCAL_PART, of the validation
   *   category, for an address the sign-in's rule refuses or one with no local part;
   *   ADMINISTRATOR_ALREADY_EXISTS, ADMINISTRATION_ROLE_WRITTEN_BY_ANOTHER_RUN or
   *   ADMINISTRATION_ROLE_NAME_HELD, of the conflict category, when an administrator exists or
   *   another writer holds the role's id or its name; an error of the internal category carrying
   *   the original error when the generator, the hasher, a repository, the audit log or the
   *   transaction fails
   */
  async execute(
    input: CreateFirstAdministratorInput
  ): Promise<Result<CreateFirstAdministratorOutput, UseCaseError>> {
    const email = normalizeEmail(input.email);
    // The administrator must be able to sign in, and the command refuses a second run, so an
    // address the sign-in would refuse is refused before anything is written.
    if (!this.addressRule.accepts(email)) {
      return err(UseCaseError.of(AUTH_ERRORS.ADMINISTRATOR_EMAIL_INVALID));
    }
    // The name is required and comes from the local part, which ends at the last "@" since a
    // domain holds none; the rule's verdict is not trusted to guarantee there is one.
    const at = email.lastIndexOf("@");
    if (at < 1) {
      return err(UseCaseError.of(AUTH_ERRORS.ADMINISTRATOR_EMAIL_HAS_NO_LOCAL_PART));
    }
    const name = email.slice(0, at);

    const credential = await issueSingleUseCredential(this.passwordGenerator, this.passwordHasher);
    if (!credential.ok) {
      return credential;
    }

    return runInTransaction(
      this.unitOfWork,
      () => this.createWithinTransaction(email, name, credential.value),
      (cause) => UseCaseError.of(AUTH_ERRORS.FIRST_ADMINISTRATOR_OUTCOME_UNKNOWN, { cause })
    );
  }

  /**
   * The writes of one run, in the order that makes concurrent runs safe. Every refusal and
   * failure is returned as an `err`, which rolls the transaction back.
   */
  private async createWithinTransaction(
    email: string,
    name: string,
    credential: SingleUseCredential
  ): Promise<Result<CreateFirstAdministratorOutput, UseCaseError>> {
    const saved = await this.systemRoles.save(this.role);
    if (!saved.ok) {
      const { error } = saved;
      // The conflict is recognised by its `collision` field, a value, and not by its class,
      // whose identity is not stable across the domain package's dual export.
      if (!("collision" in error)) {
        return err(UseCaseError.of(AUTH_ERRORS.ADMINISTRATION_ROLE_WRITE_FAILED, { cause: error }));
      }
      return err(roleConflictError(error.collision, error));
    }

    const exists = await this.administrators.existsAny();
    if (!exists.ok) {
      return err(
        UseCaseError.of(AUTH_ERRORS.ADMINISTRATOR_EXISTENCE_READ_FAILED, { cause: exists.error })
      );
    }
    if (exists.value) {
      return err(UseCaseError.of(AUTH_ERRORS.ADMINISTRATOR_ALREADY_EXISTS));
    }

    const created = await this.createAdministrator({
      email,
      name,
      roleId: this.role.id,
      passwordHash: credential.passwordHash,
      mustChangePassword: true,
    });
    if (!created.ok) {
      return created;
    }
    const audited = await recordSystemAction(
      this.auditLog,
      { ...AUDIT, administratorId: created.value.id },
      (cause) => UseCaseError.of(AUTH_ERRORS.FIRST_ADMINISTRATOR_AUDIT_WRITE_FAILED, { cause })
    );
    if (!audited.ok) {
      return err(audited.error);
    }
    return ok({
      id: created.value.id,
      email: created.value.email,
      name: created.value.name,
      password: credential.password,
    });
  }

  /** Creates the administrator; the port signals a failure by raising. */
  private async createAdministrator(
    fields: AdminUserCreateInput
  ): Promise<Result<AdminUserDto, UseCaseError>> {
    try {
      return ok(await this.administrators.create(fields));
    } catch (error: unknown) {
      return err(
        UseCaseError.of(AUTH_ERRORS.ADMINISTRATOR_CREATE_FAILED, { cause: asCause(error) })
      );
    }
  }
}
