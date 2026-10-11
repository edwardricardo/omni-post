/**
 * @file server.test.ts
 * @description Pins `createServerInstrumentation`, the server half a portal's `instrumentation.ts`
 *              re-exports: `register()` initializes Sentry only on the Node.js runtime, loads the
 *              portal's env module only there, prefers the server DSN over the public one, and keeps
 *              Sentry disabled without a DSN or under tests; `onRequestError` is Sentry's
 *              request-error hook itself.
 * @layer infrastructure
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createServerInstrumentation, type SentryServerEnv } from "../src/server";

const SERVER_DSN = "https://server@o0.ingest.invalid/0";
const PUBLIC_DSN = "https://public@o0.ingest.invalid/0";

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureRequestError: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => sentry);

/**
 * @description Builds the `loadEnv` a portal passes, as a spy that resolves to the given env.
 * @param env - The validated environment the portal's env module would export.
 * @returns A spy standing in for the portal's dynamic import of its env module.
 */
function loadEnvOf(env: SentryServerEnv) {
  return vi.fn(async () => ({ env }));
}

describe("createServerInstrumentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("initializes Sentry once on the Node.js runtime, with the server DSN", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { register } = createServerInstrumentation({
      loadEnv: loadEnvOf({
        SENTRY_DSN: SERVER_DSN,
        NEXT_PUBLIC_SENTRY_DSN: PUBLIC_DSN,
        NODE_ENV: "production",
      }),
    });

    await register();

    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.init).toHaveBeenCalledWith({
      dsn: SERVER_DSN,
      environment: "production",
      tracesSampleRate: 0.1,
      enabled: true,
    });
  });

  it("falls back to the public DSN when no server DSN is set", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { register } = createServerInstrumentation({
      loadEnv: loadEnvOf({ NEXT_PUBLIC_SENTRY_DSN: PUBLIC_DSN, NODE_ENV: "production" }),
    });

    await register();

    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: PUBLIC_DSN, enabled: true })
    );
  });

  it("keeps Sentry disabled when no DSN is configured", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { register } = createServerInstrumentation({
      loadEnv: loadEnvOf({ NODE_ENV: "production" }),
    });

    await register();

    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: undefined, enabled: false })
    );
  });

  it("keeps Sentry disabled in the test environment even with a DSN", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { register } = createServerInstrumentation({
      loadEnv: loadEnvOf({ SENTRY_DSN: SERVER_DSN, NODE_ENV: "test" }),
    });

    await register();

    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "test", enabled: false })
    );
  });

  it("neither loads the env module nor initializes Sentry on Next's Edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const loadEnv = loadEnvOf({ SENTRY_DSN: SERVER_DSN, NODE_ENV: "production" });
    const { register } = createServerInstrumentation({ loadEnv });

    await register();

    expect(loadEnv).not.toHaveBeenCalled();
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("reports the errors Next catches on the server through Sentry's request-error hook", () => {
    const { onRequestError } = createServerInstrumentation({
      loadEnv: loadEnvOf({ NODE_ENV: "production" }),
    });

    expect(onRequestError).toBe(sentry.captureRequestError);
  });
});
