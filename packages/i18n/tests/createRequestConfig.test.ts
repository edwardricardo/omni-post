/**
 * @file createRequestConfig.test.ts
 * @description Pins the locale-resolution contract of the shared next-intl request
 *              factory. Both portals now delegate to this single implementation, so its
 *              regression surface widened when it was extracted out of `@shared/types`
 *              without any proof of its own travelling with it.
 *
 *              WHY `next-intl/server` IS MOCKED, since the obvious objection is that a
 *              mock proves less: it is not a shortcut, it is the only shape available
 *              here, and the reason is the same one that created this package. Outside a
 *              React Server Components runtime, `next-intl/server` resolves to its
 *              react-client build, where `getRequestConfig` is a stub that throws
 *              "not supported in Client Components" — measured. Forcing the react-server
 *              condition instead makes it import `next/headers`, which would require
 *              `@packages/i18n` to depend on `next` — precisely the dependency this
 *              package exists to keep out of backend closures. So the wrapper stays
 *              next-intl's contract, exercised by the apps; what is under test here is
 *              the callback's own logic: validate, fall back, delegate.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Faithful to the server build's shape: it hands the callback back for the
// framework to invoke per request. Nothing else about next-intl is simulated.
vi.mock("next-intl/server", () => ({
  getRequestConfig: (handler: unknown) => handler,
}));

import { createRequestConfig, type RoutingConfig } from "../src/createRequestConfig.js";

type Handler = (args: { requestLocale: Promise<string | undefined> }) => Promise<{
  locale: string;
  messages: Record<string, unknown>;
}>;

const ROUTING: RoutingConfig = { locales: ["en", "es"], defaultLocale: "en" };

const makeLoader = (): ReturnType<typeof vi.fn> =>
  vi.fn(async (locale: string) => ({ default: { greeting: `hello-${locale}` } }));

describe("createRequestConfig", () => {
  let loadMessages: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    loadMessages = makeLoader();
  });

  it("uses the requested locale when it is one the routing declares", async () => {
    const handler = createRequestConfig(ROUTING, loadMessages) as unknown as Handler;

    const result = await handler({ requestLocale: Promise.resolve("es") });

    expect(result.locale).toBe("es");
    expect(loadMessages).toHaveBeenCalledWith("es");
  });

  it("falls back to the default locale when the requested one is not declared", async () => {
    const handler = createRequestConfig(ROUTING, loadMessages) as unknown as Handler;

    const result = await handler({ requestLocale: Promise.resolve("fr") });

    expect(result.locale).toBe("en");
    expect(loadMessages).toHaveBeenCalledWith("en");
  });

  it("falls back to the default locale when no locale was requested at all", async () => {
    const handler = createRequestConfig(ROUTING, loadMessages) as unknown as Handler;

    const result = await handler({ requestLocale: Promise.resolve(undefined) });

    expect(result.locale).toBe("en");
    expect(loadMessages).toHaveBeenCalledWith("en");
  });

  it("matches locales exactly, so a case or whitespace variant is not accepted", async () => {
    // The runtime `as Locale` cast in the factory is sound only while this
    // branch rejects everything the routing does not literally declare. A
    // future "be lenient" refactor would make that cast a lie, and this is the
    // assertion that would fail first.
    const handler = createRequestConfig(ROUTING, loadMessages) as unknown as Handler;

    for (const variant of ["EN", " en", "en ", "en-US"]) {
      loadMessages.mockClear();
      const result = await handler({ requestLocale: Promise.resolve(variant) });
      expect(result.locale).toBe("en");
      expect(loadMessages).toHaveBeenCalledWith("en");
    }
  });

  it("returns the loader's default export as the messages bundle", async () => {
    const handler = createRequestConfig(ROUTING, loadMessages) as unknown as Handler;

    const result = await handler({ requestLocale: Promise.resolve("es") });

    expect(result.messages).toEqual({ greeting: "hello-es" });
  });

  it("propagates a loader failure instead of silently serving an empty bundle", async () => {
    // A swallowed failure here would render every page with missing strings and
    // no signal. The factory deliberately does not catch, and this pins that.
    const failing = vi.fn(async () => {
      throw new Error("messages bundle missing");
    });
    const handler = createRequestConfig(ROUTING, failing) as unknown as Handler;

    await expect(handler({ requestLocale: Promise.resolve("es") })).rejects.toThrow(
      "messages bundle missing"
    );
  });
});
