/**
 * @file mutations.ts
 * @description Mutation hooks for AI prompt templates — create, update, delete.
 * @layer infrastructure
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createTemplate, deleteTemplate, updateTemplate } from "./api.js";

/**
 * @hook useCreateAIPromptTemplate
 * @description Mutation hook for creating a new AI prompt template.
 * @returns TanStack Query mutation that invalidates the template list on success
 */
export function useCreateAIPromptTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTemplate,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai-templates"] });
    },
  });
}

/**
 * @hook useUpdateAIPromptTemplate
 * @description Mutation hook for updating an existing AI prompt template.
 * @returns TanStack Query mutation that invalidates the template list on success
 */
export function useUpdateAIPromptTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateTemplate,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai-templates"] });
    },
  });
}

/**
 * @hook useDeleteAIPromptTemplate
 * @description Mutation hook for deleting an AI prompt template.
 * @returns TanStack Query mutation that invalidates the template list on success
 */
export function useDeleteAIPromptTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, accountId }: { templateId: string; accountId: string }) =>
      deleteTemplate(templateId, accountId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai-templates"] });
    },
  });
}
