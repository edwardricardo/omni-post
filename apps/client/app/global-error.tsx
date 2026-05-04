"use client";

/**
 * @file global-error.tsx
 * @description Next.js global error boundary rendering a fallback UI with a reset action
 *              when the root layout crashes.
 * @component GlobalError
 * @layer infrastructure
 */
import { useEffect } from "react";
import { ConsoleLoggerAdapter } from "@observability/browser-logger";

// global-error replaces the entire <html> tree when the root layout crashes,
// so it runs outside any React Context — we can't use useLogger. Instantiate
// the console adapter directly; swap to an APM adapter here if a root-level
// reporting channel becomes available.
const globalErrorLogger = new ConsoleLoggerAdapter("client.global-error");

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    globalErrorLogger.error("Global error (root layout crash)", error, {
      ...(error.digest !== undefined && { digest: error.digest }),
    });
  }, [error]);

  const isDev = process.env.NODE_ENV === "development";
  const displayMessage = isDev
    ? error.message || "A critical error occurred"
    : "Something went wrong. Please try again or contact support.";

  return (
    <html lang="en">
      <body>
        <div
          role="alert"
          aria-live="assertive"
          className="flex min-h-screen flex-col items-center justify-center"
        >
          <h2 className="text-2xl font-bold mb-4">Something went wrong!</h2>
          <p className="text-gray-600 mb-4">{displayMessage}</p>
          {!isDev && error.digest && (
            <p className="text-sm text-gray-500 mb-4">Error ID: {error.digest}</p>
          )}
          <button
            onClick={() => reset()}
            className="px-4 py-2 bg-blue-500 text-white rounded-sm hover:bg-blue-600"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
