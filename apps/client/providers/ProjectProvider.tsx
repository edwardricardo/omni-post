"use client";

/**
 * @file ProjectProvider.tsx
 * @description React context provider that resolves the active project and
 *              account for the multi-tenant client app. Each Account owns N
 *              Projects (in Edward's mental model: "subcuentas"); each Project
 *              partitions channels, posts, and provider connections.
 *
 *              Data fetching is delegated to TanStack Query (`useQuery`):
 *              - the customer query resolves the authenticated user + accountId
 *                via `authApi.getCurrentUser()`
 *              - the projects query lists projects for that account via
 *                `apiClient.getAccountProjects(accountId)`, gated with
 *                `enabled: !!accountId`
 *
 *              Selection is persisted to localStorage so it survives reloads.
 *              Loading/error/empty states are driven by the query state — the
 *              retry button calls `refetch()` instead of reloading the page.
 *
 *              Downstream consumers call `useProject()` to get
 *              `{ projectId, accountId, setProjectId, setAccountId }`.
 *
 *              Pattern reference: TkDodo (TanStack Query maintainer) on
 *              combining server state queries with React Context. TanStack
 *              docs on `refetch()` for explicit re-fetching after errors.
 * @component ProjectProvider
 * @layer infrastructure
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { authApi } from "@/lib/auth/authApi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProjectContextValue {
  projectId: string;
  accountId: string;
  setProjectId: (id: string) => void;
  setAccountId: (id: string) => void;
}

interface ProjectProviderProps {
  children: ReactNode;
  initialProjectId?: string;
  initialAccountId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "omnipost-active-project";
const ProjectContext = createContext<ProjectContextValue | null>(null);

// ---------------------------------------------------------------------------
// localStorage helpers (SSR-safe)
// ---------------------------------------------------------------------------

interface StoredSelection {
  accountId: string;
  projectId: string;
}

function readStoredSelection(): StoredSelection | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "accountId" in parsed &&
      "projectId" in parsed &&
      typeof (parsed as StoredSelection).accountId === "string" &&
      typeof (parsed as StoredSelection).projectId === "string"
    ) {
      return parsed as StoredSelection;
    }
  } catch {
    // Corrupt data — ignore
  }
  return null;
}

function writeStoredSelection(accountId: string, projectId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accountId, projectId }));
  } catch {
    // Storage full or blocked — ignore
  }
}

// ---------------------------------------------------------------------------
// Provider component
// ---------------------------------------------------------------------------

export function ProjectProvider({
  children,
  initialProjectId,
  initialAccountId,
}: ProjectProviderProps) {
  // When explicit initial values are provided (e.g. by a future Server
  // Component or test wrapper), skip the queries entirely and treat them
  // as already-resolved.
  const hasInitialValues = !!initialProjectId && !!initialAccountId;

  const [accountId, setAccountIdRaw] = useState(initialAccountId ?? "");
  const [projectId, setProjectIdRaw] = useState(initialProjectId ?? "");

  // --- 1) Resolve the authenticated customer (provides accountId) ---

  const customerQuery = useQuery({
    queryKey: ["project-context", "customer"],
    queryFn: () => authApi.getCurrentUser(),
    enabled: !hasInitialValues,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // --- 2) Resolve the active accountId (stored or first) ---

  const resolvedAccountId = useMemo<string | null>(() => {
    if (hasInitialValues) return null;
    const stored = readStoredSelection();
    const customerAccountId = customerQuery.data?.accountId ?? "";
    if (!customerAccountId) return null;
    return stored?.accountId === customerAccountId ? stored.accountId : customerAccountId;
  }, [hasInitialValues, customerQuery.data?.accountId]);

  // --- 3) Fetch projects for that account ---

  const projectsQuery = useQuery({
    queryKey: ["project-context", "projects", resolvedAccountId ?? ""],
    queryFn: () => apiClient.getAccountProjects(resolvedAccountId!),
    enabled: !!resolvedAccountId && !hasInitialValues,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // --- 4) Reconcile fetched data with selected ids ---

  useEffect(() => {
    if (hasInitialValues) return;
    if (!resolvedAccountId) return;

    setAccountIdRaw(resolvedAccountId);

    if (projectsQuery.data === undefined) return;
    const projects = projectsQuery.data;

    if (projects.length === 0) {
      writeStoredSelection(resolvedAccountId, "");
      setProjectIdRaw("");
      return;
    }

    const stored = readStoredSelection();
    const storedProjectExists =
      stored?.accountId === resolvedAccountId && projects.some((p) => p.id === stored.projectId);
    const selectedProjectId = storedProjectExists ? stored.projectId : projects[0]!.id;

    setProjectIdRaw(selectedProjectId);
    writeStoredSelection(resolvedAccountId, selectedProjectId);
  }, [hasInitialValues, resolvedAccountId, projectsQuery.data]);

  // --- 5) Stable setters that also persist to localStorage ---

  const setProjectId = useCallback(
    (id: string) => {
      setProjectIdRaw(id);
      if (accountId) writeStoredSelection(accountId, id);
    },
    [accountId]
  );

  const setAccountId = useCallback(
    (id: string) => {
      setAccountIdRaw(id);
      if (projectId) writeStoredSelection(id, projectId);
    },
    [projectId]
  );

  // --- Derived UI state ---
  // NOTE: when a query has `enabled: false` (e.g. projectsQuery while
  // customer hasn't resolved yet, or after customer errors), TanStack v5
  // keeps `isPending: true` indefinitely. We must check `isError` first
  // to short-circuit the loading state, then derive loading from
  // `isFetching` so disabled queries don't keep the spinner up forever.

  const isError = !hasInitialValues && (customerQuery.isError || projectsQuery.isError);
  const error = customerQuery.error ?? projectsQuery.error;
  const isLoading =
    !hasInitialValues &&
    !isError &&
    (customerQuery.isFetching ||
      (customerQuery.isSuccess && !!resolvedAccountId && projectsQuery.isFetching) ||
      (customerQuery.isPending && !customerQuery.isError));
  const isEmpty =
    !hasInitialValues &&
    !isLoading &&
    !isError &&
    (!customerQuery.data?.accountId ||
      (projectsQuery.data !== undefined && projectsQuery.data.length === 0));

  const handleRetry = useCallback(() => {
    if (customerQuery.isError) void customerQuery.refetch();
    if (projectsQuery.isError) void projectsQuery.refetch();
  }, [customerQuery, projectsQuery]);

  // --- Context value (stable reference via useMemo) ---

  const value = useMemo<ProjectContextValue>(
    () => ({ projectId, accountId, setProjectId, setAccountId }),
    [projectId, accountId, setProjectId, setAccountId]
  );

  // --- Loading state ---

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center py-20"
        role="status"
        aria-label="Loading project context"
      >
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
          <p className="text-sm text-gray-500">Loading projects...</p>
        </div>
      </div>
    );
  }

  // --- Error state ---

  if (isError) {
    const errorMessage = error instanceof Error ? error.message : "Failed to load project context";
    return (
      <div
        className="mx-auto max-w-lg rounded-lg border border-red-200 bg-red-50 p-6 text-center"
        role="alert"
      >
        <h2 className="text-lg font-semibold text-red-800">Failed to load project context</h2>
        <p className="mt-2 text-sm text-red-600">{errorMessage}</p>
        <button
          type="button"
          onClick={handleRetry}
          className="mt-4 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-hidden focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
        >
          Retry
        </button>
      </div>
    );
  }

  // --- Empty state (no accounts or no projects) ---

  if (isEmpty) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
          <svg
            className="h-6 w-6 text-blue-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 10.5v6m3-3H9m4.06-7.19-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
            />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-gray-900">No projects found</h2>
        <p className="mt-2 text-sm text-gray-500">
          {accountId
            ? "This account has no projects yet. Create one to start managing content."
            : "No active accounts were found. Create an account first, then add a project."}
        </p>
      </div>
    );
  }

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useProject(): ProjectContextValue {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error("useProject must be used within a ProjectProvider");
  }
  return context;
}
