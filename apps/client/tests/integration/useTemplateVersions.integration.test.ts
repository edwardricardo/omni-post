/**
 * @file useTemplateVersions.integration.test.ts
 * @description Integration tests for the useTemplateVersions hook — version
 *              history list (only when both ids are present) + create / restore
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

import { useTemplateVersions } from "../../lib/hooks/useTemplateVersions.js";
import { server } from "../mocks/server.js";

const PROXY = "/api/backend";
const PROJECT = "proj-1";
const TEMPLATE = "tmpl-1";
const BASE = `${PROXY}/projects/${PROJECT}/templates/${TEMPLATE}/versions`;

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

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: "ver-1",
    templateId: TEMPLATE,
    version: 1,
    content: "v1 content",
    variables: [],
    platforms: ["x"],
    tags: [],
    changeLog: "initial",
    author: { id: "u-1", name: "Author" },
    isActive: true,
    createdAt: "2026-05-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("useTemplateVersions", () => {
  it("does not fetch when template/project ids are missing", () => {
    const { result } = renderHook(() => useTemplateVersions(undefined, undefined), {
      wrapper: createWrapper(),
    });

    // Query is disabled — no request fires (onUnhandledRequest would error otherwise).
    expect(result.current.versions).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("fetches version history when both ids are present", async () => {
    server.use(
      http.get(BASE, () =>
        HttpResponse.json({ ok: true, data: [version(), version({ id: "ver-2", version: 2 })] })
      )
    );

    const { result } = renderHook(() => useTemplateVersions(TEMPLATE, PROJECT), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.versions).toHaveLength(2);
  });

  it("surfaces an error when the list request fails", async () => {
    server.use(
      http.get(BASE, () => HttpResponse.json({ ok: false, error: "boom" }, { status: 500 }))
    );

    const { result } = renderHook(() => useTemplateVersions(TEMPLATE, PROJECT), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });

  it("creates a version via POST", async () => {
    let received: unknown;
    server.use(
      http.get(BASE, () => HttpResponse.json({ ok: true, data: [version()] })),
      http.post(BASE, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ ok: true, data: version({ id: "ver-new", version: 2 }) });
      })
    );

    const { result } = renderHook(() => useTemplateVersions(TEMPLATE, PROJECT), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const created = await result.current.createVersion.mutateAsync({
      templateId: TEMPLATE,
      version: 2,
      content: "v2 content",
      variables: [],
      platforms: ["x"],
      tags: [],
      changeLog: "update",
      author: { id: "u-1", name: "Author" },
      isActive: true,
    });

    expect(created.id).toBe("ver-new");
    expect(received).toMatchObject({ version: 2, content: "v2 content" });
  });

  it("restores a version via POST …/restore", async () => {
    let restored = false;
    server.use(
      http.get(BASE, () => HttpResponse.json({ ok: true, data: [version()] })),
      http.post(`${BASE}/ver-1/restore`, () => {
        restored = true;
        return HttpResponse.json({ ok: true });
      })
    );

    const { result } = renderHook(() => useTemplateVersions(TEMPLATE, PROJECT), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await result.current.restoreVersion.mutateAsync("ver-1");
    expect(restored).toBe(true);
  });
});
