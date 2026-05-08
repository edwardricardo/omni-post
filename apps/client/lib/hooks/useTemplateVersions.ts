/**
 * @file useTemplateVersions.ts
 * @description Custom hook for template version management, supporting version history listing, creation, restoration, and deletion via TanStack Query.
 * @layer infrastructure
 */

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { request, PROXY_BASE } from "@/lib/api/clients/request";

interface TemplateVersion {
  id: string;
  templateId: string;
  version: number;
  content: string;
  variables: string[];
  platforms: string[];
  tags: string[];
  changeLog: string;
  commitMessage?: string;
  author: {
    id: string;
    name: string;
    avatar?: string;
  };
  isActive: boolean;
  parentVersionId?: string;
  branchName?: string;
  createdAt: Date;
}

function makeVersionsApi(projectId: string, templateId: string) {
  const base = `/projects/${projectId}/templates/${templateId}/versions`;
  return {
    async getVersions(): Promise<TemplateVersion[]> {
      const res = await request<{ data: TemplateVersion[] }>(PROXY_BASE, base);
      return res.data;
    },
    async createVersion(
      version: Omit<TemplateVersion, "id" | "createdAt">
    ): Promise<TemplateVersion> {
      const res = await request<{ data: TemplateVersion }>(PROXY_BASE, base, {
        method: "POST",
        body: JSON.stringify(version),
      });
      return res.data;
    },
    async restoreVersion(versionId: string): Promise<void> {
      await request<void>(PROXY_BASE, `${base}/${versionId}/restore`, {
        method: "POST",
      });
    },
    // Backend route for version DELETE is not exposed (PR-46 backlog: needs
    // product decision on retention policy + UI authorization). Consumer's
    // delete button currently 404s; routing through canonical client keeps
    // the contract consistent for when the backend route lands.
    async deleteVersion(versionId: string): Promise<void> {
      await request<void>(PROXY_BASE, `${base}/${versionId}`, {
        method: "DELETE",
      });
    },
  };
}

/**
 * @hook useTemplateVersions
 * @description Version-history hook for a single template, scoped to a project. List query
 *              plus create / restore / delete mutations, all delegating to the canonical
 *              proxy `request<T>` helper (handles `/api/backend` prefix + session cookie).
 * @returns Query state plus three mutation handles.
 */
export function useTemplateVersions(templateId?: string, projectId?: string) {
  const queryClient = useQueryClient();
  const enabled = !!templateId && !!projectId;
  const api = useMemo(
    () => (enabled ? makeVersionsApi(projectId!, templateId!) : null),
    [enabled, projectId, templateId]
  );

  const {
    data: versions = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["template-versions", projectId, templateId],
    queryFn: () => api!.getVersions(),
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const createVersion = useMutation({
    mutationFn: (version: Omit<TemplateVersion, "id" | "createdAt">) => api!.createVersion(version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["template-versions", projectId, templateId] });
      queryClient.invalidateQueries({ queryKey: ["templates", projectId] });
    },
  });

  const restoreVersion = useMutation({
    mutationFn: (versionId: string) => api!.restoreVersion(versionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["template-versions", projectId, templateId] });
      queryClient.invalidateQueries({ queryKey: ["templates", projectId] });
    },
  });

  const deleteVersion = useMutation({
    mutationFn: (versionId: string) => api!.deleteVersion(versionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["template-versions", projectId, templateId] });
    },
  });

  return {
    versions,
    isLoading,
    error,
    refetch,
    createVersion,
    restoreVersion,
    deleteVersion,
  };
}
