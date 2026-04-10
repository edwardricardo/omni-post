/**
 * @file error.tsx
 * @description Next.js root error boundary component that displays a user-friendly error message
 * with an error ID (digest) and a retry button to attempt recovery.
 */
"use client";

import { useTranslations } from "next-intl";
import { ActionButton } from "@/components/ui/ActionButton";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errorPage");
  const tc = useTranslations("common");

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-base)]">
      <div className="text-center max-w-md p-8">
        <div className="mb-4">
          <div className="mx-auto w-16 h-16 bg-[var(--error-subtle)] rounded-full flex items-center justify-center">
            <span className="text-[var(--error)] text-2xl font-bold" aria-hidden="true">
              !
            </span>
          </div>
        </div>
        <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-4">{t("title")}</h2>
        <p className="text-[var(--text-secondary)] mb-4">{error.message}</p>
        {error.digest && (
          <p className="text-sm text-[var(--text-tertiary)] mb-4">
            {tc("errorId", { id: error.digest ?? "unknown" })}
          </p>
        )}
        <ActionButton variant="primary" size="lg" onClick={reset}>
          {t("tryAgain")}
        </ActionButton>
      </div>
    </div>
  );
}
