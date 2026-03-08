/**
 * Unit Tests — ErrorBoundary Component
 *
 * Verifies React error boundary behavior:
 * - Normal children render correctly
 * - Errors are caught and fallback UI is shown
 * - Custom fallback is respected
 * - Error message is displayed
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

  it("shows default error UI when child throws", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Test error message")).toBeInTheDocument();
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

  it("shows fallback message when error has no message", () => {
    function ThrowEmpty(): never {
      throw new Error();
    }
    render(
      <ErrorBoundary>
        <ThrowEmpty />
      </ErrorBoundary>
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
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
