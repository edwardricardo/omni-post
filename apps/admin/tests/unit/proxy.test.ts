/**
 * @file proxy.test.ts
 * @description Pins the admin proxy's auth gate around the locale prefix: the prefix is
 *   stripped for every locale `routing.locales` declares, so a public page stays public in
 *   each of them and a protected page redirects to the same locale's login. The routing is
 *   the real one, or a mocked one declaring a third locale. next-intl's middleware is a
 *   recording stand-in: its ESM build imports the extensionless `next/server`, which Node's
 *   resolver refuses outside Next's bundler (the reason the portal's tests also mock
 *   `@/i18n/navigation`), and the gate under test is the proxy's, not next-intl's.
 * @layer infrastructure
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ORIGIN = "http://admin.test";
const SESSION_COOKIE = "admin-session=session-token";

const i18nMiddleware = vi.hoisted(() => ({ handledPaths: [] as string[] }));

vi.mock("next-intl/middleware", async () => {
  const { NextResponse } = await import("next/server");
  return {
    default: () => (request: NextRequest) => {
      i18nMiddleware.handledPaths.push(request.nextUrl.pathname);
      return NextResponse.next();
    },
  };
});

type Proxy = (typeof import("@/proxy"))["proxy"];

/**
 * Loads a fresh copy of the proxy, with the real routing or with one declaring `locales`.
 * The proxy builds its next-intl middleware at module load, so each routing needs its own load.
 */
async function loadProxy(locales?: readonly string[]): Promise<Proxy> {
  vi.resetModules();
  if (locales) {
    vi.doMock("@/i18n/routing", () => ({ routing: { locales, defaultLocale: "en" } }));
  }
  const { proxy } = await import("@/proxy");
  return proxy;
}

function requestTo(path: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(path, ORIGIN), cookie ? { headers: { cookie } } : {});
}

beforeEach(() => {
  i18nMiddleware.handledPaths.length = 0;
});

afterEach(() => {
  vi.doUnmock("@/i18n/routing");
  vi.resetModules();
});

describe("admin proxy with the declared routing (en, es)", () => {
  it("lets an anonymous visitor reach /es/login", async () => {
    const proxy = await loadProxy();

    const response = proxy(requestTo("/es/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(i18nMiddleware.handledPaths).toEqual(["/es/login"]);
  });

  it("lets an anonymous visitor reach /en/login", async () => {
    const proxy = await loadProxy();

    const response = proxy(requestTo("/en/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(i18nMiddleware.handledPaths).toEqual(["/en/login"]);
  });

  it("redirects an anonymous visitor on /es/dashboard to /es/login", async () => {
    const proxy = await loadProxy();

    const response = proxy(requestTo("/es/dashboard"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/es/login`);
  });

  it("redirects a signed-in user on /en/login to /en", async () => {
    const proxy = await loadProxy();

    const response = proxy(requestTo("/en/login", SESSION_COOKIE));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/en`);
  });

  it("redirects an anonymous visitor on the bare /es root to /es/login", async () => {
    const proxy = await loadProxy();

    const response = proxy(requestTo("/es"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/es/login`);
  });

  it("falls back to the default locale's login for a path without a locale prefix", async () => {
    const proxy = await loadProxy();

    const response = proxy(requestTo("/dashboard"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/en/login`);
  });

  it("does not strip a first segment that only begins with a locale", async () => {
    const proxy = await loadProxy();

    const response = proxy(requestTo("/esx/login"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/en/login`);
  });
});

describe("admin proxy with a routing that declares a third locale (fr)", () => {
  it("lets an anonymous visitor reach /fr/login", async () => {
    const proxy = await loadProxy(["en", "es", "fr"]);

    const response = proxy(requestTo("/fr/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(i18nMiddleware.handledPaths).toEqual(["/fr/login"]);
  });

  it("redirects an anonymous visitor on /fr/dashboard to /fr/login", async () => {
    const proxy = await loadProxy(["en", "es", "fr"]);

    const response = proxy(requestTo("/fr/dashboard"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/fr/login`);
  });
});
