/**
 * @file CreateFirstAdministratorUseCase.test.ts
 * @description Unit tests for CreateFirstAdministratorUseCase, the one-time creation of the first
 *   administrator on a database that has none. The in-memory doubles write every call into one
 *   journal, so each case asserts which ports ran, in what order, and which of them ran inside
 *   the transaction. The sign-in's address rule is a double here: which addresses it accepts is
 *   its adapter's to test, against the sign-in's own schema.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { inspect } from "node:util";
import { ok, type Result } from "@shared/types";
import { USE_CASE_ERRORS, type UseCaseError } from "@core/application/UseCase.js";
import { Permission } from "@core/domain/auth/Permission.js";
import { RepositoryFailureError } from "@core/domain/errors/RepositoryFailureError.js";
import type { AdminUserCreateInput } from "@core/domain/repositories/AdminUserRepository.js";
import type { AdminUserDto } from "@core/domain/repositories/ReadModelDtos.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import {
  SystemRoleConflictError,
  type SystemRoleDefinition,
  type SystemRoleRepository,
} from "@core/domain/repositories/SystemRoleRepository.js";
import type { AdministratorSignInAddressRule, SingleUsePasswordGenerator } from "@ports/core";
import {
  CreateFirstAdministratorUseCase,
  type FirstAdministratorRepository,
  type SingleUsePasswordHasher,
} from "../../src/CreateFirstAdministratorUseCase.js";

const OPERATOR_EMAIL = "first.admin@example.com";
const OPERATOR_NAME = "first.admin";
const SINGLE_USE_PASSWORD = "fixture-single-use-password-9f2c";
const PASSWORD_HASH = "$argon2id$v=19$m=65536,t=3,p=4$Zml4dHVyZS1zYWx0$Zml4dHVyZS1oYXNo";
const CREATED_ADMIN_ID = "admin-uuid-001";
const FIXED_DATE = new Date("2024-01-01T00:00:00Z");

const MESSAGES = {
  invalidEmail: "The e-mail is not an address the administrators' sign-in accepts",
  noLocalPart: "The e-mail has no local part to name the administrator after",
  administratorExists:
    "An administrator already exists: the first administrator is created only on a database that has none",
  roleConflict:
    "Another writer holds the administration role's id or name, as another run of this command does while it is in progress: wait for it to end, then check whether an administrator exists",
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

const JOURNAL = {
  checkAddress: "address.accepts",
  generate: "password.generate",
  hash: "password.hash",
  open: "transaction.open",
  commit: "transaction.commit",
  rollback: "transaction.rollback",
  commitFailed: "transaction.commitFailed",
  saveRole: "role.save",
  existsAny: "administrators.existsAny",
  create: "administrators.create",
} as const;

/** What the doubles answer; an absent key takes the answer of a database that has no administrator. */
interface HarnessOptions {
  readonly addressAccepted?: boolean;
  readonly generateFailure?: Error;
  readonly hashFailure?: Error;
  readonly roleSave?: Result<void, SystemRoleConflictError | RepositoryFailureError>;
  readonly existsAny?: Result<boolean, RepositoryFailureError>;
  /** A value `save` raises instead of returning its `Result`. */
  readonly saveRaise?: unknown;
  /** A value `existsAny` raises instead of returning its `Result`. */
  readonly existsAnyRaise?: unknown;
  readonly createFailure?: unknown;
  readonly commitFailure?: Error;
}

/** The use case wired to in-memory doubles, and what each double recorded. */
interface Harness {
  readonly useCase: CreateFirstAdministratorUseCase;
  readonly definition: SystemRoleDefinition;
  readonly journal: string[];
  readonly checkedAddresses: string[];
  readonly savedDefinitions: SystemRoleDefinition[];
  readonly createdInputs: AdminUserCreateInput[];
  readonly hashedPlaintexts: string[];
  readonly transactionOutcomes: Array<Result<unknown, unknown>>;
}

function makeRoleDefinition(): SystemRoleDefinition {
  return {
    id: "role-super-admin",
    name: "SUPER_ADMIN",
    description: "Full access to the administration portal",
    level: 100,
    isSystem: true,
    permissions: [Permission.USER_READ, Permission.USER_MANAGE],
  };
}

