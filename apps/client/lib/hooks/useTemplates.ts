/**
 * @file useTemplates.ts
 * @description Custom hook for template CRUD operations (create, update, delete, duplicate) with TanStack Query cache management, scoped to a project.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Template } from "@/lib/templates/templateEngine";

interface CreateTemplateRequest {
  projectId: string;
  name: string;
  description?: string;
  category: string;
  content: string;
  platforms: string[];
  tags?: string[];
}

interface UpdateTemplateRequest {
  templateId: string;
  name?: string;
  description?: string;
  category?: string;
  content?: string;
  platforms?: string[];
  tags?: string[];
}

interface DuplicateTemplateRequest {
  templateId: string;
  name: string;
}

// API client functions
const templatesApi = {
  async getTemplates(projectId: string): Promise<Template[]> {
    const response = await fetch(`/api/projects/${projectId}/templates`);
    if (!response.ok) {
      throw new Error("Failed to fetch templates");
    }
    const data = await response.json();
    return data.data;
  },

  async createTemplate(request: CreateTemplateRequest): Promise<Template> {
    const response = await fetch(`/api/projects/${request.projectId}/templates`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: request.name,
        description: request.description,
        category: request.category,
        content: request.content,
        platforms: request.platforms,
        tags: request.tags || [],
        variables: [], // Will be extracted by the template engine
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to create template");
    }
    const data = await response.json();
    return data.data;
  },

  async updateTemplate(request: UpdateTemplateRequest): Promise<Template> {
    const { templateId, ...updateData } = request;
    const response = await fetch(`/api/templates/${templateId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updateData),
    });

    if (!response.ok) {
      throw new Error("Failed to update template");
    }
    const data = await response.json();
    return data.data;
  },

  async deleteTemplate(templateId: string): Promise<void> {
    const response = await fetch(`/api/templates/${templateId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error("Failed to delete template");
    }
  },

  async duplicateTemplate(request: DuplicateTemplateRequest): Promise<Template> {
    const response = await fetch(`/api/templates/${request.templateId}/duplicate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: request.name,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to duplicate template");
    }
    const data = await response.json();
    return data.data;
  },
};

export function useTemplates(projectId: string) {
  const queryClient = useQueryClient();

  // Query for fetching templates
  const {
    data: templates = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["templates", projectId],
    queryFn: () => templatesApi.getTemplates(projectId),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Mutation for creating templates
  const createTemplate = useMutation({
    mutationFn: templatesApi.createTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates", projectId] });
    },
  });

  // Mutation for updating templates
  const updateTemplate = useMutation({
    mutationFn: templatesApi.updateTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates", projectId] });
    },
  });

  // Mutation for deleting templates
  const deleteTemplate = useMutation({
    mutationFn: templatesApi.deleteTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates", projectId] });
    },
  });

  // Mutation for duplicating templates
  const duplicateTemplate = useMutation({
    mutationFn: templatesApi.duplicateTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates", projectId] });
    },
  });

  return {
    templates,
    isLoading,
    error,
    refetch,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    duplicateTemplate,
  };
}
