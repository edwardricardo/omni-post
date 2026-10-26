/**
 * @file proxy.test.ts
 * @description Pins the client proxy's auth gate around the locale prefix: the prefix is
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

const ORIGIN = "http://client.test";
const SESSION_COOKIE = "customer-session=session-token";

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

describe("client proxy with the declared routing (en, es)", () => {
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

  it("redirects an anonymous visitor on /es/dashboard to /es/login, keeping the requested path", async () => {
    const proxy = await loadProxy();

    const response = proxy(requestTo("/es/dashboard"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/es/login?redirect=%2Fes%2Fdashboard`);
  });

  it("redirects a signed-in user on /en/login to /en/dashboard", async () => {
    const proxy = await loadProxy();

    const response = proxy(requestTo("/en/login", SESSION_COOKIE));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/en/dashboard`);
  });

  it("keeps a signed-in user on the site when the auth page carries a returnTo to another origin", async () => {
    const proxy = await loadProxy();

    const response = proxy(
      requestTo("/en/login?returnTo=https%3A%2F%2Fevil.example%2Fphish", SESSION_COOKIE)
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/en/dashboard`);
  });

  it("hands an anonymous visitor's auth page to next-intl whatever its returnTo holds", async () => {
    const proxy = await loadProxy();

    const response = proxy(requestTo("/en/login?returnTo=https%3A%2F%2Fevil.example%2Fphish"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(i18nMiddleware.handledPaths).toEqual(["/en/login"]);
  });

  it("keeps a signed-in user on the site when returnTo is a protocol-relative or backslash path", async () => {
    const proxy = await loadProxy();

    const protocolRelative = proxy(
      requestTo("/es/login?returnTo=%2F%2Fevil.example", SESSION_COOKIE)
    );
    const backslash = proxy(requestTo("/es/register?returnTo=%2F%5Cevil.example", SESSION_COOKIE));

    expect(protocolRelative.status).toBe(307);
    expect(protocolRelative.headers.get("location")).toBe(`${ORIGIN}/es/dashboard`);
    expect(backslash.status).toBe(307);
    expect(backslash.headers.get("location")).toBe(`${ORIGIN}/es/dashboard`);
  });

  it("lets an anonymous visitor reach the bare /es root", async () => {
    const proxy = await loadProxy();

    const response = proxy(requestTo("/es"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(i18nMiddleware.handledPaths).toEqual(["/es"]);
  });

  it("falls back to the default locale's login for a path without a locale prefix", async () => {
    const proxy = await loadProxy();

    const response = proxy(requestTo("/dashboard"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/en/login?redirect=%2Fdashboard`);
  });

  it("does not strip a first segment that only begins with a locale", async () => {
    const proxy = await loadProxy();

    const response = proxy(requestTo("/esx/login"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/en/login?redirect=%2Fesx%2Flogin`);
  });
});

describe("client proxy with a routing that declares a third locale (fr)", () => {
  it("lets an anonymous visitor reach /fr/login", async () => {
    const proxy = await loadProxy(["en", "es", "fr"]);

    const response = proxy(requestTo("/fr/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(i18nMiddleware.handledPaths).toEqual(["/fr/login"]);
  });

  it("redirects an anonymous visitor on /fr/dashboard to /fr/login, keeping the requested path", async () => {
    const proxy = await loadProxy(["en", "es", "fr"]);

    const response = proxy(requestTo("/fr/dashboard"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/fr/login?redirect=%2Ffr%2Fdashboard`);
  });
});