/** The conflict the role repository returns when another writer holds the role's id or name. */
function makeRoleConflict(): SystemRoleConflictError {
  return new SystemRoleConflictError(new Error("fixture: the store's unique violation"));
}

function makeAdminUserDto(overrides: Partial<AdminUserDto> = {}): AdminUserDto {
  return {
    id: CREATED_ADMIN_ID,
    email: OPERATOR_EMAIL,
    name: OPERATOR_NAME,
    role: "SUPER_ADMIN",
    isActive: true,
    emailVerified: false,
    lastLoginAt: null,
    mfaEnabled: false,
    passwordHashAlgo: "argon2id",
    passwordChangedAt: FIXED_DATE,
    mustChangePassword: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lockReason: null,
    maxConcurrentSessions: 5,
    timezone: null,
    locale: null,
    department: null,
    team: null,
    avatarUrl: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

function makeUnitOfWork(
  journal: string[],
  outcomes: Array<Result<unknown, unknown>>,
  options: HarnessOptions
): UnitOfWork {
  return {
    async executeInTransaction<T>(fn: () => Promise<T>): Promise<T> {
      journal.push("transaction.executeInTransaction");
      return fn();
    },
    async executeResultInTransaction<T, E>(fn: () => Promise<Result<T, E>>): Promise<Result<T, E>> {
      journal.push(JOURNAL.open);
      let outcome: Result<T, E>;
      try {
        outcome = await fn();
      } catch (error: unknown) {
        journal.push(JOURNAL.rollback);
        throw error;
      }
      outcomes.push(outcome);
      if (!outcome.ok) {
        journal.push(JOURNAL.rollback);
        return outcome;
      }
      if (options.commitFailure !== undefined) {
        journal.push(JOURNAL.commitFailed);
        throw options.commitFailure;
      }
      journal.push(JOURNAL.commit);
      return outcome;
    },
  };
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const journal: string[] = [];
  const checkedAddresses: string[] = [];
  const savedDefinitions: SystemRoleDefinition[] = [];
  const createdInputs: AdminUserCreateInput[] = [];
  const hashedPlaintexts: string[] = [];
  const transactionOutcomes: Array<Result<unknown, unknown>> = [];
  const definition = makeRoleDefinition();

  const administrators: FirstAdministratorRepository = {
    async existsAny() {
      journal.push(JOURNAL.existsAny);
      if (options.existsAnyRaise !== undefined) {
        throw options.existsAnyRaise;
      }
      return options.existsAny ?? ok(false);
    },
    async create(input: AdminUserCreateInput) {
      journal.push(JOURNAL.create);
      createdInputs.push(input);
      if (options.createFailure !== undefined) {
        throw options.createFailure;
      }
      return makeAdminUserDto({
        email: input.email,
        name: input.name,
        mustChangePassword: input.mustChangePassword === true,
      });
    },
  };
  const systemRoles: SystemRoleRepository = {
    async save(saved: SystemRoleDefinition) {
      journal.push(JOURNAL.saveRole);
      savedDefinitions.push(saved);
      if (options.saveRaise !== undefined) {
        throw options.saveRaise;
      }
      return options.roleSave ?? ok(undefined);
    },
  };
  const passwordHasher: SingleUsePasswordHasher = {
    async hash(plaintext: string) {
      journal.push(JOURNAL.hash);
      hashedPlaintexts.push(plaintext);
      if (options.hashFailure !== undefined) {
        throw options.hashFailure;
      }
      return PASSWORD_HASH;
    },
  };
  const passwordGenerator: SingleUsePasswordGenerator = {
    generate() {
      journal.push(JOURNAL.generate);
      if (options.generateFailure !== undefined) {
        throw options.generateFailure;
      }
      return SINGLE_USE_PASSWORD;
    },
  };
  const addressRule: AdministratorSignInAddressRule = {
    accepts(address: string) {
      journal.push(JOURNAL.checkAddress);
      checkedAddresses.push(address);
      return options.addressAccepted ?? true;
    },
  };

  const useCase = new CreateFirstAdministratorUseCase(
    administrators,
    systemRoles,
    passwordHasher,
    passwordGenerator,
    addressRule,
    definition,
    makeUnitOfWork(journal, transactionOutcomes, options)
  );
  return {
    useCase,
    definition,
    journal,
    checkedAddresses,
    savedDefinitions,
    createdInputs,
    hashedPlaintexts,
    transactionOutcomes,
  };
}

/** Narrows a failed outcome to its error, failing the case when the outcome succeeded. */
function expectFailure<T>(result: Result<T, UseCaseError>): UseCaseError {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("Expected a failed outcome, got a success");
  }
  return result.error;
}

/** Narrows a successful outcome to its value, failing the case when the outcome failed. */
function expectSuccess<T>(result: Result<T, UseCaseError>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected a success, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

/** The journal of a run before its first write: address checked, password drawn and hashed, transaction opened. */
const BEFORE_THE_TRANSACTION = [
  JOURNAL.checkAddress,
  JOURNAL.generate,
  JOURNAL.hash,
  JOURNAL.open,
] as const;

describe("CreateFirstAdministratorUseCase", () => {
  describe("on a database that has no administrator", () => {
    it("returns the created administrator and its single-use password when the e-mail is valid", async () => {
      const harness = makeHarness();

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const expectedOutput = {
        id: CREATED_ADMIN_ID,
        email: OPERATOR_EMAIL,
        name: OPERATOR_NAME,
        password: SINGLE_USE_PASSWORD,
      };
      expect(result).toEqual(ok(expectedOutput));
      expect(harness.checkedAddresses).toEqual([OPERATOR_EMAIL]);
      expect(harness.journal).toEqual([
        ...BEFORE_THE_TRANSACTION,
        JOURNAL.saveRole,
        JOURNAL.existsAny,
        JOURNAL.create,
        JOURNAL.commit,
      ]);
      expect(harness.transactionOutcomes).toEqual([ok(expectedOutput)]);
    });

    it("returns success after writing the role with exactly the definition it was given", async () => {
      const harness = makeHarness();

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      expect(result.ok).toBe(true);
      expect(harness.savedDefinitions).toHaveLength(1);
      expect(harness.savedDefinitions[0]).toBe(harness.definition);
      expect(harness.savedDefinitions[0]).toEqual(makeRoleDefinition());
    });

    it("returns success after creating the administrator with the role's id, the hash of the generated password and mustChangePassword true", async () => {
      const harness = makeHarness();

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      expect(result.ok).toBe(true);
      expect(harness.hashedPlaintexts).toEqual([SINGLE_USE_PASSWORD]);
      expect(harness.createdInputs).toEqual([
        {
          email: OPERATOR_EMAIL,
          name: OPERATOR_NAME,
          roleId: harness.definition.id,
          passwordHash: PASSWORD_HASH,
          mustChangePassword: true,
        },
      ]);
      expect(inspect(harness.createdInputs, { depth: null })).not.toContain(SINGLE_USE_PASSWORD);
    });

    it.each([
      {
        email: "first.admin@example.com",
        stored: "first.admin@example.com",
        name: "first.admin",
      },
      {
        email: "ops+setup@example.com",
        stored: "ops+setup@example.com",
        name: "ops+setup",
      },
      {
        email: "Ops.Lead@Example.COM",
        stored: "ops.lead@example.com",
        name: "ops.lead",
      },
      {
        email: "  maria.o'neil@example.co.uk  ",
        stored: "maria.o'neil@example.co.uk",
        name: "maria.o'neil",
      },
      {
        email: "a@b@example.com",
        stored: "a@b@example.com",
        name: "a@b",
      },
    ])(
      "returns the administrator named $name, after asking the rule about '$stored', when the e-mail is '$email'",
      async ({ email, stored, name }) => {
        const harness = makeHarness();

        const result = await harness.useCase.execute({ email });

        expect(result).toEqual(
          ok({ id: CREATED_ADMIN_ID, email: stored, name, password: SINGLE_USE_PASSWORD })
        );
        expect(harness.checkedAddresses).toEqual([stored]);
        expect(harness.createdInputs).toHaveLength(1);
        expect(harness.createdInputs[0]?.email).toBe(stored);
        expect(harness.createdInputs[0]?.name).toBe(name);
      }
    );
  });

  describe("refusals", () => {
    it("refuses with CONFLICT from inside the transaction when an administrator exists", async () => {
      const harness = makeHarness({ existsAny: ok(true) });

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const error = expectFailure(result);
      expect(error.code).toBe(USE_CASE_ERRORS.CONFLICT);
      expect(error.message).toBe(MESSAGES.administratorExists);
      expect(error.cause).toBeUndefined();
      expect(harness.transactionOutcomes).toHaveLength(1);
      expect(harness.transactionOutcomes[0]).toEqual({ ok: false, error });
      expect(harness.journal).toEqual([
        ...BEFORE_THE_TRANSACTION,
        JOURNAL.saveRole,
        JOURNAL.existsAny,
        JOURNAL.rollback,
      ]);
      expect(harness.createdInputs).toEqual([]);
    });

    it("refuses with CONFLICT and its own message when another writer holds the role", async () => {
      const conflict = makeRoleConflict();
      const harness = makeHarness({ roleSave: { ok: false, error: conflict } });

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const error = expectFailure(result);
      expect(error.code).toBe(USE_CASE_ERRORS.CONFLICT);
      expect(error.message).toBe(MESSAGES.roleConflict);
      expect(error.message).not.toBe(MESSAGES.administratorExists);
      expect(error.cause).toBe(conflict);
      expect(harness.transactionOutcomes).toEqual([{ ok: false, error }]);
      expect(harness.journal).toEqual([
        ...BEFORE_THE_TRANSACTION,
        JOURNAL.saveRole,
        JOURNAL.rollback,
      ]);
      expect(harness.createdInputs).toEqual([]);
    });
  });

  describe("failures", () => {
    it("returns INTERNAL_ERROR carrying the repository's error when the role write fails", async () => {
      const failure = new RepositoryFailureError(
        "Writing a system role failed",
        new Error("socket closed")
      );
      const harness = makeHarness({ roleSave: { ok: false, error: failure } });

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const error = expectFailure(result);
      expect(error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
      expect(error.message).toBe(MESSAGES.roleWriteFailed);
      expect(error.cause).toBe(failure);
      expect(error.originalError).toBe(failure);
      expect(harness.transactionOutcomes).toEqual([{ ok: false, error }]);
      expect(harness.journal).toEqual([
        ...BEFORE_THE_TRANSACTION,
        JOURNAL.saveRole,
        JOURNAL.rollback,
      ]);
      expect(harness.createdInputs).toEqual([]);
    });

    it("returns INTERNAL_ERROR carrying the repository's error when reading whether an administrator exists fails", async () => {
      const failure = new RepositoryFailureError(
        "Reading whether an admin user exists failed",
        new Error("connection reset")
      );
      const harness = makeHarness({ existsAny: { ok: false, error: failure } });

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const error = expectFailure(result);
      expect(error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
      expect(error.message).toBe(MESSAGES.existenceReadFailed);
      expect(error.cause).toBe(failure);
      expect(harness.transactionOutcomes).toEqual([{ ok: false, error }]);
      expect(harness.journal).toEqual([
        ...BEFORE_THE_TRANSACTION,
        JOURNAL.saveRole,
        JOURNAL.existsAny,
        JOURNAL.rollback,
      ]);
      expect(harness.createdInputs).toEqual([]);
    });

    it("returns INTERNAL_ERROR carrying the raised error, from inside the transaction, when creating the administrator fails", async () => {
      const failure = new Error("unique constraint on email");
      const harness = makeHarness({ createFailure: failure });

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const error = expectFailure(result);
      expect(error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
      expect(error.message).toBe(MESSAGES.createFailed);
      expect(error.cause).toBe(failure);
      expect(harness.transactionOutcomes).toEqual([{ ok: false, error }]);
      expect(harness.journal).toEqual([
        ...BEFORE_THE_TRANSACTION,
        JOURNAL.saveRole,
        JOURNAL.existsAny,
        JOURNAL.create,
        JOURNAL.rollback,
      ]);
    });

    it("returns INTERNAL_ERROR whose cause names only the type when creating the administrator raises a value that is not an Error", async () => {
      const raised = { detail: "socket closed" };
      const harness = makeHarness({ createFailure: raised });

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const error = expectFailure(result);
      expect(error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
      expect(error.message).toBe(MESSAGES.createFailed);
      expect(error.cause).toBeInstanceOf(Error);
      expect(error.originalError?.message).toBe(
        "A value that is not an Error was raised, of type object"
      );
      expect(inspect(error, { depth: null })).not.toContain(raised.detail);
      expect(harness.transactionOutcomes).toEqual([{ ok: false, error }]);
      expect(harness.journal).toEqual([
        ...BEFORE_THE_TRANSACTION,
        JOURNAL.saveRole,
        JOURNAL.existsAny,
        JOURNAL.create,
        JOURNAL.rollback,
      ]);
    });

    it("returns INTERNAL_ERROR carrying the hasher's error, before any transaction, when hashing fails", async () => {
      const failure = new Error("argon2 out of memory");
      const harness = makeHarness({ hashFailure: failure });

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const error = expectFailure(result);
      expect(error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
      expect(error.message).toBe(MESSAGES.hashFailed);
      expect(error.cause).toBe(failure);
      expect(harness.journal).toEqual([JOURNAL.checkAddress, JOURNAL.generate, JOURNAL.hash]);
      expect(harness.transactionOutcomes).toEqual([]);
      expect(harness.savedDefinitions).toEqual([]);
      expect(harness.createdInputs).toEqual([]);
    });

    it("returns INTERNAL_ERROR carrying the generator's error, before hashing, when drawing the password fails", async () => {
      const failure = new Error("no random source");
      const harness = makeHarness({ generateFailure: failure });

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const error = expectFailure(result);
      expect(error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
      expect(error.message).toBe(MESSAGES.generateFailed);
      expect(error.cause).toBe(failure);
      expect(harness.journal).toEqual([JOURNAL.checkAddress, JOURNAL.generate]);
      expect(harness.hashedPlaintexts).toEqual([]);
      expect(harness.transactionOutcomes).toEqual([]);
    });

    it("returns INTERNAL_ERROR carrying the raised error when the transaction itself fails", async () => {
      const failure = new Error("could not commit");
      const harness = makeHarness({ commitFailure: failure });

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const error = expectFailure(result);
      expect(error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
      expect(error.message).toBe(MESSAGES.transactionFailed);
      expect(error.cause).toBe(failure);
      expect(harness.journal).toEqual([
        ...BEFORE_THE_TRANSACTION,
        JOURNAL.saveRole,
        JOURNAL.existsAny,
        JOURNAL.create,
        JOURNAL.commitFailed,
      ]);
    });

    it.each([
      {
        call: "the role write",
        options: { saveRaise: new Error("driver crashed") },
        journalAfterOpen: [JOURNAL.saveRole],
      },
      {
        call: "reading whether an administrator exists",
        options: { existsAnyRaise: new Error("driver crashed") },
        journalAfterOpen: [JOURNAL.saveRole, JOURNAL.existsAny],
      },
    ] satisfies ReadonlyArray<{
      call: string;
      options: HarnessOptions;
      journalAfterOpen: readonly string[];
    }>)(
      "returns INTERNAL_ERROR from inside the transaction, rolled back, when $call raises instead of returning its Result",
      async ({ options, journalAfterOpen }) => {
        const raised = options.saveRaise ?? options.existsAnyRaise;
        const harness = makeHarness(options);

        const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

        const error = expectFailure(result);
        expect(error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
        expect(error.message).toBe(MESSAGES.stepRaised);
        expect(error.cause).toBe(raised);
        expect(harness.transactionOutcomes).toEqual([{ ok: false, error }]);
        expect(harness.journal).toEqual([
          ...BEFORE_THE_TRANSACTION,
          ...journalAfterOpen,
          JOURNAL.rollback,
        ]);
        expect(harness.createdInputs).toEqual([]);
        expect(inspect(error, { depth: null, showHidden: true })).not.toContain(
          SINGLE_USE_PASSWORD
        );
      }
    );

    it("returns INTERNAL_ERROR from inside the transaction, rolled back, whose cause names only the type when the role write raises a value that is not an Error", async () => {
      const raised = "connection lost to the primary";
      const harness = makeHarness({ saveRaise: raised });

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const error = expectFailure(result);
      expect(error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
      expect(error.message).toBe(MESSAGES.stepRaised);
      expect(error.cause).toBeInstanceOf(Error);
      expect(error.originalError?.message).toBe(
        "A value that is not an Error was raised, of type string"
      );
      expect(harness.transactionOutcomes).toEqual([{ ok: false, error }]);
      expect(harness.journal).toEqual([
        ...BEFORE_THE_TRANSACTION,
        JOURNAL.saveRole,
        JOURNAL.rollback,
      ]);
      expect(harness.createdInputs).toEqual([]);
      const inspected = inspect(error, { depth: null, showHidden: true });
      expect(inspected).not.toContain(raised);
      expect(inspected).not.toContain(SINGLE_USE_PASSWORD);
    });
  });

  describe("validation", () => {
    it("refuses with VALIDATION_FAILED, touching no other port, when the sign-in's rule refuses the normalized address", async () => {
      const harness = makeHarness({ addressAccepted: false });

      const result = await harness.useCase.execute({ email: "  First.Admin@Example.COM " });

      const error = expectFailure(result);
      expect(error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
      expect(error.message).toBe(MESSAGES.invalidEmail);
      expect(harness.checkedAddresses).toEqual([OPERATOR_EMAIL]);
      expect(harness.journal).toEqual([JOURNAL.checkAddress]);
    });

    it.each([{ email: "first.admin" }, { email: "@example.com" }])(
      "refuses with VALIDATION_FAILED, touching no other port, when the rule accepts '$email', which has no local part",
      async ({ email }) => {
        const harness = makeHarness({ addressAccepted: true });

        const result = await harness.useCase.execute({ email });

        const error = expectFailure(result);
        expect(error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
        expect(error.message).toBe(MESSAGES.noLocalPart);
        expect(harness.checkedAddresses).toEqual([email]);
        expect(harness.journal).toEqual([JOURNAL.checkAddress]);
      }
    );
  });

  describe("the single-use password", () => {
    it.each([
      { outcome: "the hasher fails", options: { hashFailure: new Error("argon2 out of memory") } },
      { outcome: "an administrator exists", options: { existsAny: ok(true) } },
      {
        outcome: "the role is held by another writer",
        options: { roleSave: { ok: false, error: makeRoleConflict() } },
      },
      {
        outcome: "the role write fails",
        options: {
          roleSave: {
            ok: false,
            error: new RepositoryFailureError("Writing a system role failed", new Error("down")),
          },
        },
      },
      {
        outcome: "reading whether an administrator exists fails",
        options: {
          existsAny: {
            ok: false,
            error: new RepositoryFailureError("Reading failed", new Error("down")),
          },
        },
      },
      {
        outcome: "creating the administrator fails",
        options: { createFailure: new Error("down") },
      },
      {
        outcome: "the transaction fails",
        options: { commitFailure: new Error("could not commit") },
      },
    ] satisfies ReadonlyArray<{ outcome: string; options: HarnessOptions }>)(
      "returns an error that holds the password nowhere when $outcome",
      async ({ options }) => {
        const harness = makeHarness(options);

        const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

        const error = expectFailure(result);
        expect(harness.hashedPlaintexts).toEqual([SINGLE_USE_PASSWORD]);
        expect(error.message).not.toContain(SINGLE_USE_PASSWORD);
        expect(inspect(error, { depth: null, showHidden: true })).not.toContain(
          SINGLE_USE_PASSWORD
        );
      }
    );

    it("returns the password under the key password and nowhere else in the output when the administrator is created", async () => {
      const harness = makeHarness();

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const output = expectSuccess(result);
      const { password, ...rest } = output;
      expect(password).toBe(SINGLE_USE_PASSWORD);
      expect(Object.keys(output).sort()).toEqual(["email", "id", "name", "password"]);
      expect(inspect(rest, { depth: null })).not.toContain(SINGLE_USE_PASSWORD);
    });
  });
});
