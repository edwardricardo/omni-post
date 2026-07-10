/**
 * @file MfaChallengeForm.test.tsx
 * @description RTL tests for the MFA challenge step: hidden challenge/rememberMe
 *              inputs (memory/DOM only), wrong-code keeps the challenge, an
 *              invalid/expired challenge falls back to the password step, and the
 *              login page renders the two-step (password ⇄ challenge) transition.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Control the server actions so useActionState resolves to deterministic state.
const loginActionMock = vi.fn();
const completeMfaLoginActionMock = vi.fn();
vi.mock("@/app/actions/auth", () => ({
  loginAction: (prev: unknown, fd: FormData) => loginActionMock(prev, fd),
  completeMfaLoginAction: (prev: unknown, fd: FormData) => completeMfaLoginActionMock(prev, fd),
}));

// Keep the locale-aware Link trivial in tests.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { MfaChallengeForm } from "./MfaChallengeForm";
import LoginPage from "@/app/[locale]/login/page";
import { IntlTestProvider } from "../../tests/intl-test-utils";

const challenge = {
  challengeToken: "challenge-jwt-abc",
  expiresInSeconds: 180,
  rememberMe: true,
};

function submitForm(container: HTMLElement) {
  const form = container.querySelector("form");
  if (!form) throw new Error("form not found");
  fireEvent.submit(form);
}

describe("MfaChallengeForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders hidden challengeToken and rememberMe inputs (memory/DOM only)", () => {
    const { container } = render(
      <IntlTestProvider>
        <MfaChallengeForm challenge={challenge} onChallengeExpired={vi.fn()} />
      </IntlTestProvider>
    );

    const tokenInput = container.querySelector('input[name="challengeToken"]');
    const rememberInput = container.querySelector('input[name="rememberMe"]');
    const codeInput = container.querySelector('input[name="code"]');

    expect(tokenInput).toHaveAttribute("type", "hidden");
    expect(tokenInput).toHaveValue("challenge-jwt-abc");
    expect(rememberInput).toHaveAttribute("type", "hidden");
    expect(rememberInput).toHaveValue("on");
    expect(codeInput).toBeInTheDocument();
  });

  it("keeps the challenge and shows the error on a wrong code", async () => {
    completeMfaLoginActionMock.mockResolvedValue({ error: "Invalid MFA code." });
    const onChallengeExpired = vi.fn();

    const { container } = render(
      <IntlTestProvider>
        <MfaChallengeForm challenge={challenge} onChallengeExpired={onChallengeExpired} />
      </IntlTestProvider>
    );

    const codeInput = container.querySelector('input[name="code"]') as HTMLInputElement;
    fireEvent.change(codeInput, { target: { value: "000000" } });
    submitForm(container);

    await waitFor(() => expect(screen.getByText("Invalid MFA code.")).toBeInTheDocument());
    expect(onChallengeExpired).not.toHaveBeenCalled();
    expect(container.querySelector('input[name="code"]')).toBeInTheDocument();
  });

  it("falls back to the password step when the challenge is expired", async () => {
    completeMfaLoginActionMock.mockResolvedValue({
      mfaChallengeExpired: true,
      error: "MFA challenge is invalid or expired. Please sign in again.",
    });
    const onChallengeExpired = vi.fn();

    const { container } = render(
      <IntlTestProvider>
        <MfaChallengeForm challenge={challenge} onChallengeExpired={onChallengeExpired} />
      </IntlTestProvider>
    );

    const codeInput = container.querySelector('input[name="code"]') as HTMLInputElement;
    fireEvent.change(codeInput, { target: { value: "123456" } });
    submitForm(container);

    await waitFor(() =>
      expect(onChallengeExpired).toHaveBeenCalledWith(
        "MFA challenge is invalid or expired. Please sign in again."
      )
    );
  });
});

describe("LoginPage two-step", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the password step by default", () => {
    const { container } = render(
      <IntlTestProvider>
        <LoginPage />
      </IntlTestProvider>
    );

    expect(container.querySelector('input[name="email"]')).toBeInTheDocument();
    expect(container.querySelector('input[name="password"]')).toBeInTheDocument();
    expect(container.querySelector('input[name="code"]')).not.toBeInTheDocument();
  });

  it("switches to the challenge step when login returns an mfaChallenge", async () => {
    loginActionMock.mockResolvedValue({
      mfaChallenge: {
        challengeToken: "challenge-jwt-abc",
        expiresInSeconds: 180,
        rememberMe: false,
      },
    });

    const { container } = render(
      <IntlTestProvider>
        <LoginPage />
      </IntlTestProvider>
    );

    const emailInput = container.querySelector('input[name="email"]') as HTMLInputElement;
    const passwordInput = container.querySelector('input[name="password"]') as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: "mfa@test.com" } });
    fireEvent.change(passwordInput, { target: { value: "pass1234" } });
    submitForm(container);

    await waitFor(() => expect(container.querySelector('input[name="code"]')).toBeInTheDocument());
    expect(container.querySelector('input[name="challengeToken"]')).toHaveValue(
      "challenge-jwt-abc"
    );
  });
});
