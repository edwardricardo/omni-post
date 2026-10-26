/**
 * @file authRefresh.test.ts
 * @description Proves that the admin token refresh route sends a refreshed session to the
 *              dashboard root of the admin app and nowhere else: a `returnTo` parameter, which no
 *              caller sets, cannot send the browser to another origin.
 * @layer infrastructure
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const session = vi.hoisted(() => ({ setSessionCookie: vi.fn(), clearAuthCookies: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "admin-refresh" || name === "admin-csrf" ? { value: `${name}-value` } : undefined,
  }),
}));

vi.mock("@/lib/auth/sessionCookie", () => ({
  REFRESH_COOKIE_NAME: "admin-refresh",
  CSRF_COOKIE_NAME: "admin-csrf",
  setSessionCookie: session.setSessionCookie,
  clearAuthCookies: session.clearAuthCookies,
}));

const okRefresh = (): Response =>
  new Response(JSON.stringify({ ok: true, data: { tokens: { accessToken: "fresh-access" } } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  session.setSessionCookie.mockReset();
  session.clearAuthCookies.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => okRefresh())
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/auth/refresh", () => {
  it("refreshes the session and redirects to the admin app's root", async () => {
    const { GET } = await import("../../../app/api/auth/refresh/route");

    const response = await GET(new NextRequest("http://admin.test/api/auth/refresh"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/");
    expect(session.setSessionCookie).toHaveBeenCalledWith("fresh-access");
  });

  it("does not follow a returnTo to another origin after a successful refresh", async () => {
    const { GET } = await import("../../../app/api/auth/refresh/route");
    const appOrigin = new URL(
      (await GET(new NextRequest("http://admin.test/api/auth/refresh"))).headers.get("location") ??
        ""
    ).origin;

    const response = await GET(
      new NextRequest("http://admin.test/api/auth/refresh?returnTo=https%3A%2F%2Fevil.example%2Fx")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${appOrigin}/`);
  });
});
