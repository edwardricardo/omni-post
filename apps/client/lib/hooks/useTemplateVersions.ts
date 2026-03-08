/**
 * @file useTemplateVersions.ts
 * @description Custom hook for template version management, supporting version history listing, creation, restoration, and deletion via TanStack Query.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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

// API client functions
const templateVersionsApi = {
  async getVersions(projectId: string, templateId: string): Promise<TemplateVersion[]> {
    const response = await fetch(`/api/projects/${projectId}/templates/${templateId}/versions`);
    if (!response.ok) {
      throw new Error("Failed to fetch template versions");
    }
    const data = await response.json();
    return data.data;
  },

  async createVersion(
    projectId: string,
    templateId: string,
    version: Omit<TemplateVersion, "id" | "createdAt">
  ): Promise<TemplateVersion> {
    const response = await fetch(`/api/projects/${projectId}/templates/${templateId}/versions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(version),
    });

    if (!response.ok) {
      throw new Error("Failed to create template version");
    }
    const data = await response.json();
    return data.data;
  },

  async restoreVersion(projectId: string, templateId: string, versionId: string): Promise<void> {
    const response = await fetch(
      `/api/projects/${projectId}/templates/${templateId}/versions/${versionId}/restore`,
      {
        method: "POST",
      }
    );

    if (!response.ok) {
      throw new Error("Failed to restore template version");
    }
  },

  async deleteVersion(versionId: string): Promise<void> {
    const response = await fetch(`/api/template-versions/${versionId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error("Failed to delete template version");
    }
  },
};

export function useTemplateVersions(templateId?: string, projectId?: string) {
  const queryClient = useQueryClient();

  // Query for fetching template versions
  const {
    data: versions = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["template-versions", projectId, templateId],
    queryFn: () => templateVersionsApi.getVersions(projectId!, templateId!),
    enabled: !!templateId && !!projectId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Mutation for creating versions
  const createVersion = useMutation({
    mutationFn: (version: Omit<TemplateVersion, "id" | "createdAt">) =>
      templateVersionsApi.createVersion(projectId!, templateId!, version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["template-versions", projectId, templateId] });
      queryClient.invalidateQueries({ queryKey: ["templates", projectId] });
    },
  });

  // Mutation for restoring versions
  const restoreVersion = useMutation({
    mutationFn: (versionId: string) =>
      templateVersionsApi.restoreVersion(projectId!, templateId!, versionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["template-versions", projectId, templateId] });
      queryClient.invalidateQueries({ queryKey: ["templates", projectId] });
    },
  });

  // Mutation for deleting versions
  const deleteVersion = useMutation({
    mutationFn: templateVersionsApi.deleteVersion,
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
