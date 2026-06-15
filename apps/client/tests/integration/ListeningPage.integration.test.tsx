/**
 * @file ListeningPage.integration.test.tsx
 * @description Integration tests for the brand-listening dashboard: renders the
 *              Share-of-Voice summary cards + mention feed from real (MSW-served)
 *              data, the empty state, and the error state. Charts are stubbed to
 *              keep assertions on the data-driven DOM (recharts needs no jsdom geometry).
 *
 *              Canon: `msw-v2-setup-for-vitest-tests-with-tanstack-query`.
 * @layer infrastructure
 */
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ListeningDashboard } from "../../app/[locale]/dashboard/listening/components/ListeningDashboard";
import { server } from "../mocks/server";
import { IntlTestProvider } from "../intl-test-utils";

const PROXY = "/api/backend";

// EmptyState pulls the locale-aware nav primitives + the UI Button barrel; stub
// both so importing the dashboard doesn't drag in next/navigation or Vite-unresolvable paths.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@packages/ui", () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

// Stub the recharts-backed charts: recharts needs layout geometry jsdom lacks,
// and the data-bearing assertions live in the summary cards + feed.
vi.mock("../../app/[locale]/dashboard/listening/components/ShareOfVoiceChart", () => ({
  ShareOfVoiceChart: () => <div data-testid="sov-chart" />,
}));
vi.mock("../../app/[locale]/dashboard/listening/components/SentimentBreakdownChart", () => ({
  SentimentBreakdownChart: () => <div data-testid="sentiment-chart" />,
}));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // The hooks set retry: 2 (overrides the client default); retryDelay: 0
        // keeps the error-state test fast since retries fire instantly.
        retryDelay: 0,
        gcTime: Infinity,
        staleTime: 0,
        refetchOnWindowFocus: false,
      },
    },
  });
}

function renderDashboard() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <IntlTestProvider>
        <ListeningDashboard projectId="proj-1" />
      </IntlTestProvider>
    </QueryClientProvider>
  );
}

describe("ListeningDashboard", () => {
  it("renders SoV summary cards + mention feed from real data", async () => {
    renderDashboard();

    await waitFor(() => expect(screen.getByText("2.00×")).toBeInTheDocument()); // SoV = brand/market
    expect(screen.getByText("12")).toBeInTheDocument(); // total mentions
    expect(screen.getByText("Loving the new launch from Acme!")).toBeInTheDocument(); // feed body
    expect(screen.getByText("Jane Fan")).toBeInTheDocument(); // feed author
  });

  it("renders the empty state when the corpus has no mentions", async () => {
    server.use(
      http.get(`${PROXY}/listening/share-of-voice`, () =>
        HttpResponse.json({
          ok: true,
          data: {
            projectId: "proj-1",
            since: "2026-04-22T00:00:00.000Z",
            until: "2026-05-22T00:00:00.000Z",
            brandCount: 0,
            marketCount: 0,
            totalCount: 0,
            sov: 0,
            byProvider: [],
            bySentiment: { positive: 0, neutral: 0, negative: 0, unscored: 0 },
          },
        })
      )
    );

    renderDashboard();

    await waitFor(() => expect(screen.getByText("Aún no hay menciones")).toBeInTheDocument());
  });

  it("renders the error state when the backend returns 500", async () => {
    server.use(
      http.get(`${PROXY}/listening/share-of-voice`, () =>
        HttpResponse.json({ ok: false, error: "backend down" }, { status: 500 })
      )
    );

    renderDashboard();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
