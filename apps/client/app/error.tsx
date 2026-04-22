/**
 * @file error.tsx
 * @description Next.js global error boundary for the client app. Uses the
 *              browser logger port to report uncaught errors from the render
 *              tree so the sink can be swapped (console → APM) centrally.
 * @layer infrastructure
 */
"use client";

import { useEffect } from "react";
import { useLogger } from "@observability/browser-logger";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const logger = useLogger("client.error-page");

  useEffect(() => {
    logger.error("Unhandled app error", error, {
      ...(error.digest !== undefined && { digest: error.digest }),
    });
  }, [error, logger]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <h2 className="text-2xl font-bold mb-4">Something went wrong!</h2>
      <p className="text-gray-600 mb-4">{error.message || "An unexpected error occurred"}</p>
      <button
        onClick={() => reset()}
        className="px-4 py-2 bg-blue-500 text-white rounded-sm hover:bg-blue-600"
      >
        Try again
      </button>
    </div>
  );
}
