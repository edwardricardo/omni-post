/**
 * @file subscriptionsLocaleFormatting.test.tsx
 * @description Pins the numbers, dates and texts of the subscriptions page to the active UI
 *   locale: the revenue figures, the plan price, the billing and trial dates, and the usage
 *   panel's month and counts read in Spanish under `es` and keep the English text they had under
 *   `en`; the two statistics regions' accessible names, the billing cycle, the trial status and
 *   every text of the usage panel, loaded, loading and failed, read their catalog text, and a
 *   billing cycle or trial status the catalog does not name keeps its code. The data hooks, the
 *   URL's search parameters and next-intl's navigation are stand-ins, and the clock is fixed for
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
const usage = vi.hoisted(() => ({ state: "loaded" as "loaded" | "loading" | "failed" }));
const rows = vi.hoisted(() => ({ billingCycle: "monthly", trialStatus: "ACTIVE" }));

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
          billingCycle: rows.billingCycle,
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
          status: rows.trialStatus,
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
  useUsageMetrics: () => {
    if (usage.state === "loading") return { data: undefined, isLoading: true, error: null };
    if (usage.state === "failed") {
      return { data: undefined, isLoading: false, error: new Error("HTTP 401: {}") };
    }
    return {
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
    };
  },
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
  usage.state = "loaded";
  rows.billingCycle = "monthly";
  rows.trialStatus = "ACTIVE";
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

  it("writes the panel's heading, reset note, labels and unlimited counts in Spanish on the es interface", () => {
    renderPage("es");

    expect(screen.getByRole("heading", { name: "Uso — octubre de 2026" })).toBeInTheDocument();
    expect(screen.getByText("Se reinicia el día 1 de cada mes")).toBeInTheDocument();
    for (const label of [
      "Publicaciones realizadas",
      "Llamadas de IA usadas",
      "Almacenamiento usado",
      "Miembros del equipo",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("1.234.567 (ilimitado)")).toBeInTheDocument();
    expect(screen.getByText("12,5 GB (ilimitado)")).toBeInTheDocument();
  });

  it("keeps the panel's English reset note and labels on the en interface", () => {
    renderPage("en");

    expect(screen.getByText("Resets on the 1st of each month")).toBeInTheDocument();
    for (const label of ["Posts Published", "AI Calls Used", "Storage Used", "Team Members"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("titles the loading panel in Spanish on the es interface", () => {
    usage.state = "loading";
    renderPage("es");

    expect(screen.getByRole("heading", { name: "Uso — octubre de 2026" })).toBeInTheDocument();
  });

  it("keeps the English title of the loading panel on the en interface", () => {
    usage.state = "loading";
    renderPage("en");

    expect(screen.getByRole("heading", { name: "Usage -- October 2026" })).toBeInTheDocument();
  });

  it("says the usage is unavailable in Spanish on the es interface", () => {
    usage.state = "failed";
    renderPage("es");

    expect(screen.getByRole("heading", { name: "Uso — octubre de 2026" })).toBeInTheDocument();
    expect(screen.getByText("Datos de uso no disponibles para este periodo.")).toBeInTheDocument();
  });

  it("keeps the English unavailable notice on the en interface", () => {
    usage.state = "failed";
    renderPage("en");

    expect(screen.getByRole("heading", { name: "Usage -- October 2026" })).toBeInTheDocument();
    expect(screen.getByText("Usage data unavailable for this period.")).toBeInTheDocument();
  });
});

describe("subscriptions statistics regions", () => {
  it("names the two statistics regions in Spanish on the es interface", () => {
    renderPage("es");

    expect(
      screen.getByRole("region", { name: "Estadísticas de suscripciones" })
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Estadísticas de facturación" })).toBeInTheDocument();
  });

  it("keeps the English names of the two statistics regions on the en interface", () => {
    renderPage("en");

    expect(screen.getByRole("region", { name: "Subscription statistics" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Billing statistics" })).toBeInTheDocument();
  });
});

describe("subscriptions billing cycle", () => {
  it.each([
    ["monthly", "Mensual"],
    ["yearly", "Anual"],
  ])("names the %s billing cycle in Spanish on the es interface", (cycle, label) => {
    rows.billingCycle = cycle;
    renderPage("es");

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it.each([
    ["monthly", "Monthly"],
    ["yearly", "Yearly"],
  ])("keeps the English %s billing cycle on the en interface", (cycle, label) => {
    rows.billingCycle = cycle;
    renderPage("en");

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("shows the code of a billing cycle the catalog does not name", () => {
    rows.billingCycle = "quarterly";
    renderPage("es");

    expect(screen.getByText("quarterly")).toBeInTheDocument();
  });
});

describe("subscriptions trial status", () => {
  it.each([
    ["ACTIVE", "ACTIVA"],
    ["EXPIRING", "POR VENCER"],
    ["EXPIRED", "VENCIDA"],
  ])("names the %s trial status in Spanish on the es interface", (status, label) => {
    rows.trialStatus = status;
    renderPage("es");
    openTrials("es");

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it.each(["ACTIVE", "EXPIRING", "EXPIRED"])(
    "keeps the English %s trial status on the en interface",
    (status) => {
      rows.trialStatus = status;
      renderPage("en");
      openTrials("en");

      expect(screen.getByText(status)).toBeInTheDocument();
    }
  );

  it("shows the code of a trial status the catalog does not name", () => {
    rows.trialStatus = "PAUSED";
    renderPage("es");
    openTrials("es");

    expect(screen.getByText("PAUSED")).toBeInTheDocument();
  });
});
