/**
 * @file useTrendRadar.integration.test.tsx
 * @description Integration tests for the `useTrendRadar` TanStack Query
 *              hook against MSW v2. Default handler in
 *              `tests/mocks/handlers/trendRadar.ts` serves the happy path;
 *              per-test overrides via `server.use(...)` cover the error,
 *              missing-data, and protocol-violation branches.
 *
 *              Canon: `msw-v2-setup-for-vitest-tests-with-tanstack-query`.
 * @layer infrastructure
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useTrendRadar, type TrendRadarPage } from "../../hooks/api/useTrendRadar.js";
import { server } from "../mocks/server.js";

const PROXY = "/api/backend";

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

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

const customPage: TrendRadarPage = {
  scored: [
    {
      topic: "#AIArt",
      platform: "TIKTOK",
      source: "PERPLEXITY_WEB",
      sourceUrl: "https://example.test/ai-art",
      relevanceScore: 9,
      postIdea: "Lean into the AI art wave",
      bestPlatform: "TIKTOK",
      urgency: "TODAY",
      volume: 1500,
      fetchedAt: "2026-05-20T00:00:00.000Z",
    },
  ],
  total: 1,
};

describe("useTrendRadar", () => {
  it("returns the default handler's trend radar page on success", async () => {
    const { result } = renderHook(() => useTrendRadar(), { wrapper: createWrapper(makeClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total).toBe(1);
    expect(result.current.data?.scored[0]?.topic).toBe("#DefaultTrend");
  });

  it("returns a per-test custom page when the handler is overridden", async () => {
    server.use(
      http.get(`${PROXY}/trends/radar`, () => HttpResponse.json({ ok: true, data: customPage }))
    );

    const { result } = renderHook(() => useTrendRadar(), { wrapper: createWrapper(makeClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.scored[0]?.topic).toBe("#AIArt");
    expect(result.current.data?.scored[0]?.sourceUrl).toBe("https://example.test/ai-art");
  });

  it("throws the parsed error message on a 5xx response", async () => {
    server.use(
      http.get(`${PROXY}/trends/radar`, () =>
        HttpResponse.json({ ok: false, error: "backend down" }, { status: 500 })
      )
    );

    const { result } = renderHook(() => useTrendRadar(), { wrapper: createWrapper(makeClient()) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("backend down");
  });

  it("falls back to a default error message when the 5xx body has no `error` field", async () => {
    server.use(http.get(`${PROXY}/trends/radar`, () => HttpResponse.json({}, { status: 500 })));

    const { result } = renderHook(() => useTrendRadar(), { wrapper: createWrapper(makeClient()) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Failed to load trend radar");
  });

  it("throws when the response is 2xx but the body is missing `data`", async () => {
    server.use(http.get(`${PROXY}/trends/radar`, () => HttpResponse.json({ ok: true })));

    const { result } = renderHook(() => useTrendRadar(), { wrapper: createWrapper(makeClient()) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Failed to load trend radar");
  });

  it("throws when the response is 2xx but `ok` is false (server protocol violation)", async () => {
    server.use(
      http.get(`${PROXY}/trends/radar`, () => HttpResponse.json({ ok: false, error: "soft fail" }))
    );

    const { result } = renderHook(() => useTrendRadar(), { wrapper: createWrapper(makeClient()) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("soft fail");
  });
});
