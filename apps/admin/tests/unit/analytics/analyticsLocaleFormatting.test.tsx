/**
 * @file analyticsLocaleFormatting.test.tsx
 * @description Pins the money and counts of the analytics page to the active UI locale: the
 *   revenue, recurring revenue and lifetime value figures and the two trend charts' values read
 *   the Spanish way under `es` and keep the English text they had when the page named `en-US`
 *   under `en`. The data hook, the chart colours, the charts and next-intl's navigation are
 *   stand-ins; each chart stand-in renders the values its `formatValue` returns.
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
    subscriptions: {},
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
  DonutChart: () => null,
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
