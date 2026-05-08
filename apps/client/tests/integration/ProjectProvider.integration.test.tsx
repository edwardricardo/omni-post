/**
 * @file ProjectProvider.integration.test.tsx
 * @description Integration tests for the refactored `ProjectProvider` —
 *              guards against the L-100 regression: silent fetch failures,
 *              `window.location.reload()` retry, and manual useEffect data
 *              fetching. Verifies TanStack Query integration (loading,
 *              error+refetch, empty state, localStorage persistence,
 *              account/project resolution).
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ProjectProvider, useProject } from "@/providers/ProjectProvider";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const STORAGE_KEY = "omnipost-active-project";

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function ProjectProbe() {
  const { projectId, accountId } = useProject();
  return (
    <div>
      <span data-testid="project-id">{projectId}</span>
      <span data-testid="account-id">{accountId}</span>
    </div>
  );
}

function mockCustomerMe(accountId: string) {
  return {
    ok: true,
    json: async () => ({
      ok: true,
      data: {
        user: {
          id: "user-1",
          email: "alice@example.com",
          name: "Alice",
          accountId,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      },
    }),
  };
}

function mockProjectsOk(projects: Array<{ id: string; name: string; accountId: string }>) {
  return {
    ok: true,
    json: async () => ({
      ok: true,
      value: projects.map((p) => ({
        ...p,
        locale: "es",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      })),
    }),
  };
}

describe("ProjectProvider", () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) wipes mock IMPLEMENTATIONS too —
    // critical because the loading-state test installs a never-resolving
    // implementation that would otherwise leak into subsequent tests and
    // hang their waitFor() calls.
    vi.resetAllMocks();
    if (typeof window !== "undefined") {
      window.localStorage.clear();
    }
  });

  it("shows the loading state while resolving customer + projects", () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // never resolves

    const Wrapper = createWrapper(makeClient());
    render(
      <Wrapper>
        <ProjectProvider>
          <ProjectProbe />
        </ProjectProvider>
      </Wrapper>
    );

    expect(screen.getByRole("status", { name: /loading project context/i })).toBeInTheDocument();
  });

  it("resolves the first project for the account when localStorage is empty", async () => {
    mockFetch.mockResolvedValueOnce(mockCustomerMe("acc-1"));
    mockFetch.mockResolvedValueOnce(
      mockProjectsOk([
        { id: "proj-1", name: "Brand A", accountId: "acc-1" },
        { id: "proj-2", name: "Brand B", accountId: "acc-1" },
      ])
    );

    const Wrapper = createWrapper(makeClient());
    render(
      <Wrapper>
        <ProjectProvider>
          <ProjectProbe />
        </ProjectProvider>
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-id")).toHaveTextContent("proj-1");
    });
    expect(screen.getByTestId("account-id")).toHaveTextContent("acc-1");
  });

  it("restores the project from localStorage when account matches", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ accountId: "acc-1", projectId: "proj-2" })
    );

    mockFetch.mockResolvedValueOnce(mockCustomerMe("acc-1"));
    mockFetch.mockResolvedValueOnce(
      mockProjectsOk([
        { id: "proj-1", name: "Brand A", accountId: "acc-1" },
        { id: "proj-2", name: "Brand B", accountId: "acc-1" },
      ])
    );

    const Wrapper = createWrapper(makeClient());
    render(
      <Wrapper>
        <ProjectProvider>
          <ProjectProbe />
        </ProjectProvider>
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-id")).toHaveTextContent("proj-2");
    });
  });

  it("shows the error state with a Retry button when the customer query fails", async () => {
    // The provider configures `retry: 1`, so the failing fetch is invoked twice
    // before TanStack flips to the error state. `mockResolvedValue` (not Once)
    // returns the same response for every call. Default retry delay is
    // exponential (~1s for the first retry) — bump test timeout accordingly.
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ ok: false, error: "Server boom" }),
    });

    const Wrapper = createWrapper(makeClient());
    render(
      <Wrapper>
        <ProjectProvider>
          <ProjectProbe />
        </ProjectProvider>
      </Wrapper>
    );

    await waitFor(
      () => {
        expect(screen.getByRole("alert")).toHaveTextContent(/failed to load project context/i);
      },
      { timeout: 8000 }
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  }, 15_000);

  it("retries via TanStack Query refetch (NOT window.location.reload)", async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });

    let nextResponse:
      | { ok: false; status: number; statusText: string; json: () => Promise<unknown> }
      | { ok: true; json: () => Promise<unknown> } = {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ ok: false, error: "Server boom" }),
    };
    mockFetch.mockImplementation(() => Promise.resolve(nextResponse));

    const Wrapper = createWrapper(makeClient());
    render(
      <Wrapper>
        <ProjectProvider>
          <ProjectProbe />
        </ProjectProvider>
      </Wrapper>
    );

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument(), { timeout: 8000 });

    // Switch the mock to success responses (customer me + projects).
    // The retry button triggers `refetch()` on each errored query.
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(mockCustomerMe("acc-1"));
      return Promise.resolve(mockProjectsOk([{ id: "proj-1", name: "X", accountId: "acc-1" }]));
    });
    nextResponse = { ok: true, json: async () => ({}) }; // no-op, mockImplementation overrides

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(
      () => {
        expect(screen.getByTestId("project-id")).toHaveTextContent("proj-1");
      },
      { timeout: 8000 }
    );
    expect(reloadSpy).not.toHaveBeenCalled();
  }, 15_000);

  it("shows the empty state when the account has zero projects", async () => {
    mockFetch.mockResolvedValueOnce(mockCustomerMe("acc-empty"));
    mockFetch.mockResolvedValueOnce(mockProjectsOk([]));

    const Wrapper = createWrapper(makeClient());
    render(
      <Wrapper>
        <ProjectProvider>
          <ProjectProbe />
        </ProjectProvider>
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText(/no projects found/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/this account has no projects yet/i)).toBeInTheDocument();
  });

  it("skips the queries entirely when initialProjectId + initialAccountId are passed", () => {
    const Wrapper = createWrapper(makeClient());
    render(
      <Wrapper>
        <ProjectProvider initialAccountId="acc-init" initialProjectId="proj-init">
          <ProjectProbe />
        </ProjectProvider>
      </Wrapper>
    );

    expect(screen.getByTestId("project-id")).toHaveTextContent("proj-init");
    expect(screen.getByTestId("account-id")).toHaveTextContent("acc-init");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("persists the selected project to localStorage on resolution", async () => {
    mockFetch.mockResolvedValueOnce(mockCustomerMe("acc-1"));
    mockFetch.mockResolvedValueOnce(
      mockProjectsOk([{ id: "proj-1", name: "Brand A", accountId: "acc-1" }])
    );

    const Wrapper = createWrapper(makeClient());
    render(
      <Wrapper>
        <ProjectProvider>
          <ProjectProbe />
        </ProjectProvider>
      </Wrapper>
    );

    await waitFor(() => expect(screen.getByTestId("project-id")).toHaveTextContent("proj-1"));

    const stored = window.localStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!) as { accountId: string; projectId: string };
    expect(parsed).toEqual({ accountId: "acc-1", projectId: "proj-1" });
  });
});
