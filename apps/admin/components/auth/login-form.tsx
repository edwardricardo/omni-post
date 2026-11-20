/**
 * @file login-form.tsx
 * @description Admin Login Form using React 19 useActionState with MFA two-step flow.
 *   Uses CSS custom-property design tokens for full theme support. Its error line shows the
 *   catalog message of the error code, never the code itself.
 * @layer infrastructure
 */
"use client";

import { useState, useActionState } from "react";
import { useTranslations } from "next-intl";
import { loginAction } from "@/app/actions/auth";
import { adminAuthErrorMessageKey, type AdminAuthState } from "@/lib/auth/types";
import { AUTH_INPUT_CLASS, AUTH_SUBMIT_CLASS } from "./authFormClasses";

/**
 * @component LoginForm
 * @description Admin login form with two-step MFA flow using React 19 useActionState.
 *   Handles credential submission and TOTP code verification.
 */
export function LoginForm() {
  const tErrors = useTranslations("adminAuthErrors");
  const [mfaCredentials, setMfaCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);

  const wrappedAction = async (
    prevState: AdminAuthState | null,
    formData: FormData
  ): Promise<AdminAuthState> => {
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    if (email && password) {
      setMfaCredentials({ email, password });
    }
    return loginAction(prevState, formData);
  };

  const [state, formAction, isPending] = useActionState<AdminAuthState | null, FormData>(
    wrappedAction,
    null
  );

  return (
    <div className="w-full space-y-8">
      <div>
        <h2 className="text-center text-2xl font-bold text-[var(--text-primary)]">Admin Login</h2>
      </div>

      <form className="space-y-6" action={formAction}>
        {state?.error && (
          <div
            className="rounded-md bg-[var(--error-subtle)] p-4"
            role="alert"
            data-testid="login-error"
          >
            <div className="text-sm text-[var(--error)]">
              {tErrors(adminAuthErrorMessageKey(state.error))}
            </div>
          </div>
        )}

        {state?.requiresMfa ? (
          <>
            <input type="hidden" name="email" value={mfaCredentials?.email ?? ""} />
            <input type="hidden" name="password" value={mfaCredentials?.password ?? ""} />
            <input type="hidden" name="mfaSessionToken" value={state.mfaSessionToken ?? ""} />

            <div>
              <label
                htmlFor="mfaToken"
                className="block text-sm font-medium text-[var(--text-secondary)]"
              >
                Enter your MFA code
              </label>
              <input
                id="mfaToken"
                name="mfaToken"
                type="text"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className={`${AUTH_INPUT_CLASS} mt-1 tracking-widest text-center text-lg`}
                placeholder="000000"
                aria-label="MFA one-time code"
                aria-required="true"
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className={AUTH_INPUT_CLASS}
                placeholder="Email address"
                aria-label="Email address"
                aria-required="true"
              />
            </div>

            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className={AUTH_INPUT_CLASS}
                placeholder="Password"
                aria-label="Password"
                aria-required="true"
              />
            </div>

            <div className="flex items-center">
              <input
                id="rememberMe"
                name="rememberMe"
                type="checkbox"
                value="true"
                className="h-4 w-4 text-[var(--accent)] focus:ring-[var(--accent)] border-[var(--border-default)] rounded-sm"
                aria-label="Remember me"
              />
              <label htmlFor="rememberMe" className="ml-2 block text-sm text-[var(--text-primary)]">
                Remember me
              </label>
            </div>
          </>
        )}

        <div>
          <button
            type="submit"
            disabled={isPending}
            aria-busy={isPending}
            className={AUTH_SUBMIT_CLASS}
          >
            {isPending ? "Signing in..." : state?.requiresMfa ? "Verify" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
