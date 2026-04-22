/**
 * @file context.test.tsx
 * @description Tests for LoggerProvider + useLogger + useLoggerContext.
 *              Covers factory injection, default fallback, and defaultContext
 *              propagation.
 * @layer infrastructure
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook } from "@testing-library/react";
import { LoggerProvider, useLogger, useLoggerContext } from "../src/context";
import { ConsoleLoggerAdapter } from "../src/console-adapter";
import type { BrowserLoggerPort, LogContext, LogLevelType } from "../src/port";
import { LogLevel } from "../src/port";

class MockLogger implements BrowserLoggerPort {
  readonly name: string;
  readonly level: LogLevelType = LogLevel.INFO;
  public entries: Array<{ level: string; message: string; data?: LogContext }> = [];

  constructor(name: string) {
    this.name = name;
  }

  debug(message: string, data?: LogContext): void {
    this.entries.push({ level: "debug", message, ...(data !== undefined && { data }) });
  }
  info(message: string, data?: LogContext): void {
    this.entries.push({ level: "info", message, ...(data !== undefined && { data }) });
  }
  warn(message: string, data?: LogContext): void {
    this.entries.push({ level: "warn", message, ...(data !== undefined && { data }) });
  }
  error(message: string, error?: Error | LogContext, context?: LogContext): void {
    const data: LogContext = {};
    if (error instanceof Error) {
      data.err = error.message;
    } else if (error !== undefined) {
      Object.assign(data, error);
    }
    if (context !== undefined) Object.assign(data, context);
    this.entries.push({ level: "error", message, data });
  }
  child(bindings: LogContext): BrowserLoggerPort {
    const c = new MockLogger(this.name);
    c.entries = this.entries;
    void bindings;
    return c;
  }
}

describe("LoggerProvider + useLogger", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("useLogger returns a ConsoleLoggerAdapter when no provider is present", () => {
    const { result } = renderHook(() => useLogger("no-provider"));
    expect(result.current).toBeInstanceOf(ConsoleLoggerAdapter);
    expect(result.current.name).toBe("no-provider");
  });

  it("useLogger uses the provider's custom factory when supplied", () => {
    const mocks: MockLogger[] = [];
    const factory = (name: string): BrowserLoggerPort => {
      const m = new MockLogger(name);
      mocks.push(m);
      return m;
    };

    const wrapper = ({ children }: { children: React.ReactNode }): React.ReactElement => (
      <LoggerProvider createLogger={factory}>{children}</LoggerProvider>
    );

    const { result } = renderHook(() => useLogger("injected"), { wrapper });
    expect(result.current).toBeInstanceOf(MockLogger);
    expect(result.current.name).toBe("injected");

    result.current.info("hello", { foo: "bar" });
    expect(mocks[0]?.entries).toEqual([{ level: "info", message: "hello", data: { foo: "bar" } }]);
  });

  it("useLogger from default factory includes defaultContext as boundContext", () => {
    const wrapper = ({ children }: { children: React.ReactNode }): React.ReactElement => (
      <LoggerProvider defaultContext={{ app: "admin" }}>{children}</LoggerProvider>
    );

    const { result } = renderHook(() => useLogger("with-default-ctx"), { wrapper });
    result.current.info("hello");
    expect(infoSpy.mock.calls[0]?.[1]).toEqual({ app: "admin" });
  });

  it("useLoggerContext returns undefined when no provider is present", () => {
    const { result } = renderHook(() => useLoggerContext());
    expect(result.current).toBeUndefined();
  });

  it("useLoggerContext returns the provider's defaultContext", () => {
    const wrapper = ({ children }: { children: React.ReactNode }): React.ReactElement => (
      <LoggerProvider defaultContext={{ correlationId: "c-1", userId: "u-1" }}>
        {children}
      </LoggerProvider>
    );

    const { result } = renderHook(() => useLoggerContext(), { wrapper });
    expect(result.current).toEqual({ correlationId: "c-1", userId: "u-1" });
  });

  it("LoggerProvider renders children", () => {
    const { getByText } = render(
      <LoggerProvider>
        <div>child-content</div>
      </LoggerProvider>
    );
    expect(getByText("child-content")).toBeTruthy();
  });
});
