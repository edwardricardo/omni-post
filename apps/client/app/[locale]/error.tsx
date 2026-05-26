/**
 * @file error.tsx
 * @description Next.js global error boundary for the client app. Uses the
 *              browser logger port to report uncaught errors from the render
 *              tree so the sink can be swapped (console → APM) centrally.
 *              Recovery uses `unstable_retry` (Next 16.2+ canonical — re-fetches
 *              data on retry, vs `reset` which only re-renders the boundary).
 * @layer infrastructure
 */
"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useLogger } from "@observability/browser-logger";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const t = useTranslations("errors");
  const logger = useLogger("client.error-page");

  useEffect(() => {
    logger.error("Unhandled app error", error, {
      ...(error.digest !== undefined && { digest: error.digest }),
    });
  }, [error, logger]);

  // Never leak raw error.message to end users in production — attackers can use
  // stack trace / internal error shapes for reconnaissance. In development we
  // show the real message to keep debugging friction low.
  const isDev = process.env.NODE_ENV === "development";
  const displayMessage = isDev
    ? error.message || t("boundary.unexpected")
    : t("boundary.description");

  return (
    <div role="alert" className="flex min-h-screen flex-col items-center justify-center">
      <h2 className="text-2xl font-bold mb-4">{t("boundary.title")}</h2>
      <p className="text-gray-600 mb-4">{displayMessage}</p>
      {!isDev && error.digest && (
        <p className="text-sm text-gray-500 mb-4">
          {t("boundary.errorId", { digest: error.digest })}
        </p>
      )}
      <button
        onClick={() => unstable_retry()}
        className="px-4 py-2 bg-blue-500 text-white rounded-sm hover:bg-blue-600"
      >
        {t("boundary.tryAgain")}
      </button>
    </div>
  );
}
