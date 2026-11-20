/**
 * @file requiredPasswordChangeForm.test.tsx
 * @description Pins the form of the page that changes a password an administrator must change
 *   before signing in, under the English catalog: its labelled fields and the password policy it
 *   states with the API's numbers; the confirmation that does not match, which stops the
 *   submission, and the four fields the action receives otherwise; the translated message of
 *   every error code, never the code itself; the second factor's field, which appears once the API
 *   asks for it, takes the focus each time an answer still asks for it and keeps what was typed;
 *   each field a validation failure marks, described by its own message; the disabled button while
 *   the change is pending;
 *   and a server-rendered form whose native submission cannot carry the fields into a URL before
 *   the page is interactive. The Server Action is a stand-in.
 * @layer infrastructure
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider, createTranslator, type AbstractIntlMessages } from "next-intl";
import { renderToString } from "react-dom/server";

import enMessages from "@/messages/en.json";
import { RequiredPasswordChangeForm } from "@/app/[locale]/(auth)/login/change-password/RequiredPasswordChangeForm";
import { ADMIN_PASSWORD_POLICY } from "@/lib/auth/passwordPolicy";
import { ADMIN_AUTH_ERROR, type RequiredPasswordChangeState } from "@/lib/auth/types";

const action = vi.hoisted(() => ({
  changeRequiredPasswordAction:
    vi.fn<
      (
        previous: RequiredPasswordChangeState | null,
        formData: FormData
      ) => Promise<RequiredPasswordChangeState>
    >(),
}));

vi.mock("@/app/actions/auth", () => ({
  changeRequiredPasswordAction: action.changeRequiredPasswordAction,
}));

const MESSAGES = enMessages.requiredPasswordChange;
const ERRORS = enMessages.adminAuthErrors;
const EMAIL = "first.admin@omnipost.test";
const CURRENT = "single-use-secret";
const NEW_PASSWORD = "N3w-Passphrase!x";

const CATALOG: AbstractIntlMessages = enMessages;
const translate = createTranslator({ locale: "en", messages: CATALOG });

/** The English text of the catalog message at `key`, with the policy's numbers in it. */
function text(key: string): string {
  return translate(key, ADMIN_PASSWORD_POLICY);
}

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RequiredPasswordChangeForm />
    </NextIntlClientProvider>
  );
}

/** Types the four fields; the confirmation is the new password unless another is given. */
async function fillForm(confirmation = NEW_PASSWORD) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(MESSAGES.emailLabel), EMAIL);
  await user.type(screen.getByLabelText(MESSAGES.currentPasswordLabel), CURRENT);
  await user.type(screen.getByLabelText(MESSAGES.newPasswordLabel), NEW_PASSWORD);
  await user.type(screen.getByLabelText(MESSAGES.confirmPasswordLabel), confirmation);
  return user;
}

/** The fields of the form data the action received on its call number `call`. */
function sentFields(call: number): Record<string, FormDataEntryValue> {
  const formData = action.changeRequiredPasswordAction.mock.calls[call]?.[1];
  expect(formData).toBeInstanceOf(FormData);
  return Object.fromEntries((formData as FormData).entries());
}

beforeEach(() => {
  action.changeRequiredPasswordAction.mockReset();
});

