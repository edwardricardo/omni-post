/**
 * @file loginForm.test.tsx
 * @description Pins the error line of the administrators' sign-in form under the English catalog:
 *   an error code the sign-in can answer shows its translated message from the shared namespace,
 *   a code or sentence the form does not know shows the general message, and neither ever shows
 *   as the literal text the action returned. The second-factor step still appears when the
 *   action asks for it, and the server-rendered form carries an action, so a native submission
 *   before the page is interactive cannot put the credentials in a URL. The Server Action is a
 *   stand-in.
 * @layer infrastructure
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";

import enMessages from "@/messages/en.json";
import { LoginForm } from "@/components/auth/login-form";
import { ADMIN_AUTH_ERROR, type AdminAuthState } from "@/lib/auth/types";

const action = vi.hoisted(() => ({
  loginAction:
    vi.fn<(previous: AdminAuthState | null, formData: FormData) => Promise<AdminAuthState>>(),
}));

vi.mock("@/app/actions/auth", () => ({ loginAction: action.loginAction }));

const ERRORS = enMessages.adminAuthErrors;

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LoginForm />
    </NextIntlClientProvider>
  );
}

/** Types the e-mail and the password and submits the form. */
async function signIn() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email address"), "first.admin@omnipost.test");
  await user.type(screen.getByLabelText("Password"), "a-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  action.loginAction.mockReset();
});

describe("LoginForm", () => {
  it.each([
    ["INVALID_CREDENTIALS", ERRORS.invalidCredentials],
    ["ACCOUNT_LOCKED", ERRORS.accountLocked],
    ["ACCOUNT_INACTIVE", ERRORS.accountInactive],
    ["MFA_INVALID", ERRORS.mfaInvalid],
    ["RATE_LIMIT_EXCEEDED", ERRORS.rateLimitExceeded],
    ["IP_NOT_ALLOWED", ERRORS.ipNotAllowed],
    [ADMIN_AUTH_ERROR.VALIDATION_FAILED, ERRORS.validationFailed],
    ["INTERNAL_ERROR", ERRORS.internalError],
    ["UNKNOWN_ERROR", ERRORS.unknown],
  ])("shows the translated message for %s, never the code", async (code, message) => {
    action.loginAction.mockResolvedValue({ error: code });
    renderForm();

    await signIn();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(alert).not.toHaveTextContent(code);
  });

  it.each([["A_CODE_THE_FORM_DOES_NOT_KNOW"], ["Invalid response from server"]])(
    "shows the general message for %s, never the text itself",
    async (text) => {
      action.loginAction.mockResolvedValue({ error: text });
      renderForm();

      await signIn();

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(ERRORS.unknown);
      expect(alert).not.toHaveTextContent(text);
    }
  );

  it("never lets a native submission carry the credentials to a URL before the page is interactive", () => {
    const html = renderToString(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LoginForm />
      </NextIntlClientProvider>
    );

    expect(html.match(/<form[^>]*>/)?.[0] ?? "").toMatch(/\saction="javascript:/);
  });

  it("still asks for the second factor's code when the action requires it", async () => {
    action.loginAction.mockResolvedValue({ requiresMfa: true, mfaSessionToken: "" });
    renderForm();

    await signIn();

    expect(await screen.findByLabelText("MFA one-time code")).toHaveAttribute(
      "autocomplete",
      "one-time-code"
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
