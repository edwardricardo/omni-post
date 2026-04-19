/**
 * @file onboarding.test.ts
 * @description Unit tests for welcome email in registration and onboarding API logic.
 * @layer application
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RegisterCustomerUseCase } from "../../../src/application/customer-auth/RegisterCustomerUseCase.js";
import type { CustomerUserRepository } from "../../../src/domain/repositories/CustomerUserRepository.js";
import type { AccountRepositoryPort } from "../../../src/domain/repositories/AccountRepository.js";
import type { EmailPort } from "../../../src/domain/repositories/EmailPort.js";
import type { PlatformCredentialService } from "../../../src/security/PlatformCredentialService.js";

function makeMockCustomerUserRepo(): CustomerUserRepository {
  return {
    findByEmailAcrossAccounts: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    findById: vi.fn(),
    findByEmail: vi.fn(),
  } as unknown as CustomerUserRepository;
}

function makeMockAccountRepo(): AccountRepositoryPort {
  return {
    save: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    findById: vi.fn(),
  } as unknown as AccountRepositoryPort;
}

function makeMockEmailPort(): EmailPort {
  return { send: vi.fn().mockResolvedValue({ ok: true, value: undefined }) };
}

function makeMockCredentialService(): PlatformCredentialService {
  return {
    getGroup: vi.fn().mockResolvedValue({
      ok: true,
      value: { baseUrl: "https://app.test.io", supportEmail: "help@test.io" },
    }),
  } as unknown as PlatformCredentialService;
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
  let emailPort: EmailPort;
  let credService: PlatformCredentialService;

  beforeEach(() => {
    vi.clearAllMocks();
    emailPort = makeMockEmailPort();
    credService = makeMockCredentialService();
  });

  it("sends welcome email after successful registration", async () => {
    const useCase = new RegisterCustomerUseCase(
      makeMockCustomerUserRepo(),
      makeMockAccountRepo(),
      undefined,
      undefined,
      emailPort,
      credService
    );

    const result = await useCase.execute(validInput);

    expect(result.ok).toBe(true);
    // Wait for async email send (fire-and-forget)
    await new Promise((r) => setTimeout(r, 50));
    expect(emailPort.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["john@test.com"],
        subject: expect.stringContaining("Welcome"),
      })
    );
  });

  it("does NOT fail registration if email send fails", async () => {
    const failingEmailPort: EmailPort = {
      send: vi.fn().mockRejectedValue(new Error("SMTP down")),
    };

    const useCase = new RegisterCustomerUseCase(
      makeMockCustomerUserRepo(),
      makeMockAccountRepo(),
      undefined,
      undefined,
      failingEmailPort,
      credService
    );

    const result = await useCase.execute(validInput);

    expect(result.ok).toBe(true);
    // Wait for async catch
    await new Promise((r) => setTimeout(r, 50));
    expect(failingEmailPort.send).toHaveBeenCalled();
  });

  it("uses baseUrl from PLATFORM settings", async () => {
    const useCase = new RegisterCustomerUseCase(
      makeMockCustomerUserRepo(),
      makeMockAccountRepo(),
      undefined,
      undefined,
      emailPort,
      credService
    );

    await useCase.execute(validInput);
    await new Promise((r) => setTimeout(r, 50));

    expect(credService.getGroup).toHaveBeenCalledWith("PLATFORM");
    expect(emailPort.send).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("https://app.test.io"),
      })
    );
  });

  it("works without email port (backward compatible)", async () => {
    const useCase = new RegisterCustomerUseCase(makeMockCustomerUserRepo(), makeMockAccountRepo());

    const result = await useCase.execute(validInput);

    expect(result.ok).toBe(true);
  });
});
