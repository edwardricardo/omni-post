"use client";

/**
 * @file useAIPromptTemplates.ts
 * @description TanStack Query hooks for AI prompt template management.
 *   Provides read (list) and write (create, update, delete) hooks.
 * @layer presentation
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemplateVariableDto {
  name: string;
  type: "text" | "select" | "date" | "url";
  label: string;
  placeholder: string;
  required: boolean;
  options?: string[];
}

export interface AIPromptTemplateDto {
  id: string;
  accountId: string | null;
  name: string;
  category: string;
  platforms: string[];
  prompt: string;
  variables: TemplateVariableDto[];
  tone: string[];
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateInput {
  accountId: string;
  name: string;
  category: string;
  platforms: string[];
  prompt: string;
  variables: TemplateVariableDto[];
  tone: string[];
}

export interface UpdateTemplateInput {
  templateId: string;
  name?: string;
  category?: string;
  platforms?: string[];
  prompt?: string;
  variables?: TemplateVariableDto[];
  tone?: string[];
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const BASE = "/api/backend/ai-templates";

async function fetchTemplates(accountId?: string): Promise<AIPromptTemplateDto[]> {
  const url = accountId ? `${BASE}?accountId=${accountId}` : BASE;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch templates");
  const json = (await res.json()) as { ok: boolean; data?: AIPromptTemplateDto[] };
  return json.data ?? [];
}

async function createTemplate(input: CreateTemplateInput): Promise<{ id: string }> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json()) as { message?: string };
    throw new Error(err.message ?? "Failed to create template");
  }
  const json = (await res.json()) as { ok: boolean; data?: { id: string } };
  return json.data ?? { id: "" };
}

async function updateTemplate(input: UpdateTemplateInput): Promise<AIPromptTemplateDto> {
  const { templateId, ...body } = input;
  const res = await fetch(`${BASE}/${templateId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json()) as { message?: string };
    throw new Error(err.message ?? "Failed to update template");
  }
  const json = (await res.json()) as { ok: boolean; data?: AIPromptTemplateDto };
  if (!json.data) throw new Error("No data returned");
  return json.data;
}

async function deleteTemplate(templateId: string, accountId: string): Promise<void> {
  const res = await fetch(`${BASE}/${templateId}?accountId=${accountId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = (await res.json()) as { message?: string };
    throw new Error(err.message ?? "Failed to delete template");
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const QUERY_KEY = (accountId?: string) => ["ai-templates", accountId ?? "system"];

export function useAIPromptTemplates(accountId?: string) {
  return useQuery({
    queryKey: QUERY_KEY(accountId),
    queryFn: () => fetchTemplates(accountId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateAIPromptTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTemplate,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai-templates"] });
    },
  });
}

export function useUpdateAIPromptTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateTemplate,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai-templates"] });
    },
  });
}

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
