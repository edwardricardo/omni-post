/**
 * @file CreateFirstAdministratorUseCase.ts
 * @description Creates the first administrator of a database that has none. In one transaction
 *   it writes the administration role it is given, refuses when any administrator already
 *   exists, and otherwise creates one administrator who holds that role, is named after the
 *   e-mail's local part, signs in with a single-use password and must set a new password at
 *   the first sign-in. The single-use password leaves the use case once, in its output.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type {
  AdminUserCreateInput,
  AdminUserRepositoryPort,
} from "@core/domain/repositories/AdminUserRepository.js";
import type { PasswordHasher } from "@core/domain/repositories/PasswordHasher.js";
import type { AdminUserDto } from "@core/domain/repositories/ReadModelDtos.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import {
  SYSTEM_ROLE_COLLISIONS,
  type SystemRoleDefinition,
  type SystemRoleRepository,
} from "@core/domain/repositories/SystemRoleRepository.js";
import { normalizeEmail } from "@core/domain/value-objects/EmailAddress.js";
import type { AdministratorSignInAddressRule, SingleUsePasswordGenerator } from "@ports/core";

const MESSAGES = {
  invalidEmail: "The e-mail is not an address the administrators' sign-in accepts",
  noLocalPart: "The e-mail has no local part to name the administrator after",
  administratorExists:
    "An administrator already exists: the first administrator is created only on a database that has none",
  roleIdHeld:
    "Another run of this command wrote the administration role first: check whether an administrator exists",
  roleNameHeld:
    "A role with the administration role's name exists under another id, so every run of this command is refused until that role is renamed or removed",
  generateFailed: "Generating the single-use password failed",
  hashFailed: "Hashing the single-use password failed",
  roleWriteFailed: "Writing the administration role failed",
  existenceReadFailed: "Reading whether an administrator exists failed",
  createFailed: "Creating the administrator failed",
  stepRaised:
    "A step inside the transaction failed; the transaction was rolled back and nothing was written",
  transactionFailed:
    "The transaction that creates the first administrator failed and its outcome is unknown: the administrator may have been created without its password being shown, so check whether an administrator exists before running the command again",
} as const;

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

/** The one operation of the password hasher this use case calls. */
export type SingleUsePasswordHasher = Pick<PasswordHasher, "hash">;

/** A drawn single-use password and the hash the store keeps of it. */
interface SingleUseCredential {
  readonly password: string;
  readonly passwordHash: string;
}

/**
 * @class CreateFirstAdministratorUseCase
 * @description Creates the first administrator, once. The role is written before the refusal is
 *   decided, so that a concurrent run waits on the role's row or collides on it; when a run then
 *   refuses, only the rollback of its transaction takes that write back. The Unit of Work is
 *   therefore required: a run outside a transaction would leave the role written behind a
 *   refusal. The use case takes no logger, and the single-use password appears in no error and
 *   no message.
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
    private readonly unitOfWork: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Normalizes the e-mail and asks the sign-in's address rule about it, draws and
   *   hashes the single-use password outside the transaction (hashing is slow by design, and the
   *   transaction holds only the writes), then in one transaction writes the role, refuses when
   *   an administrator exists, and creates the administrator with `mustChangePassword` set.
   * @param input - The e-mail of the administrator to create
   * @returns The administrator's id, e-mail and name with the single-use password on success;
   *   VALIDATION_FAILED for an address the sign-in's rule refuses or one with no local part;
   *   CONFLICT when an administrator exists or another writer holds the role; INTERNAL_ERROR
   *   carrying the original error when the generator, the hasher, a repository or the
   *   transaction fails
   */
  async execute(
    input: CreateFirstAdministratorInput
  ): Promise<Result<CreateFirstAdministratorOutput, UseCaseError>> {
    const email = normalizeEmail(input.email);
    // The administrator must be able to sign in, and the command refuses a second run, so an
    // address the sign-in would refuse is refused before anything is written.
    if (!this.addressRule.accepts(email)) {
      return err(new UseCaseError(MESSAGES.invalidEmail, USE_CASE_ERRORS.VALIDATION_FAILED));
    }
    // The name is required and comes from the local part, which ends at the last "@" since a
    // domain holds none; the rule's verdict is not trusted to guarantee there is one.
    const at = email.lastIndexOf("@");
    if (at < 1) {
      return err(new UseCaseError(MESSAGES.noLocalPart, USE_CASE_ERRORS.VALIDATION_FAILED));
    }
    const name = email.slice(0, at);

    const credential = await this.issueCredential();
    if (!credential.ok) {
      return credential;
    }

    try {
      return await this.unitOfWork.executeResultInTransaction(async () => {
        // A raise inside the work is returned as an `err`, so the transaction rolls back and the
        // outcome stays known; only what the Unit of Work itself raises reaches the catch below.
        try {
          return await this.createWithinTransaction(email, name, credential.value);
        } catch (error: unknown) {
          return err(
            new UseCaseError(MESSAGES.stepRaised, USE_CASE_ERRORS.INTERNAL_ERROR, asCause(error))
          );
        }
      });
    } catch (error: unknown) {
      return err(
        new UseCaseError(MESSAGES.transactionFailed, USE_CASE_ERRORS.INTERNAL_ERROR, asCause(error))
      );
    }
  }

  /** Draws the single-use password and hashes it. */
  private async issueCredential(): Promise<Result<SingleUseCredential, UseCaseError>> {
    let password: string;
    try {
      password = this.passwordGenerator.generate();
    } catch (error: unknown) {
      return err(
        new UseCaseError(MESSAGES.generateFailed, USE_CASE_ERRORS.INTERNAL_ERROR, asCause(error))
      );
    }
    try {
      return ok({ password, passwordHash: await this.passwordHasher.hash(password) });
    } catch (error: unknown) {
      return err(
        new UseCaseError(MESSAGES.hashFailed, USE_CASE_ERRORS.INTERNAL_ERROR, asCause(error))
      );
    }
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
        return err(
          new UseCaseError(MESSAGES.roleWriteFailed, USE_CASE_ERRORS.INTERNAL_ERROR, error)
        );
      }
      const message =
        error.collision === SYSTEM_ROLE_COLLISIONS.NAME
          ? MESSAGES.roleNameHeld
          : MESSAGES.roleIdHeld;
      return err(new UseCaseError(message, USE_CASE_ERRORS.CONFLICT, error));
    }

    const exists = await this.administrators.existsAny();
    if (!exists.ok) {
      return err(
        new UseCaseError(MESSAGES.existenceReadFailed, USE_CASE_ERRORS.INTERNAL_ERROR, exists.error)
      );
    }
    if (exists.value) {
      return err(new UseCaseError(MESSAGES.administratorExists, USE_CASE_ERRORS.CONFLICT));
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
        new UseCaseError(MESSAGES.createFailed, USE_CASE_ERRORS.INTERNAL_ERROR, asCause(error))
      );
    }
  }
}

/**
 * The cause a use-case error carries must be an `Error`. A raised value that is not one is not
 * kept, since it carries no stack and may hold any data; the `Error` that stands for it names
 * only its type, so the fact that such a value was raised is not lost.
 *
 * @param caught - The value a port raised
 * @returns That value when it is an `Error`, otherwise an `Error` naming its type
 */
function asCause(caught: unknown): Error {
  return caught instanceof Error
    ? caught
    : new Error(
        `A value that is not an Error was raised, of type ${caught === null ? "null" : typeof caught}`
      );
}
