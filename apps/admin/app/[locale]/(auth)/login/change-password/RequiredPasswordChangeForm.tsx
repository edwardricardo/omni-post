/**
 * @file RequiredPasswordChangeForm.tsx
 * @description The form of the page where an administrator who must change the password sets a
 *   new one before signing in. It asks for the e-mail, the current password, the new password and
 *   its confirmation, and for the second factor's code once the API asks for it. The confirmation
 *   is compared here and never sent; every other rule is the API's, whose error codes are shown as
 *   translated messages.
 * @component RequiredPasswordChangeForm
 * @layer infrastructure
 */
"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import { useTranslations, type Messages } from "next-intl";

import { changeRequiredPasswordAction } from "@/app/actions/auth";
import { AUTH_INPUT_CLASS, AUTH_SUBMIT_CLASS } from "@/components/auth/authFormClasses";
import {
  ADMIN_AUTH_ERROR,
  adminAuthErrorMessageKey,
  type RequiredPasswordChangeState,
} from "@/lib/auth/types";

type CatalogSection = Messages["requiredPasswordChange"];

const LABEL_CLASS = "block text-sm font-medium text-[var(--text-secondary)]";

/** The fields a validation failure can name, each with a message of its own under `invalidField`. */
const VALIDATED_FIELDS: readonly (keyof CatalogSection["invalidField"])[] = [
  "email",
  "currentPassword",
  "newPassword",
  "mfaToken",
];

/** The rules of the API's password policy, each stated under `policy`, in the order shown. */
const POLICY_RULES: readonly (keyof CatalogSection["policy"])[] = [
  "length",
  "lowercase",
  "uppercase",
  "number",
  "special",
  "reuse",
];

const POLICY_ID = "required-password-change-policy";

/** The id of the message a validation failure shows for `field`, which that field points to. */
function errorIdOf(field: string): string {
  return `required-password-change-${field}-error`;
}

/**
 * Stops a submission whose new password differs from its confirmation, and sends any other
 * without the confirmation. The code field stays once the form has asked for it.
 */
async function submitUnlessMismatched(
  previous: RequiredPasswordChangeState | null,
  formData: FormData
): Promise<RequiredPasswordChangeState> {
  if (formData.get("newPassword") !== formData.get("confirmPassword")) {
    return {
      error: ADMIN_AUTH_ERROR.PASSWORD_MISMATCH,
      ...(previous?.requiresMfa === true && { requiresMfa: true }),
    };
  }
  formData.delete("confirmPassword");
  return changeRequiredPasswordAction(previous, formData);
}

/**
 * Renders the required password change: the four fields with the policy under the new password,
 * the second factor's code once the API asks for it, the error of the last attempt as a translated
 * message, and a button that is disabled while the change is pending. A change redirects to the
 * sign-in.
 */
export function RequiredPasswordChangeForm() {
  const t = useTranslations("requiredPasswordChange");
  const tErrors = useTranslations("adminAuthErrors");
  const [state, dispatch, isPending] = useActionState(submitUnlessMismatched, null);
  const codeField = useRef<HTMLInputElement>(null);

  // A form whose action React runs is reset once the action ends, so the submission goes through
  // `onSubmit` inside a transition, which keeps what was typed when the API asks for the code or
  // refuses; React skips the action of a submission whose default was prevented. The action is
  // still named: before the page is interactive it renders as one that refuses a native
  // submission, instead of none, which would send the fields as a GET to the page's own URL.
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => {
      dispatch(formData);
    });
  };

  const requiresMfa = state?.requiresMfa === true;
  useEffect(() => {
    if (requiresMfa) {
      codeField.current?.focus();
    }
  }, [requiresMfa]);

  const invalidFields = state?.invalidFields ?? [];
  const invalid = (field: string) => (invalidFields.includes(field) ? true : undefined);
  // A field the validation failure marks is described by its own message, after any description
  // it always carries.
  const describedBy = (field: string, ...always: string[]) => {
    const ids = invalidFields.includes(field) ? [...always, errorIdOf(field)] : always;
    return ids.length > 0 ? ids.join(" ") : undefined;
  };

  return (
    <form className="space-y-6" action={dispatch} onSubmit={handleSubmit}>
      {state?.error !== undefined && (
        <div className="rounded-md bg-[var(--error-subtle)] p-4" role="alert">
          <p className="text-sm text-[var(--error)]">
            {tErrors(adminAuthErrorMessageKey(state.error))}
          </p>
          {invalidFields.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-[var(--error)]">
              {VALIDATED_FIELDS.filter((field) => invalidFields.includes(field)).map((field) => (
                <li key={field} id={errorIdOf(field)}>
                  {t(`invalidField.${field}`)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div>
        <label htmlFor="required-password-change-email" className={LABEL_CLASS}>
          {t("emailLabel")}
        </label>
        <input
          id="required-password-change-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={invalid("email")}
          aria-describedby={describedBy("email")}
          className={`${AUTH_INPUT_CLASS} mt-1`}
        />
      </div>

      <div>
        <label htmlFor="required-password-change-current" className={LABEL_CLASS}>
          {t("currentPasswordLabel")}
        </label>
        <input
          id="required-password-change-current"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={invalid("currentPassword")}
          aria-describedby={describedBy("currentPassword")}
          className={`${AUTH_INPUT_CLASS} mt-1`}
        />
      </div>

      <div>
        <label htmlFor="required-password-change-new" className={LABEL_CLASS}>
          {t("newPasswordLabel")}
        </label>
        <input
          id="required-password-change-new"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={invalid("newPassword")}
          aria-describedby={describedBy("newPassword", POLICY_ID)}
          className={`${AUTH_INPUT_CLASS} mt-1`}
        />
        <div id={POLICY_ID} className="mt-2 text-xs text-[var(--text-secondary)]">
          <p>{t("policyTitle")}</p>
          <ul className="mt-1 list-disc pl-5">
            {POLICY_RULES.map((rule) => (
              <li key={rule}>{t(`policy.${rule}`)}</li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <label htmlFor="required-password-change-confirm" className={LABEL_CLASS}>
          {t("confirmPasswordLabel")}
        </label>
        <input
          id="required-password-change-confirm"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className={`${AUTH_INPUT_CLASS} mt-1`}
        />
      </div>

      {requiresMfa && (
        <div>
          <label htmlFor="required-password-change-code" className={LABEL_CLASS}>
            {t("mfaCodeLabel")}
          </label>
          <input
            ref={codeField}
            id="required-password-change-code"
            name="mfaToken"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            aria-invalid={invalid("mfaToken")}
            aria-describedby={describedBy("mfaToken")}
            className={`${AUTH_INPUT_CLASS} mt-1 tracking-widest text-center text-lg`}
          />
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        aria-busy={isPending}
        className={AUTH_SUBMIT_CLASS}
      >
        {isPending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
