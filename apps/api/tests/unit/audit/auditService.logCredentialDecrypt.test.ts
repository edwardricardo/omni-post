/**
 * @file auditService.logCredentialDecrypt.test.ts
 * @description Verifies that AuditService.logCredentialDecrypt persists the
 *   right shape, NEVER includes plaintext (ASVS V16.2.5), and enriches
 *   the row from the AsyncLocalStorage when running inside a request scope.
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock @infra/prisma BEFORE importing auditService — the singleton constructs
// at import time and binds to the prisma client.
const auditLogCreate = vi.fn();
vi.mock("@infra/prisma", () => ({
  prisma: {
    auditLog: { create: auditLogCreate },
  },
}));

const { auditService, AuditActions } = await import("../../../src/audit/auditService.js");
const { withRequestAuditContext } = await import("../../../src/security/decryptAuditContext.js");

describe("auditService.logCredentialDecrypt", () => {
  beforeEach(() => {
    auditLogCreate.mockReset();
    auditLogCreate.mockResolvedValue({
      id: "audit-1",
      action: AuditActions.CREDENTIAL_DECRYPTED,
      success: true,
      createdAt: new Date(),
    });
  });

  it("writes a row with action=CREDENTIAL_DECRYPTED and the structured fields", async () => {
    await auditService.logCredentialDecrypt({
      fieldName: "Channel.credentials",
      recordId: "ch-1",
      caller: "TestCaller",
      success: true,
    });

    expect(auditLogCreate).toHaveBeenCalledOnce();
    const args = auditLogCreate.mock.calls[0]?.[0] as {
      data: { action: string; resource: string; resourceId: string; success: boolean };
    };
    expect(args.data.action).toBe(AuditActions.CREDENTIAL_DECRYPTED);
    expect(args.data.resource).toBe("Channel.credentials");
    expect(args.data.resourceId).toBe("ch-1");
    expect(args.data.success).toBe(true);
  });

  it("enriches the row with userId/ipAddress from the request audit context (ALS)", async () => {
    await withRequestAuditContext(
      {
        userId: "user-7",
        ipAddress: "10.0.0.1",
        userAgent: "test-agent",
        correlationId: "req-abc",
      },
      async () => {
        await auditService.logCredentialDecrypt({
          fieldName: "OidcConfiguration.clientSecret",
          recordId: "acc-1",
          success: true,
        });
      }
    );

    const args = auditLogCreate.mock.calls[0]?.[0] as {
      data: {
        userId: string;
        ipAddress: string;
        userAgent: string;
        details: { correlationId?: string };
      };
    };
    expect(args.data.userId).toBe("user-7");
    expect(args.data.ipAddress).toBe("10.0.0.1");
    expect(args.data.userAgent).toBe("test-agent");
    expect(args.data.details.correlationId).toBe("req-abc");
  });

  it("logs failure with the error message when success is false", async () => {
    await auditService.logCredentialDecrypt({
      fieldName: "Channel.credentials",
      recordId: "ch-2",
      success: false,
      error: "Decryption failed: data may be tampered",
    });

    const args = auditLogCreate.mock.calls[0]?.[0] as {
      data: { success: boolean; error: string };
    };
    expect(args.data.success).toBe(false);
    expect(args.data.error).toContain("Decryption failed");
  });

  it("NEVER persists the plaintext anywhere (ASVS V16.2.5)", async () => {
    // The contract is that logCredentialDecrypt does not receive the
    // plaintext at all — only structured non-secret context. This test
    // documents the contract: any future refactor that adds a `plaintext`
    // field would fail because the param shape rejects it via TS.
    await auditService.logCredentialDecrypt({
      fieldName: "Channel.credentials",
      recordId: "ch-3",
      caller: "PrismaChannelRepository.toDomain",
      success: true,
    });
    const args = auditLogCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    const serialised = JSON.stringify(args.data);
    expect(serialised).not.toContain("password");
    expect(serialised).not.toContain("token");
    expect(serialised).not.toContain("secret");
  });
});
