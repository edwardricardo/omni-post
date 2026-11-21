/**
 * @file ReissueAdministratorPasswordUseCase.test.ts
 * @description Unit tests for ReissueAdministratorPasswordUseCase, which issues a new single-use
 *   password to an administrator who exists, has never signed in and is still marked to change the
 *   password. The doubles write every call into one journal, so each case asserts which ports ran,
 *   in what order, and which of them ran inside the transaction. Whether the guarded write matches
 *   a row is the repository's to decide against the store; here its answer is given.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { inspect } from "node:util";
import { ERROR_CATEGORY, err, ok, type Result } from "@shared/types";
import type { UseCaseError } from "@core/application/UseCase.js";
import { RepositoryFailureError } from "@core/domain/errors/RepositoryFailureError.js";
import type { AdminSessionRevokeReason } from "@core/domain/repositories/AdminSessionRepository.js";
import type { SingleUsePasswordReplacement } from "@core/domain/repositories/AdminUserRepository.js";
import type { AuditLogCreateInput } from "@core/domain/repositories/AuditLogRepository.js";
import type { AdminUserCredentialsDto } from "@core/domain/repositories/ReadModelDtos.js";
import type { SingleUsePasswordGenerator } from "@ports/core";
import {
  ReissueAdministratorPasswordUseCase,
  type ReissueAdministratorRepository,
  type ReissueSessionRepository,
} from "../../src/ReissueAdministratorPasswordUseCase.js";
import type { SingleUsePasswordHasher, SystemAuditLog } from "../../src/singleUsePassword.js";
import {
  TRANSACTION_JOURNAL,
  expectFailure,
  expectSuccess,
  makeJournalingUnitOfWork,
} from "./useCaseDoubles.js";

const OPERATOR_EMAIL = "  First.Admin@Example.COM ";
const STORED_EMAIL = "first.admin@example.com";
const ADMIN_ID = "admin-uuid-001";
const CURRENT_HASH = "$argon2id$v=19$m=65536,t=3,p=4$Y3VycmVudA$Y3VycmVudC1oYXNo";
const NEW_PASSWORD = "fixture-reissued-password-4d1e";
const NEW_HASH = "$argon2id$v=19$m=65536,t=3,p=4$cmVpc3N1ZWQ$cmVpc3N1ZWQtaGFzaA";
const PENDING_RESET_TOKEN = "fixture-hash-of-a-pending-reset-token";
const FIXED_DATE = new Date("2024-01-01T00:00:00Z");

/** What each refusal and failure reports: the registry's code, category and status, and its text. */
const FAILURES = {
  notFound: {
    code: "ADMINISTRATOR_NOT_FOUND",
    category: ERROR_CATEGORY.NOT_FOUND,
    status: 404,
    message: "No administrator has this e-mail: there is no single-use password to re-issue",
  },
  hasSignedIn: {
    code: "PASSWORD_REISSUE_REFUSED_SIGNED_IN",
    category: ERROR_CATEGORY.CONFLICT,
    status: 409,
    message:
      "This administrator has signed in, so its password is no longer a single-use password nobody saw: it is not re-issued",
  },
  notMarked: {
    code: "PASSWORD_REISSUE_REFUSED_NOT_MARKED",
    category: ERROR_CATEGORY.CONFLICT,
    status: 409,
    message:
      "This administrator is not marked to change its password, so its password is its own and not a single-use password: it is not re-issued",
  },
  deactivated: {
    code: "PASSWORD_REISSUE_REFUSED_DEACTIVATED",
    category: ERROR_CATEGORY.CONFLICT,
    status: 409,
    message:
      "This administrator is deactivated, so no password lets it sign in: it must be reactivated first, and its password is not re-issued",
  },
  readFailed: {
    code: "ADMINISTRATOR_READ_FAILED",
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message: "Reading the administrator failed",
  },
  generateFailed: {
    code: "SINGLE_USE_PASSWORD_GENERATE_FAILED",
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message: "Generating the single-use password failed",
  },
  hashFailed: {
    code: "SINGLE_USE_PASSWORD_HASH_FAILED",
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message: "Hashing the single-use password failed",
  },
  replaceFailed: {
    code: "SINGLE_USE_PASSWORD_REPLACE_FAILED",
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message: "Replacing the single-use password failed",
  },
  changedSinceRead: {
    code: "PASSWORD_REISSUE_REFUSED_CHANGED_SINCE_READ",
    category: ERROR_CATEGORY.CONFLICT,
    status: 409,
    message:
      "The administrator changed between the read and the write (another re-issue, a password change, a requested password reset, a sign-in or a deactivation), so nothing was replaced: run the re-issue again to see what is true now",
  },
  revokeFailed: {
    code: "ADMINISTRATOR_SESSIONS_REVOKE_FAILED",
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message: "Ending the administrator's sessions failed",
  },
  auditFailed: {
    code: "PASSWORD_REISSUE_AUDIT_WRITE_FAILED",
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message: "Writing the audit record of the re-issue failed",
  },
  transactionFailed: {
    code: "PASSWORD_REISSUE_OUTCOME_UNKNOWN",
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message:
      "The transaction that re-issues the single-use password failed and its outcome is unknown: the password may have been replaced without the new one being shown, so run the re-issue again",
  },
} as const;

