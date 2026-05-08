/**
 * @file api.ts
 * @description Internal fetch helpers for AI prompt template endpoints.
 * @layer infrastructure
 */

import type { AIPromptTemplateDto, CreateTemplateInput, UpdateTemplateInput } from "./types";

const BASE = "/api/backend/ai-templates";

export async function fetchTemplates(accountId?: string): Promise<AIPromptTemplateDto[]> {
  const url = accountId ? `${BASE}?accountId=${accountId}` : BASE;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch templates");
  const json = (await res.json()) as { ok: boolean; data?: AIPromptTemplateDto[] };
  return json.data ?? [];
}

export async function createTemplate(input: CreateTemplateInput): Promise<{ id: string }> {
  const res = await fetch(BASE, {
    method: "POST",
    credentials: "include",
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

export async function updateTemplate(input: UpdateTemplateInput): Promise<AIPromptTemplateDto> {
  const { templateId, ...body } = input;
  const res = await fetch(`${BASE}/${templateId}`, {
    method: "PATCH",
    credentials: "include",
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

export async function deleteTemplate(templateId: string, accountId: string): Promise<void> {
  const res = await fetch(`${BASE}/${templateId}?accountId=${accountId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const err = (await res.json()) as { message?: string };
    throw new Error(err.message ?? "Failed to delete template");
  }
}
