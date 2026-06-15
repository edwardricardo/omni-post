/**
 * @file context.tsx
 * @description React DI for the browser logger. Provides <LoggerProvider> for
 *              app-level logger factory injection and useLogger / useLoggerContext
 *              hooks for component consumption. Swapping implementations (e.g.,
 *              console → Sentry) only requires changing the provider's factory.
 * @layer infrastructure
 */

"use client";

import React, { ReactNode, createContext, useContext, useMemo } from "react";
import { ConsoleLoggerAdapter } from "./console-adapter.js";
import type { BrowserLoggerPort, LogContext } from "./port.js";

interface LoggerContextValue {
  createLogger: (name: string) => BrowserLoggerPort;
  defaultContext?: LogContext;
}

const LoggerContext = createContext<LoggerContextValue | undefined>(undefined);

interface LoggerProviderProps {
  children: ReactNode;
  /**
   * Optional custom logger factory. When omitted, defaults to
   * ConsoleLoggerAdapter. Swap this to wire a real APM adapter.
   */
  createLogger?: (name: string) => BrowserLoggerPort;
  /**
   * Optional context bound to every logger created by this provider
   * (e.g., `{ app: "admin" }`, correlation ID from request, user ID after login).
   */
  defaultContext?: LogContext;
}

/**
 * @component LoggerProvider
 * @description Wraps the app with a logger factory. Child components access
 *              loggers via the `useLogger` hook.
 */
export function LoggerProvider({
  children,
  createLogger,
  defaultContext,
}: LoggerProviderProps): React.ReactElement {
  const value = useMemo<LoggerContextValue>(() => {
    const factory =
      createLogger ??
      ((name: string): BrowserLoggerPort =>
        new ConsoleLoggerAdapter(name, {
          ...(defaultContext !== undefined && { boundContext: defaultContext }),
        }));
    return {
      createLogger: factory,
      ...(defaultContext !== undefined && { defaultContext }),
    };
  }, [createLogger, defaultContext]);

  return <LoggerContext.Provider value={value}>{children}</LoggerContext.Provider>;
}

/**
 * @hook useLogger
 * @description Obtain a logger instance scoped to the given name. When called
 *              outside a LoggerProvider, falls back to a default
 *              ConsoleLoggerAdapter (useful for isolated component tests).
 * @param name - Logger identifier (component or subsystem name)
 * @returns BrowserLoggerPort instance
 */
export function useLogger(name: string): BrowserLoggerPort {
  const context = useContext(LoggerContext);
  if (context === undefined) {
    return new ConsoleLoggerAdapter(name);
  }
  return context.createLogger(name);
}

/**
 * @hook useLoggerContext
 * @description Read the provider's defaultContext (correlation ID, user, etc.).
 *              Returns undefined when no provider is present.
 */
export function useLoggerContext(): LogContext | undefined {
  const context = useContext(LoggerContext);
  return context?.defaultContext;
}
