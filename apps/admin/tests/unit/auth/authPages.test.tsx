/**
 * @file authPages.test.tsx
 * @description Pins the two public pages of the administrators' sign-in under the English
 *   catalog: the sign-in page shows that the password was changed only when its URL carries the
 *   changed flag, and the page that changes a password that must be changed explains why, holds
 *   the change form and links back to the sign-in. The Server Actions, next-intl's server
 *   translator and its locale-aware link are stand-ins.
 * @layer infrastructure
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactElement } from "react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";

import enMessages from "@/messages/en.json";
import LoginPage from "@/app/[locale]/(auth)/login/page";
import RequiredPasswordChangePage from "@/app/[locale]/(auth)/login/change-password/page";

const MESSAGES: AbstractIntlMessages = enMessages;
const CHANGE = enMessages.requiredPasswordChange;

vi.mock("@/app/actions/auth", () => ({
  loginAction: vi.fn(),
  changeRequiredPasswordAction: vi.fn(),
}));

vi.mock("next-intl/server", async () => {
  const intl = await import("next-intl");
  const messages: AbstractIntlMessages = (await import("@/messages/en.json")).default;
  const translate = intl.createTranslator({ locale: "en", messages });
  return {
    getTranslations: async (namespace: string) => (key: string) => translate(`${namespace}.${key}`),
  };
});

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function renderPage(page: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {page}
    </NextIntlClientProvider>
  );
}

describe("the sign-in page", () => {
  it("says the password was changed when the URL carries the changed flag", async () => {
    renderPage(await LoginPage({ searchParams: Promise.resolve({ passwordChanged: "1" }) }));

    expect(screen.getByRole("status")).toHaveTextContent(CHANGE.passwordChanged);
  });

  it("says nothing of a change without the flag", async () => {
    renderPage(await LoginPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(CHANGE.passwordChanged)).toBeNull();
  });

  it("says nothing of a change when the flag carries another value", async () => {
    renderPage(await LoginPage({ searchParams: Promise.resolve({ passwordChanged: "true" }) }));

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(CHANGE.passwordChanged)).toBeNull();
  });
});

describe("the required password change page", () => {
  it("explains why, holds the change form and links back to the sign-in", async () => {
    renderPage(await RequiredPasswordChangePage());

    expect(screen.getByRole("heading", { level: 1, name: CHANGE.title })).toBeInTheDocument();
    expect(screen.getByText(CHANGE.description)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CHANGE.submit })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: CHANGE.backToSignIn })).toHaveAttribute(
      "href",
      "/login"
    );
  });
});
