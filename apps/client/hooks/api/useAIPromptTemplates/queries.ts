/**
 * @file queries.ts
 * @description Read-only hooks for AI prompt templates.
 * @layer infrastructure
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchTemplates } from "./api.js";

const QUERY_KEY = (accountId?: string) => ["ai-templates", accountId ?? "system"];

/**
 * @hook useAIPromptTemplates
 * @description Fetches AI prompt templates, optionally filtered by account.
 * @param accountId - Optional account ID to filter templates; omit for system templates
 * @returns TanStack Query result with prompt template array
 */
export function useAIPromptTemplates(accountId?: string) {
  return useQuery({
    queryKey: QUERY_KEY(accountId),
    queryFn: () => fetchTemplates(accountId),
    staleTime: 5 * 60 * 1000,
  });
}
