/**
 * @file GlobalErrorDocument.test.tsx
 * @description Pins the fallback document both portals' `app/global-error.tsx` render when the root
 *              layout crashes: it shows the heading, the portal's own sentence and the error ID,
 *              reports the error once to Sentry and once to the console sink, on the portal's own
 *              `<portal>.global-error` channel and tagged with the portal, and its button calls
 *              Next's `retry`.
 * @layer infrastructure
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalErrorDocument } from "../src/GlobalErrorDocument";

const { sentry, logError, loggedOn } = vi.hoisted(() => ({
  sentry: { captureException: vi.fn() },
  logError: vi.fn(),
  loggedOn: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => sentry);
// The double keeps the channel its constructor received, so each entry names the adapter that
// wrote it: `loggedOn` records the channel, `logError` the entry itself.
vi.mock("@observability/browser-logger", () => ({
  ConsoleLoggerAdapter: class {
    readonly channel: string;

    constructor(channel: string) {
      this.channel = channel;
    }

    error = (...args: unknown[]): void => {
      loggedOn(this.channel);
      logError(...args);
    };
  },
}));

describe("GlobalErrorDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["admin", "The admin dashboard hit an unexpected error. Please try again."],
    ["client", "Something went wrong. Please try again or contact support."],
  ] as const)(
    "reports the %s portal's crash once to Sentry and the console and offers a retry",
    (portal, sentence) => {
      const error = Object.assign(new Error("root layout crashed"), { digest: "digest-001" });
      const retry = vi.fn();

      render(<GlobalErrorDocument error={error} retry={retry} portal={portal} />, {
        container: document,
      });

      expect(sentry.captureException).toHaveBeenCalledTimes(1);
      expect(sentry.captureException).toHaveBeenCalledWith(error);
      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError).toHaveBeenCalledWith("Global error (root layout crash)", error, {
        portal,
        digest: "digest-001",
      });
      expect(screen.getByRole("alert").tagName).toBe("MAIN");
      expect(screen.getByRole("heading", { name: "Something went wrong!" }).tagName).toBe("H1");
      expect(screen.getByText(sentence)).toBeTruthy();
      expect(screen.getByText("Error ID: digest-001")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(retry).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ["admin", "admin.global-error"],
    ["client", "client.global-error"],
  ] as const)("logs the %s portal's crash on its own %j console channel", (portal, channel) => {
    render(
      <GlobalErrorDocument
        error={new Error("root layout crashed")}
        retry={vi.fn()}
        portal={portal}
      />,
      { container: document }
    );

    expect(loggedOn).toHaveBeenCalledTimes(1);
    expect(loggedOn).toHaveBeenCalledWith(channel);
  });

  it("shows no error ID and logs no digest when the error carries none", () => {
    const error = new Error("root layout crashed");

    render(<GlobalErrorDocument error={error} retry={vi.fn()} portal="admin" />, {
      container: document,
    });

    expect(logError).toHaveBeenCalledWith("Global error (root layout crash)", error, {
      portal: "admin",
    });
    expect(screen.queryByText(/Error ID:/)).toBeNull();
  });
});
