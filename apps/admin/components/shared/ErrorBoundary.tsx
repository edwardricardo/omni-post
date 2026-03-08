/**
 * @file ErrorBoundary.tsx
 * @description React class-based error boundary that catches rendering errors in its subtree
 * and displays a configurable fallback UI instead of crashing the entire page.
 */
"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <span className="text-red-600 text-xl">⚠️</span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800">Error</p>
                <p className="mt-1 text-sm text-red-700">
                  {this.state.error?.message || "Something went wrong"}
                </p>
              </div>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
