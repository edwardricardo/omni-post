/**
 * @file onboarding.test.ts
 * @description Unit tests for welcome email in registration and onboarding API logic.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RegisterCustomerUseCase } from "@core/customer-auth/RegisterCustomerUseCase.js";
import { Argon2PasswordHasher } from "../../../src/infrastructure/adapters/Argon2PasswordHasher.js";
import { CustomerTokenServiceAdapter } from "../../../src/infrastructure/adapters/CustomerTokenServiceAdapter.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import type { WelcomeMailer } from "@core/domain/repositories/WelcomeMailer.js";
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

  beforeEach(() => {
    vi.clearAllMocks();
    welcomeMailer = makeMockWelcomeMailer();
    credService = makeMockCredentialService();
  });

  it("sends welcome email after successful registration", async () => {
    const useCase = new RegisterCustomerUseCase(
      makeMockCustomerUserRepo(),
      makeMockCustomerRoleRepo(),
      makeMockAccountRepo(),
      hasher,
      tokenService,
      makeMockLogger(),
      undefined,
      welcomeMailer,
      credService
    );

    const result = await useCase.execute(validInput);

    expect(result.ok).toBe(true);
    // Wait for async email send (fire-and-forget)
    await new Promise((r) => setTimeout(r, 50));
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
    const useCase = new RegisterCustomerUseCase(
      makeMockCustomerUserRepo(),
      makeMockCustomerRoleRepo(),
      makeMockAccountRepo(),
      hasher,
      tokenService,
      logger,
      undefined,
      failingMailer,
      credService
    );

    const result = await useCase.execute(validInput);

    expect(result.ok).toBe(true);
    // Wait for async catch
    await new Promise((r) => setTimeout(r, 50));
    expect(failingMailer.sendWelcome).toHaveBeenCalled();
    // The failure is logged, not swallowed, and the log carries no address.
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "registerCustomer.welcomeEmail" }),
      "A registration e-mail was not sent"
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("john@test.com");
  });

  it("uses baseUrl from PLATFORM settings", async () => {
    const useCase = new RegisterCustomerUseCase(
      makeMockCustomerUserRepo(),
      makeMockCustomerRoleRepo(),
      makeMockAccountRepo(),
      hasher,
      tokenService,
      makeMockLogger(),
      undefined,
      welcomeMailer,
      credService
    );

    await useCase.execute(validInput);
    await new Promise((r) => setTimeout(r, 50));

    expect(credService.getPlatformCredentials).toHaveBeenCalled();
    expect(welcomeMailer.sendWelcome).toHaveBeenCalledWith(
      "john@test.com",
      expect.objectContaining({ onboardingUrl: expect.stringContaining("https://app.test.io") })
    );
  });

  it("works without a mailer (backward compatible)", async () => {
    const useCase = new RegisterCustomerUseCase(
      makeMockCustomerUserRepo(),
      makeMockCustomerRoleRepo(),
      makeMockAccountRepo(),
      hasher,
      tokenService,
      makeMockLogger()
    );

    const result = await useCase.execute(validInput);

    expect(result.ok).toBe(true);
  });
});
