/**
 * @file client.test.ts
 * @description Pins the browser half a portal's `instrumentation-client.ts` calls and re-exports:
 *              `initBrowserSentry` initializes Sentry's browser SDK once with the DSN and the
 *              environment the portal passes, keeps it disabled without a DSN or under tests, and
 *              `onRouterTransitionStart` is Sentry's router-transition hook itself.
 * @layer infrastructure
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initBrowserSentry, onRouterTransitionStart } from "../src/client";

const PUBLIC_DSN = "https://public@o0.ingest.invalid/0";

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => sentry);

describe("initBrowserSentry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes Sentry once with the DSN, the environment, the trace rate and both replay rates", () => {
    initBrowserSentry({ dsn: PUBLIC_DSN, nodeEnv: "production" });

    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.init).toHaveBeenCalledWith({
      dsn: PUBLIC_DSN,
      environment: "production",
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1.0,
      enabled: true,
    });
  });

  it("reports the development environment when the build inlined no NODE_ENV", () => {
    initBrowserSentry({ dsn: PUBLIC_DSN, nodeEnv: undefined });

    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "development", enabled: true })
    );
  });

  it("keeps Sentry disabled when no DSN is configured", () => {
    initBrowserSentry({ dsn: undefined, nodeEnv: "production" });

    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: undefined, enabled: false })
    );
  });

  it("keeps Sentry disabled in the test environment even with a DSN", () => {
    initBrowserSentry({ dsn: PUBLIC_DSN, nodeEnv: "test" });

    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "test", enabled: false })
    );
  });
});

describe("onRouterTransitionStart", () => {
  it("reports App Router navigations through Sentry's router-transition hook", () => {
    expect(onRouterTransitionStart).toBe(sentry.captureRouterTransitionStart);
  });
});
