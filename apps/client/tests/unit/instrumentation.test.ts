/**
 * @file instrumentation.test.ts
 * @description Pins the client portal's Sentry wiring to the files Next 16 loads:
 *              `instrumentation.ts` on the server, `instrumentation-client.ts` in the
 *              browser, and `app/global-error.tsx` for a crash in the root layout. The init
 *              used to live in the config files of Sentry's older convention, which a
 *              Turbopack production build never loads, so Sentry stayed uninitialized in
 *              production on both sides while every suite was green (DEF-86).
 *
 *              These tests hold the contract each file owes to Next: what `register()` does
 *              on each runtime, which DSN each side reads, when the SDK is enabled, which
 *              Sentry hooks the files export, and that the global error boundary reports its
 *              error, on the `client.global-error` console channel, and retries. The locale
 *              error page's retry is pinned here too: Next 16.3 passes `retry` and no longer
 *              `unstable_retry`. The files delegate to `@observability/sentry-next`, whose own
 *              suites pin its logic; these cases run through it, with the portal's env and
 *              portal name. What a unit test cannot see, whether the BUILD wires the files in,
 *              is `scripts/testing/sentry-init-probe.mjs`'s job, run against a standalone build.
 * @layer infrastructure
 */
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import LocaleError from "../../app/[locale]/error";
import GlobalError from "../../app/global-error";

const SERVER_DSN = "https://server@o0.ingest.invalid/0";
const PUBLIC_DSN = "https://public@o0.ingest.invalid/0";

/** A console adapter double: the channel it was built for, and a spy per level. */
interface ConsoleAdapterDouble {
  readonly channel: string;
  readonly error: Mock;
  readonly warn: Mock;
  readonly info: Mock;
  readonly debug: Mock;
}

const { sentry, env, logger, consoleAdapters } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  sentry: {
    init: vi.fn(),
    captureException: vi.fn(),
    captureRequestError: vi.fn(),
    captureRouterTransitionStart: vi.fn(),
  },
  env: {} as Record<string, string | undefined>,
  consoleAdapters: [] as ConsoleAdapterDouble[],
}));

vi.mock("@sentry/nextjs", () => sentry);
vi.mock("../../lib/env", () => ({ env }));
// Every adapter the code under test builds is kept with the channel it was built for, so a case
// can read which channel an entry was written on.
vi.mock("@observability/browser-logger", () => ({
  ConsoleLoggerAdapter: class implements ConsoleAdapterDouble {
    readonly error = vi.fn();
    readonly warn = vi.fn();
    readonly info = vi.fn();
    readonly debug = vi.fn();

    constructor(readonly channel: string) {
      consoleAdapters.push(this);
    }
  },
  useLogger: () => logger,
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

/**
 * @description Replaces the mocked `env` values with the given ones, so no key a previous test
 *   set leaks into the next.
 * @param values - The environment the module under test reads.
 */
function setEnv(values: Record<string, string>): void {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, values);
}

/**
 * @description Every `error` entry written on the console adapters built for one channel.
 * @param channel - The channel the adapters were constructed with.
 * @returns The arguments of each entry, in order.
 */
function errorsOn(channel: string): unknown[][] {
  return consoleAdapters
    .filter((adapter) => adapter.channel === channel)
    .flatMap((adapter) => adapter.error.mock.calls);
}

describe("client instrumentation.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("initializes Sentry once on the Node.js runtime, with the server DSN", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    setEnv({ SENTRY_DSN: SERVER_DSN, NEXT_PUBLIC_SENTRY_DSN: PUBLIC_DSN, NODE_ENV: "production" });
    const { register } = await import("../../instrumentation");

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
    setEnv({ NEXT_PUBLIC_SENTRY_DSN: PUBLIC_DSN, NODE_ENV: "production" });
    const { register } = await import("../../instrumentation");

    await register();

    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: PUBLIC_DSN, enabled: true })
    );
  });

  it("keeps Sentry disabled when no DSN is configured", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    setEnv({ NODE_ENV: "production" });
    const { register } = await import("../../instrumentation");

    await register();

    expect(sentry.init).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it("keeps Sentry disabled in the test environment even with a DSN", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    setEnv({ SENTRY_DSN: SERVER_DSN, NODE_ENV: "test" });
    const { register } = await import("../../instrumentation");

    await register();

    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "test", enabled: false })
    );
  });

  it.each([
    ["Edge", "edge"],
    ["unset", undefined],
  ] as const)("initializes nothing when NEXT_RUNTIME is %s", async (_label, runtime) => {
    vi.stubEnv("NEXT_RUNTIME", runtime);
    setEnv({ SENTRY_DSN: SERVER_DSN, NODE_ENV: "production" });
    const { register } = await import("../../instrumentation");

    await register();

    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("reports the errors Next catches on the server through Sentry's request-error hook", async () => {
    const { onRequestError } = await import("../../instrumentation");

    expect(onRequestError).toBe(sentry.captureRequestError);
  });
});

describe("client instrumentation-client.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("initializes Sentry once on import, with the public DSN and never the server one", async () => {
    vi.stubEnv("NODE_ENV", "production");
    setEnv({ SENTRY_DSN: SERVER_DSN, NEXT_PUBLIC_SENTRY_DSN: PUBLIC_DSN });

    await import("../../instrumentation-client");

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

  it("keeps Sentry disabled, never borrowing the server DSN, when no public DSN is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    setEnv({ SENTRY_DSN: SERVER_DSN });

    await import("../../instrumentation-client");

    expect(sentry.init).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(sentry.init.mock.calls[0]?.[0]).not.toHaveProperty("dsn", SERVER_DSN);
  });

  it("keeps Sentry disabled in the test environment even with a DSN", async () => {
    vi.stubEnv("NODE_ENV", "test");
    setEnv({ NEXT_PUBLIC_SENTRY_DSN: PUBLIC_DSN });

    await import("../../instrumentation-client");

    expect(sentry.init).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it("reports App Router navigations through Sentry's router-transition hook", async () => {
    setEnv({});
    const { onRouterTransitionStart } = await import("../../instrumentation-client");

    expect(onRouterTransitionStart).toBe(sentry.captureRouterTransitionStart);
  });
});

describe("client app/global-error.tsx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports the root-layout crash to Sentry and on the client console channel once and offers a retry that re-fetches", () => {
    const error = Object.assign(new Error("root layout crashed"), { digest: "digest-001" });
    const retry = vi.fn();

    render(createElement(GlobalError, { error, retry }), { container: document });

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledWith(error);
    expect(errorsOn("client.global-error")).toEqual([
      ["Global error (root layout crash)", error, { portal: "client", digest: "digest-001" }],
    ]);
    expect(errorsOn("admin.global-error")).toEqual([]);
    expect(screen.getByRole("heading", { name: "Something went wrong!" })).toBeInTheDocument();
    expect(screen.getByText("Error ID: digest-001")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("client app/[locale]/error.tsx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries through Next's retry prop when the user presses Try again", () => {
    const error = Object.assign(new Error("page crashed"), { digest: "digest-002" });
    const retry = vi.fn();

    render(createElement(LocaleError, { error, retry }));
    fireEvent.click(screen.getByRole("button", { name: "boundary.tryAgain" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
