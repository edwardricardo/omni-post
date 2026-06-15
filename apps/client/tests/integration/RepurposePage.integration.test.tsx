/**
 * @file RepurposePage.integration.test.tsx
 * @description Integration tests for the repurpose page: lists proposals from
 *              the backend, renders the empty and error states, and triggers
 *              on-demand detection with toast feedback + list refetch.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RepurposePage from "../../app/[locale]/dashboard/ai/repurpose/page.js";
import { IntlTestProvider } from "../intl-test-utils.js";

const toastSpy = vi.fn();
// Mock @packages/ui to the surface the page uses — the full barrel pulls
// paths Vite cannot resolve in this test environment.
vi.mock("@packages/ui", () => ({
  Button: ({ children, disabled, onClick }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  toast: (args: unknown) => toastSpy(args),
}));

const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

const proposal = {
  id: "prop-1",
  sourcePostId: "post-1",
  sourcePlatform: "X",
  status: "PENDING",
  engagementRate: 0.42,
  engagementMultiplier: 3.1,
  detectedAt: "2026-05-19T00:00:00.000Z",
  reviewedAt: null,
  variantCount: 2,
};

const proposalsPage = (proposals: unknown[]) =>
  jsonResponse({ ok: true, data: { proposals, total: proposals.length, limit: 20, offset: 0 } });

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

function renderPage() {
  const client = makeClient();
  return render(
    <QueryClientProvider client={client}>
      <IntlTestProvider>
        <RepurposePage />
      </IntlTestProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockFetch.mockReset();
  toastSpy.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

describe("RepurposePage", () => {
  it("lists proposals returned by the backend", async () => {
    mockFetch.mockResolvedValue(proposalsPage([proposal]));

    renderPage();

    await waitFor(() => expect(screen.getByText("X")).toBeInTheDocument());
    expect(screen.getByText("PENDING")).toBeInTheDocument();
    expect(screen.getByText("3.1× promedio")).toBeInTheDocument();
    expect(screen.getByText(/2 variantes/)).toBeInTheDocument();
  });

  it("shows the empty state when there are no proposals", async () => {
    mockFetch.mockResolvedValue(proposalsPage([]));

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Aún no hay oportunidades de reutilización")).toBeInTheDocument()
    );
  });

  it("shows an error state when the proposals request fails", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: false, error: "backend down" }, 500));

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("No se pudieron cargar las propuestas")).toBeInTheDocument()
    );
    expect(screen.getByText("backend down")).toBeInTheDocument();
  });

  it("triggers detection and toasts the counts on click", async () => {
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url.includes("/repurpose/detect") && opts?.method === "POST") {
        return Promise.resolve(
          jsonResponse({ ok: true, data: { detected: 2, alreadyProposed: 1 } })
        );
      }
      return Promise.resolve(proposalsPage([]));
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Aún no hay oportunidades de reutilización")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: /detectar ahora/i }));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/backend/repurpose/detect",
        expect.objectContaining({ method: "POST", credentials: "include" })
      )
    );
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toastSpy.mock.calls[0]?.[0]).toMatchObject({
      title: "Detección completada",
      description: "2 detectadas, 1 ya propuestas",
    });
  });
});
