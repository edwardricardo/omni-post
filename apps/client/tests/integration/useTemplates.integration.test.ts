/**
 * @file useTemplates.integration.test.ts
 * @description Integration tests for the useTemplates hook — project-scoped
 *              template list query + create / update / delete / duplicate
 *              mutations, exercised through the proxy with MSW v2.
 *
 *              Canon: `msw-v2-setup-for-vitest-tests-with-tanstack-query`.
 * @layer infrastructure
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useTemplates } from "../../lib/hooks/useTemplates";
import { server } from "../mocks/server";

const PROXY = "/api/backend";
const PROJECT = "proj-1";
const BASE = `${PROXY}/projects/${PROJECT}/templates`;

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

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: "tmpl-1",
    name: "Welcome",
    description: "",
    category: "promo",
    content: "Hello {name}",
    platforms: ["x"],
    tags: [],
    variables: [],
    ...overrides,
  };
}

describe("useTemplates", () => {
  it("fetches templates for the project", async () => {
    server.use(http.get(BASE, () => HttpResponse.json({ ok: true, data: [template()] })));

    const { result } = renderHook(() => useTemplates(PROJECT), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.templates).toHaveLength(1);
    expect(result.current.templates[0]?.name).toBe("Welcome");
    expect(result.current.error).toBeFalsy();
  });

  it("surfaces an error when the list request fails", async () => {
    server.use(
      http.get(BASE, () => HttpResponse.json({ ok: false, error: "boom" }, { status: 500 }))
    );

    const { result } = renderHook(() => useTemplates(PROJECT), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });

  it("creates a template via POST and returns the created entity", async () => {
    let received: unknown;
    server.use(
      http.get(BASE, () => HttpResponse.json({ ok: true, data: [] })),
      http.post(BASE, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ ok: true, data: template({ id: "tmpl-new", name: "Promo" }) });
      })
    );

    const { result } = renderHook(() => useTemplates(PROJECT), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const created = await result.current.createTemplate.mutateAsync({
      name: "Promo",
      category: "promo",
      content: "Buy now",
      platforms: ["x"],
    });

    expect(created.id).toBe("tmpl-new");
    expect(received).toMatchObject({ name: "Promo", category: "promo", platforms: ["x"] });
  });

  it("deletes a template via DELETE", async () => {
    let deletedId: string | undefined;
    server.use(
      http.get(BASE, () => HttpResponse.json({ ok: true, data: [template()] })),
      http.delete(`${BASE}/tmpl-1`, () => {
        deletedId = "tmpl-1";
        return HttpResponse.json({ ok: true });
      })
    );

    const { result } = renderHook(() => useTemplates(PROJECT), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await result.current.deleteTemplate.mutateAsync("tmpl-1");
    expect(deletedId).toBe("tmpl-1");
  });

  it("duplicates a template via POST …/duplicate", async () => {
    let body: unknown;
    server.use(
      http.get(BASE, () => HttpResponse.json({ ok: true, data: [template()] })),
      http.post(`${BASE}/tmpl-1/duplicate`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          ok: true,
          data: template({ id: "tmpl-copy", name: "Welcome copy" }),
        });
      })
    );

    const { result } = renderHook(() => useTemplates(PROJECT), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const copy = await result.current.duplicateTemplate.mutateAsync({
      templateId: "tmpl-1",
      name: "Welcome copy",
    });

    expect(copy.id).toBe("tmpl-copy");
    expect(body).toMatchObject({ name: "Welcome copy" });
  });
});
