/**
 * @file page.tsx
 * @description Public password reset confirmation page. Users arrive here via a
 *   reset link sent by email. Validates the token, collects a new password,
 *   verifies Cloudflare Turnstile, and submits to the backend.
 *   Fetches the Turnstile site key from the public settings API at runtime.
 * @layer infrastructure
 */
"use client";

import { useState, useCallback, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Turnstile } from "@marsidev/react-turnstile";

import { ActionButton } from "@/components/ui/ActionButton";
import { ApiError, getErrorMessage } from "@packages/api-errors";

const INPUT_CLASS =
  "w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations("resetPassword");
  const ts = useTranslations("security");

  const token = searchParams.get("token");

  const [turnstileSiteKey, setTurnstileSiteKey] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [validationError, setValidationError] = useState("");
  const [apiError, setApiError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/backend/settings/public")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const key = json?.data?.turnstileSiteKey;
        if (key) setTurnstileSiteKey(key);
      })
      .catch(() => {
        /* Turnstile will be skipped if settings unavailable */
      });
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setValidationError("");
      setApiError("");

      if (!token) {
        setValidationError(t("invalidToken"));
        return;
      }

      if (newPassword !== confirmPassword) {
        setValidationError(ts("changePassword.passwordsMismatch"));
        return;
      }
      if (newPassword.length < 12) {
        setValidationError(ts("changePassword.minLength"));
        return;
      }
      if (!/[A-Z]/.test(newPassword)) {
        setValidationError(ts("changePassword.requireUppercase"));
        return;
      }
      if (!/[0-9]/.test(newPassword)) {
        setValidationError(ts("changePassword.requireNumber"));
        return;
      }

      if (turnstileSiteKey && !turnstileToken) {
        setValidationError(t("completeCaptcha"));
        return;
      }

      setIsSubmitting(true);
      try {
        const res = await fetch("/api/backend/admin/auth/password/reset/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            newPassword,
            ...(turnstileToken && { turnstileToken }),
          }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw ApiError.fromResponse(res.status, body);
        }

        setSuccess(true);
        setTimeout(() => router.push("/login"), 3000);
      } catch (err) {
        setApiError(getErrorMessage(err));
      } finally {
        setIsSubmitting(false);
      }
    },
    [token, newPassword, confirmPassword, turnstileSiteKey, turnstileToken, t, ts, router]
  );

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-base)] p-4">
        <div className="w-full max-w-sm rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 text-center">
          <h1 className="text-lg font-semibold text-[var(--error)]">{t("invalidToken")}</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">{t("invalidTokenDesc")}</p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-base)] p-4">
        <div className="w-full max-w-sm rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 text-center">
          <h1 className="text-lg font-semibold text-[var(--success)]">{t("successTitle")}</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">{t("successDesc")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-base)] p-4">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
        <h1 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{t("title")}</h1>
        <p className="text-sm text-[var(--text-secondary)] mb-4">{t("description")}</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label
              htmlFor="rp-new"
              className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
            >
              {ts("changePassword.newPassword")}
            </label>
            <input
              id="rp-new"
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label
              htmlFor="rp-confirm"
              className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
            >
              {ts("changePassword.confirmPassword")}
            </label>
            <input
              id="rp-confirm"
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          {turnstileSiteKey && (
            <div className="flex justify-center">
              <Turnstile siteKey={turnstileSiteKey} onSuccess={setTurnstileToken} />
            </div>
          )}

          {validationError && (
            <p className="text-sm text-[var(--error)]" role="alert">
              {validationError}
            </p>
          )}
          {apiError && (
            <p className="text-sm text-[var(--error)]" role="alert">
              {apiError}
            </p>
          )}

          <ActionButton
            variant="primary"
            size="sm"
            type="submit"
            loading={isSubmitting}
            className="w-full"
          >
            {t("submit")}
          </ActionButton>
        </form>
      </div>
    </div>
  );
}

/**
 * @component ResetPasswordPage
 * @description Public page for confirming a password reset via email token.
 *   Protected by Cloudflare Turnstile captcha loaded from platform settings.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
