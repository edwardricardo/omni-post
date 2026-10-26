/**
 * @file subscriptionsLocaleFormatting.test.tsx
 * @description Pins the numbers and dates of the subscriptions page to the active UI locale:
 *   the revenue figures, the plan price, the billing and trial dates, and the usage panel's
 *   month and counts read in Spanish under `es` and keep the English text they had under `en`.
 *   The data hooks, the URL's search parameters and next-intl's navigation are stand-ins, and
 *   the clock is fixed for
 *   the usage panel's month. Dates are built from local wall-clock parts, so the assertions hold
 *   in any time zone the suite runs in.
 * @layer infrastructure
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AnchorHTMLAttributes } from "react";
import enMessages from "@/messages/en.json";
import esMessages from "@/messages/es.json";
import SubscriptionsPage from "@/app/[locale]/(dashboard)/subscriptions/page";

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock("next/navigation", () => ({ useSearchParams: () => search.params }));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const OCT_29 = new Date(2026, 9, 29, 14, 7).toISOString();
const OCT_22 = new Date(2026, 9, 22, 14, 7).toISOString();
const PLAN = {
  type: "custom",
  name: "Growth",
  status: "ACTIVE",
  providers: ["x"],
  pricePerMonth: 12500,
};

vi.mock("@/hooks/api/useSubscriptions", () => ({
  useSubscriptions: () => ({
    data: {
      subscriptions: [
        {
          id: "account-1",
          email: "billing@acme.test",
          name: "Acme",
          plan: PLAN,
          billingCycle: "monthly",
          autoRenewal: true,
          nextBillingDate: OCT_29,
          lastBillingDate: OCT_22,
          createdAt: OCT_22,
        },
      ],
      trials: [
        {
          id: "account-2",
          email: "owner@globex.test",
          name: "Globex",
          plan: PLAN,
          trialStartDate: OCT_22,
          trialEndDate: OCT_29,
          trialDaysRemaining: 3,
          autoRenewal: false,
          status: "ACTIVE",
        },
      ],
      stats: {
        totalRevenue: 1234567,
        monthlyRevenue: 48250,
        activeSubscriptions: 1,
        activeTrials: 1,
        expiringTrials: 0,
        conversionRate: 50,
      },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/api/useBillingStats", () => ({
  useBillingStats: () => ({
    data: { totalRevenue: 1234567, monthlyRecurringRevenue: 99500, activeSubscriptions: 1 },
  }),
}));

vi.mock("@/hooks/api/useSubscriptionMutations", () => ({
  useEndTrial: () => ({ mutate: vi.fn(), isPending: false }),
  useConvertTrial: () => ({ mutate: vi.fn(), isPending: false }),
  useStartTrial: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/api/useUsageMetrics", () => ({
  useUsageMetrics: () => ({
    data: {
      accountId: "account-1",
      periodYear: 2026,
      periodMonth: 10,
      postsPublished: 1234567,
      aiCallsMade: 1500,
      storageGb: 12.5,
      teamMemberCount: 4,
    },
    isLoading: false,
    error: null,
  }),
}));

const CATALOGS = { en: enMessages, es: esMessages } as const;

function renderPage(locale: keyof typeof CATALOGS) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale={locale} messages={CATALOGS[locale]}>
        <SubscriptionsPage />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

/** Switches to the trial-accounts tab. */
function openTrials(locale: keyof typeof CATALOGS): void {
  const label = CATALOGS[locale].subscriptions.tabs.trialAccounts.replace("{count}", "1");
  fireEvent.click(screen.getByRole("tab", { name: label }));
}

beforeEach(() => {
  search.params = new URLSearchParams();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("subscriptions revenue and price", () => {
  it("groups the revenue figures and the plan price the Spanish way on the es interface", () => {
    renderPage("es");

    expect(screen.getByText("$1.234.567")).toBeInTheDocument();
    expect(screen.getByText("$48.250")).toBeInTheDocument();
    expect(screen.getByText("$99.500")).toBeInTheDocument();
    expect(screen.getByText("$12.500/mes")).toBeInTheDocument();
  });

  it("keeps the English revenue figures and plan price on the en interface", () => {
    renderPage("en");

    expect(screen.getByText("$1,234,567")).toBeInTheDocument();
    expect(screen.getByText("$48,250")).toBeInTheDocument();
    expect(screen.getByText("$99,500")).toBeInTheDocument();
    expect(screen.getByText("$12,500/mo")).toBeInTheDocument();
  });
});

describe("subscriptions billing and trial dates", () => {
  it("shows the billing and trial dates in Spanish on the es interface", () => {
    renderPage("es");

    expect(screen.getByText("29 oct 2026")).toBeInTheDocument();
    expect(screen.getByText("22 oct 2026")).toBeInTheDocument();
    openTrials("es");
    expect(screen.getByText("22 oct 2026")).toBeInTheDocument();
    expect(screen.getByText("29 oct 2026")).toBeInTheDocument();
  });

  it("keeps the English billing and trial dates on the en interface", () => {
    renderPage("en");

    expect(screen.getByText("Oct 29, 2026")).toBeInTheDocument();
    expect(screen.getByText("Oct 22, 2026")).toBeInTheDocument();
    openTrials("en");
    expect(screen.getByText("Oct 22, 2026")).toBeInTheDocument();
    expect(screen.getByText("Oct 29, 2026")).toBeInTheDocument();
  });
});

describe("usage metrics panel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 29, 14, 7));
    search.params = new URLSearchParams({ accountId: "account-1" });
  });

  it("names the month and groups the counts the Spanish way on the es interface", () => {
    renderPage("es");

    expect(screen.getByRole("heading", { name: /octubre de 2026$/ })).toBeInTheDocument();
    expect(screen.getByText(/^1\.234\.567 /)).toBeInTheDocument();
    expect(screen.getByText(/^12,5 GB /)).toBeInTheDocument();
  });

  it("keeps the English month and counts on the en interface", () => {
    renderPage("en");

    expect(screen.getByRole("heading", { name: "Usage -- October 2026" })).toBeInTheDocument();
    expect(screen.getByText("1,234,567 (unlimited)")).toBeInTheDocument();
    expect(screen.getByText("12.5 GB (unlimited)")).toBeInTheDocument();
  });
});
