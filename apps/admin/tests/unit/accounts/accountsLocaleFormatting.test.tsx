/**
 * @file accountsLocaleFormatting.test.tsx
 * @description Pins the dates of the accounts page and of the account billing panel to the
 *   active UI locale: the creation and last-login dates of the table, and the panel's
 *   grandfathering end, last login, trial end and session dates, read in Spanish under `es` and
 *   keep the English text they had under `en`. The data hooks, the current user and next-intl's
 *   navigation are stand-ins. Dates are built from local wall-clock parts, so the assertions hold
 *   in any time zone the suite runs in.
 * @layer infrastructure
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AnchorHTMLAttributes, ReactElement } from "react";
import enMessages from "@/messages/en.json";
import esMessages from "@/messages/es.json";
import AccountsPage from "@/app/[locale]/(dashboard)/accounts/page";
import { AccountBillingPanel } from "@/components/accounts/AccountBillingPanel";
import type { AccountSummary } from "@/lib/api/types";
import type { BillingData } from "@/hooks/api/useAccountBilling";

const OCT_20 = new Date(2026, 9, 20, 14, 7).toISOString();
const OCT_22 = new Date(2026, 9, 22, 14, 7).toISOString();
const OCT_29 = new Date(2026, 9, 29, 14, 7).toISOString();
const NOV_30 = new Date(2026, 10, 30, 14, 7).toISOString();

const ACCOUNT: AccountSummary = {
  id: "account-1",
  email: "billing@acme.test",
  name: "Acme",
  isActive: true,
  createdAt: OCT_22,
  lastLoginAt: OCT_29,
  plan: { type: "custom", name: "Growth", status: "ACTIVE", providers: ["x"], pricePerMonth: 30 },
  trial: { isOnTrial: false, trialDaysRemaining: 0, trialExpired: false },
  usage: { projectsUsed: 1, projectsRemaining: 4, utilizationPercent: 20 },
};

const BILLING: BillingData = {
  accountId: "account-1",
  accountName: "Acme",
  planType: "custom",
  bundleInfo: null,
  isGrandfathered: true,
  grandfathering: {
    lockedPrice: 20,
    currentListPrice: 30,
    savingsFromGrandfathering: 10,
    expiresAt: NOV_30,
  },
  providers: [],
  calculation: {
    providerCount: 1,
    accountCount: 1,
    basePrice: 30,
    totalMonthly: 30,
    listPrice: 30,
    savings: 0,
  },
  cheaperBundle: null,
  trial: { isOnTrial: true, trialEndDate: OCT_29, daysRemaining: 3 },
};

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/providers/AuthProvider", () => ({
  useCurrentUser: () => ({ hasPermission: () => true }),
}));

vi.mock("@/hooks/api/useAccounts", () => ({
  useAccounts: () => ({ data: [ACCOUNT], isLoading: false, error: null, refetch: vi.fn() }),
  useUpdateAccount: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/api/useResetAccountPassword", () => ({
  useResetAccountPassword: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/api/useAccountBilling", () => ({
  useAccountBilling: () => ({ data: BILLING, isLoading: false, error: null }),
}));

vi.mock("@/hooks/api/useAccountSessions", () => ({
  useAccountSessions: () => ({
    data: [
      {
        id: "session-1",
        userId: "user-1",
        ipAddress: "203.0.113.7",
        userAgent: "Firefox",
        isActive: true,
        expiresAt: NOV_30,
        createdAt: OCT_20,
      },
    ],
  }),
  useRevokeAccountSessions: () => ({ mutate: vi.fn(), isPending: false }),
}));

const CATALOGS = { en: enMessages, es: esMessages } as const;

/** Renders `ui` inside a query client and next-intl's provider on `locale`, with its catalog. */
function renderIn(locale: keyof typeof CATALOGS, ui: ReactElement) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale={locale} messages={CATALOGS[locale]}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

function renderPanel(locale: keyof typeof CATALOGS) {
  renderIn(locale, <AccountBillingPanel accountId="account-1" lastLoginAt={OCT_22} />);
}

describe("accounts table dates", () => {
  it("shows the creation and last-login dates in Spanish on the es interface", () => {
    renderIn("es", <AccountsPage />);

    expect(screen.getByText("Creada el 22 oct 2026")).toBeInTheDocument();
    expect(screen.getByText("29 oct 2026")).toBeInTheDocument();
  });

  it("keeps the English creation and last-login dates on the en interface", () => {
    renderIn("en", <AccountsPage />);

    expect(screen.getByText("Created Oct 22, 2026")).toBeInTheDocument();
    expect(screen.getByText("Oct 29, 2026")).toBeInTheDocument();
  });
});

describe("AccountBillingPanel dates", () => {
  it("shows the grandfathering end, last login, trial end and session dates in Spanish on the es interface", () => {
    renderPanel("es");

    expect(screen.getByText(/30\/11\/2026$/)).toBeInTheDocument();
    expect(screen.getByText("22 oct 2026")).toBeInTheDocument();
    expect(screen.getByText("Termina el 29/10/2026")).toBeInTheDocument();
    expect(screen.getByText("20/10/2026")).toBeInTheDocument();
  });

  it("keeps the English grandfathering end, last login, trial end and session dates on the en interface", () => {
    renderPanel("en");

    expect(screen.getByText("Grandfathered until 11/30/2026")).toBeInTheDocument();
    expect(screen.getByText("Oct 22, 2026")).toBeInTheDocument();
    expect(screen.getByText("Ends 10/29/2026")).toBeInTheDocument();
    expect(screen.getByText("10/20/2026")).toBeInTheDocument();
  });
});
