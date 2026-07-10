/**
 * @file auth.test.ts
 * @description Server-action tests for customer login MFA wiring. Covers
 *              `loginAction` returning an inert MFA challenge state on
 *              `mfaRequired`, and `completeMfaLoginAction`: request shape with
 *              the XFF relay, the wrong-code-keeps-challenge vs
 *              challenge-invalid/503-falls-back mapping, and cookie persistence
 *              on success.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { redirectMock, headersMock, setSessionCookieMock, setRefreshCookieMock, mockFetch } =
  vi.hoisted(() => ({
    redirectMock: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
    headersMock: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.9" })),
    setSessionCookieMock: vi.fn(async () => {}),
    setRefreshCookieMock: vi.fn(async () => {}),
    mockFetch: vi.fn(),
  }));

vi.mock("@/lib/env", () => ({
  env: { API_URL: "http://localhost:3000", API_BASE_URL: "http://localhost:3000" },
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "en"),
}));

vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

vi.mock("@/lib/auth/sessionCookie", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/sessionCookie")>(
    "@/lib/auth/sessionCookie"
  );
  return {
    readAuthTokens: actual.readAuthTokens,
    setSessionCookie: setSessionCookieMock,
    setRefreshCookie: setRefreshCookieMock,
  };
});

vi.mock("@observability/browser-logger", () => ({
  ConsoleLoggerAdapter: class {
    error = vi.fn();
    warn = vi.fn();
    info = vi.fn();
  },
}));

vi.stubGlobal("fetch", mockFetch);

import { loginAction, completeMfaLoginAction } from "./auth";

function okJson(body: unknown) {
  return { ok: true, status: 200, json: vi.fn().mockResolvedValue(body) };
}
function errJson(status: number, body: unknown) {
  return { ok: false, status, json: vi.fn().mockResolvedValue(body) };
}

function loginForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.append("email", overrides.email ?? "a@b.com");
  fd.append("password", overrides.password ?? "pass1234");
  if (overrides.rememberMe) fd.append("rememberMe", overrides.rememberMe);
  return fd;
}

function mfaForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.append("challengeToken", overrides.challengeToken ?? "challenge-jwt-abc");
  fd.append("code", overrides.code ?? "123456");
  if (overrides.rememberMe) fd.append("rememberMe", overrides.rememberMe);
  return fd;
}

describe("loginAction — MFA challenge state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an mfaChallenge state (no cookies) when the backend requires MFA", async () => {
    mockFetch.mockResolvedValue(
      okJson({
        data: { mfaRequired: true, challengeToken: "challenge-jwt-abc", expiresInSeconds: 180 },
      })
    );

    const result = await loginAction(null, loginForm({ rememberMe: "on" }));

    expect(result.mfaChallenge).toEqual({
      challengeToken: "challenge-jwt-abc",
      expiresInSeconds: 180,
      rememberMe: true,
    });
    expect(setSessionCookieMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("still completes a non-MFA login (cookies + redirect)", async () => {
    mockFetch.mockResolvedValue(
      okJson({ data: { accessToken: "AT", refreshToken: "RT", user: { id: "u1" } } })
    );

    await expect(loginAction(null, loginForm())).rejects.toThrow("REDIRECT:/en/dashboard");
    expect(setSessionCookieMock).toHaveBeenCalledWith("AT");
    expect(redirectMock).toHaveBeenCalledWith("/en/dashboard");
  });
});

describe("completeMfaLoginAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POSTs to /auth/customer/login/mfa with the XFF relay and challenge body", async () => {
    mockFetch.mockResolvedValue(okJson({ data: { accessToken: "AT", refreshToken: "RT" } }));

    await completeMfaLoginAction(null, mfaForm({ rememberMe: "on" })).catch(() => {});

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/auth/customer/login/mfa",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-forwarded-for": "203.0.113.9" }),
        body: JSON.stringify({
          challengeToken: "challenge-jwt-abc",
          code: "123456",
          rememberMe: true,
        }),
      })
    );
  });

  it("keeps the challenge on a wrong code (INVALID_MFA_CODE)", async () => {
    mockFetch.mockResolvedValue(
      errJson(401, { error: "Invalid MFA code.", code: "INVALID_MFA_CODE" })
    );

    const result = await completeMfaLoginAction(null, mfaForm({ code: "000000" }));

    expect(result.error).toBe("Invalid MFA code.");
    expect(result.mfaChallengeExpired).toBeUndefined();
  });

  it("falls back to the password step when the challenge is invalid/expired", async () => {
    mockFetch.mockResolvedValue(
      errJson(401, {
        error: "MFA challenge is invalid or expired. Please sign in again.",
        code: "INVALID_CHALLENGE",
      })
    );

    const result = await completeMfaLoginAction(null, mfaForm());

    expect(result.mfaChallengeExpired).toBe(true);
    expect(result.error).toBe("MFA challenge is invalid or expired. Please sign in again.");
  });

  it("falls back to the password step when the challenge store is unavailable (503)", async () => {
    mockFetch.mockResolvedValue(
      errJson(503, { error: "Unable to complete multi-factor login right now. Please try again." })
    );

    const result = await completeMfaLoginAction(null, mfaForm());

    expect(result.mfaChallengeExpired).toBe(true);
  });

  it("persists cookies and redirects on success", async () => {
    mockFetch.mockResolvedValue(
      okJson({ data: { accessToken: "AT", refreshToken: "RT", user: { id: "u1" } } })
    );

    await expect(completeMfaLoginAction(null, mfaForm({ rememberMe: "on" }))).rejects.toThrow(
      "REDIRECT:/en/dashboard"
    );
    expect(setSessionCookieMock).toHaveBeenCalledWith("AT");
    expect(setRefreshCookieMock).toHaveBeenCalledWith("RT", { rememberMe: true });
    expect(redirectMock).toHaveBeenCalledWith("/en/dashboard");
  });
});