/** How an error reads against the registry: its definition's code, category and status, and its text. */
interface FailureReading {
  readonly code: string;
  readonly category: string | undefined;
  readonly status: number | undefined;
  readonly message: string;
}

/** Reads an error as the registry words it, so one comparison pins the code, category, status and text. */
function readingOf(error: UseCaseError): FailureReading {
  return {
    code: error.code,
    category: error.definition?.category,
    status: error.definition?.status,
    message: error.message,
  };
}

const JOURNAL = {
  read: "administrators.findCredentialsByEmail",
  generate: "password.generate",
  hash: "password.hash",
  replace: "administrators.replaceSingleUsePassword",
  revoke: "sessions.revokeAllForUser",
  audit: "audit.create",
  ...TRANSACTION_JOURNAL,
} as const;

/** The administrator a re-issue is for: never signed in, still marked. */
function makeAdministrator(
  overrides: Partial<AdminUserCredentialsDto> = {}
): AdminUserCredentialsDto {
  return {
    id: ADMIN_ID,
    email: STORED_EMAIL,
    name: "first.admin",
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
    passwordHash: CURRENT_HASH,
    passwordResetToken: PENDING_RESET_TOKEN,
    passwordResetExpires: new Date("2024-01-01T01:00:00Z"),
    mfaSecret: null,
    passwordHistory: [],
    mfaBackupCodes: [],
    mfaBackupUsedAt: null,
    ...overrides,
  };
}

/** One call of the session repository's revocation: whose sessions, and the reason stored. */
interface RevokeCall {
  readonly userId: string;
  readonly reason: AdminSessionRevokeReason;
}

/** What the doubles answer; an absent key takes the answer of an eligible administrator. */
interface HarnessOptions {
  /** The stored administrator; `null` when no administrator has the e-mail. */
  readonly administrator?: AdminUserCredentialsDto | null;
  readonly readRaise?: unknown;
  readonly generateFailure?: Error;
  readonly hashFailure?: Error;
  /** What the guarded write answers instead of applying its guard to the stored row. */
  readonly replaceAnswer?: Result<boolean, RepositoryFailureError>;
  /** Fields of the stored row that changed between the read and the write. */
  readonly changedBeforeWrite?: Partial<AdminUserCredentialsDto>;
  readonly replaceRaise?: unknown;
  readonly revokeRaise?: unknown;
  readonly auditRaise?: unknown;
  readonly commitFailure?: Error;
}

