"use client";

/**
 * @file global-error.tsx
 * @description The client portal's root error boundary. A crash in the root layout replaces the
 *              whole document with this one, which hands the error and Next's `retry` (stable
 *              since Next 16.3, which no longer passes `unstable_retry`) to the shared fallback
 *              document; that document reports to Sentry and to the console logger.
 * @component GlobalError
 * @layer infrastructure
 */
import {
  GlobalErrorDocument,
  type GlobalErrorProps,
} from "@observability/sentry-next/global-error";

/**
 * Fallback document for a crash in the client portal's root layout, asking the user to try
 * again or contact support.
 */
export default function GlobalError({ error, retry }: GlobalErrorProps) {
  return <GlobalErrorDocument error={error} retry={retry} portal="client" />;
}
