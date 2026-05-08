/**
 * @file authApi.test.ts
 * @description Mutation-killing tests for the AuthAPI class.
 * Covers login, register, logout, refreshToken, getCurrentUser,
 * updateProfile, changePassword, and error handling.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { authApi } from "../authApi";

// ============================================================================
// Mock fetch
// ============================================================================

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockJsonResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  };
}

// ============================================================================
// login
// ============================================================================

describe("authApi.login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends credentials as JSON to /api/backend/auth/customer/login", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        data: {
          user: { id: "u1", email: "a@b.com", name: "Alice", createdAt: "", updatedAt: "" },
          expiresAt: "2025-12-31",
        },
      })
    );

    await authApi.login({ email: "a@b.com", password: "pass123" });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/auth/customer/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ email: "a@b.com", password: "pass123" }),
      })
    );
  });

  it("returns user and expiresAt on success", async () => {
    const user = {
      id: "u1",
      email: "a@b.com",
      name: "Alice",
      createdAt: "2025-01-01",
      updatedAt: "2025-01-01",
    };
    mockFetch.mockResolvedValue(mockJsonResponse({ data: { user, expiresAt: "2025-12-31" } }));

    const result = await authApi.login({ email: "a@b.com", password: "pass" });
    expect(result).toEqual({ user, expiresAt: "2025-12-31" });
  });

  it("returns MFA challenge when mfaRequired is true", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        data: {
          mfaRequired: true,
          message: "Enter OTP",
          methods: ["totp", "sms"],
        },
      })
    );

    const result = await authApi.login({ email: "a@b.com", password: "pass" });
    expect(result).toEqual({
      requiresMfa: true,
      message: "Enter OTP",
      methods: ["totp", "sms"],
    });
  });

  it("uses default MFA message when message is missing", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        data: {
          mfaRequired: true,
        },
      })
    );

    const result = await authApi.login({ email: "a@b.com", password: "pass" });
    expect((result as { message: string }).message).toBe("MFA token required");
  });

  it("uses empty methods array when methods is missing", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        data: {
          mfaRequired: true,
        },
      })
    );

    const result = await authApi.login({ email: "a@b.com", password: "pass" });
    expect((result as { methods: string[] }).methods).toEqual([]);
  });

  it("throws error on non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ error: "Invalid credentials" }),
    });

    await expect(authApi.login({ email: "a@b.com", password: "bad" })).rejects.toThrow(
      "Invalid credentials"
    );
  });

  it("throws fallback error message when error json parsing fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new Error("parse error")),
    });

    // After T3-B authApi throws ApiError with the per-endpoint fallback message
    // ("Login failed"). Body parsing failure is now caught silently in
    // readErrorBody and the endpoint-specific fallback is used.
    await expect(authApi.login({ email: "a@b.com", password: "bad" })).rejects.toThrow(
      "Login failed"
    );
  });

  it("handles response without data wrapper", async () => {
    const user = { id: "u2", email: "b@c.com", name: "Bob", createdAt: "", updatedAt: "" };
    mockFetch.mockResolvedValue(mockJsonResponse({ user, expiresAt: "2025-06-01" }));

    const result = await authApi.login({ email: "b@c.com", password: "pass" });
    expect(result).toEqual({ user, expiresAt: "2025-06-01" });
  });

  it("includes rememberMe in request body when set", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: { user: { id: "u1" }, expiresAt: "" } }));

    await authApi.login({ email: "a@b.com", password: "pass", rememberMe: true });

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(body.rememberMe).toBe(true);
  });
});

// ============================================================================
// register
// ============================================================================

describe("authApi.register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends registration data to /api/backend/auth/customer/register", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ user: { id: "u1", email: "a@b.com", name: "Alice" } })
    );

    await authApi.register({ email: "a@b.com", password: "pass123", name: "Alice" });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/auth/customer/register",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      })
    );
  });

  it("throws error on failure", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ message: "Email taken" }),
    });

    await expect(
      authApi.register({ email: "a@b.com", password: "pass", name: "Alice" })
    ).rejects.toThrow("Email taken");
  });
});

// ============================================================================
// logout
// ============================================================================

describe("authApi.logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends POST to /api/backend/auth/customer/logout", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}));

    await authApi.logout();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/auth/customer/logout",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      })
    );
  });

  it("does not throw even if response is not ok", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    // Logout should not throw — always considered successful from client perspective
    await expect(authApi.logout()).resolves.not.toThrow();
  });
});

// ============================================================================
// refreshToken
// ============================================================================

describe("authApi.refreshToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends POST to /api/backend/auth/customer/refresh", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: { expiresAt: "2025-12-31" } }));

    await authApi.refreshToken();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/auth/customer/refresh",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      })
    );
  });

  it("returns expiresAt on success", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: { expiresAt: "2025-12-31T23:59:59Z" } }));

    const result = await authApi.refreshToken();
    expect(result.expiresAt).toBe("2025-12-31T23:59:59Z");
  });

  it("handles response without data wrapper", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ expiresAt: "2025-06-01" }));

    const result = await authApi.refreshToken();
    expect(result.expiresAt).toBe("2025-06-01");
  });

  it("throws error on non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockRejectedValue(new Error("no body")),
    });

    await expect(authApi.refreshToken()).rejects.toThrow("Token refresh failed");
  });
});

// ============================================================================
// getCurrentUser
// ============================================================================

describe("authApi.getCurrentUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends GET to /api/backend/auth/customer/me", async () => {
    const user = { id: "u1", email: "a@b.com", name: "Alice", createdAt: "", updatedAt: "" };
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { user } }));

    await authApi.getCurrentUser();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/auth/customer/me",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
      })
    );
  });

  it("returns user from { data: { user } } shape", async () => {
    const user = { id: "u1", email: "a@b.com", name: "Alice", createdAt: "", updatedAt: "" };
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { user } }));

    const result = await authApi.getCurrentUser();
    expect(result).toEqual(user);
  });

  it("returns user from flat { user } shape", async () => {
    const user = { id: "u2", email: "b@c.com", name: "Bob", createdAt: "", updatedAt: "" };
    mockFetch.mockResolvedValue(mockJsonResponse({ user }));

    const result = await authApi.getCurrentUser();
    expect(result).toEqual(user);
  });
});

// ============================================================================
// updateProfile, changePassword, requestPasswordReset, resetPassword, verifyEmail
// ============================================================================

describe("authApi.updateProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends PATCH to /api/backend/auth/customer/profile", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ id: "u1", name: "Updated" }));

    await authApi.updateProfile({ name: "Updated" });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/auth/customer/profile",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
      })
    );
  });
});

describe("authApi.changePassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends POST with currentPassword and newPassword", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}));

    await authApi.changePassword("old-pass", "new-pass");

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(body.currentPassword).toBe("old-pass");
    expect(body.newPassword).toBe("new-pass");
  });
});

describe("authApi.requestPasswordReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends email in request body", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}));

    await authApi.requestPasswordReset("user@test.com");

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(body.email).toBe("user@test.com");
  });
});

describe("authApi.resetPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends token and newPassword in request body", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}));

    await authApi.resetPassword("reset-token-123", "new-pass");

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(body.token).toBe("reset-token-123");
    expect(body.newPassword).toBe("new-pass");
  });
});

describe("authApi.verifyEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends token in request body", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}));

    await authApi.verifyEmail("verify-token-456");

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(body.token).toBe("verify-token-456");
  });
});

describe("authApi.resendVerificationEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends POST to /api/backend/auth/customer/verify-email/resend", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}));

    await authApi.resendVerificationEmail();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/auth/customer/verify-email/resend",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      })
    );
  });
});
