/**
 * @file useTemplateData.ts
 * @description Custom hook that fetches content templates from the API via TanStack Query and
 * exposes client-side filtering, sorting, and optimistic local mutation support.
 * @hook useTemplateData
 * @layer infrastructure
 */

import { useState, useMemo, useCallback, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ContentTemplate, AutomationTemplate, FilterOptions, SortOption } from "./types";

/**
 * Fetches templates for the default project from the real API and exposes
 * client-side filtering and sorting.
 *
 * Returns the same shape as the previous mock-based hook so that
 * ContentTemplates.tsx requires no changes:
 *   { templates, setTemplates, automations, sortedTemplates, isLoading }
 *
 * - `setTemplates` allows the parent component to perform optimistic local
 *   mutations (e.g. duplicate). After a real mutation the caller should
 *   invalidate the ["templates"] query to re-sync with the server.
 * - `automations` is kept as an empty array because no automations endpoint
 *   exists yet; the UI already handles a zero-item list gracefully.
 */
export const useTemplateData = (
  projectId: string,
  searchQuery: string,
  filterBy: FilterOptions,
  sortBy: SortOption
) => {
  // ------------------------------------------------------------------
  // Remote data
  // ------------------------------------------------------------------

  const { data: serverTemplates, isLoading } = useQuery<ContentTemplate[]>({
    queryKey: ["templates", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/backend/projects/${projectId}/templates`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch templates: ${res.status}`);
      }
      const body = (await res.json()) as { ok: boolean; value?: ContentTemplate[] };
      return body.value ?? [];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // ------------------------------------------------------------------
  // Local override — null while in sync with the server. Optimistic
  // mutations (e.g. duplicate) via setTemplates populate it; a fresh
  // server payload supersedes any stale override.
  // ------------------------------------------------------------------
  const [override, setOverride] = useState<ContentTemplate[] | null>(null);
  const lastServerRef = useRef<ContentTemplate[] | undefined>(undefined);

  const serverList = serverTemplates ?? [];
  if (lastServerRef.current !== serverTemplates) {
    lastServerRef.current = serverTemplates;
    if (override !== null) setOverride(null);
  }

  const templates = override ?? serverList;

  const setTemplates = useCallback<Dispatch<SetStateAction<ContentTemplate[]>>>((value) => {
    setOverride((prev) => {
      const base = prev ?? lastServerRef.current ?? [];
      return typeof value === "function"
        ? (value as (p: ContentTemplate[]) => ContentTemplate[])(base)
        : value;
    });
  }, []);

  // ------------------------------------------------------------------
  // Automations — no endpoint yet; kept as empty static list
  // ------------------------------------------------------------------
  const automations: AutomationTemplate[] = [];

  // ------------------------------------------------------------------
  // Client-side filtering
  // ------------------------------------------------------------------
  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      if (
        searchQuery &&
        !template.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !template.description.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !template.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
      ) {
        return false;
      }
      if (filterBy.category && template.category !== filterBy.category) return false;
      if (filterBy.platform && !template.platforms.includes(filterBy.platform)) return false;
      if (filterBy.author && template.metadata.author.id !== filterBy.author) return false;
      if (filterBy.performance) {
        const perf = template.metadata.performance;
        if (!perf) return false;
        const score = perf.avgEngagement;
        if (filterBy.performance === "high" && score < 1000) return false;
        if (filterBy.performance === "medium" && (score < 500 || score >= 1000)) return false;
        if (filterBy.performance === "low" && score >= 500) return false;
      }
      return true;
    });
  }, [templates, searchQuery, filterBy]);

  // ------------------------------------------------------------------
  // Client-side sorting
  // ------------------------------------------------------------------
  const sortedTemplates = useMemo(() => {
    return [...filteredTemplates].sort((a, b) => {
      switch (sortBy) {
        case "oldest":
          return (
            new Date(a.metadata.createdAt).getTime() - new Date(b.metadata.createdAt).getTime()
          );
        case "popular":
          return b.metadata.usage.count - a.metadata.usage.count;
        case "performance": {
          const aPerf = a.metadata.performance?.avgEngagement ?? 0;
          const bPerf = b.metadata.performance?.avgEngagement ?? 0;
          return bPerf - aPerf;
        }
        case "newest":
        default:
          return (
            new Date(b.metadata.updatedAt).getTime() - new Date(a.metadata.updatedAt).getTime()
          );
      }
    });
  }, [filteredTemplates, sortBy]);

  return {
    templates,
    setTemplates,
    automations,
    sortedTemplates,
    isLoading,
  };
};