describe("RequiredPasswordChangeForm", () => {
  it("shows the four labelled fields, the policy and an enabled button, and no code field or error", () => {
    renderForm();

    expect(screen.getByLabelText(MESSAGES.emailLabel)).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText(MESSAGES.currentPasswordLabel)).toHaveAttribute(
      "autocomplete",
      "current-password"
    );
    expect(screen.getByLabelText(MESSAGES.newPasswordLabel)).toHaveAttribute(
      "autocomplete",
      "new-password"
    );
    expect(screen.getByLabelText(MESSAGES.confirmPasswordLabel)).toHaveAttribute(
      "autocomplete",
      "new-password"
    );
    expect(screen.queryByLabelText(MESSAGES.mfaCodeLabel)).toBeNull();
    for (const rule of Object.keys(MESSAGES.policy)) {
      expect(screen.getByText(text(`requiredPasswordChange.policy.${rule}`))).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: MESSAGES.submit })).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("states the policy with the API's numbers", () => {
    renderForm();

    expect(screen.getByText("be 12 to 128 characters long")).toBeInTheDocument();
    expect(
      screen.getByText(
        "differ from the current password and from the last 5 passwords of the account"
      )
    ).toBeInTheDocument();
  });

  it("describes the new password by the policy it must meet", () => {
    renderForm();

    expect(screen.getByLabelText(MESSAGES.newPasswordLabel)).toHaveAccessibleDescription(
      expect.stringContaining(text("requiredPasswordChange.policy.reuse"))
    );
  });

  it("stops the submission and says so when the confirmation does not match", async () => {
    renderForm();
    const user = await fillForm("N3w-Passphrase!y");

    await user.click(screen.getByRole("button", { name: MESSAGES.submit }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ERRORS.passwordMismatch);
    expect(action.changeRequiredPasswordAction).not.toHaveBeenCalled();
  });

  it("sends the four fields to the action, the confirmation included, for the action's own check", async () => {
    action.changeRequiredPasswordAction.mockResolvedValue({ error: "PASSWORD_REUSED" });
    renderForm();
    const user = await fillForm();

    await user.click(screen.getByRole("button", { name: MESSAGES.submit }));

    await screen.findByRole("alert");
    expect(sentFields(0)).toEqual({
      email: EMAIL,
      currentPassword: CURRENT,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
  });

  it.each([
    ["INVALID_CREDENTIALS", ERRORS.invalidCredentials],
    ["MFA_INVALID", ERRORS.mfaInvalid],
    ["ACCOUNT_LOCKED", ERRORS.accountLocked],
    ["ACCOUNT_INACTIVE", ERRORS.accountInactive],
    ["PASSWORD_CHANGE_NOT_REQUIRED", ERRORS.passwordChangeNotRequired],
    ["CONCURRENT_MODIFICATION", ERRORS.concurrentModification],
    ["PASSWORD_TOO_WEAK", ERRORS.passwordTooWeak],
    ["PASSWORD_REUSED", text("adminAuthErrors.passwordReused")],
    ["RATE_LIMIT_EXCEEDED", ERRORS.rateLimitExceeded],
    ["IP_NOT_ALLOWED", ERRORS.ipNotAllowed],
    ["UNKNOWN_ERROR", ERRORS.unknown],
    ["A_CODE_THE_PAGE_DOES_NOT_KNOW", ERRORS.unknown],
  ])("shows the translated message for %s, never the code", async (code, message) => {
    action.changeRequiredPasswordAction.mockResolvedValue({ error: code });
    renderForm();
    const user = await fillForm();

    await user.click(screen.getByRole("button", { name: MESSAGES.submit }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(alert).not.toHaveTextContent(code);
  });

  it("shows a validation failure's message and one per field it names, never the API's text", async () => {
    action.changeRequiredPasswordAction.mockResolvedValue({
      error: ADMIN_AUTH_ERROR.VALIDATION_FAILED,
      invalidFields: ["email", "newPassword", "a.path.the.page.does.not.know"],
    });
    renderForm();
    const user = await fillForm();

    await user.click(screen.getByRole("button", { name: MESSAGES.submit }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(ERRORS.validationFailed);
    expect(alert).toHaveTextContent(MESSAGES.invalidField.email);
    expect(alert).toHaveTextContent(text("requiredPasswordChange.invalidField.newPassword"));
    expect(alert).not.toHaveTextContent(MESSAGES.invalidField.currentPassword);
    expect(alert).not.toHaveTextContent(ADMIN_AUTH_ERROR.VALIDATION_FAILED);
    expect(alert).not.toHaveTextContent("a.path.the.page.does.not.know");
    expect(screen.getByLabelText(MESSAGES.emailLabel)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(MESSAGES.currentPasswordLabel)).not.toHaveAttribute(
      "aria-invalid"
    );
  });

  it("describes each field a validation failure marks by its own message, keeping the policy on the new password", async () => {
    action.changeRequiredPasswordAction.mockResolvedValue({
      error: ADMIN_AUTH_ERROR.VALIDATION_FAILED,
      invalidFields: ["email", "newPassword"],
    });
    renderForm();
    const user = await fillForm();

    await user.click(screen.getByRole("button", { name: MESSAGES.submit }));

    await screen.findByRole("alert");
    expect(screen.getByLabelText(MESSAGES.emailLabel)).toHaveAccessibleDescription(
      MESSAGES.invalidField.email
    );
    const newPassword = screen.getByLabelText(MESSAGES.newPasswordLabel);
    expect(newPassword).toHaveAccessibleDescription(
      expect.stringContaining(text("requiredPasswordChange.invalidField.newPassword"))
    );
    expect(newPassword).toHaveAccessibleDescription(
      expect.stringContaining(text("requiredPasswordChange.policy.reuse"))
    );
    expect(screen.getByLabelText(MESSAGES.currentPasswordLabel)).toHaveAccessibleDescription("");
  });

  it("describes the code field by its own message when a validation failure marks it", async () => {
    action.changeRequiredPasswordAction.mockResolvedValue({
      error: ADMIN_AUTH_ERROR.VALIDATION_FAILED,
      invalidFields: ["mfaToken"],
      requiresMfa: true,
    });
    renderForm();
    const user = await fillForm();

    await user.click(screen.getByRole("button", { name: MESSAGES.submit }));

    const codeField = await screen.findByLabelText(MESSAGES.mfaCodeLabel);
    expect(codeField).toHaveAttribute("aria-invalid", "true");
    expect(codeField).toHaveAccessibleDescription(
      text("requiredPasswordChange.invalidField.mfaToken")
    );
  });

  it("gives the focus back to the code field after an answer that still asks for it", async () => {
    action.changeRequiredPasswordAction
      .mockResolvedValueOnce({ error: "MFA_REQUIRED", requiresMfa: true })
      .mockResolvedValueOnce({ error: "MFA_INVALID", requiresMfa: true });
    renderForm();
    const user = await fillForm();
    await user.click(screen.getByRole("button", { name: MESSAGES.submit }));
    await user.type(await screen.findByLabelText(MESSAGES.mfaCodeLabel), "000000");

    await user.click(screen.getByRole("button", { name: MESSAGES.submit }));

    expect(await screen.findByText(ERRORS.mfaInvalid)).toBeInTheDocument();
    expect(screen.getByLabelText(MESSAGES.mfaCodeLabel)).toHaveFocus();
  });

  it("moves the focus to the second factor's field when it appears", async () => {
    action.changeRequiredPasswordAction.mockResolvedValueOnce({
      error: "MFA_REQUIRED",
      requiresMfa: true,
    });
    renderForm();
    const user = await fillForm();

    await user.click(screen.getByRole("button", { name: MESSAGES.submit }));

    expect(await screen.findByLabelText(MESSAGES.mfaCodeLabel)).toHaveFocus();
  });

  it("never lets a native submission carry the fields to a URL before the page is interactive", () => {
    const html = renderToString(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <RequiredPasswordChangeForm />
      </NextIntlClientProvider>
    );

    expect(html.match(/<form[^>]*>/)?.[0] ?? "").toMatch(/\saction="javascript:/);
  });

  it("asks for the second factor's code when the API requires it, keeping what was typed", async () => {
    action.changeRequiredPasswordAction.mockResolvedValueOnce({
      error: "MFA_REQUIRED",
      requiresMfa: true,
    });
    renderForm();
    const user = await fillForm();

    await user.click(screen.getByRole("button", { name: MESSAGES.submit }));

    const codeField = await screen.findByLabelText(MESSAGES.mfaCodeLabel);
    expect(codeField).toHaveAttribute("autocomplete", "one-time-code");
    expect(screen.getByRole("alert")).toHaveTextContent(ERRORS.mfaRequired);
    expect(screen.getByRole("alert")).not.toHaveTextContent("MFA_REQUIRED");
    expect(screen.getByLabelText(MESSAGES.emailLabel)).toHaveValue(EMAIL);
    expect(screen.getByLabelText(MESSAGES.currentPasswordLabel)).toHaveValue(CURRENT);
    expect(screen.getByLabelText(MESSAGES.newPasswordLabel)).toHaveValue(NEW_PASSWORD);
    expect(screen.getByLabelText(MESSAGES.confirmPasswordLabel)).toHaveValue(NEW_PASSWORD);
  });

  it("sends the second factor's code with the typed fields on the next submission", async () => {
    action.changeRequiredPasswordAction
      .mockResolvedValueOnce({ error: "MFA_REQUIRED", requiresMfa: true })
      .mockResolvedValueOnce({ error: "MFA_INVALID", requiresMfa: true });
    renderForm();
    const user = await fillForm();
    await user.click(screen.getByRole("button", { name: MESSAGES.submit }));

    await user.type(await screen.findByLabelText(MESSAGES.mfaCodeLabel), "123456");
    await user.click(screen.getByRole("button", { name: MESSAGES.submit }));

    expect(await screen.findByText(ERRORS.mfaInvalid)).toBeInTheDocument();
    expect(sentFields(1)).toEqual({
      email: EMAIL,
      currentPassword: CURRENT,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
      mfaToken: "123456",
    });
    expect(screen.getByLabelText(MESSAGES.mfaCodeLabel)).toBeInTheDocument();
  });

  it("keeps the code field when the confirmation stops a later submission", async () => {
    action.changeRequiredPasswordAction.mockResolvedValueOnce({
      error: "MFA_REQUIRED",
      requiresMfa: true,
    });
    renderForm();
    const user = await fillForm();
    await user.click(screen.getByRole("button", { name: MESSAGES.submit }));
    await screen.findByLabelText(MESSAGES.mfaCodeLabel);

    await user.type(screen.getByLabelText(MESSAGES.confirmPasswordLabel), "!");
    await user.type(screen.getByLabelText(MESSAGES.mfaCodeLabel), "123456");
    await user.click(screen.getByRole("button", { name: MESSAGES.submit }));

    expect(await screen.findByText(ERRORS.passwordMismatch)).toBeInTheDocument();
    expect(screen.getByLabelText(MESSAGES.mfaCodeLabel)).toBeInTheDocument();
    expect(action.changeRequiredPasswordAction).toHaveBeenCalledTimes(1);
  });

  it("disables the button while the change is pending", async () => {
    let finish: (state: RequiredPasswordChangeState) => void = () => undefined;
    action.changeRequiredPasswordAction.mockReturnValue(
      new Promise<RequiredPasswordChangeState>((resolve) => {
        finish = resolve;
      })
    );
    renderForm();
    const user = await fillForm();

    await user.click(screen.getByRole("button", { name: MESSAGES.submit }));

    const pending = await screen.findByRole("button", { name: MESSAGES.submitting });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");

    finish({ error: "PASSWORD_REUSED" });

    expect(await screen.findByRole("button", { name: MESSAGES.submit })).toBeEnabled();
  });
});
