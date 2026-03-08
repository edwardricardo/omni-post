/**
 * Admin Login Form
 *
 * React 19 useActionState-based login form that integrates with the
 * loginAction Server Action. Supports a two-step MFA flow: the first
 * submission sends email + password; if the backend responds with
 * requiresMfa, the form transitions to an OTP input step.
 *
 * Credentials are preserved in local state so hidden fields can resubmit
 * them alongside the mfaToken in the second step.
 */
"use client";

import { useState, useActionState } from "react";
import { loginAction } from "@/app/actions/auth";
import type { AdminAuthState } from "@/lib/auth/types";

export function LoginForm() {
  // Track credentials locally so they can be forwarded as hidden fields
  // when the MFA step is displayed (form state resets between submissions).
  const [mfaCredentials, setMfaCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);

  // Wrap loginAction to capture credentials before the Server Action runs.
  // useActionState passes (prevState, formData) — we read the fields here
  // so that when state transitions to requiresMfa we already have them.
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

  const inputClass =
    "appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow-sm">
        <div>
          <h2 className="text-center text-3xl font-extrabold text-gray-900">Admin Login</h2>
        </div>

        <form className="mt-8 space-y-6" action={formAction}>
          {state?.error && (
            <div
              className="rounded-md bg-red-50 p-4"
              role="alert"
              aria-live="assertive"
              data-testid="login-error"
            >
              <div className="text-sm text-red-800">{state.error}</div>
            </div>
          )}

          {state?.requiresMfa ? (
            /* ----------------------------------------------------------------
             * MFA step — hidden credential fields resubmit email + password;
             * user provides the one-time code in mfaToken.
             * ---------------------------------------------------------------- */
            <>
              <input type="hidden" name="email" value={mfaCredentials?.email ?? ""} />
              <input type="hidden" name="password" value={mfaCredentials?.password ?? ""} />
              <input type="hidden" name="mfaSessionToken" value={state.mfaSessionToken ?? ""} />

              <div>
                <label htmlFor="mfaToken" className="block text-sm font-medium text-gray-700">
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
                  className={`${inputClass} mt-1 tracking-widest text-center text-lg`}
                  placeholder="000000"
                  aria-label="MFA one-time code"
                  aria-required="true"
                />
              </div>
            </>
          ) : (
            /* ----------------------------------------------------------------
             * Normal step — email + password.
             * ---------------------------------------------------------------- */
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
                  className={inputClass}
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
                  className={inputClass}
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
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded-sm"
                  aria-label="Remember me"
                />
                <label htmlFor="rememberMe" className="ml-2 block text-sm text-gray-900">
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
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? "Signing in..." : state?.requiresMfa ? "Verify" : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
