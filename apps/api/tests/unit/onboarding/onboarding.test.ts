/**
 * @file onboarding.test.ts
 * @description Unit tests for welcome email in registration and onboarding API logic.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { until } from "@packages/vitest-shared/determinism";
import { RegisterCustomerUseCase } from "@core/customer-auth/RegisterCustomerUseCase.js";
import { Argon2PasswordHasher } from "../../../src/infrastructure/adapters/Argon2PasswordHasher.js";
import { CustomerTokenServiceAdapter } from "../../../src/infrastructure/adapters/CustomerTokenServiceAdapter.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import type { WelcomeMailer } from "@core/domain/repositories/WelcomeMailer.js";
import type { DeletedAccountNoticeMailer } from "@core/domain/repositories/DeletedAccountNoticeMailer.js";
import type { PlatformCredentialReader } from "@core/domain/repositories/PlatformCredentialReader.js";
import type { LoggerPort } from "@ports/core";

const hasher = new Argon2PasswordHasher();
const tokenService = new CustomerTokenServiceAdapter();

function makeMockCustomerUserRepo(): CustomerUserRepository {
  return {
    findByEmailAcrossAccounts: vi.fn().mockResolvedValue([]),
    existsDeletedByEmailAcrossAccounts: vi.fn().mockResolvedValue(false),
    create: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    findById: vi.fn(),
    findByEmail: vi.fn(),
  } as unknown as CustomerUserRepository;
}

function makeMockAccountRepo(): AccountRepositoryPort {
  return {
    save: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    findByEmail: vi.fn().mockResolvedValue(null),
    existsDeletedByEmail: vi.fn().mockResolvedValue(false),
    findById: vi.fn(),
    findByIdIncludingDeleted: vi.fn(),
    restore: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  } as unknown as AccountRepositoryPort;
}

function makeMockLogger() {
  return { error: vi.fn(), warn: vi.fn() } satisfies LoggerPort;
}

function makeMockWelcomeMailer(): WelcomeMailer {
  return { sendWelcome: vi.fn().mockResolvedValue({ ok: true, value: undefined }) };
}

function makeMockNoticeMailer(): DeletedAccountNoticeMailer {
  return {
    notifyRegistrationAttemptOnDeletedAccount: vi
      .fn()
      .mockResolvedValue({ ok: true, value: undefined }),
  };
}

/**
 * Waits until `fn` has been called. The use case starts its e-mails without waiting for them
 * and returns first, so a call it makes is only visible some turns after `execute` resolves.
 * @param fn - The double the fire-and-forget dispatch reaches.
 * @param description - What the call means, for the timeout message.
 */
async function untilCalled(
  fn: { readonly mock: { readonly calls: readonly unknown[] } },
  description: string
): Promise<void> {
  await until(() => fn.mock.calls.length > 0, { description });
}

function makeMockCredentialService(): PlatformCredentialReader {
  return {
    getPlatformCredentials: vi.fn().mockResolvedValue({
      ok: true,
      value: { baseUrl: "https://app.test.io", supportEmail: "help@test.io" },
    }),
  };
}

const validInput = {
  accountName: "Test Account",
  accountEmail: "account@test.com",
  firstName: "John",
  lastName: "Doe",
  email: "john@test.com",
  password: "SecurePassword123!",
};

describe("Welcome email on registration", () => {
  let welcomeMailer: WelcomeMailer;
  let noticeMailer: DeletedAccountNoticeMailer;
  let credService: PlatformCredentialReader;

  function makeMockCustomerRoleRepo() {
    return {
      getSnapshotByName: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          roleId: "role-owner",
          roleName: "OWNER",
          roleLevel: 100,
          permissions: new Set(["post:read", "billing:manage"]),
        },
      }),
      getSnapshotById: vi.fn(),
      listAll: vi.fn().mockResolvedValue([]),
    } as never;
  }

  /**
   * @param logger - Receives the use case's log calls.
   * @param welcome - The welcome mailer the registration sends with, if any.
   * @returns The registration use case over fresh repository doubles and no trial port.
   */
  function registrationWith(logger: LoggerPort, welcome?: WelcomeMailer): RegisterCustomerUseCase {
    const noTrialSubscription = undefined;
    return new RegisterCustomerUseCase(
      makeMockCustomerUserRepo(),
      makeMockCustomerRoleRepo(),
      makeMockAccountRepo(),
      hasher,
      tokenService,
      logger,
      noticeMailer,
      noTrialSubscription,
      welcome,
      credService
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    welcomeMailer = makeMockWelcomeMailer();
    noticeMailer = makeMockNoticeMailer();
    credService = makeMockCredentialService();
  });

  it("sends welcome email after successful registration", async () => {
    const useCase = registrationWith(makeMockLogger(), welcomeMailer);

    const result = await useCase.execute(validInput);

    expect(result.ok).toBe(true);
    await untilCalled(vi.mocked(welcomeMailer.sendWelcome), "the welcome e-mail to be sent");
    expect(welcomeMailer.sendWelcome).toHaveBeenCalledWith(
      "john@test.com",
      expect.objectContaining({ accountName: "Test Account" })
    );
  });

  it("does NOT fail registration if email send fails", async () => {
    const failingMailer: WelcomeMailer = {
      sendWelcome: vi.fn().mockRejectedValue(new Error("SMTP down")),
    };

    const logger = makeMockLogger();
    const useCase = registrationWith(logger, failingMailer);

    const result = await useCase.execute(validInput);

    expect(result.ok).toBe(true);
    // The log call is the last thing the dispatch does, after the mailer's rejection.
    await untilCalled(logger.error, "the failed welcome e-mail to be logged");
    expect(failingMailer.sendWelcome).toHaveBeenCalled();
    // The failure is logged, not swallowed, and the log carries no address.
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "registerCustomer.welcomeEmail" }),
      "A registration e-mail was not sent"
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("john@test.com");
  });

  it("uses baseUrl from PLATFORM settings", async () => {
    const useCase = registrationWith(makeMockLogger(), welcomeMailer);

    await useCase.execute(validInput);
    await untilCalled(vi.mocked(welcomeMailer.sendWelcome), "the welcome e-mail to be sent");

    expect(credService.getPlatformCredentials).toHaveBeenCalled();
    expect(welcomeMailer.sendWelcome).toHaveBeenCalledWith(
      "john@test.com",
      expect.objectContaining({ onboardingUrl: expect.stringContaining("https://app.test.io") })
    );
  });

  it("registers without a welcome mailer", async () => {
    const useCase = registrationWith(makeMockLogger());

    const result = await useCase.execute(validInput);

    expect(result.ok).toBe(true);
  });
});
