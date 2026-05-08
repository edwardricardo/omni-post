/**
 * @file useTemplates.ts
 * @description Custom hook for template CRUD operations (create, update, delete, duplicate) with TanStack Query cache management, scoped to a project.
 * @layer infrastructure
 */

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Template } from "@/lib/templates/templateEngine";
import { request, PROXY_BASE } from "@/lib/api/clients/request";

interface CreateTemplateInput {
  name: string;
  description?: string;
  category: string;
  content: string;
  platforms: string[];
  tags?: string[];
}

interface UpdateTemplateInput {
  templateId: string;
  name?: string;
  description?: string;
  category?: string;
  content?: string;
  platforms?: string[];
  tags?: string[];
}

interface DuplicateTemplateInput {
  templateId: string;
  name: string;
}

function makeTemplatesApi(projectId: string) {
  const base = `/projects/${projectId}/templates`;
  return {
    async getTemplates(): Promise<Template[]> {
      const res = await request<{ data: Template[] }>(PROXY_BASE, base);
      return res.data;
    },
    async createTemplate(input: CreateTemplateInput): Promise<Template> {
      const res = await request<{ data: Template }>(PROXY_BASE, base, {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          description: input.description,
          category: input.category,
          content: input.content,
          platforms: input.platforms,
          tags: input.tags || [],
          variables: [],
        }),
      });
      return res.data;
    },
    async updateTemplate(input: UpdateTemplateInput): Promise<Template> {
      const { templateId, ...updateData } = input;
      const res = await request<{ data: Template }>(PROXY_BASE, `${base}/${templateId}`, {
        method: "PUT",
        body: JSON.stringify(updateData),
      });
      return res.data;
    },
    async deleteTemplate(templateId: string): Promise<void> {
      await request<void>(PROXY_BASE, `${base}/${templateId}`, { method: "DELETE" });
    },
    async duplicateTemplate(input: DuplicateTemplateInput): Promise<Template> {
      const res = await request<{ data: Template }>(
        PROXY_BASE,
        `${base}/${input.templateId}/duplicate`,
        {
          method: "POST",
          body: JSON.stringify({ name: input.name }),
        }
      );
      return res.data;
    },
  };
}

/**
 * @hook useTemplates
 * @description CRUD hook for project-scoped templates. List query plus create / update /
 *              delete / duplicate mutations, all delegating to the canonical proxy
 *              `request<T>` helper (handles `/api/backend` prefix + session cookie).
 * @returns Query state plus four mutation handles.
 */
export function useTemplates(projectId: string) {
  const queryClient = useQueryClient();
  const api = useMemo(() => makeTemplatesApi(projectId), [projectId]);

  const {
    data: templates = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["templates", projectId],
    queryFn: () => api.getTemplates(),
    staleTime: 5 * 60 * 1000,
  });

  const createTemplate = useMutation({
    mutationFn: api.createTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates", projectId] });
    },
  });

  const updateTemplate = useMutation({
    mutationFn: api.updateTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates", projectId] });
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: api.deleteTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates", projectId] });
    },
  });

  const duplicateTemplate = useMutation({
    mutationFn: api.duplicateTemplate,
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
