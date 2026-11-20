/**
 * @file page.tsx
 * @description The public page where an administrator who must change the password sets a new
 *   one before signing in. No session exists until the password is changed, so the page asks for
 *   the credentials again; it explains why, holds the change form and links back to the sign-in.
 * @layer infrastructure
 */
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { RequiredPasswordChangeForm } from "./RequiredPasswordChangeForm";

/**
 * @component RequiredPasswordChangePage
 * @description Renders the required password change: its title, why the password must be changed
 *   and that the administrator signs in afterwards, the form, and a link back to the sign-in.
 */
export default async function RequiredPasswordChangePage() {
  const t = await getTranslations("requiredPasswordChange");

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-base)] p-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">{t("title")}</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">{t("description")}</p>
        </div>

        <RequiredPasswordChangeForm />

        <p className="text-center text-sm">
          <Link href="/login" className="text-[var(--accent)] hover:underline">
            {t("backToSignIn")}
          </Link>
        </p>
      </div>
    </main>
  );
}
