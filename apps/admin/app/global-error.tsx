"use client";

/**
 * @file global-error.tsx
 * @description Next.js global error boundary of the admin portal: when the root layout itself
 *              crashes, it replaces the whole document with a minimal fallback, reports the
 *              error to Sentry and offers a retry.
 * @component GlobalError
 * @layer infrastructure
 */
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

interface GlobalErrorProps {
  /** The error the root layout threw; `digest` identifies it in the server logs. */
  error: Error & { digest?: string };
  /** Re-fetches and re-renders the root layout (Next 16.3+; `reset` re-renders only). */
  retry: () => void;
}

/**
 * Fallback document for a crash in the root layout. It renders outside every provider, so it
 * carries no translations or theme and reports straight to Sentry instead of a context logger.
 */
export default function GlobalError({ error, retry }: GlobalErrorProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main role="alert">
          <h1>Something went wrong</h1>
          <p>The admin dashboard hit an unexpected error. Please try again.</p>
          {error.digest !== undefined && <p>Error ID: {error.digest}</p>}
          <button type="button" onClick={() => retry()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
