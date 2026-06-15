/**
 * @file TrendsPage.integration.test.tsx
 * @description Integration tests for the Trend Radar page: renders the
 *              hook's loading / error / empty / populated states, the
 *              provenance badge per source (PERPLEXITY_WEB /
 *              ACCOUNT_ANALYTICS / INBOX_MENTIONS), the optional
 *              `sourceUrl` external link, and the urgency grouping
 *              (NOW / TODAY / THIS_WEEK).
 *
 *              Canon: `msw-v2-setup-for-vitest-tests-with-tanstack-query`.
 * @layer infrastructure
 */
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import TrendsPage from "../../app/[locale]/dashboard/ai/trends/page";
import { server } from "../mocks/server";
import { IntlTestProvider } from "../intl-test-utils";
import type { ScoredTrend } from "../../hooks/api/useTrendRadar";

const PROXY = "/api/backend";

// Mock @packages/ui — the full barrel pulls paths Vite cannot resolve in
// the test env; same pattern as RepurposePage.integration.test.tsx.
vi.mock("@packages/ui", () => ({
  Badge: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0, refetchOnWindowFocus: false },
    },
  });
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <IntlTestProvider>
        <TrendsPage />
      </IntlTestProvider>
    </QueryClientProvider>
  );
}

function trend(overrides: Partial<ScoredTrend>): ScoredTrend {
  return {
    topic: "#Default",
    platform: "TIKTOK",
    source: "PERPLEXITY_WEB",
    sourceUrl: null,
    relevanceScore: 8,
    postIdea: "Default idea",
    bestPlatform: "TIKTOK",
    urgency: "TODAY",
    volume: 100,
    fetchedAt: "2026-05-20T00:00:00.000Z",
    ...overrides,
  };
}

function withTrends(scored: ScoredTrend[]) {
  server.use(
    http.get(`${PROXY}/trends/radar`, () =>
      HttpResponse.json({ ok: true, data: { scored, total: scored.length } })
    )
  );
}

describe("TrendsPage", () => {
  it("renders the populated state (default handler serves one trend)", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("#DefaultTrend")).toBeInTheDocument());
    expect(screen.getByText("Hoy")).toBeInTheDocument();
  });

  it("renders a SourceBadge per provenance with the canonical label", async () => {
    withTrends([
      trend({ topic: "#FromWeb", source: "PERPLEXITY_WEB", urgency: "NOW" }),
      trend({ topic: "#FromAnalytics", source: "ACCOUNT_ANALYTICS", urgency: "TODAY" }),
      trend({ topic: "#FromInbox", source: "INBOX_MENTIONS", urgency: "THIS_WEEK" }),
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText("#FromWeb")).toBeInTheDocument());
    expect(screen.getByText("Web")).toBeInTheDocument();
    expect(screen.getByText("Tus publicaciones")).toBeInTheDocument();
    expect(screen.getByText("Bandeja")).toBeInTheDocument();
  });

  it("renders an external link when `sourceUrl` is present", async () => {
    withTrends([
      trend({ topic: "#WithUrl", sourceUrl: "https://example.test/foo", urgency: "NOW" }),
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText("#WithUrl")).toBeInTheDocument());
    const link = screen.getByLabelText("Abrir fuente de #WithUrl");
    expect(link).toHaveAttribute("href", "https://example.test/foo");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("does not render an external link when `sourceUrl` is null", async () => {
    withTrends([trend({ topic: "#NoUrl", sourceUrl: null, urgency: "NOW" })]);

    renderPage();

    await waitFor(() => expect(screen.getByText("#NoUrl")).toBeInTheDocument());
    expect(screen.queryByLabelText("Abrir fuente de #NoUrl")).not.toBeInTheDocument();
  });

  it("groups trends by urgency and renders each group with its count", async () => {
    withTrends([
      trend({ topic: "#Now1", urgency: "NOW" }),
      trend({ topic: "#Now2", urgency: "NOW" }),
      trend({ topic: "#Today1", urgency: "TODAY" }),
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText("#Now1")).toBeInTheDocument());
    expect(screen.getByText("Publicar ahora")).toBeInTheDocument();
    expect(screen.getByText("(2)")).toBeInTheDocument();
    expect(screen.getByText("Hoy")).toBeInTheDocument();
    expect(screen.getByText("(1)")).toBeInTheDocument();
  });

  it("renders the empty state when there are no trends", async () => {
    withTrends([]);

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Aún no hay temas en tendencia")).toBeInTheDocument()
    );
  });

  it("renders the error state when the backend returns 500", async () => {
    server.use(
      http.get(`${PROXY}/trends/radar`, () =>
        HttpResponse.json({ ok: false, error: "backend down" }, { status: 500 })
      )
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("No se pudo cargar el radar de tendencias")).toBeInTheDocument()
    );
    expect(screen.getByText("backend down")).toBeInTheDocument();
  });
});
