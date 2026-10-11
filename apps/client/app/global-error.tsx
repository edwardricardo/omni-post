"use client";

/**
 * @file global-error.tsx
 * @description Next.js global error boundary rendering a fallback UI with a retry action
 *              when the root layout crashes. It reports the error to Sentry and to the
 *              console logger, and retries with `retry` (stable since Next 16.3, which no
 *              longer passes `unstable_retry`; it re-fetches, where `reset` only re-renders).
 * @component GlobalError
 * @layer infrastructure
 */
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { ConsoleLoggerAdapter } from "@observability/browser-logger";

// global-error replaces the entire <html> tree when the root layout crashes,
// so it runs outside any React Context — we can't use useLogger. Instantiate
// the console adapter directly; Sentry receives the same error below.
const globalErrorLogger = new ConsoleLoggerAdapter("client.global-error");

interface GlobalErrorProps {
  /** The error the root layout threw; `digest` identifies it in the server logs. */
  error: Error & { digest?: string };
  /** Re-fetches and re-renders the root layout (Next 16.3+; `reset` re-renders only). */
  retry: () => void;
}

/**
 * Fallback document for a crash in the root layout. It shows the error message in development
 * and a generic message with the error ID otherwise, and offers a retry.
 */
export default function GlobalError({ error, retry }: GlobalErrorProps) {
  useEffect(() => {
    Sentry.captureException(error);
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
        <div role="alert" className="flex min-h-screen flex-col items-center justify-center">
          <h2 className="text-2xl font-bold mb-4">Something went wrong!</h2>
          <p className="text-gray-600 mb-4">{displayMessage}</p>
          {!isDev && error.digest && (
            <p className="text-sm text-gray-500 mb-4">Error ID: {error.digest}</p>
          )}
          <button
            onClick={() => retry()}
            className="px-4 py-2 bg-blue-500 text-white rounded-sm hover:bg-blue-600"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