/** The use case wired to doubles, and what each double recorded. */
interface Harness {
  readonly useCase: ReissueAdministratorPasswordUseCase;
  readonly journal: string[];
  readonly lookedUp: string[];
  readonly hashedPlaintexts: string[];
  readonly replacements: SingleUsePasswordReplacement[];
  readonly revokedFor: RevokeCall[];
  readonly auditEntries: AuditLogCreateInput[];
  readonly transactionOutcomes: Array<Result<unknown, unknown>>;
  /** The stored row as the guarded write left it; `null` when no administrator is stored. */
  readonly storedRow: () => AdminUserCredentialsDto | null;
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const journal: string[] = [];
  const lookedUp: string[] = [];
  const hashedPlaintexts: string[] = [];
  const replacements: SingleUsePasswordReplacement[] = [];
  const revokedFor: RevokeCall[] = [];
  const auditEntries: AuditLogCreateInput[] = [];
  const transactionOutcomes: Array<Result<unknown, unknown>> = [];
  const stored = options.administrator === undefined ? makeAdministrator() : options.administrator;
  // The row the guarded write sees: the one read, with what changed before the write.
  let row = stored === null ? null : { ...stored, ...options.changedBeforeWrite };

  const administrators: ReissueAdministratorRepository = {
    async findCredentialsByEmail(email: string) {
      journal.push(JOURNAL.read);
      lookedUp.push(email);
      if (options.readRaise !== undefined) {
        throw options.readRaise;
      }
      return stored === null ? err("NOT_FOUND" as const) : ok(stored);
    },
    async replaceSingleUsePassword(replacement: SingleUsePasswordReplacement) {
      journal.push(JOURNAL.replace);
      replacements.push(replacement);
      if (options.replaceRaise !== undefined) {
        throw options.replaceRaise;
      }
      if (options.replaceAnswer !== undefined) {
        return options.replaceAnswer;
      }
      if (
        row === null ||
        row.id !== replacement.id ||
        row.passwordHash !== replacement.currentPasswordHash ||
        row.passwordResetToken !== replacement.currentPasswordResetToken ||
        !row.mustChangePassword ||
        row.lastLoginAt !== null ||
        !row.isActive
      ) {
        return ok(false);
      }
      row = {
        ...row,
        passwordHash: replacement.passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
      };
      return ok(true);
    },
  };
  const sessions: ReissueSessionRepository = {
    async revokeAllForUser(userId: string, reason: AdminSessionRevokeReason) {
      journal.push(JOURNAL.revoke);
      revokedFor.push({ userId, reason });
      if (options.revokeRaise !== undefined) {
        throw options.revokeRaise;
      }
      return 2;
    },
  };
  const auditLog: SystemAuditLog = {
    async create(entry: AuditLogCreateInput) {
      journal.push(JOURNAL.audit);
      auditEntries.push(entry);
      if (options.auditRaise !== undefined) {
        throw options.auditRaise;
      }
    },
  };
  const passwordHasher: SingleUsePasswordHasher = {
    async hash(plaintext: string) {
      journal.push(JOURNAL.hash);
      hashedPlaintexts.push(plaintext);
      if (options.hashFailure !== undefined) {
        throw options.hashFailure;
      }
      return NEW_HASH;
    },
  };
  const passwordGenerator: SingleUsePasswordGenerator = {
    generate() {
      journal.push(JOURNAL.generate);
      if (options.generateFailure !== undefined) {
        throw options.generateFailure;
      }
      return NEW_PASSWORD;
    },
  };

  const useCase = new ReissueAdministratorPasswordUseCase(
    administrators,
    sessions,
    auditLog,
    passwordHasher,
    passwordGenerator,
    makeJournalingUnitOfWork(journal, transactionOutcomes, options.commitFailure)
  );
  return {
    useCase,
    journal,
    lookedUp,
    hashedPlaintexts,
    replacements,
    revokedFor,
    auditEntries,
    transactionOutcomes,
    storedRow: () => row,
  };
}

/** The journal of a run up to the opening of its transaction. */
const BEFORE_THE_TRANSACTION = [
  JOURNAL.read,
  JOURNAL.generate,
  JOURNAL.hash,
  JOURNAL.open,
] as const;

