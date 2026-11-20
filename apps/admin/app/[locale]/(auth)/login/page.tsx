/**
 * @file page.tsx
 * @description Admin login page with split layout. Left side features the OmniPost
 * branding on a dark background; right side houses the LoginForm component, under a notice
 * that the password was changed when the URL carries `passwordChanged=1`.
 * @layer infrastructure
 */
import { getTranslations } from "next-intl/server";

import { LoginForm } from "@/components/auth/login-form";

interface LoginPageProps {
  /** The URL's query; `passwordChanged=1` says the required password change has just succeeded. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * @component LoginPage
 * @description Displays the admin login page with split layout branding and authentication form,
 *   and, after a required password change, a notice to sign in with the new password.
 */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { passwordChanged } = await searchParams;
  const t = await getTranslations("requiredPasswordChange");

  return (
    <div className="flex min-h-screen">
      {/* Left branding panel — 60% */}
      <div className="hidden lg:flex lg:w-[60%] relative bg-[var(--bg-base)] flex-col items-center justify-center overflow-hidden">
        {/* Subtle gradient overlay */}
        <div
          className="absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(ellipse at 30% 50%, var(--accent-subtle) 0%, transparent 70%), radial-gradient(ellipse at 70% 80%, var(--accent-subtle) 0%, transparent 60%)",
          }}
          aria-hidden="true"
        />
        {/* Dot pattern */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: "radial-gradient(circle, var(--text-primary) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
          aria-hidden="true"
        />
        {/* Wordmark */}
        <div className="relative z-10 text-center">
          <h1 className="text-5xl font-bold tracking-tight text-[var(--text-primary)]">OmniPost</h1>
          <p className="mt-3 text-lg text-[var(--text-secondary)]">Platform Administration</p>
        </div>
      </div>

      {/* Right form panel — 40% */}
      <div className="w-full lg:w-[40%] flex items-center justify-center bg-[var(--bg-surface)] p-8">
        <div className="w-full max-w-sm">
          {passwordChanged === "1" && (
            <div className="mb-6 rounded-md bg-[var(--success-subtle)] p-4" role="status">
              <p className="text-sm text-[var(--success)]">{t("passwordChanged")}</p>
            </div>
          )}
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
