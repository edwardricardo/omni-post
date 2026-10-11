"use client";

/**
 * @file GlobalErrorDocument.tsx
 * @description The fallback document both portals' `app/global-error.tsx` render when the root
 *              layout itself crashes. Next renders it in place of the whole document, outside every
 *              provider and without the app's global styles, so it carries no translations, theme
 *              or utility classes. It reports the error to Sentry and to the console logger, so the
 *              crash leaves a trace even when Sentry is not initialized, and offers Next's `retry`.
 *              It has no story: it renders the `<html>` element itself, which Storybook's preview,
 *              a document of its own that mounts each story inside a `<div>`, cannot host.
 * @component GlobalErrorDocument
 * @layer infrastructure
 */
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { ConsoleLoggerAdapter } from "@observability/browser-logger";

/** The portals whose root layout this document replaces. */
export type GlobalErrorPortal = "admin" | "client";

// The document runs outside any React context, so the hook-based logger is out of reach; one
// console adapter per portal is built directly, on that portal's own `<portal>.global-error`
// channel, and each entry also carries the portal in its context.
const GLOBAL_ERROR_LOGGERS: Readonly<Record<GlobalErrorPortal, ConsoleLoggerAdapter>> = {
  admin: new ConsoleLoggerAdapter("admin.global-error"),
  client: new ConsoleLoggerAdapter("client.global-error"),
};

/** The sentence under the heading, the one line of copy each portal words its own way. */
const PORTAL_MESSAGES: Readonly<Record<GlobalErrorPortal, string>> = {
  admin: "The admin dashboard hit an unexpected error. Please try again.",
  client: "Something went wrong. Please try again or contact support.",
};

/** The props Next passes a portal's `app/global-error.tsx`. */
export interface GlobalErrorProps {
  /** The error the root layout threw; `digest` identifies it in the server logs. */
  error: Error & { digest?: string };
  /** Re-fetches and re-renders the root layout (Next 16.3+; `reset` re-renders only). */
  retry: () => void;
}

/** Props of the fallback document: Next's props plus the portal that renders it. */
export interface GlobalErrorDocumentProps extends GlobalErrorProps {
  /** The portal whose root layout crashed; it selects the sentence and tags the console entry. */
  portal: GlobalErrorPortal;
}

/**
 * @description Renders the fallback document for a crash in a portal's root layout and reports
 *   the error once to Sentry and once to the console logger.
 * @param props - The error, Next's `retry` and the portal.
 * @returns The whole document: heading, the portal's sentence, the error ID and a retry button.
 */
export function GlobalErrorDocument({ error, retry, portal }: GlobalErrorDocumentProps) {
  useEffect(() => {
    Sentry.captureException(error);
    GLOBAL_ERROR_LOGGERS[portal].error("Global error (root layout crash)", error, {
      portal,
      ...(error.digest !== undefined && { digest: error.digest }),
    });
  }, [error, portal]);

  return (
    <html lang="en">
      <body>
        <main role="alert">
          <h1>Something went wrong!</h1>
          <p>{PORTAL_MESSAGES[portal]}</p>
          {error.digest !== undefined && <p>Error ID: {error.digest}</p>}
          <button type="button" onClick={retry}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
