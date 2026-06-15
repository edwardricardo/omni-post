/**
 * @file useABTests.integration.test.ts
 * @description Integration tests for the useABTests hook — project-scoped A/B test
 *              list query (with optional status filter) + create / start / stop
 *              lifecycle mutations, exercised through the proxy with MSW v2.
 *
 *              Canon: `msw-v2-setup-for-vitest-tests-with-tanstack-query`.
 * @layer infrastructure
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useABTests } from "../../lib/hooks/useABTests";
import { server } from "../mocks/server";

const PROXY = "/api/backend";
const PROJECT = "proj-1";
const BASE = `${PROXY}/projects/${PROJECT}/templates/ab-tests`;

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function abTest(overrides: Record<string, unknown> = {}) {
  return {
    id: "ab-1",
    name: "Subject line test",
    templateId: "tmpl-1",
    config: { enabled: true, variants: [] },
    status: "draft",
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("useABTests", () => {
  it("fetches A/B tests for the project", async () => {
    server.use(http.get(BASE, () => HttpResponse.json({ ok: true, data: [abTest()] })));

    const { result } = renderHook(() => useABTests(PROJECT), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.tests).toHaveLength(1);
    expect(result.current.tests[0]?.name).toBe("Subject line test");
  });

  it("propagates the status filter to the query string", async () => {
    let requestedUrl = "";
    server.use(
      http.get(BASE, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({ ok: true, data: [] });
      })
    );

    const { result } = renderHook(() => useABTests(PROJECT, "running"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(requestedUrl).toContain("status=running");
  });

  it("surfaces an error when the list request fails", async () => {
    server.use(
      http.get(BASE, () => HttpResponse.json({ ok: false, error: "boom" }, { status: 500 }))
    );

    const { result } = renderHook(() => useABTests(PROJECT), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });

  it("creates an A/B test via POST", async () => {
    let received: unknown;
    server.use(
      http.get(BASE, () => HttpResponse.json({ ok: true, data: [] })),
      http.post(BASE, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ ok: true, data: abTest({ id: "ab-new" }) });
      })
    );

    const { result } = renderHook(() => useABTests(PROJECT), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const created = await result.current.createTest.mutateAsync({
      name: "New test",
      templateId: "tmpl-1",
      config: { enabled: true, variants: [] },
    });

    expect(created.id).toBe("ab-new");
    expect(received).toMatchObject({ name: "New test", templateId: "tmpl-1" });
  });

  it("starts an A/B test via POST …/start", async () => {
    let started = false;
    server.use(
      http.get(BASE, () => HttpResponse.json({ ok: true, data: [abTest()] })),
      http.post(`${BASE}/ab-1/start`, () => {
        started = true;
        return HttpResponse.json({ ok: true, data: abTest({ status: "running" }) });
      })
    );

    const { result } = renderHook(() => useABTests(PROJECT), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const updated = await result.current.startTest.mutateAsync("ab-1");
    expect(started).toBe(true);
    expect(updated.status).toBe("running");
  });
});
