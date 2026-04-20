/**
 * @file ErrorBoundary.tsx
 * @description React error boundary that catches render-time errors in its
 *   subtree and shows a fallback UI. Supports an optional custom fallback.
 * @layer presentation
 */
"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ErrorBoundary caught error:", error, info.componentStack);
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }
      const message = this.state.error?.message || "Something went wrong";
      return (
        <div role="alert">
          <h2>Error</h2>
          <p>{message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
