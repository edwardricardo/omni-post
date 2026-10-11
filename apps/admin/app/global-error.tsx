"use client";

/**
 * @file global-error.tsx
 * @description Next.js global error boundary of the admin portal: when the root layout itself
 *              crashes, Next renders this file in place of the whole document. It renders the
 *              fallback document of `@observability/sentry-next`, which reports the error to Sentry
 *              and to the console logger and offers a retry.
 * @component GlobalError
 * @layer infrastructure
 */
import {
  GlobalErrorDocument,
  type GlobalErrorDocumentProps,
} from "@observability/sentry-next/global-error";

/**
 * Fallback document for a crash in the admin portal's root layout, with the admin dashboard's
 * own sentence under the heading.
 */
export default function GlobalError({ error, retry }: Omit<GlobalErrorDocumentProps, "portal">) {
  return <GlobalErrorDocument error={error} retry={retry} portal="admin" />;
}
