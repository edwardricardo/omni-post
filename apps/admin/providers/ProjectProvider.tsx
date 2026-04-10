"use client";

/**
 * @file ProjectProvider.tsx
 * @description React context provider that resolves the active project and account from the API.
 *
 * On mount it fetches accounts via GET /admin/accounts, then fetches projects for the first
 * (or previously-selected) account via GET /accounts/:accountId/projects. The selection is
 * persisted to localStorage so it survives page reloads.
 *
 * Downstream consumers call useProject() to get { projectId, accountId, setProjectId, setAccountId }.
 * While loading, children are replaced with a spinner. When no projects exist, an informative
 * empty state is shown instead.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getErrorMessage } from "@/lib/parseApiError";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProjectContextValue {
  projectId: string;
  accountId: string;
  setProjectId: (id: string) => void;
  setAccountId: (id: string) => void;
}

interface AccountEntry {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
}

interface ProjectEntry {
  id: string;
  accountId: string;
  name: string;
  locale: string;
  createdAt: string;
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
    // Corrupt data -- ignore
  }
  return null;
}

function writeStoredSelection(accountId: string, projectId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accountId, projectId }));
  } catch {
    // Storage full or blocked -- ignore
  }
}

// ---------------------------------------------------------------------------
// API fetch helpers (via Next.js proxy to inject Bearer token)
// ---------------------------------------------------------------------------

async function fetchAccounts(): Promise<AccountEntry[]> {
  const res = await fetch("/api/backend/admin/accounts?page=1&limit=100&isActive=true");
  if (!res.ok) return [];
  const data: {
    ok: boolean;
    value?: {
      accounts: AccountEntry[];
    };
  } = await res.json();
  return data.ok && data.value?.accounts ? data.value.accounts : [];
}

async function fetchProjects(accountId: string): Promise<ProjectEntry[]> {
  const res = await fetch(`/api/backend/accounts/${accountId}/projects`);
  if (!res.ok) return [];
  const data: { ok: boolean; value?: ProjectEntry[] } = await res.json();
  return data.ok && Array.isArray(data.value) ? data.value : [];
}

// ---------------------------------------------------------------------------
// Provider component
// ---------------------------------------------------------------------------

export function ProjectProvider({
  children,
  initialProjectId,
  initialAccountId,
}: ProjectProviderProps) {
  const [accountId, setAccountIdRaw] = useState(initialAccountId ?? "");
  const [projectId, setProjectIdRaw] = useState(initialProjectId ?? "");
  const [isLoading, setIsLoading] = useState(true);
  const [isEmpty, setIsEmpty] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // --- Stable setters that also persist to localStorage ---

  const setProjectId = useCallback(
    (id: string) => {
      setProjectIdRaw(id);
      if (accountId) {
        writeStoredSelection(accountId, id);
      }
    },
    [accountId]
  );

  const setAccountId = useCallback(
    (id: string) => {
      setAccountIdRaw(id);
      // When account changes we cannot keep the old project -- caller should also
      // call setProjectId after resolving new projects. We persist immediately so
      // the account sticks even if the page is closed before projects load.
      if (projectId) {
        writeStoredSelection(id, projectId);
      }
    },
    [projectId]
  );

  // --- Initial data resolution ---

  useEffect(() => {
    // If explicit initial values were passed in (e.g. from a future Server Component),
    // skip the API fetch entirely.
    if (initialProjectId && initialAccountId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function resolve() {
      try {
        const stored = readStoredSelection();

        // 1) Fetch all active accounts
        const accounts = await fetchAccounts();
        if (cancelled) return;

        if (accounts.length === 0) {
          setIsEmpty(true);
          setIsLoading(false);
          return;
        }

        // 2) Pick account -- prefer stored, otherwise first active
        const storedAccountExists = stored
          ? accounts.some((a) => a.id === stored.accountId)
          : false;
        const selectedAccountId = storedAccountExists ? stored!.accountId : accounts[0]!.id;

        setAccountIdRaw(selectedAccountId);

        // 3) Fetch projects for that account
        const projects = await fetchProjects(selectedAccountId);
        if (cancelled) return;

        if (projects.length === 0) {
          setIsEmpty(true);
          setIsLoading(false);
          // Still set accountId so downstream at least has a valid account
          writeStoredSelection(selectedAccountId, "");
          return;
        }

        // 4) Pick project -- prefer stored, otherwise first
        const storedProjectExists =
          storedAccountExists && stored ? projects.some((p) => p.id === stored.projectId) : false;
        const selectedProjectId = storedProjectExists ? stored!.projectId : projects[0]!.id;

        setProjectIdRaw(selectedProjectId);
        writeStoredSelection(selectedAccountId, selectedProjectId);
        setIsLoading(false);
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(getErrorMessage(err));
        setIsLoading(false);
      }
    }

    resolve();

    return () => {
      cancelled = true;
    };
    // Only run once on mount -- initialProjectId / initialAccountId are static props
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-[var(--accent)]" />
          <p className="text-sm text-[var(--text-tertiary)]">Loading projects...</p>
        </div>
      </div>
    );
  }

  // --- Error state ---

  if (errorMsg) {
    return (
      <div
        className="mx-auto max-w-lg rounded-lg border border-[var(--error-subtle)] bg-[var(--error-subtle)] p-6 text-center"
        role="alert"
      >
        <h2 className="text-lg font-semibold text-[var(--error)]">
          Failed to load project context
        </h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{errorMsg}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-md bg-[var(--error)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-hidden focus:ring-2 focus:ring-[var(--error)] focus:ring-offset-2"
        >
          Retry
        </button>
      </div>
    );
  }

  // --- Empty state (no accounts or no projects) ---

  if (isEmpty) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-subtle)]">
          <svg
            className="h-6 w-6 text-[var(--accent)]"
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
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">No projects found</h2>
        <p className="mt-2 text-sm text-[var(--text-tertiary)]">
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
