/**
 * @file analyticsLocaleFormatting.test.tsx
 * @description Pins the money, counts and texts of the analytics page to the active UI locale:
 *   the revenue, recurring revenue and lifetime value figures and the two trend charts' values
 *   read the Spanish way under `es` and keep the English text they had when the page named
 *   `en-US` under `en`; the time-range selector's accessible name and the subscription chart's
 *   status names read their catalog text, and a status the catalog does not name keeps its code.
 *   The data hook, the chart colours, the charts and next-intl's navigation are stand-ins; each
 *   trend stand-in renders the values its `formatValue` returns and each donut stand-in the names
 *   of its slices.
 * @layer infrastructure
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AnchorHTMLAttributes } from "react";
import enMessages from "@/messages/en.json";
import esMessages from "@/messages/es.json";
import AnalyticsPage from "@/app/[locale]/(dashboard)/analytics/page";
import type { AnalyticsSummary } from "@/hooks/api/useAnalytics";

const SUMMARY: AnalyticsSummary = {
  businessMetrics: {
    totalRevenue: 1234567,
    monthlyRecurringRevenue: 48250,
    revenueGrowth: 4,
    customerAcquisitionCost: 120,
    lifetimeValue: 25000,
    churnRate: 2,
  },
  operationalMetrics: {
    systemUptime: 99,
    apiResponseTime: 180,
    errorRate: 1,
    activeUsers: 320,
    dataProcessed: 12,
    securityScore: 90,
  },
  growthMetrics: {
    newCustomers: 14,
    trialConversions: 25,
    featureAdoption: 60,
    supportTickets: 3,
    customerSatisfaction: 4,
  },
  trends: { period: "30d", revenue: [7654321], users: [3456789], performance: [] },
  platformMetrics: {
    totalAccounts: 40,
    activeAccounts: 35,
    trialsActive: 5,
    trialsExpiring: 1,
    totalProjects: 60,
    totalChannels: 80,
    channelsByProvider: {},
    totalPosts: 900,
    postsPublished: 850,
    subscriptions: {
      TRIALING: 3,
      ACTIVE: 20,
      PAST_DUE: 1,
      CANCELED: 2,
      GRANDFATHERED: 4,
      PAUSED: 1,
    },
  },
};

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/hooks/api/useAnalytics", () => ({
  useAnalytics: () => ({ data: SUMMARY, isLoading: false, error: null }),
}));

vi.mock("@/hooks/useChartColors", () => ({
  useChartColors: () => ({ accent: "#6366f1", success: "#22c55e", subscriptionColors: {} }),
}));

vi.mock("@/components/charts", () => ({
  DonutChart: ({ data }: { data: Array<{ name: string }> }) => (
    <ul>
      {data.map((slice) => (
        <li key={slice.name}>{slice.name}</li>
      ))}
    </ul>
  ),
  TrendAreaChart: ({
    data,
    formatValue,
  }: {
    data: Array<{ label: string; value: number }>;
    formatValue: (value: number) => string;
  }) => (
    <ul>
      {data.map((point) => (
        <li key={point.label}>{formatValue(point.value)}</li>
      ))}
    </ul>
  ),
}));

const CATALOGS = { en: enMessages, es: esMessages } as const;

function renderPage(locale: keyof typeof CATALOGS) {
  render(
    <NextIntlClientProvider locale={locale} messages={CATALOGS[locale]}>
      <AnalyticsPage />
    </NextIntlClientProvider>
  );
}

describe("analytics money figures", () => {
  it("formats the revenue, recurring revenue and lifetime value in Spanish on the es interface", () => {
    renderPage("es");

    expect(screen.getByText("1.234.567 US$")).toBeInTheDocument();
    expect(screen.getByText("48.250 US$")).toBeInTheDocument();
    expect(screen.getByText("25.000 US$")).toBeInTheDocument();
  });

  it("keeps the English revenue, recurring revenue and lifetime value on the en interface", () => {
    renderPage("en");

    expect(screen.getByText("$1,234,567")).toBeInTheDocument();
    expect(screen.getByText("$48,250")).toBeInTheDocument();
    expect(screen.getByText("$25,000")).toBeInTheDocument();
  });
});

describe("analytics trend values", () => {
  it("groups the revenue and user trend values the Spanish way on the es interface", () => {
    renderPage("es");

    expect(screen.getByText("$7.654.321")).toBeInTheDocument();
    expect(screen.getByText("3.456.789")).toBeInTheDocument();
  });

  it("keeps the English revenue and user trend values on the en interface", () => {
    renderPage("en");

    expect(screen.getByText("$7,654,321")).toBeInTheDocument();
    expect(screen.getByText("3,456,789")).toBeInTheDocument();
  });
});

describe("analytics time-range selector", () => {
  it("names the time-range selector in Spanish on the es interface", () => {
    renderPage("es");

    expect(
      screen.getByRole("combobox", { name: "Seleccionar rango de tiempo" })
    ).toBeInTheDocument();
  });

  it("keeps the English name of the time-range selector on the en interface", () => {
    renderPage("en");

    expect(screen.getByRole("combobox", { name: "Select time range" })).toBeInTheDocument();
  });
});

describe("analytics subscription statuses", () => {
  it("names the subscription statuses in Spanish on the es interface", () => {
    renderPage("es");

    for (const name of ["En prueba", "Activa", "Pago vencido", "Cancelada", "Precio anterior"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("keeps the English subscription status names on the en interface", () => {
    renderPage("en");

    for (const name of ["Trialing", "Active", "Past Due", "Canceled", "Grandfathered"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("shows the code of a status the catalog does not name", () => {
    renderPage("es");

    expect(screen.getByText("PAUSED")).toBeInTheDocument();
  });
});
