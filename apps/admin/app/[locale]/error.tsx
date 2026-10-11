/**
 * @file error.tsx
 * @description Next.js root error boundary component that displays a user-friendly error message
 * with an error ID (digest) and a retry button to attempt recovery. Uses `retry` (stable since
 * Next 16.3, which no longer passes `unstable_retry`; it re-fetches data, where `reset` only
 * re-renders).
 * Routes caught errors through the BrowserLoggerPort for structured reporting.
 * @component Error
 * @layer infrastructure
 */
"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useLogger } from "@observability/browser-logger";
import { ActionButton } from "@/components/ui/ActionButton";

interface ErrorPageProps {
  /** The error the page threw; `digest` identifies it in the server logs. */
  error: Error & { digest?: string };
  /** Re-fetches and re-renders the failed segment (Next 16.3+; `reset` re-renders only). */
  retry: () => void;
}

/**
 * Error page of a locale segment: logs the error, shows a generic message (the real one in
 * development) with its error ID, and offers a retry.
 */
export default function Error({ error, retry }: ErrorPageProps) {
  const t = useTranslations("errorPage");
  const tc = useTranslations("common");
  const logger = useLogger("admin.error-page");

  useEffect(() => {
    logger.error("Unhandled app error", error, {
      ...(error.digest !== undefined && { digest: error.digest }),
    });
  }, [error, logger]);

  // Never leak raw error.message to end users in production. In development
  // we show the real message for easier debugging.
  const isDev = process.env.NODE_ENV === "development";
  const displayMessage = isDev ? error.message || t("genericMessage") : t("genericMessage");

  return (
    <div role="alert" className="flex min-h-screen items-center justify-center bg-[var(--bg-base)]">
      <div className="text-center max-w-md p-8">
        <div className="mb-4">
          <div className="mx-auto w-16 h-16 bg-[var(--error-subtle)] rounded-full flex items-center justify-center">
            <span className="text-[var(--error)] text-2xl font-bold" aria-hidden="true">
              !
            </span>
          </div>
        </div>
        <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-4">{t("title")}</h2>
        <p className="text-[var(--text-secondary)] mb-4">{displayMessage}</p>
        {error.digest && (
          <p className="text-sm text-[var(--text-tertiary)] mb-4">
            {tc("errorId", { id: error.digest ?? "unknown" })}
          </p>
        )}
        <ActionButton variant="primary" size="lg" onClick={retry}>
          {t("tryAgain")}
        </ActionButton>
      </div>
    </div>
  );
}
