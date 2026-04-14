/**
 * @file useAiSettings.ts
 * @description TanStack Query hooks for client AI settings.
 *   Covers BYOK key management and pool rate limit status.
 * @layer infrastructure
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AiProvider = "openai" | "anthropic" | "gemini" | "perplexity";

export interface AiRateLimitStatus {
  hasOwnKey: boolean;
  byokProvider: string | null;
  monthlyBudget: number;
  usedThisMonth: number;
  remainingTokens: number;
  resetDate: string;
}

export interface ByokTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = "/api/backend/api/settings/ai";

async function aiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `Request failed with status ${res.status}`);
  }
  const json = (await res.json()) as { ok: boolean; data: T };
  if (!json.ok || !json.data) {
    throw new Error("Unexpected response format");
  }
  return json.data;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * @hook useAiStatus
 * @description Fetches AI rate limit status and BYOK info for the current account.
 * @returns Query result with { data: AiRateLimitStatus, isLoading, error }
 */
export function useAiStatus() {
  return useQuery({
    queryKey: ["settings", "ai"],
    queryFn: () => aiFetch<AiRateLimitStatus>(BASE),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * @hook useSetByokKey
 * @description Stores a BYOK API key for the given AI provider.
 *   Invalidates AI settings query on success.
 * @returns Mutation object with mutate({ provider, apiKey })
 */
export function useSetByokKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ provider, apiKey }: { provider: AiProvider; apiKey: string }) => {
      await aiFetch<void>(`${BASE}/byok`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "ai"] });
    },
  });
}

/**
 * @hook useDeleteByokKey
 * @description Deletes a BYOK API key for the given AI provider.
 *   Invalidates AI settings query on success.
 * @returns Mutation object with mutate(provider)
 */
export function useDeleteByokKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (provider: AiProvider) => {
      await aiFetch<void>(`${BASE}/byok/${provider}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "ai"] });
    },
  });
}

/**
 * @hook useTestByokKey
 * @description Tests a BYOK API key against the provider's API.
 *   Does not invalidate queries (read-only operation).
 * @returns Mutation object with mutate({ provider, apiKey })
 */
export function useTestByokKey() {
  return useMutation({
    mutationFn: async ({ provider, apiKey }: { provider: AiProvider; apiKey: string }) => {
      return aiFetch<ByokTestResult>(`${BASE}/byok/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });
    },
  });
}
