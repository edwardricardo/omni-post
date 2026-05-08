/**
 * Unit Tests — ErrorBoundary Component
 *
 * Verifies React error boundary behavior:
 * - Normal children render correctly
 * - Errors are caught and fallback UI is shown
 * - Custom fallback is respected
 * - Raw error.message is sanitized in non-development environments (security)
 * - Raw error.message is shown in development (debug friction)
 *
 * @file ErrorBoundary.test.tsx
 * @description Tests for ErrorBoundary
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";

// Component that throws when the "throw" prop is set
function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Test error message");
  }
  return <div>Child rendered successfully</div>;
}

const GENERIC_MESSAGE = "Something went wrong. Please try again or contact support.";

describe("ErrorBoundary", () => {
  // Suppress console.error for expected throws in tests
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when no error occurs", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText("Child rendered successfully")).toBeInTheDocument();
  });

  it("shows sanitized generic message when child throws in non-dev env", () => {
    // NODE_ENV is "test" by default in vitest, which is treated as non-development.
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText("Error")).toBeInTheDocument();
    // Raw "Test error message" MUST NOT leak — sanitized to generic copy.
    expect(screen.queryByText("Test error message")).not.toBeInTheDocument();
    expect(screen.getByText(GENERIC_MESSAGE)).toBeInTheDocument();
  });

  it("shows raw error.message when NODE_ENV === 'development'", () => {
    const original = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "development");
    try {
      render(
        <ErrorBoundary>
          <ThrowingChild shouldThrow={true} />
        </ErrorBoundary>
      );
      expect(screen.getByText("Test error message")).toBeInTheDocument();
      expect(screen.queryByText(GENERIC_MESSAGE)).not.toBeInTheDocument();
    } finally {
      vi.stubEnv("NODE_ENV", original ?? "test");
      vi.unstubAllEnvs();
    }
  });

  it("shows custom fallback when provided", () => {
    const CustomFallback = <div>Custom error UI</div>;
    render(
      <ErrorBoundary fallback={CustomFallback}>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText("Custom error UI")).toBeInTheDocument();
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
  });

  it("shows generic message when error has no message (non-dev)", () => {
    function ThrowEmpty(): never {
      throw new Error();
    }
    render(
      <ErrorBoundary>
        <ThrowEmpty />
      </ErrorBoundary>
    );
    expect(screen.getByText(GENERIC_MESSAGE)).toBeInTheDocument();
  });

  it("does not render children when error occurred", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.queryByText("Child rendered successfully")).not.toBeInTheDocument();
  });
});
