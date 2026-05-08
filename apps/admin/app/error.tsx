/**
 * @file error.tsx
 * @description Next.js root error boundary component that displays a user-friendly error message
 * with an error ID (digest) and a retry button to attempt recovery. Uses `unstable_retry`
 * (Next 16.2+ canonical recovery — re-fetches data on retry, vs `reset` which only re-renders).
 * Routes caught errors through the BrowserLoggerPort for structured reporting.
 */
"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useLogger } from "@observability/browser-logger";
import { ActionButton } from "@/components/ui/ActionButton";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
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
        <ActionButton variant="primary" size="lg" onClick={unstable_retry}>
          {t("tryAgain")}
        </ActionButton>
      </div>
    </div>
  );
}