describe("ReissueAdministratorPasswordUseCase", () => {
  describe("for an administrator who has never signed in and must change the password", () => {
    it("returns the new single-use password once, after replacing the hash as read, ending every session and writing one system audit record", async () => {
      const harness = makeHarness();

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const expectedOutput = { id: ADMIN_ID, email: STORED_EMAIL, password: NEW_PASSWORD };
      expect(result).toEqual(ok(expectedOutput));
      expect(harness.lookedUp).toEqual([STORED_EMAIL]);
      expect(harness.hashedPlaintexts).toEqual([NEW_PASSWORD]);
      expect(harness.journal).toEqual([
        ...BEFORE_THE_TRANSACTION,
        JOURNAL.replace,
        JOURNAL.revoke,
        JOURNAL.audit,
        JOURNAL.commit,
      ]);
      expect(harness.replacements).toEqual([
        {
          id: ADMIN_ID,
          currentPasswordHash: CURRENT_HASH,
          currentPasswordResetToken: PENDING_RESET_TOKEN,
          passwordHash: NEW_HASH,
        },
      ]);
      expect(harness.revokedFor).toEqual([{ userId: ADMIN_ID, reason: "PASSWORD_REISSUED" }]);
      expect(harness.auditEntries).toEqual([
        {
          action: "ADMINISTRATOR_PASSWORD_REISSUED",
          actorType: "SYSTEM",
          resource: "AdminUser",
          resourceId: ADMIN_ID,
          details: { task: "create-first-admin --reissue" },
          success: true,
        },
      ]);
      expect(harness.transactionOutcomes).toEqual([ok(expectedOutput)]);
    });

    it("returns the password under the key password and nowhere else, and writes it to no port", async () => {
      const harness = makeHarness();

      const result = await harness.useCase.execute({ email: STORED_EMAIL });

      const output = expectSuccess(result);
      const { password, ...rest } = output;
      expect(password).toBe(NEW_PASSWORD);
      expect(Object.keys(output).sort()).toEqual(["email", "id", "password"]);
      expect(inspect(rest, { depth: null })).not.toContain(NEW_PASSWORD);
      const written = inspect(
        { replacements: harness.replacements, audit: harness.auditEntries },
        { depth: null }
      );
      expect(written).not.toContain(NEW_PASSWORD);
      expect(inspect(harness.auditEntries, { depth: null })).not.toContain(NEW_HASH);
      expect(inspect(harness.auditEntries, { depth: null })).not.toContain(STORED_EMAIL);
    });
  });

  describe("refusals", () => {
    it.each([
      {
        reason: "no administrator has the e-mail",
        administrator: null,
        failure: FAILURES.notFound,
      },
      {
        reason: "the administrator has signed in",
        administrator: makeAdministrator({ lastLoginAt: FIXED_DATE }),
        failure: FAILURES.hasSignedIn,
      },
      {
        reason: "the administrator is not marked to change the password",
        administrator: makeAdministrator({ mustChangePassword: false }),
        failure: FAILURES.notMarked,
      },
      {
        reason: "the administrator is deactivated",
        administrator: makeAdministrator({ isActive: false }),
        failure: FAILURES.deactivated,
      },
    ])(
      "refuses with $failure.code, $failure.category, and its own message, drawing no password and writing nothing, when $reason",
      async ({ administrator, failure }) => {
        const harness = makeHarness({ administrator });

        const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

        const error = expectFailure(result);
        expect(readingOf(error)).toEqual(failure);
        expect(error.cause).toBeUndefined();
        expect(harness.lookedUp).toEqual([STORED_EMAIL]);
        expect(harness.journal).toEqual([JOURNAL.read]);
        expect(harness.replacements).toEqual([]);
        expect(harness.revokedFor).toEqual([]);
        expect(harness.auditEntries).toEqual([]);
      }
    );

    it("refuses as signed in, not as unmarked, when the administrator has signed in and is no longer marked", async () => {
      const harness = makeHarness({
        administrator: makeAdministrator({ lastLoginAt: FIXED_DATE, mustChangePassword: false }),
      });

      const result = await harness.useCase.execute({ email: STORED_EMAIL });

      expect(readingOf(expectFailure(result))).toEqual(FAILURES.hasSignedIn);
      expect(harness.journal).toEqual([JOURNAL.read]);
    });

    it("refuses as unmarked, not as deactivated, when the administrator is deactivated and no longer marked, since reactivating it would not make it eligible", async () => {
      const harness = makeHarness({
        administrator: makeAdministrator({ isActive: false, mustChangePassword: false }),
      });

      const result = await harness.useCase.execute({ email: STORED_EMAIL });

      expect(readingOf(expectFailure(result))).toEqual(FAILURES.notMarked);
      expect(harness.journal).toEqual([JOURNAL.read]);
    });
  });

  describe("when the row moved since it was read", () => {
    it("returns PASSWORD_REISSUE_REFUSED_CHANGED_SINCE_READ, a conflict, rolled back, ending no session and writing no audit record, when the guarded write matches no row", async () => {
      const harness = makeHarness({ replaceAnswer: ok(false) });

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const error = expectFailure(result);
      expect(readingOf(error)).toEqual(FAILURES.changedSinceRead);
      expect(error.cause).toBeUndefined();
      expect(harness.transactionOutcomes).toEqual([{ ok: false, error }]);
      expect(harness.journal).toEqual([
        ...BEFORE_THE_TRANSACTION,
        JOURNAL.replace,
        JOURNAL.rollback,
      ]);
      expect(harness.revokedFor).toEqual([]);
      expect(harness.auditEntries).toEqual([]);
      expect(inspect(error, { depth: null, showHidden: true })).not.toContain(NEW_PASSWORD);
    });

    it("returns PASSWORD_REISSUE_REFUSED_CHANGED_SINCE_READ, leaving the stored hash and reset token as they are, ending no session and writing no audit record, when a password reset was requested between the read and the write", async () => {
      const resetRequestedSince = "fixture-hash-of-a-reset-token-requested-since";
      const harness = makeHarness({
        changedBeforeWrite: { passwordResetToken: resetRequestedSince },
      });

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const error = expectFailure(result);
      expect(readingOf(error)).toEqual(FAILURES.changedSinceRead);
      expect(harness.replacements).toEqual([
        expect.objectContaining({ currentPasswordResetToken: PENDING_RESET_TOKEN }),
      ]);
      expect(harness.storedRow()).toEqual(
        makeAdministrator({ passwordResetToken: resetRequestedSince })
      );
      expect(harness.journal).toEqual([
        ...BEFORE_THE_TRANSACTION,
        JOURNAL.replace,
        JOURNAL.rollback,
      ]);
      expect(harness.revokedFor).toEqual([]);
      expect(harness.auditEntries).toEqual([]);
    });

    it("returns PASSWORD_REISSUE_REFUSED_CHANGED_SINCE_READ, leaving the stored hash as it is, ending no session and writing no audit record, when the administrator was deactivated between the read and the write", async () => {
      const harness = makeHarness({ changedBeforeWrite: { isActive: false } });

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const error = expectFailure(result);
      expect(readingOf(error)).toEqual(FAILURES.changedSinceRead);
      expect(harness.storedRow()).toEqual(makeAdministrator({ isActive: false }));
      expect(harness.journal).toEqual([
        ...BEFORE_THE_TRANSACTION,
        JOURNAL.replace,
        JOURNAL.rollback,
      ]);
      expect(harness.revokedFor).toEqual([]);
      expect(harness.auditEntries).toEqual([]);
    });
  });

  describe("failures", () => {
    it("returns ADMINISTRATOR_READ_FAILED, an internal failure carrying the raised error, drawing no password, when reading the administrator raises", async () => {
      const failure = new Error("connection reset");
      const harness = makeHarness({ readRaise: failure });

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const error = expectFailure(result);
      expect(readingOf(error)).toEqual(FAILURES.readFailed);
      expect(error.cause).toBe(failure);
      expect(harness.journal).toEqual([JOURNAL.read]);
    });

    it.each([
      {
        step: "drawing the password",
        options: { generateFailure: new Error("no random source") },
        failure: FAILURES.generateFailed,
        journal: [JOURNAL.read, JOURNAL.generate],
      },
      {
        step: "hashing the password",
        options: { hashFailure: new Error("argon2 out of memory") },
        failure: FAILURES.hashFailed,
        journal: [JOURNAL.read, JOURNAL.generate, JOURNAL.hash],
      },
    ] satisfies ReadonlyArray<{
      step: string;
      options: HarnessOptions;
      failure: FailureReading;
      journal: readonly string[];
    }>)(
      "returns $failure.code, an internal failure, before any transaction when $step fails",
      async ({ options, failure, journal }) => {
        const harness = makeHarness(options);

        const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

        const error = expectFailure(result);
        expect(readingOf(error)).toEqual(failure);
        expect(error.cause).toBe(options.generateFailure ?? options.hashFailure);
        expect(harness.journal).toEqual(journal);
        expect(harness.transactionOutcomes).toEqual([]);
      }
    );

    it("returns SINGLE_USE_PASSWORD_REPLACE_FAILED, an internal failure carrying the repository's error, rolled back, when the guarded write fails", async () => {
      const failure = new RepositoryFailureError(
        "Replacing an admin user's single-use password failed",
        new Error("socket closed")
      );
      const harness = makeHarness({ replaceAnswer: { ok: false, error: failure } });

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const error = expectFailure(result);
      expect(readingOf(error)).toEqual(FAILURES.replaceFailed);
      expect(error.cause).toBe(failure);
      expect(harness.journal).toEqual([
        ...BEFORE_THE_TRANSACTION,
        JOURNAL.replace,
        JOURNAL.rollback,
      ]);
      expect(harness.revokedFor).toEqual([]);
      expect(harness.auditEntries).toEqual([]);
    });

    it.each([
      {
        step: "the guarded write raises",
        options: { replaceRaise: new Error("driver crashed") },
        failure: FAILURES.replaceFailed,
        afterOpen: [JOURNAL.replace],
      },
      {
        step: "ending the sessions raises",
        options: { revokeRaise: new Error("driver crashed") },
        failure: FAILURES.revokeFailed,
        afterOpen: [JOURNAL.replace, JOURNAL.revoke],
      },
      {
        step: "writing the audit record raises",
        options: { auditRaise: new Error("driver crashed") },
        failure: FAILURES.auditFailed,
        afterOpen: [JOURNAL.replace, JOURNAL.revoke, JOURNAL.audit],
      },
    ] satisfies ReadonlyArray<{
      step: string;
      options: HarnessOptions;
      failure: FailureReading;
      afterOpen: readonly string[];
    }>)(
      "returns $failure.code, an internal failure, as the failed outcome of the transaction's work, after its earlier writes in it, when $step",
      async ({ options, failure, afterOpen }) => {
        const harness = makeHarness(options);

        const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

        const error = expectFailure(result);
        expect(readingOf(error)).toEqual(failure);
        expect(error.cause).toBe(options.replaceRaise ?? options.revokeRaise ?? options.auditRaise);
        expect(harness.transactionOutcomes).toEqual([{ ok: false, error }]);
        expect(harness.journal).toEqual([
          ...BEFORE_THE_TRANSACTION,
          ...afterOpen,
          JOURNAL.rollback,
        ]);
        expect(inspect(error, { depth: null, showHidden: true })).not.toContain(NEW_PASSWORD);
      }
    );

    it("returns SINGLE_USE_PASSWORD_REPLACE_FAILED whose cause names only the type when the guarded write raises a value that is not an Error", async () => {
      const raised = "connection lost to the primary";
      const harness = makeHarness({ replaceRaise: raised });

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const error = expectFailure(result);
      expect(readingOf(error)).toEqual(FAILURES.replaceFailed);
      expect(error.originalError?.message).toBe(
        "A value that is not an Error was raised, of type string"
      );
      expect(inspect(error, { depth: null, showHidden: true })).not.toContain(raised);
    });

    it("returns PASSWORD_REISSUE_OUTCOME_UNKNOWN, an internal failure with the message of an unknown outcome, when the transaction itself fails", async () => {
      const failure = new Error("could not commit");
      const harness = makeHarness({ commitFailure: failure });

      const result = await harness.useCase.execute({ email: OPERATOR_EMAIL });

      const error = expectFailure(result);
      expect(readingOf(error)).toEqual(FAILURES.transactionFailed);
      expect(error.cause).toBe(failure);
      expect(harness.journal).toEqual([
        ...BEFORE_THE_TRANSACTION,
        JOURNAL.replace,
        JOURNAL.revoke,
        JOURNAL.audit,
        JOURNAL.commitFailed,
      ]);
      expect(inspect(error, { depth: null, showHidden: true })).not.toContain(NEW_PASSWORD);
    });
  });
});
