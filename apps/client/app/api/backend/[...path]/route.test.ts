/**
 * @file route.test.ts
 * @description Proxy cookie-path tests for the universal backend route handler.
 *              Anchors the load-bearing security fix: a step-2 MFA response
 *              through `auth/customer/login/mfa` MUST persist httpOnly session /
 *              refresh cookies and MUST NOT leak tokens to the browser body,
 *              while the step-1 challenge (`auth/customer/login`) still passes
 *              through with no cookies.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Sidestep the @t3-oss/env-nextjs client-access guard under jsdom (window is
// defined, so a real server-var read would throw onInvalidAccess).
vi.mock("@/lib/env", () => ({
  env: { API_URL: "http://localhost:3000", API_BASE_URL: "http://localhost:3000" },
}));

// Capture cookie writes via a mocked next/headers store. The REAL sessionCookie
// helpers run against this store, so httpOnly/maxAge assertions are meaningful.
interface CookieSetCall {
  name: string;
  value: string;
  options: { httpOnly?: boolean; maxAge?: number; secure?: boolean; sameSite?: string };
}
const cookieSetCalls: CookieSetCall[] = [];
const cookieStore = {
  get: vi.fn(() => undefined),
  set: vi.fn((name: string, value: string, options: CookieSetCall["options"]) => {
    cookieSetCalls.push({ name, value, options });
  }),
  delete: vi.fn(),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { POST } from "./route";

function upstreamJson(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    body: null,
    headers: new Headers({ "Content-Type": "application/json" }),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

function makeRequest(pathSegments: string[], jsonBody: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/backend/${pathSegments.join("/")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(jsonBody),
  });
}

function invoke(pathSegments: string[], jsonBody: unknown) {
  const req = makeRequest(pathSegments, jsonBody);
  return POST(req, { params: Promise.resolve({ path: pathSegments }) });
}

describe("backend proxy — MFA step-2 cookie path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieSetCalls.length = 0;
  });

  it("persists httpOnly session and refresh cookies on a step-2 response", async () => {
    mockFetch.mockResolvedValue(
      upstreamJson({
        data: {
          accessToken: "ACCESS-TOKEN",
          refreshToken: "REFRESH-TOKEN",
          user: { id: "u1" },
          expiresAt: "2025-12-31",
        },
      })
    );

    await invoke(["auth", "customer", "login", "mfa"], {
      challengeToken: "ct",
      code: "123456",
      rememberMe: false,
    });

    const session = cookieSetCalls.find((c) => c.name === "customer-session");
    const refresh = cookieSetCalls.find((c) => c.name === "customer-refresh");
    expect(session?.value).toBe("ACCESS-TOKEN");
    expect(session?.options.httpOnly).toBe(true);
    expect(refresh?.value).toBe("REFRESH-TOKEN");
    expect(refresh?.options.httpOnly).toBe(true);
  });

  it("does NOT leak the tokens into the browser-visible response body", async () => {
    mockFetch.mockResolvedValue(
      upstreamJson({
        data: {
          accessToken: "ACCESS-TOKEN",
          refreshToken: "REFRESH-TOKEN",
          user: { id: "u1" },
          expiresAt: "2025-12-31",
        },
      })
    );

    const res = await invoke(["auth", "customer", "login", "mfa"], {
      challengeToken: "ct",
      code: "123456",
    });
    const text = await res.text();

    expect(text).not.toContain("ACCESS-TOKEN");
    expect(text).not.toContain("REFRESH-TOKEN");
    expect(text).toContain("u1"); // user data still forwarded
  });

  it("extends the refresh cookie TTL when rememberMe is set on step-2", async () => {
    mockFetch.mockResolvedValue(
      upstreamJson({
        data: {
          accessToken: "ACCESS-TOKEN",
          refreshToken: "REFRESH-TOKEN",
          user: { id: "u1" },
          expiresAt: "2025-12-31",
        },
      })
    );

    await invoke(["auth", "customer", "login", "mfa"], {
      challengeToken: "ct",
      code: "123456",
      rememberMe: true,
    });

    const refresh = cookieSetCalls.find((c) => c.name === "customer-refresh");
    expect(refresh?.options.maxAge).toBe(30 * 24 * 60 * 60);
  });

  it("passes the step-1 challenge through with no cookies", async () => {
    mockFetch.mockResolvedValue(
      upstreamJson({
        data: { mfaRequired: true, challengeToken: "challenge-jwt", expiresInSeconds: 180 },
      })
    );

    const res = await invoke(["auth", "customer", "login"], {
      email: "a@b.com",
      password: "pass",
    });
    const text = await res.text();

    expect(cookieSetCalls).toHaveLength(0);
    expect(text).toContain("mfaRequired");
    expect(text).toContain("challenge-jwt");
  });
});
