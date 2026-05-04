/**
 * @file ErrorBoundary.tsx
 * @description React error boundary that catches render-time errors in its
 *   subtree and shows a fallback UI. Routes caught errors through the
 *   BrowserLoggerPort for structured reporting. Accepts an optional logger
 *   prop; defaults to a ConsoleLoggerAdapter when omitted.
 * @component ErrorBoundary
 * @layer infrastructure
 */
"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { ConsoleLoggerAdapter, type BrowserLoggerPort } from "@observability/browser-logger";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  logger?: BrowserLoggerPort;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false, error: null };

  private readonly logger: BrowserLoggerPort;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.logger = props.logger ?? new ConsoleLoggerAdapter("ErrorBoundary");
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.logger.error("ErrorBoundary caught error", error, {
      componentStack: info.componentStack ?? undefined,
    });
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }
      // Never leak raw error.message to end users in production — attackers can
      // use the shape/stack of internal errors for reconnaissance. In development
      // show the real message to keep debugging friction low.
      const isDev = process.env.NODE_ENV === "development";
      const displayMessage =
        isDev && this.state.error?.message
          ? this.state.error.message
          : "Something went wrong. Please try again or contact support.";
      return (
        <div role="alert">
          <h2>Error</h2>
          <p>{displayMessage}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
