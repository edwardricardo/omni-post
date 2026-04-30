/**
 * @file context.test.tsx
 * @description Tests for ApiProvider and useApi
 * @layer infrastructure
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { ApiProvider, useApi, useApiErrorHandler } from "../context";
import { ApiError } from "../types";

// Test component that uses the API context
function TestComponent() {
  const { client, handleError } = useApi();
  const errorHandler = useApiErrorHandler();

  return (
    <div>
      <span data-testid="client-exists">{client ? "yes" : "no"}</span>
      <button
        data-testid="trigger-error"
        onClick={() => {
          const error = new ApiError(400, null, "Test error");
          handleError(error);
          errorHandler(error);
        }}
      >
        Trigger Error
      </button>
    </div>
  );
}

describe("ApiProvider and useApi", () => {
  it("should provide API client", () => {
    render(
      <ApiProvider>
        <TestComponent />
      </ApiProvider>
    );

    expect(screen.getByTestId("client-exists")).toHaveTextContent("yes");
  });

  it("should delegate errors to onError callback when provided", () => {
    const onError = vi.fn();

    render(
      <ApiProvider onError={onError}>
        <TestComponent />
      </ApiProvider>
    );

    screen.getByTestId("trigger-error").click();

    // handleError + errorHandler both call onError, so it fires twice
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(expect.any(ApiError));
  });

  it("should not throw when no onError is provided", () => {
    render(
      <ApiProvider>
        <TestComponent />
      </ApiProvider>
    );

    // Should not throw -- handleError is a no-op when no onError callback
    expect(() => {
      screen.getByTestId("trigger-error").click();
    }).not.toThrow();
  });

  it("should call custom error handler with correct error instance", () => {
    const onError = vi.fn();

    render(
      <ApiProvider onError={onError}>
        <TestComponent />
      </ApiProvider>
    );

    screen.getByTestId("trigger-error").click();

    const firstCallArg = onError.mock.calls[0][0];
    expect(firstCallArg).toBeInstanceOf(ApiError);
    expect(firstCallArg.message).toBe("Test error");
    expect(firstCallArg.status).toBe(400);
  });

  it("should throw error when used outside provider", () => {
    // Suppress React error boundary console output
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      render(<TestComponent />);
    }).toThrow("useApi must be used within an ApiProvider");

    consoleSpy.mockRestore();
  });

  describe("Error handling delegates to onError callback", () => {
    it("should pass 401 errors to onError", () => {
      const onError = vi.fn();

      function TestUnauthorized() {
        const { handleError } = useApi();
        const error = new ApiError(401, null, "Unauthorized");
        handleError(error);
        return <div>Test</div>;
      }

      render(
        <ApiProvider onError={onError}>
          <TestUnauthorized />
        </ApiProvider>
      );

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
    });

    it("should pass 403 errors to onError", () => {
      const onError = vi.fn();

      function TestForbidden() {
        const { handleError } = useApi();
        const error = new ApiError(403, null, "Forbidden");
        handleError(error);
        return <div>Test</div>;
      }

      render(
        <ApiProvider onError={onError}>
          <TestForbidden />
        </ApiProvider>
      );

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
    });

    it("should pass 429 errors to onError", () => {
      const onError = vi.fn();

      function TestRateLimit() {
        const { handleError } = useApi();
        const error = new ApiError(429, null, "Too Many Requests");
        handleError(error);
        return <div>Test</div>;
      }

      render(
        <ApiProvider onError={onError}>
          <TestRateLimit />
        </ApiProvider>
      );

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ status: 429 }));
    });

    it("should pass 500 errors to onError", () => {
      const onError = vi.fn();

      function TestServerError() {
        const { handleError } = useApi();
        const error = new ApiError(500, null, "Internal Server Error");
        handleError(error);
        return <div>Test</div>;
      }

      render(
        <ApiProvider onError={onError}>
          <TestServerError />
        </ApiProvider>
      );

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ status: 500 }));
    });
  });
});
